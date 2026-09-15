import { apiRequest } from "./client";
import type { ApiEnvelope } from "./envelope";

export type ImportConfidence = "high" | "medium" | "low";

export interface ImportedDuplicate {
  transactionId: string;
  date: string;
  amount: number;
  description: string;
  paymentMethod: string | null;
  category: string;
}

export interface ImportedTransactionCandidate {
  candidateId: string;
  date: string;
  merchant: string;
  amount: number;
  cardName: string;
  suggestedCategoryName: string;
  kind: "expense" | "refund";
  confidence: ImportConfidence;
  memo: string;
  sourceText: string;
  categoryId: string | null;
  categoryName: string;
  categorySuggestionSource: "history" | "ai" | null;
  paymentMethodId: string | null;
  paymentMethodName: string;
  spendingTarget: string;
  duplicate: ImportedDuplicate | null;
  selected: boolean;
  reviewReasons: string[];
}

export interface AnalyzeTransactionImportResult {
  model: string;
  items: ImportedTransactionCandidate[];
}

export async function analyzeTransactionImport(input: {
  text?: string;
  images?: string[];
}) {
  const raw = await apiRequest<ApiEnvelope<AnalyzeTransactionImportResult>>(
    "/api/import/transactions/analyze",
    {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 90_000
    }
  );
  if (!raw.success || !raw.data) {
    throw new Error(raw.error?.message || "거래 내역을 분석하지 못했습니다.");
  }
  return raw.data;
}
