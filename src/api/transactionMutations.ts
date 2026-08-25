import {
  apiRequest
} from "./client";

import {
  unwrapEnvelope
} from "./envelope";

import type {
  ApiEnvelope
} from "./envelope";


export type TransactionType =
  | "수입"
  | "지출"
  | "이체";


export interface TransactionItem {
  transactionId: string;

  date: string;

  type:
    TransactionType;

  categoryId:
    string | null;

  category: string;

  amount: number;

  fromAccountId:
    string | null;

  fromAccount:
    string | null;

  toAccountId:
    string | null;

  toAccount:
    string | null;

  paymentMethodId:
    string | null;

  paymentMethod:
    string | null;

  spendingTarget:
    string | null;

  memo: string;

  billingOverride:
    string | null;

  billingMonth:
    string | null;

  groupId:
    string | null;

  requestId:
    string | null;

  reversalOf:
    string | null;

  createdAt:
    string | null;

  updatedAt:
    string | null;

  createdBy: string;

  updatedBy: string;

  deletedAt:
    string | null;

  deletedBy: string;

  isDeleted: boolean;

  row: number;
}


export interface TransactionListResponse {
  total: number;

  items:
    TransactionItem[];
}


export interface TransactionListParams {
  dateFrom?: string;

  dateTo?: string;

  type?:
    TransactionType;

  categoryId?: string;

  accountId?: string;

  spendingTarget?: string;

  q?: string;

  limit?: number;

  offset?: number;
}


export interface UpdateTransactionInput {
  transactionId: string;

  date?: string;

  type?:
    TransactionType;

  categoryId?: string;

  amount?: number;

  fromAccountId?: string;

  toAccountId?: string;

  paymentMethodId?: string;

  spendingTarget?: string;

  memo?: string;

  billingMonth?: string;
}


export interface UpdateTransactionResult {
  updated: boolean;

  transaction:
    TransactionItem;
}


export interface DeleteTransactionResult {
  deleted: boolean;

  alreadyDeleted?: boolean;

  transactionId: string;
}


export interface RestoreTransactionResult {
  restored: boolean;

  alreadyActive?: boolean;

  transactionId?: string;

  transaction?:
    TransactionItem;
}


function appendListParams(
  searchParams:
    URLSearchParams,

  params:
    TransactionListParams
) {
  if (
    params.dateFrom
  ) {
    searchParams.set(
      "dateFrom",
      params.dateFrom
    );
  }


  if (
    params.dateTo
  ) {
    searchParams.set(
      "dateTo",
      params.dateTo
    );
  }


  if (
    params.type
  ) {
    searchParams.set(
      "type",
      params.type
    );
  }


  if (
    params.categoryId
  ) {
    searchParams.set(
      "categoryId",
      params.categoryId
    );
  }


  if (
    params.accountId
  ) {
    searchParams.set(
      "accountId",
      params.accountId
    );
  }


  if (
    params.spendingTarget
  ) {
    searchParams.set(
      "spendingTarget",
      params.spendingTarget
    );
  }


  if (
    params.q
  ) {
    searchParams.set(
      "q",
      params.q
    );
  }


  if (
    params.limit !==
      undefined
  ) {
    searchParams.set(
      "limit",
      String(
        params.limit
      )
    );
  }


  if (
    params.offset !==
      undefined
  ) {
    searchParams.set(
      "offset",
      String(
        params.offset
      )
    );
  }
}


export async function getTransactionsIncludingDeleted(
  params:
    TransactionListParams = {}
) {
  const searchParams =
    new URLSearchParams();


  appendListParams(
    searchParams,
    params
  );


  searchParams.set(
    "includeDeleted",
    "true"
  );


  const raw =
    await apiRequest<
      | ApiEnvelope<
          TransactionListResponse
        >
      | TransactionListResponse
    >(
      `/api/transactions?${searchParams.toString()}`
    );


  return unwrapEnvelope<
    TransactionListResponse
  >(
    raw
  );
}


export async function updateTransaction(
  input:
    UpdateTransactionInput
) {
  const raw =
    await apiRequest<
      | ApiEnvelope<
          UpdateTransactionResult
        >
      | UpdateTransactionResult
    >(
      "/api/transactions/update",
      {
        method: "POST",

        body:
          JSON.stringify(
            input
          )
      }
    );


  return unwrapEnvelope<
    UpdateTransactionResult
  >(
    raw
  );
}


export async function deleteTransaction(
  transactionId:
    string
) {
  const raw =
    await apiRequest<
      | ApiEnvelope<
          DeleteTransactionResult
        >
      | DeleteTransactionResult
    >(
      "/api/transactions/delete",
      {
        method: "POST",

        body:
          JSON.stringify({
            transactionId
          })
      }
    );


  return unwrapEnvelope<
    DeleteTransactionResult
  >(
    raw
  );
}


export async function restoreTransaction(
  transactionId:
    string
) {
  const raw =
    await apiRequest<
      | ApiEnvelope<
          RestoreTransactionResult
        >
      | RestoreTransactionResult
    >(
      "/api/transactions/restore",
      {
        method: "POST",

        body:
          JSON.stringify({
            transactionId
          })
      }
    );


  return unwrapEnvelope<
    RestoreTransactionResult
  >(
    raw
  );
}
