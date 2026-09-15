import test from "node:test";
import assert from "node:assert/strict";

import {
  getSeoulDateString,
  getSeoulFileDate,
  getSeoulMonthString
} from "../src/utils/dateTime.ts";

test("Seoul date helpers use Asia/Seoul rather than the runtime timezone", () => {
  const utcBeforeMidnight = new Date("2026-09-14T15:30:00.000Z");

  assert.equal(getSeoulDateString(utcBeforeMidnight), "2026-09-15");
  assert.equal(getSeoulMonthString(utcBeforeMidnight), "2026-09");
  assert.equal(getSeoulFileDate(utcBeforeMidnight), "2026-09-15");
});

test("Seoul month rolls over correctly at KST year boundary", () => {
  const date = new Date("2026-12-31T15:05:00.000Z");
  assert.equal(getSeoulDateString(date), "2027-01-01");
  assert.equal(getSeoulMonthString(date), "2027-01");
});
