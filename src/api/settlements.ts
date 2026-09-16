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
