import test from "node:test";
import assert from "node:assert/strict";

import {
  dateOnly,
  estimateBillingMonth,
  monthOnly
} from "../worker/domain/date.js";

import {
  recurringOccurrenceDate,
  recurringPayload,
  recurringRuleActiveForMonth
} from "../worker/domain/automation.js";

test("dateOnly validates real calendar dates", () => {
  assert.equal(dateOnly("2028-02-29"), "2028-02-29");
  assert.equal(dateOnly("2027-02-29"), "");
  assert.equal(dateOnly("2026-13-01"), "");
  assert.equal(dateOnly(" 2026-09-15 "), "2026-09-15");
});

test("monthOnly accepts only YYYY-MM with a real month", () => {
  assert.equal(monthOnly("2026-09"), "2026-09");
  assert.equal(monthOnly("2026-00"), "");
  assert.equal(monthOnly("2026-13"), "");
});

test("estimateBillingMonth respects cutoff and payment day", () => {
  assert.equal(estimateBillingMonth("2026-09-14", 14, 25), "2026-09");
  assert.equal(estimateBillingMonth("2026-09-15", 14, 25), "2026-10");
  assert.equal(estimateBillingMonth("2026-09-14", 14, 10), "2026-10");
  assert.equal(estimateBillingMonth("2026-09-15", 14, 10), "2026-11");
});

test("estimateBillingMonth clamps cutoff to the last day of short months", () => {
  assert.equal(estimateBillingMonth("2028-02-29", 31, 25), "2028-03");
  assert.equal(estimateBillingMonth("2027-02-28", 31, 31), "2027-03");
});

test("recurringOccurrenceDate clamps 29-31 to the month's last day", () => {
  const rule = { dayOfMonth: 31 };
  assert.equal(recurringOccurrenceDate(rule, "2028-02"), "2028-02-29");
  assert.equal(recurringOccurrenceDate(rule, "2027-02"), "2027-02-28");
  assert.equal(recurringOccurrenceDate(rule, "2026-04"), "2026-04-30");
});

test("recurringRuleActiveForMonth honors enabled and start/end boundaries", () => {
  const rule = {
    enabled: true,
    startMonth: "2026-03",
    endMonth: "2026-10"
  };

  assert.equal(recurringRuleActiveForMonth(rule, "2026-02"), false);
  assert.equal(recurringRuleActiveForMonth(rule, "2026-03"), true);
  assert.equal(recurringRuleActiveForMonth(rule, "2026-10"), true);
  assert.equal(recurringRuleActiveForMonth(rule, "2026-11"), false);
  assert.equal(recurringRuleActiveForMonth({ ...rule, enabled: false }, "2026-06"), false);
});

test("recurringPayload emits account fields appropriate to each transaction type", () => {
  const common = {
    amount: 12000,
    categoryId: "CAT_1",
    description: "정기 거래",
    name: "fallback",
    memo: "memo"
  };

  assert.deepEqual(
    recurringPayload(
      {
        ...common,
        type: "지출",
        paymentMethodId: "CARD_1",
        spendingTarget: "공동"
      },
      "2026-09-15",
      "REQ_EXP"
    ),
    {
      date: "2026-09-15",
      type: "지출",
      amount: 12000,
      categoryId: "CAT_1",
      description: "정기 거래",
      memo: "memo",
      requestId: "REQ_EXP",
      paymentMethodId: "CARD_1",
      spendingTarget: "공동"
    }
  );

  assert.equal(
    recurringPayload(
      { ...common, type: "수입", toAccountId: "BANK_1" },
      "2026-09-15",
      "REQ_INC"
    ).toAccountId,
    "BANK_1"
  );

  const transfer = recurringPayload(
    {
      ...common,
      type: "이체",
      fromAccountId: "BANK_1",
      toAccountId: "BANK_2"
    },
    "2026-09-15",
    "REQ_TR"
  );
  assert.equal(transfer.fromAccountId, "BANK_1");
  assert.equal(transfer.toAccountId, "BANK_2");
});
