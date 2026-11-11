import { assert, test } from 'orca/testing';
import { monthWeeks, sameDay, shiftMonth, withDate, withTime } from './calendar.ts';

test('月曆：一週 7 格、1 號前後補空格對齊星期日開頭，天數含閏年', () => {
  // 2026-11-01 是星期日、11-30 是星期一
  const nov = monthWeeks({ year: 2026, month: 10 });
  assert.equal(nov.length, 5);
  assert.ok(nov.every((w) => w.length === 7));
  assert.equal(nov[0]?.[0], 1);
  assert.deepEqual(nov[4], [29, 30, null, null, null, null, null]);
  // 2026-02-01 是星期日且剛好四週
  assert.equal(monthWeeks({ year: 2026, month: 1 }).length, 4);
  // 2024-02-01 是星期四、閏年 29 天
  const feb24 = monthWeeks({ year: 2024, month: 1 });
  assert.deepEqual(feb24[0]?.slice(0, 5), [null, null, null, null, 1]);
  assert.ok(feb24.flat().includes(29));
});

test('換月跨年', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
});

test('只換日期保留時分；只換時分保留日期', () => {
  const base = new Date(2026, 10, 12, 20, 35).getTime();
  const moved = withDate(base, { year: 2026, month: 11 }, 3);
  assert.equal(new Date(moved).getTime(), new Date(2026, 11, 3, 20, 35).getTime());
  assert.ok(sameDay(moved, { year: 2026, month: 11 }, 3));
  assert.equal(withTime(base, 9, 5), new Date(2026, 10, 12, 9, 5).getTime());
});
