import test from "node:test";
import assert from "node:assert/strict";

import {
  isSettlementEligibleCategory,
  isSettlementRequestId,
  settlementRemaining
} from "../worker/domain/settlement.js";

test("회식비 지출만 정산 가능 카테고리로 인식한다", () => {
  assert.equal(isSettlementEligibleCategory("지출", "회식비"), true);
  assert.equal(isSettlementEligibleCategory("지출", "외식비"), false);
  assert.equal(isSettlementEligibleCategory("수입", "회식비"), false);
});

test("정산 request id를 구분한다", () => {
  assert.equal(isSettlementRequestId("SETTLEMENT_TX_123"), true);
  assert.equal(isSettlementRequestId("BENEFIT_123"), false);
});

test("정산 가능 잔액은 환불과 정산을 모두 차감하고 0 아래로 내려가지 않는다", () => {
  assert.equal(settlementRemaining(120000, [30000, 60000]), 30000);
  assert.equal(settlementRemaining(120000, [50000, 80000]), 0);
});
