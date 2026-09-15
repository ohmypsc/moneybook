import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseCategory,
  choosePaymentMethod,
  dedupeImportedCandidates,
  extractJsonValue,
  findDuplicateTransaction,
  normalizeImportedCandidate,
  normalizeMerchant
} from "../worker/domain/transactionImport.js";

test("import candidate normalizes Korean card approval data", () => {
  const item = normalizeImportedCandidate({
    date: "2026-09-15",
    merchant: "스타벅스 세종점",
    amount: "12,500원",
    cardName: "현대카드",
    status: "expense",
    confidence: "high"
  });
  assert.equal(item.date, "2026-09-15");
  assert.equal(item.amount, 12500);
  assert.equal(item.kind, "expense");
});

test("refund/cancel is classified as refund", () => {
  const item = normalizeImportedCandidate({ status: "승인취소", amount: 5000 });
  assert.equal(item.kind, "refund");
});

test("AI fenced JSON response is extracted", () => {
  const values = extractJsonValue('```json\n{"transactions":[{"amount":5500}]}\n```');
  assert.equal(values.length, 1);
  assert.equal(values[0].amount, 5500);
});

test("card label matches account without trailing 카드", () => {
  const match = choosePaymentMethod("현대카드", [
    { accountId: "A1", displayName: "현대카드", active: true, isDeleted: false },
    { accountId: "A2", displayName: "우리체크", active: true, isDeleted: false }
  ]);
  assert.equal(match?.accountId, "A1");
});

test("historical merchant category wins over AI suggestion", () => {
  const result = chooseCategory(
    { merchant: "스타벅스 세종점", suggestedCategoryName: "생활비" },
    [
      { categoryId: "C1", name: "식비", type: "지출", active: true, isDeleted: false },
      { categoryId: "C2", name: "생활비", type: "지출", active: true, isDeleted: false }
    ],
    [{ type: "지출", description: "스타벅스 세종점", categoryId: "C1" }]
  );
  assert.equal(result.category?.categoryId, "C1");
  assert.equal(result.source, "history");
});

test("same amount/date/card is detected as duplicate", () => {
  const match = findDuplicateTransaction(
    { date: "2026-09-15", amount: 12500, merchant: "맘스터치" },
    [{ transactionId: "T1", type: "지출", date: "2026-09-15", amount: 12500, paymentMethodId: "A1", description: "맘스터치", isDeleted: false }],
    "A1"
  );
  assert.equal(match?.transactionId, "T1");
});


test("same amount/date alone is not enough to mark a duplicate", () => {
  const match = findDuplicateTransaction(
    { date: "2026-09-15", amount: 5000, merchant: "카페A" },
    [{ transactionId: "T2", type: "지출", date: "2026-09-15", amount: 5000, paymentMethodId: "A9", description: "편의점", isDeleted: false }],
    "A1"
  );
  assert.equal(match, null);
});

test("overlapping screenshot transactions are deduplicated", () => {
  const base = { date: "2026-09-15", amount: 5000, merchant: "카페", kind: "expense" };
  const values = dedupeImportedCandidates([{ ...base, candidateId: "1" }, { ...base, candidateId: "2" }]);
  assert.equal(values.length, 1);
});

test("merchant normalization ignores punctuation and parenthetical text", () => {
  assert.equal(normalizeMerchant("스타벅스(세종점)"), "스타벅스");
});
