import test from "node:test";
import assert from "node:assert/strict";
import {
  parseImportDraft,
  readImportDraft,
  saveImportDraft,
  type ImportDraft
} from "../src/features/importTransactions/importDraft.ts";
import type { EditableCandidate } from "../src/features/importTransactions/importReview.ts";

const row: EditableCandidate = {
  candidateId: "ROW1",
  requestId: "STABLE1",
  kind: "transfer",
  selected: true,
  date: "2026-11-16",
  time: "",
  amount: 10000,
  merchant: "생활비",
  memo: "메모",
  sourceText: "원문",
  cardName: "",
  suggestedCategoryName: "",
  confidence: "high",
  categoryId: "C1",
  categoryName: "이체",
  categorySuggestionSource: null,
  paymentMethodId: null,
  paymentMethodName: "",
  spendingTarget: "공동",
  fromAccountId: "A",
  toAccountId: "B",
  duplicate: null,
  reviewReasons: []
};
const draft: ImportDraft = {
  version: 1,
  source: "text",
  text: "입출금 내역",
  stage: "review",
  items: [row]
};
function storage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    }
  });
  return values;
}

test("import drafts preserve user isolation, input fields, and retry request IDs", () => {
  storage();
  assert.equal(saveImportDraft("미영", draft), true);
  assert.deepEqual(readImportDraft("미영"), draft);
  assert.equal(readImportDraft("승철"), null);
  saveImportDraft("승철", { ...draft, text: "승철 내역" });
  assert.equal(readImportDraft("미영")?.text, draft.text);
  assert.equal(readImportDraft("미영")?.items[0].requestId, "STABLE1");
});

test("partial saves retain queued flags; completed drafts clear source text as well", () => {
  storage();
  const partial = {
    ...draft,
    items: [
      { ...row, queued: true, selected: false },
      { ...row, candidateId: "ROW2", requestId: "STABLE2" }
    ]
  };
  saveImportDraft("미영", partial);
  assert.equal(readImportDraft("미영")?.items[0].queued, true);
  assert.equal(readImportDraft("미영")?.items[1].requestId, "STABLE2");
  saveImportDraft("미영", { ...draft, items: [{ ...row, queued: true }] });
  assert.equal(readImportDraft("미영"), null);
});

test("text-only drafts survive reopening and explicit reset removes them", () => {
  storage();
  saveImportDraft("미영", { ...draft, stage: "source", items: [] });
  assert.equal(readImportDraft("미영")?.text, draft.text);
  saveImportDraft("미영", { ...draft, stage: "source", text: "", items: [] });
  assert.equal(readImportDraft("미영"), null);
});

test("corrupt drafts and duplicate request IDs are rejected without crashing", () => {
  storage();
  assert.equal(parseImportDraft({ ...draft, items: [{ ...row, merchant: null }] }), null);
  assert.equal(parseImportDraft({ ...draft, items: [row, row] }), null);
  assert.equal(parseImportDraft({ ...draft, items: [{ ...row, requestId: "" }] }), null);
  assert.equal(parseImportDraft({ ...draft, items: [{ ...row, reviewReasons: [null] }] }), null);
  window.localStorage.setItem(
    "moneybook:import-draft:v1:" + encodeURIComponent("미영"),
    "broken JSON"
  );
  assert.equal(readImportDraft("미영"), null);
});

test("storage failures are reported so UI cannot claim a successful draft save", () => {
  storage();
  window.localStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  assert.equal(saveImportDraft("미영", draft), false);
});
