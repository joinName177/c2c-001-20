import type { CategoryMetric, InvestmentRecord, TimeAccount, TimeCategory } from './models';
import { CATEGORIES, CATEGORY_META } from './models';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 按浏览器本地时区取记录归属日历日（YYYY-MM-DD），保证补录到哪一天就计入哪一天 */
export function dayKey(dateIso: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return todayKey();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 今天的本地日历日（YYYY-MM-DD） */
export function todayKey(): string {
  return dayKey(new Date().toISOString());
}

/** 把 YYYY-MM-DD 的日期选择器取值转成当天中午的本地时间 ISO，避免 UTC 偏移串到前一天 */
export function dateInputToIso(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1, 12, 0, 0).toISOString();
}

/** 日历日展示文案 */
export function formatDayLabel(key: string): string {
  if (key === todayKey()) return '今天';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return '昨天';
  const [, month, day] = key.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

/** 指定日期已经累计投入的小时数（补录到该日期的记录同样计入） */
export function dailyInvested(records: InvestmentRecord[], dateKey: string): number {
  return round1(records.filter((item) => dayKey(item.date) === dateKey).reduce((sum, item) => sum + item.hours, 0));
}

export interface DailyBudgetStatus {
  dateKey: string;
  budget: number;
  invested: number;
  /** 含待入账小时后的当天累计 */
  projected: number;
  /** 含待入账小时后是否超出每日可支配 */
  over: boolean;
  /** 超出的小时数（未超为 0） */
  overHours: number;
}

/**
 * 核算某一天相对每日可支配小时数的预算占用。
 * pendingHours 为准备入账的一笔记录小时数，入账前预警用；不传则只看已入账累计。
 */
export function evaluateDailyBudget(records: InvestmentRecord[], account: TimeAccount, dateKey: string, pendingHours = 0): DailyBudgetStatus {
  const invested = dailyInvested(records, dateKey);
  const projected = round1(invested + Math.max(0, pendingHours));
  return {
    dateKey,
    budget: account.dailyHours,
    invested,
    projected,
    over: projected > account.dailyHours,
    overHours: round1(Math.max(0, projected - account.dailyHours)),
  };
}

export function totalInvested(records: InvestmentRecord[]): number {
  return records.reduce((sum, item) => sum + item.hours, 0);
}

export function metricsFor(records: InvestmentRecord[]): CategoryMetric[] {
  const total = totalInvested(records);
  return CATEGORIES.map((category) => {
    const hours = records.filter((item) => item.category === category).reduce((sum, item) => sum + item.hours, 0);
    const meta = CATEGORY_META[category];
    return { category, hours, share: total ? hours / total : 0, roi: meta.roi, color: meta.color, icon: meta.icon };
  });
}

export function portfolioScore(metrics: CategoryMetric[], account: TimeAccount): number {
  const invested = metrics.reduce((sum, item) => sum + item.hours * item.roi, 0);
  const available = Math.max(account.weeklyHours, 1);
  return Math.round((invested / available) * 10) / 10;
}

export function balanceSheet(metrics: CategoryMetric[], account: TimeAccount) {
  const assets = metrics.reduce((sum, item) => sum + item.hours * item.roi, 0);
  const invested = metrics.reduce((sum, item) => sum + item.hours, 0);
  return { assets: Math.round(assets * 10) / 10, liabilities: Math.max(0, Math.round((account.weeklyHours - invested) * 10) / 10), equity: Math.round((assets - Math.max(0, account.weeklyHours - invested)) * 10) / 10 };
}

export function suggestions(metrics: CategoryMetric[], account: TimeAccount): string[] {
  const total = Math.max(metrics.reduce((sum, item) => sum + item.hours, 0), 1);
  const lowest = [...metrics].sort((a, b) => a.hours - b.hours)[0];
  const highest = [...metrics].sort((a, b) => b.hours - a.hours)[0];
  const result: string[] = [];
  if (highest.share > 0.35) result.push(`「${highest.category}」占比 ${Math.round(highest.share * 100)}%，建议每周拿出 2 小时投向低配资产。`);
  if (lowest.share < 0.1) result.push(`「${lowest.category}」只有 ${Math.round(lowest.share * 100)}%，这是当前最值得补仓的长期资产。`);
  if (account.weeklyHours - total > 4) result.push(`还有 ${Math.round(account.weeklyHours - total)} 小时未被配置，可以先建立一笔“探索基金”。`);
  if (!result.length) result.push('你的时间组合分布稳定，继续用每周复盘保持动态平衡。');
  return result;
}

export function record(category: TimeCategory, hours: number, note: string, date = todayKey()): InvestmentRecord {
  // 日期选择器给的是 YYYY-MM-DD，统一折算到当天中午，保证归属日期不受时区影响
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? dateInputToIso(date) : date;
  return { id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, category, hours: Math.max(0.5, Number(hours) || 0.5), note: note.trim() || '未命名投资', date: isoDate };
}

export function sampleSnapshot() {
  const account: TimeAccount = { dailyHours: 8, weeklyHours: 56, updatedAt: new Date().toISOString() };
  const seed: Array<[TimeCategory, number, string]> = [
    ['事业', 16, '产品策略与交付'], ['学习', 10, '阅读与课程'], ['健康', 7, '力量训练与散步'],
    ['关系', 8, '家人和朋友'], ['休息', 9, '睡眠与留白'], ['娱乐', 4, '电影与游戏'],
  ];
  return { account, records: seed.map(([category, hours, note], index) => record(category, hours, note, new Date(Date.now() - index * 86400000).toISOString())) };
}
