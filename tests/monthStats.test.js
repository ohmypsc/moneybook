import assert from "node:assert/strict";
import test from "node:test";

import { netMonthStats } from "../worker/domain/monthStats.js";

test("settlement in the next month reduces the original expense month", () => {
  const transactions = [
    {
      transactionId: "EXP_1",
      date: "2026-08-31",
      type: "지출",
      category: "회식비",
      spendingTarget: "공동",
      amount: 120000,
      requestId: "REQ_1"
    },
    {
      transactionId: "SET_1",
      date: "2026-09-01",
      type: "수입",
      amount: 90000,
      reversalOf: "EXP_1",
      requestId: "SETTLEMENT_EXP_1_1"
    }
  ];

  const august = netMonthStats(transactions, "2026-08");
  const september = netMonthStats(transactions, "2026-09");

  assert.equal(august.expenseGross, 120000);
  assert.equal(august.expenseRefunds, 90000);
  assert.equal(august.expense, 30000);
  assert.deepEqual(august.categoryExpense, [{ name: "회식비", amount: 30000 }]);
  assert.equal(september.expense, 0);
  assert.equal(september.income, 0);
});

test("benefit income does not count as monthly income", () => {
  const stats = netMonthStats([
    {
      transactionId: "BEN_1",
      date: "2026-09-10",
      type: "수입",
      amount: 10000,
      requestId: "BENEFIT_RULE_1_REQ_1"
    },
    {
      transactionId: "INC_1",
      date: "2026-09-10",
      type: "수입",
      amount: 500000,
      requestId: "REQ_2"
    }
  ], "2026-09");

  assert.equal(stats.income, 500000);
  assert.equal(stats.incomeGross, 500000);
});


test("manual cash cashback counts as ordinary income", () => {
  const stats = netMonthStats([
    {
      transactionId: "CASHBACK_1",
      date: "2026-09-10",
      type: "수입",
      category: "캐시백",
      amount: 10000,
      requestId: "REQ_CASHBACK_1"
    },
    {
      transactionId: "BEN_1",
      date: "2026-09-10",
      type: "수입",
      category: "캐시백/할인혜택",
      amount: 5000,
      requestId: "BENEFIT_RULE_1_REQ_1"
    }
  ], "2026-09");

  assert.equal(stats.income, 10000);
  assert.equal(stats.incomeGross, 10000);
});
