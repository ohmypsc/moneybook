import assert from "node:assert/strict";
import test from "node:test";

import {
  addMonths,
  installmentAmountForMonth,
  installmentRemainingAfter,
  installmentSchedule,
  normalizeInstallmentMonths
} from "../worker/domain/installment.js";

test("installment months accept 2-36 and treat 0/1/blank as 일시불", () => {
  assert.deepEqual(normalizeInstallmentMonths(""), { months: null });
  assert.deepEqual(normalizeInstallmentMonths(1), { months: null });
  assert.deepEqual(normalizeInstallmentMonths("12"), { months: 12 });
  assert.ok(normalizeInstallmentMonths(37).error);
  assert.ok(normalizeInstallmentMonths(2.5).error);
  assert.ok(normalizeInstallmentMonths(-3).error);
});

test("monthly bills add up to the purchase and the remainder goes to the first month", () => {
  assert.deepEqual(installmentSchedule(1_200_000, 12), Array(12).fill(100_000));
  const odd = installmentSchedule(100_000, 3);
  assert.deepEqual(odd, [33_334, 33_333, 33_333]);
  assert.equal(odd.reduce((a, b) => a + b, 0), 100_000);
  assert.deepEqual(installmentSchedule(-100_000, 3), [-33_334, -33_333, -33_333]);
  assert.deepEqual(installmentSchedule(5_000, 1), [5_000]);
});

test("each billing month gets only its own installment, across year boundaries", () => {
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(installmentAmountForMonth(1_200_000, 12, "2026-11", "2026-10"), 0);
  assert.equal(installmentAmountForMonth(1_200_000, 12, "2026-11", "2026-11"), 100_000);
  assert.equal(installmentAmountForMonth(1_200_000, 12, "2026-11", "2027-10"), 100_000);
  assert.equal(installmentAmountForMonth(1_200_000, 12, "2026-11", "2027-11"), 0);
  assert.equal(installmentAmountForMonth(30_000, null, "2026-11", "2026-11"), 30_000);
  assert.equal(installmentAmountForMonth(30_000, null, "2026-11", "2026-12"), 0);
});

test("remaining balance counts installments still to be billed after a month", () => {
  assert.equal(installmentRemainingAfter(1_200_000, 12, "2026-11", "2026-10"), 1_200_000);
  assert.equal(installmentRemainingAfter(1_200_000, 12, "2026-11", "2026-11"), 1_100_000);
  assert.equal(installmentRemainingAfter(1_200_000, 12, "2026-11", "2027-10"), 0);
});
