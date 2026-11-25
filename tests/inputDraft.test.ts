import test from "node:test";
import assert from "node:assert/strict";

import {
  getRestorableDraftDate,
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

test("draft preserves installments and disabled benefit accrual, and reads legacy drafts", () => {
  const draft = parseInputDraft({
    ...emptyDraft(),
    amount: "360000",
    installmentMonths: 12,
    benefitEnabled: false
  });
  assert.equal(draft?.installmentMonths, 12);
  assert.equal(draft?.benefitEnabled, false);
  assert.equal(parseInputDraft(emptyDraft())?.installmentMonths, 1);
  assert.equal(parseInputDraft(emptyDraft())?.benefitEnabled, true);
  assert.equal(parseInputDraft({ ...emptyDraft(), installmentMonths: 99 })?.installmentMonths, 1);
});

test("draft preserves transaction tags and manual/automatic category choice", () => {
  const draft = parseInputDraft({
    ...emptyDraft(),
    tagsText: "제주여행, 가족",
    categorySource: "auto"
  });
  assert.equal(draft?.tagsText, "제주여행, 가족");
  assert.equal(draft?.categorySource, "auto");
  assert.equal(hasMeaningfulInputDraft(draft!), true);
  assert.equal(parseInputDraft({ ...emptyDraft(), categoryId: "C1" })?.categorySource, "manual");
});

test("draft date is restored only while an entry is in progress", () => {
  const draft = emptyDraft();
  assert.equal(getRestorableDraftDate(null), null);
  // 저장 후 남겨 둔 결제수단·지출대상만 있으면 오늘 날짜로 시작합니다.
  assert.equal(
    getRestorableDraftDate({ ...draft, paymentMethodId: "card", spendingTarget: "공동" }),
    null
  );
  assert.equal(getRestorableDraftDate({ ...draft, amount: "5000" }), "2026-09-15");
  assert.equal(getRestorableDraftDate({ ...draft, description: "점심" }), "2026-09-15");
});
