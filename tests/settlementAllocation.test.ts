import test from "node:test";
import assert from "node:assert/strict";

import { allocateSettlement } from "../src/utils/settlement.ts";

test("받은 총액을 앞의 지출부터 남은 금액만큼 채운다", () => {
  const result = allocateSettlement(90000, [
    { transactionId: "A", remainingAmount: 60000 },
    { transactionId: "B", remainingAmount: 40000 },
    { transactionId: "C", remainingAmount: 10000 }
  ]);
  assert.deepEqual(result.amounts, { A: 60000, B: 30000, C: 0 });
  assert.equal(result.overflow, 0);
});

test("남은 금액 합계보다 많이 받으면 초과분을 알려준다", () => {
  const result = allocateSettlement(50000, [{ transactionId: "A", remainingAmount: 30000 }]);
  assert.deepEqual(result.amounts, { A: 30000 });
  assert.equal(result.overflow, 20000);
});
