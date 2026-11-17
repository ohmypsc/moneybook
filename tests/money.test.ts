import test from "node:test";
import assert from "node:assert/strict";

import { formatMoney } from "../src/utils/money.ts";

test("formatMoney never shows a signed zero", () => {
  assert.equal(formatMoney(-0), "0원");
  assert.equal(formatMoney(-0.3), "0원");
  assert.equal(formatMoney(-0, { showPlus: true }), "0원");
  assert.equal(formatMoney(-0.001, { currency: "USD" }).includes("-"), false);
});

test("formatMoney keeps signs for real amounts", () => {
  assert.equal(formatMoney(-1200), "-1,200원");
  assert.equal(formatMoney(1200, { showPlus: true }), "+1,200원");
  assert.equal(formatMoney(-1200, { absolute: true }), "1,200원");
  assert.equal(formatMoney(Number.NaN), "0원");
});
