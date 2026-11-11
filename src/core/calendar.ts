// 編輯頁日曆選擇器的純計算：月曆格子、換月、只換日期或只換時間。月份一律 0–11（同 Date）。

export type YearMonth = { year: number; month: number };

export function yearMonthOf(ms: number): YearMonth {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** 月曆：一週一列、每列 7 格（星期日開頭）；1 號前與月底後補 null。 */
export function monthWeeks(ym: YearMonth): (number | null)[][] {
  const lead = new Date(ym.year, ym.month, 1).getDay();
  const days = new Date(ym.year, ym.month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const d = new Date(ym.year, ym.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** 換成指定日期，時間沿用 base */
export function withDate(base: number, ym: YearMonth, day: number): number {
  const b = new Date(base);
  return new Date(ym.year, ym.month, day, b.getHours(), b.getMinutes()).getTime();
}

/** 換成指定時分，日期沿用 base */
export function withTime(base: number, hour: number, minute: number): number {
  const b = new Date(base);
  return new Date(b.getFullYear(), b.getMonth(), b.getDate(), hour, minute).getTime();
}

export function sameDay(ms: number, ym: YearMonth, day: number): boolean {
  const d = new Date(ms);
  return d.getFullYear() === ym.year && d.getMonth() === ym.month && d.getDate() === day;
}
