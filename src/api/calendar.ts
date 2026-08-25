import { apiRequest } from "./client";
import {
  unwrapEnvelope
} from "./envelope";
import type {
  ApiEnvelope
} from "./envelope";

export type LedgerTransactionType =
  | "지출"
  | "수입"
  | "이체";

export interface CalendarTransaction {
  transactionId: string;

  date: string;

  type: LedgerTransactionType;

  categoryId: string | null;
  category: string;

  amount: number;

  fromAccountId: string | null;
  fromAccount: string | null;

  toAccountId: string | null;
  toAccount: string | null;

  paymentMethodId: string | null;
  paymentMethod: string | null;

  spendingTarget: string | null;

  memo: string;

  billingOverride: string | null;
  billingMonth: string | null;

  groupId: string | null;
  requestId: string | null;
  reversalOf: string | null;

  createdAt: string | null;
  updatedAt: string | null;

  createdBy?: string;
  updatedBy?: string;

  deletedAt?: string | null;
  deletedBy?: string;

  isDeleted: boolean;
}

export interface CalendarTransactionsResponse {
  total: number;
  items: CalendarTransaction[];
}

export interface GetCalendarTransactionsParams {
  dateFrom?: string;
  dateTo?: string;

  type?: LedgerTransactionType;

  categoryId?: string;
  accountId?: string;
  spendingTarget?: string;

  q?: string;

  limit?: number;
  offset?: number;
}

export async function getCalendarTransactions(
  params: GetCalendarTransactionsParams = {}
) {
  const searchParams =
    new URLSearchParams();

  if (params.dateFrom) {
    searchParams.set(
      "dateFrom",
      params.dateFrom
    );
  }

  if (params.dateTo) {
    searchParams.set(
      "dateTo",
      params.dateTo
    );
  }

  if (params.type) {
    searchParams.set(
      "type",
      params.type
    );
  }

  if (params.categoryId) {
    searchParams.set(
      "categoryId",
      params.categoryId
    );
  }

  if (params.accountId) {
    searchParams.set(
      "accountId",
      params.accountId
    );
  }

  if (params.spendingTarget) {
    searchParams.set(
      "spendingTarget",
      params.spendingTarget
    );
  }

  if (params.q) {
    searchParams.set(
      "q",
      params.q
    );
  }

  searchParams.set(
    "limit",
    String(
      params.limit ?? 1000
    )
  );

  if (
    params.offset !== undefined
  ) {
    searchParams.set(
      "offset",
      String(params.offset)
    );
  }

  const query =
    searchParams.toString();

  const url =
    query
      ? `/api/transactions?${query}`
      : "/api/transactions";

  const raw =
    await apiRequest<
      | ApiEnvelope<CalendarTransactionsResponse>
      | CalendarTransactionsResponse
    >(url);

  return unwrapEnvelope<
    CalendarTransactionsResponse
  >(raw);
}
