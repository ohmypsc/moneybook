import test from "node:test";
import assert from "node:assert/strict";

import { isPreDiscountBenefitTransaction } from "../worker/domain/benefit.js";

test("선할인 자동 반영 거래를 일반 수입과 구분한다", () => {
  assert.equal(isPreDiscountBenefitTransaction({
    type: "수입",
    requestId: "BENEFIT_RULE_1_REQ_1",
    description: "온누리 선할인"
  }), true);

  assert.equal(isPreDiscountBenefitTransaction({
    type: "수입",
    requestId: "BENEFIT_RULE_1_REQ_1",
    description: "온누리 혜택 적립"
  }), false);

  assert.equal(isPreDiscountBenefitTransaction({
    type: "수입",
    requestId: "REQ_1",
    description: "온누리 선할인"
  }), false);
});
