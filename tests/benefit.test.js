import test from "node:test";
import assert from "node:assert/strict";

import {
  isBenefitTransaction,
  isPreDiscountBenefitTransaction
} from "../worker/domain/benefit.js";

test("자동 혜택 거래를 일반 수입과 구분한다", () => {
  assert.equal(isBenefitTransaction({
    type: "수입",
    requestId: "BENEFIT_RULE_1_REQ_1",
    description: "온누리 선할인"
  }), true);

  assert.equal(isBenefitTransaction({
    type: "수입",
    requestId: "BENEFIT_RULE_2_REQ_1",
    description: "여민전 혜택 적립"
  }), true);

  assert.equal(isBenefitTransaction({
    type: "수입",
    requestId: "REQ_1",
    description: "여민전 혜택 적립"
  }), false);
});

test("선할인 혜택과 결제 후 캐시백·포인트 혜택을 구분한다", () => {
  assert.equal(isPreDiscountBenefitTransaction({
    type: "수입",
    requestId: "BENEFIT_RULE_1_REQ_1",
    description: "온누리 선할인"
  }), true);

  assert.equal(isPreDiscountBenefitTransaction({
    type: "수입",
    requestId: "BENEFIT_RULE_2_REQ_1",
    description: "여민전 혜택 적립"
  }), false);
});
