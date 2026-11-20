import type { EditableCandidate } from "./importReview";

export interface ImportDraft {
  version: 1;
  source: "image" | "text";
  text: string;
  stage: "source" | "review";
  items: EditableCandidate[];
}
const key = (owner: string) => `moneybook:import-draft:v1:${encodeURIComponent(owner)}`;

export function parseImportDraft(value: unknown): ImportDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as ImportDraft;
  if (
    draft.version !== 1 ||
    !["image", "text"].includes(draft.source) ||
    !["source", "review"].includes(draft.stage) ||
    typeof draft.text !== "string" ||
    !Array.isArray(draft.items)
  )
    return null;
  const ids = new Set<string>();
  for (const item of draft.items) {
    if (
      !item ||
      typeof item !== "object" ||
      !["expense", "income", "transfer", "refund"].includes(item.kind) ||
      !["high", "medium", "low"].includes(item.confidence) ||
      ![
        "candidateId",
        "requestId",
        "date",
        "time",
        "merchant",
        "memo",
        "sourceText",
        "cardName",
        "suggestedCategoryName",
        "categoryName",
        "paymentMethodName",
        "spendingTarget"
      ].every(field => typeof (item as unknown as Record<string, unknown>)[field] === "string") ||
      !item.candidateId ||
      !item.requestId ||
      ids.has(item.requestId) ||
      typeof item.selected !== "boolean" ||
      (item.queued !== undefined && typeof item.queued !== "boolean") ||
      (item.settlementExpected !== undefined && typeof item.settlementExpected !== "boolean") ||
      (item.settlementLinked !== undefined && typeof item.settlementLinked !== "boolean") ||
      typeof item.amount !== "number" ||
      !Number.isFinite(item.amount) ||
      !Array.isArray(item.reviewReasons) ||
      !item.reviewReasons.every(reason => typeof reason === "string") ||
      ![item.categoryId, item.paymentMethodId].every(id => id === null || typeof id === "string") ||
      ![item.fromAccountId, item.toAccountId].every(
        id => id === undefined || typeof id === "string"
      )
    )
      return null;
    if (
      item.duplicate !== null &&
      (!item.duplicate ||
        typeof item.duplicate !== "object" ||
        typeof item.duplicate.amount !== "number" ||
        !["transactionId", "date", "description", "category"].every(
          field => typeof (item.duplicate as unknown as Record<string, unknown>)[field] === "string"
        ))
    )
      return null;
    ids.add(item.requestId);
  }
  return draft;
}

export function readImportDraft(owner: string): ImportDraft | null {
  if (!owner || typeof window === "undefined") return null;
  try {
    return parseImportDraft(JSON.parse(window.localStorage.getItem(key(owner)) || "null"));
  } catch {
    return null;
  }
}

export function saveImportDraft(owner: string, draft: ImportDraft): boolean {
  if (!owner || typeof window === "undefined") return false;
  try {
    // Completed rows are retained while any unsubmitted row remains, with their original request IDs.
    // Once all rows are queued, neither the rows nor their source text should be offered again.
    if (
      (draft.items.length > 0 && draft.items.every(item => item.queued)) ||
      (draft.items.length === 0 && !draft.text.trim())
    )
      window.localStorage.removeItem(key(owner));
    else window.localStorage.setItem(key(owner), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
