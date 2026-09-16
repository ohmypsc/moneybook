import test from "node:test";
import assert from "node:assert/strict";

import {
  isSettlementEligibleCategory,
  isSettlementRequestId,
  settlementRemaining,
  systemCategoryRole
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


test("시스템 카테고리는 이름 또는 고정 ID로 역할을 유지한다", () => {
  assert.equal(systemCategoryRole("지출", "회식비", "CAT_X"), "settlement_expense");
  assert.equal(systemCategoryRole("지출", "이름이 바뀜", "CAT_SYSTEM_GROUP_MEAL"), "settlement_expense");
  assert.equal(systemCategoryRole("수입", "정산받음", "CAT_X"), "settlement_income");
  assert.equal(systemCategoryRole("수입", "캐시백/할인혜택", "CAT_X"), "benefit_income");
  assert.equal(systemCategoryRole("수입", "캐시백", "CAT_DEFAULT_CASHBACK_INCOME"), "");
});
