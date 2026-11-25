import test from "node:test";
import assert from "node:assert/strict";

import { buildCardBillBreakdown, estimateBillingMonth } from "../src/utils/cardBilling.ts";
import { estimateBillingMonth as serverEstimate } from "../worker/domain/date.js";
import type { Transaction } from "../src/api/transactions.ts";

function tx(partial: Partial<Transaction>): Transaction {
  return {
    transactionId: Math.random().toString(36),
    date: "2026-11-01",
    type: "지출",
    categoryId: null,
    category: "",
    amount: 0,
    fromAccountId: null,
    fromAccount: null,
    toAccountId: null,
    toAccount: null,
    paymentMethodId: null,
    paymentMethod: null,
    spendingTarget: null,
    description: "",
    memo: "",
    billingOverride: null,
    billingMonth: null,
    groupId: null,
    requestId: null,
    reversalOf: null,
    createdAt: null,
    ...partial
  } as Transaction;
}

test("client billing month estimate matches the server", () => {
  for (const date of ["2026-01-31", "2026-02-28", "2026-03-14", "2026-03-15", "2026-12-20"]) {
    for (const [cutoff, payDay] of [
      [14, 25],
      [31, 14],
      [15, 1],
      [30, 30]
    ]) {
      assert.equal(
        estimateBillingMonth(date, cutoff, payDay),
        serverEstimate(date, cutoff, payDay)
      );
    }
  }
});

test("card bill breakdown picks this month's usage, installments, refunds and payments", () => {
  const card = { accountId: "C1", billingCutoffDay: 31, paymentDay: 14 };
  const items = [
    tx({ date: "2026-10-05", paymentMethodId: "C1", amount: 10_000 }),
    tx({ date: "2026-11-02", paymentMethodId: "C1", amount: 5_000 }), // 12월 청구
    tx({ date: "2026-10-09", paymentMethodId: "C2", amount: 7_000 }), // 다른 카드
    tx({ date: "2026-09-10", paymentMethodId: "C1", amount: 90_000, installmentMonths: 3 }),
    tx({ date: "2026-10-20", paymentMethodId: "C1", amount: 8_000, refundAmount: 3_000 }),
    tx({
      date: "2026-11-14",
      type: "이체",
      toAccountId: "C1",
      amount: 4_000,
      billingMonth: "2026-11"
    })
  ];
  const result = buildCardBillBreakdown(items, card, "2026-11");
  assert.equal(result.usage.length, 3);
  assert.equal(result.usageTotal, 10_000 + 30_000 + 5_000);
  const installment = result.usage.find(item => item.transaction.amount === 90_000);
  assert.equal(installment?.installmentIndex, 2);
  assert.equal(result.paymentTotal, 4_000);
});
