import test from "node:test";
import assert from "node:assert/strict";

import { formatCalendarAmount } from "../src/pages/CalendarPage/calendarAmount.ts";

test("달력 금액은 같은 규칙으로 줄여 쓴다", () => {
  assert.equal(formatCalendarAmount(0), "0");
  assert.equal(formatCalendarAmount(8900), "8,900");
  assert.equal(formatCalendarAmount(-9999), "9,999");
  assert.equal(formatCalendarAmount(10000), "1만");
  assert.equal(formatCalendarAmount(98500), "9.9만");
  assert.equal(formatCalendarAmount(99960), "10만");
  assert.equal(formatCalendarAmount(359000), "36만");
  assert.equal(formatCalendarAmount(3590000), "359만");
  assert.equal(formatCalendarAmount(4200000), "420만");
  assert.equal(formatCalendarAmount(99_999_000), "1억");
  assert.equal(formatCalendarAmount(123_000_000), "1.2억");
  assert.equal(formatCalendarAmount(25_000_000_000), "250억");
});

test("부호를 붙여도 7글자를 넘지 않는다", () => {
  for (const value of [9999, 99_949, 99_950, 999_999, 9_994_999, 99_990_000, 9_990_000_000]) {
    assert.ok(`-${formatCalendarAmount(value)}`.length <= 7, String(value));
  }
});
