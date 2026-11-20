import { apiRequest } from "./client";
import { unwrapEnvelope } from "./envelope";
import type { ApiEnvelope } from "./envelope";
import type { TransactionItem } from "./transactionMutations";

export interface SettlementRecord {
  transactionId: string;
  date: string;
  amount: number;
  toAccountId: string | null;
  toAccount: string | null;
  memo?: string | null;
}

export interface SettlementSummary {
  transactionId: string;
  originalAmount: number;
  settledAmount: number;
  otherOffsetAmount: number;
  remainingAmount: number;
  settlements: SettlementRecord[];
}

export interface CreateSettlementInput {
  transactionId: string;
  amount: number;
  toAccountId: string;
  date: string;
  memo?: string;
  requestId?: string;
}

export interface CreateSettlementResult {
  created: boolean;
  duplicate: boolean;
  transaction: TransactionItem;
  summary: SettlementSummary;
}

export async function getSettlementSummary(transactionId: string) {
  const raw = await apiRequest<ApiEnvelope<SettlementSummary> | SettlementSummary>(
    `/api/transactions/settlement-summary?transactionId=${encodeURIComponent(transactionId)}`
  );
  return unwrapEnvelope<SettlementSummary>(raw);
}

export async function createSettlement(input: CreateSettlementInput) {
  const raw = await apiRequest<ApiEnvelope<CreateSettlementResult> | CreateSettlementResult>(
    "/api/transactions/settle",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  return unwrapEnvelope<CreateSettlementResult>(raw);
}

export interface SettlementCandidate extends TransactionItem {
  remainingAmount: number;
}

export interface SettlementCandidatesResponse {
  total: number;
  remainingTotal: number;
  items: SettlementCandidate[];
}

/** '정산 예정'으로 표시했고 아직 다 받지 못한 지출. includeTransactionId는 표시가 없어도 포함합니다. */
export async function getSettlementCandidates(includeTransactionId?: string) {
  const query = includeTransactionId
    ? `?includeTransactionId=${encodeURIComponent(includeTransactionId)}`
    : "";
  const raw = await apiRequest<
    ApiEnvelope<SettlementCandidatesResponse> | SettlementCandidatesResponse
  >(`/api/transactions/settlement-candidates${query}`);
  return unwrapEnvelope<SettlementCandidatesResponse>(raw);
}

export interface CreateSettlementBatchInput {
  items: Array<{ transactionId: string; amount: number }>;
  toAccountId: string;
  date: string;
  memo?: string;
  requestId?: string;
}

export interface CreateSettlementBatchResult {
  created: boolean;
  duplicate: boolean;
  groupId: string | null;
  transactions: TransactionItem[];
  summaries: SettlementSummary[];
}

/** 받은 돈을 여러 지출에 나눠 한 번에 반영합니다(전부 저장되거나 전부 취소). */
export async function createSettlementBatch(input: CreateSettlementBatchInput) {
  const raw = await apiRequest<
    ApiEnvelope<CreateSettlementBatchResult> | CreateSettlementBatchResult
  >("/api/transactions/settle-batch", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return unwrapEnvelope<CreateSettlementBatchResult>(raw);
}
