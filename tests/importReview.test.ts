import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportPayload,
  changeImportKind,
  deriveReviewReasons,
  type EditableCandidate
} from "../src/features/importTransactions/importReview.ts";
import type { BootstrapData } from "../src/types/bootstrap.ts";

const bootstrap = {
  categories: ["지출", "수입", "이체"].map((type, index) => ({
    categoryId: `C${index}`,
    type,
    active: true,
    isDeleted: false
  })),
  accounts: ["A", "B"].map(accountId => ({
    accountId,
    active: true,
    isDeleted: false,
    subType: "통장"
  })),
  spendingTargets: ["공동"]
} as BootstrapData;
const row: EditableCandidate = {
  candidateId: "IMP1",
  requestId: "REQUEST1",
  kind: "expense",
  selected: true,
  date: "2026-11-16",
  time: "",
  amount: 10000,
  merchant: "거래",
  memo: "",
  sourceText: "",
  cardName: "",
  suggestedCategoryName: "",
  confidence: "high",
  categoryId: "C0",
  categoryName: "",
  categorySuggestionSource: null,
  paymentMethodId: "A",
  paymentMethodName: "",
  spendingTarget: "공동",
  duplicate: null,
  reviewReasons: []
};

test("mixed import sends only account fields appropriate to each transaction type", () => {
  const expense = buildImportPayload(row, bootstrap);
  const income = buildImportPayload(
    { ...row, kind: "income", categoryId: "C1", toAccountId: "B" },
    bootstrap
  );
  const transfer = buildImportPayload(
    { ...row, kind: "transfer", categoryId: "C2", fromAccountId: "A", toAccountId: "B" },
    bootstrap
  );
  assert.equal(expense.type, "지출");
  assert.equal(expense.paymentMethodId, "A");
  assert.equal(income.type, "수입");
  assert.equal(income.toAccountId, "B");
  assert.equal(income.paymentMethodId, undefined);
  assert.equal(income.spendingTarget, undefined);
  assert.equal(transfer.type, "이체");
  assert.equal(transfer.fromAccountId, "A");
  assert.equal(transfer.toAccountId, "B");
  assert.equal(transfer.paymentMethodId, undefined);
  assert.equal(transfer.benefitRuleId, undefined);
});

test("import validates same-account transfer, mismatched categories, inactive accounts, refund, and calendar dates", () => {
  assert.throws(
    () =>
      buildImportPayload(
        { ...row, kind: "transfer", categoryId: "C2", fromAccountId: "A", toAccountId: "A" },
        bootstrap
      ),
    /달라야/
  );
  assert.throws(
    () => buildImportPayload({ ...row, kind: "income", toAccountId: "B" }, bootstrap),
    /수입 카테고리/
  );
  assert.throws(
    () => buildImportPayload({ ...row, paymentMethodId: "missing" }, bootstrap),
    /계좌/
  );
  assert.throws(() => buildImportPayload({ ...row, kind: "refund" }, bootstrap), /원거래/);
  assert.ok(deriveReviewReasons({ ...row, date: "2026-02-30" }).includes("날짜 확인 필요"));
});

test("type changes clear incompatible fields and retries keep request identity", () => {
  const income = changeImportKind(row, "income");
  assert.equal(income.categoryId, null);
  assert.equal(income.paymentMethodId, null);
  assert.equal(income.requestId, row.requestId);
  assert.equal(
    buildImportPayload(row, bootstrap).requestId,
    buildImportPayload(row, bootstrap).requestId
  );
  const refund = { ...row, kind: "refund" as const };
  assert.equal(changeImportKind(refund, "income"), refund);
});

test("import carries typed tags to the queued payload", () => {
  const tagged = { ...row, tagsText: "가족, 여행" };
  assert.deepEqual(buildImportPayload(tagged, bootstrap).tags, ["가족", "여행"]);
  assert.throws(() => buildImportPayload({ ...row, tagsText: "a".repeat(31) }, bootstrap), /30자/);
});
