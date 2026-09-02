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


export interface UpdateTransactionInput {
  transactionId: string;

  /*
   * 거래를 불러온 시점의 updated_at 밀리초 값.
   * 두 기기에서 같은 거래를 수정할 때 마지막 저장이
   * 조용히 덮어쓰는 것을 막는 낙관적 동시성 토큰입니다.
   */
  expectedUpdatedAtMs:
    number | null;

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


/**
 * =========================================================
 * 거래 수정
 * =========================================================
 */
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
        method:
          "POST",

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


/**
 * =========================================================
 * 거래 삭제
 *
 * 실제 데이터 제거가 아니라
 * 백엔드 soft delete를 호출합니다.
 * =========================================================
 */
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
        method:
          "POST",

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


/**
 * =========================================================
 * 삭제 취소
 *
 * 삭제된 거래 목록을 보여주기 위한 기능이 아니라,
 * 사용자가 거래를 삭제한 직후
 * "실행 취소"를 눌렀을 때만 사용합니다.
 * =========================================================
 */
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
        method:
          "POST",

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
