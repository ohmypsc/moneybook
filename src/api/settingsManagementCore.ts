import {
  apiRequest
} from "./client";

import {
  unwrapEnvelope
} from "./envelope";

import type {
  ApiEnvelope
} from "./envelope";


export type LedgerCategoryType =
  | "지출"
  | "수입"
  | "이체";


export interface ManagedCategory {
  categoryId: string;

  type:
    LedgerCategoryType;

  name: string;

  active: boolean;

  isDeleted: boolean;

  row: number;
}


export interface ManagedAccount {
  accountId: string;

  accountName: string;

  displayName: string;

  accountType: string;

  subType: string;

  owner: string;

  openingBalance: number;

  billingCutoffDay:
    number |
    null;

  paymentDay:
    number |
    null;

  startYear:
    number |
    null;

  endYear:
    number |
    null;

  active: boolean;

  balanceMethod: string;

  paymentAccountId:
    string |
    null;

  paymentAccountName:
    string |
    null;

  assetAttribution: string;

  currentBalance?: number;

  investmentCashConfigured?:
    boolean;

  investmentCashKrw?:
    number;

  securitiesValueKrw?:
    number;

  realizedPnlKrw?:
    number;

  isDeleted: boolean;

  row: number;
}


export interface CategoryListResponse {
  total: number;

  items:
    ManagedCategory[];
}


export interface AccountListResponse {
  total: number;

  items:
    ManagedAccount[];
}


export interface LedgerConfig {
  ledgerStartDate:
    string |
    null;
}


export interface SaveAccountInput {
  accountName: string;

  accountType: string;

  subType: string;

  owner: string;

  openingBalance?: number;

  billingCutoffDay?:
    number |
    null;

  paymentDay?:
    number |
    null;

  startYear?:
    number |
    null;

  endYear?:
    number |
    null;

  balanceMethod?: string;

  paymentAccountId?:
    string |
    null;

  assetAttribution?: string;
}


interface CategoryMutationResponse {
  created?: boolean;

  updated?: boolean;

  deleted?: boolean;

  restored?: boolean;

  categoryId?: string;

  category?:
    ManagedCategory;
}


interface AccountMutationResponse {
  created?: boolean;

  updated?: boolean;

  deleted?: boolean;

  restored?: boolean;

  accountId?: string;

  account?:
    ManagedAccount;
}


interface SaveLedgerStartDateResponse {
  updated?: boolean;

  cleared?: boolean;

  ledgerStartDate:
    string |
    null;
}


async function postMutation<T>(
  path: string,

  payload:
    Record<
      string,
      unknown
    >
) {
  const raw =
    await apiRequest<
      | ApiEnvelope<T>
      | T
    >(
      path,
      {
        method:
          "POST",

        body:
          JSON.stringify(
            payload
          )
      }
    );

  return unwrapEnvelope<T>(
    raw
  );
}


/*
 * =========================================================
 * 카테고리 조회
 * =========================================================
 */

export async function getManagedCategories(
  params: {
    type?:
      LedgerCategoryType;

    includeDeleted?:
      boolean;
  } = {}
) {
  const searchParams =
    new URLSearchParams();


  if (
    params.type
  ) {
    searchParams.set(
      "type",
      params.type
    );
  }


  if (
    params.includeDeleted
  ) {
    searchParams.set(
      "includeDeleted",
      "true"
    );
  }


  const query =
    searchParams.toString();


  const url =
    query
      ? `/api/categories?${query}`
      : "/api/categories";


  const raw =
    await apiRequest<
      | ApiEnvelope<
          CategoryListResponse
        >
      | CategoryListResponse
    >(
      url
    );


  return unwrapEnvelope<
    CategoryListResponse
  >(
    raw
  );
}


/*
 * =========================================================
 * 카테고리 생성
 * =========================================================
 */

export async function createManagedCategory(
  input: {
    type:
      LedgerCategoryType;

    name: string;

    active?: boolean;
  }
) {
  return postMutation<
    CategoryMutationResponse
  >(
    "/api/categories",
    {
      ...input
    }
  );
}


/*
 * =========================================================
 * 카테고리 수정
 * =========================================================
 */

export async function updateManagedCategory(
  input: {
    categoryId: string;

    name?: string;

    active?: boolean;
  }
) {
  return postMutation<
    CategoryMutationResponse
  >(
    "/api/categories/update",
    {
      ...input
    }
  );
}


/*
 * =========================================================
 * 카테고리 삭제
 * =========================================================
 */

export async function deleteManagedCategory(
  categoryId:
    string
) {
  return postMutation<
    CategoryMutationResponse
  >(
    "/api/categories/delete",
    {
      categoryId
    }
  );
}


/*
 * =========================================================
 * 카테고리 복원
 * =========================================================
 */

export async function restoreManagedCategory(
  categoryId:
    string
) {
  return postMutation<
    CategoryMutationResponse
  >(
    "/api/categories/restore",
    {
      categoryId
    }
  );
}


/*
 * =========================================================
 * 계좌 조회
 * =========================================================
 */

export async function getManagedAccounts(
  params: {
    owner?: string;

    accountType?: string;

    subType?: string;

    includeDeleted?:
      boolean;
  } = {}
) {
  const searchParams =
    new URLSearchParams();


  if (
    params.owner
  ) {
    searchParams.set(
      "owner",
      params.owner
    );
  }


  if (
    params.accountType
  ) {
    searchParams.set(
      "accountType",
      params.accountType
    );
  }


  if (
    params.subType
  ) {
    searchParams.set(
      "subType",
      params.subType
    );
  }


  if (
    params.includeDeleted
  ) {
    searchParams.set(
      "includeDeleted",
      "true"
    );
  }


  const query =
    searchParams.toString();


  const url =
    query
      ? `/api/accounts?${query}`
      : "/api/accounts";


  const raw =
    await apiRequest<
      | ApiEnvelope<
          AccountListResponse
        >
      | AccountListResponse
    >(
      url
    );


  return unwrapEnvelope<
    AccountListResponse
  >(
    raw
  );
}


/*
 * =========================================================
 * 계좌 생성
 * =========================================================
 */

export async function createManagedAccount(
  input:
    SaveAccountInput
) {
  return postMutation<
    AccountMutationResponse
  >(
    "/api/accounts",
    {
      ...input
    }
  );
}


/*
 * =========================================================
 * 계좌 수정
 * =========================================================
 */

export async function updateManagedAccount(
  input:
    Partial<
      SaveAccountInput
    > & {
      accountId: string;
    }
) {
  return postMutation<
    AccountMutationResponse
  >(
    "/api/accounts/update",
    {
      ...input
    }
  );
}


/*
 * =========================================================
 * 계좌 삭제
 * =========================================================
 */

export async function deleteManagedAccount(
  accountId:
    string
) {
  return postMutation<
    AccountMutationResponse
  >(
    "/api/accounts/delete",
    {
      accountId
    }
  );
}


/*
 * =========================================================
 * 계좌 복원
 * =========================================================
 */

export async function restoreManagedAccount(
  accountId:
    string
) {
  return postMutation<
    AccountMutationResponse
  >(
    "/api/accounts/restore",
    {
      accountId
    }
  );
}


/*
 * =========================================================
 * 가계부 운영 설정 조회
 * =========================================================
 */

export async function getLedgerConfig() {
  const raw =
    await apiRequest<
      | ApiEnvelope<
          LedgerConfig
        >
      | LedgerConfig
    >(
      "/api/settings/ledger-config"
    );


  return unwrapEnvelope<
    LedgerConfig
  >(
    raw
  );
}


/*
 * =========================================================
 * 가계부 시작일 저장
 * =========================================================
 */

export async function setLedgerStartDate(
  ledgerStartDate:
    string
) {
  return postMutation<
    SaveLedgerStartDateResponse
  >(
    "/api/settings/ledger-start-date",
    {
      ledgerStartDate
    }
  );
}


/*
 * =========================================================
 * 가계부 시작일 해제
 * =========================================================
 */

export async function clearLedgerStartDate() {
  return postMutation<
    SaveLedgerStartDateResponse
  >(
    "/api/settings/ledger-start-date/clear",
    {}
  );
}
