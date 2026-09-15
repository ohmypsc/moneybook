import test from "node:test";
import assert from "node:assert/strict";

import {
  hasMeaningfulInputDraft,
  parseInputDraft,
  type InputDraft
} from "../src/pages/InputPage/inputDraft.ts";

function emptyDraft(): InputDraft {
  return {
    mode: "expense",
    date: "2026-09-15",
    amount: "",
    description: "",
    categoryId: "",
    paymentMethodId: "",
    spendingTarget: "",
    fromAccountId: "",
    toAccountId: "",
    billingMonth: "2026-09",
    memo: "",
    benefitRewardUsedAmount: "",
    loanPrincipalAmount: "",
    loanInterestAmount: ""
  };
}

test("parseInputDraft rejects invalid input modes and normalizes optional text", () => {
  assert.equal(parseInputDraft({ mode: "broken" }), null);
  const parsed = parseInputDraft({ mode: "expense", amount: "12000" });
  assert.equal(parsed?.amount, "12000");
  assert.equal(parsed?.memo, "");
});

test("meaningful draft ignores date/billing month alone but keeps real user input", () => {
  const draft = emptyDraft();
  assert.equal(hasMeaningfulInputDraft(draft), false);
  assert.equal(hasMeaningfulInputDraft({ ...draft, description: "점심" }), true);
  assert.equal(hasMeaningfulInputDraft({ ...draft, amount: "10000" }), true);
});
