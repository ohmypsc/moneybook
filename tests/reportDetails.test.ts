import test from "node:test";
import assert from "node:assert/strict";
import {
  reportExpenseAmounts,
  reloadTransactionWindow
} from "../src/pages/HistoryPage/reportDetails.ts";

test("report details show original, deductions and actual expense, including full refunds", () => {
  assert.deepEqual(
    reportExpenseAmounts({ amount: 50000, reversalAmount: 20000, netAmount: 30000 }),
    { original: 50000, actual: 30000, deducted: 20000 }
  );
  assert.deepEqual(reportExpenseAmounts({ amount: 50000, reversalAmount: 50000, netAmount: 0 }), {
    original: 50000,
    actual: 0,
    deducted: 50000
  });
  assert.deepEqual(reportExpenseAmounts({ amount: 50000 }), {
    original: 50000,
    actual: 50000,
    deducted: 0
  });
  assert.equal(reportExpenseAmounts({ amount: 50000, reversalAmount: 10000 }).actual, 40000);
});

test("returning to an edited list reloads all loaded rows beyond a server page", async () => {
  const calls: number[][] = [];
  const rows = Array.from({ length: 1500 }, (_, id) => ({ id, memo: id === 1100 ? "수정됨" : "" }));
  const result = await reloadTransactionWindow(async (offset, limit) => {
    calls.push([offset, limit]);
    return { items: rows.slice(offset, offset + limit), total: rows.length };
  }, 1200);
  assert.deepEqual(calls, [
    [0, 1000],
    [1000, 200]
  ]);
  assert.equal(result?.items.length, 1200);
  assert.equal(result?.items[1100].memo, "수정됨");
  assert.equal(result?.total, 1500);
});

test("returning after an edit that leaves the filter handles a smaller result set", async () => {
  let calls = 0;
  const result = await reloadTransactionWindow(async () => {
    calls++;
    return { items: ["remaining"], total: 1 };
  }, 200);
  assert.equal(calls, 1);
  assert.deepEqual(result, { items: ["remaining"], total: 1 });
});

test("a stale reload stops without replacing the newly selected list", async () => {
  let calls = 0;
  const result = await reloadTransactionWindow(
    async () => {
      calls++;
      return { items: Array.from({ length: 1000 }, (_, id) => id), total: 2000 };
    },
    1500,
    () => false
  );
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test("empty and ordinary lists terminate and keep the standard page size", async () => {
  const result = await reloadTransactionWindow(async (offset, limit) => {
    assert.equal(offset, 0);
    assert.equal(limit, 100);
    return { items: [], total: 0 };
  }, 0);
  assert.deepEqual(result, { items: [], total: 0 });
});
