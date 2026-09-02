import {
  apiRequest
} from "./client";

import type {
  TransactionType
} from "../types/api";


export interface Transaction {
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

  updatedAtMs:
    number | null;

  createdBy: string;

  updatedBy: string;

  deletedAt:
    string | null;

  deletedBy: string;

  isDeleted: boolean;

  row: number;
}


export interface CreateTransactionInput {
  date: string;

  type:
    TransactionType;

  amount: number;

  categoryId: string;

  fromAccountId?:
    string;

  toAccountId?:
    string;

  paymentMethodId?:
    string;

  spendingTarget?:
    string;

  memo?:
    string;

  billingMonth?:
    string;

  requestId?:
    string;
}


export interface CreateTransactionData {
  created: boolean;

  duplicate: boolean;

  transactionId: string;

  requestId: string;

  row: number;

  transaction?:
    Transaction;
}


export interface CreateTransactionResponse {
  success: true;

  apiVersion: string;

  data:
    CreateTransactionData;
}


export interface TransactionListData {
  total: number;

  items:
    Transaction[];
}


export interface TransactionsResponse {
  success: true;

  apiVersion: string;

  data:
    TransactionListData;
}


export interface GetTransactionsParams {
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


export async function createTransaction(
  input:
    CreateTransactionInput
): Promise<CreateTransactionResponse> {

  return apiRequest<CreateTransactionResponse>(
    "/api/transactions",
    {
      method:
        "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(
          input
        )
    }
  );
}


export async function getTransactions(
  params:
    GetTransactionsParams = {}
): Promise<TransactionsResponse> {

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


  const query =
    searchParams.toString();


  const url =
    query
      ? `/api/transactions?${query}`
      : "/api/transactions";


  return apiRequest<TransactionsResponse>(
    url
  );
}
