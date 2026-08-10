export type TransactionType =
  | "수입"
  | "지출"
  | "이체";

export type InvestmentTradeType =
  | "매수"
  | "매도";

export interface User {
  name: string;
}

export interface SessionResponse {
  success: true;
  loggedIn: true;
  user: User;
}

export interface LoginResponse {
  success: true;
  loggedIn: true;
  user: User;
}

export interface LogoutResponse {
  success: true;
  loggedIn: false;
}

export interface Account {
  accountId: string;

  accountName: string;
  displayName: string;

  accountType: string;
  subType: string;
  owner: string;

  openingBalance: number;

  billingCutoffDay: number | null;
  paymentDay: number | null;

  startYear: number | null;
  endYear: number | null;

  active: boolean;

  balanceMethod: string;
  sheetCurrentBalance: number;

  paymentAccountId: string | null;
  paymentAccountName: string | null;

  assetAttribution: string;

  cashBaselineKrw: number | null;
  cashBaselineAtDate: string | null;
  cashBaselineAt: string | null;

  isDeleted: boolean;

  row: number;
}

export interface Category {
  categoryId: string;

  type: TransactionType;

  name: string;

  active: boolean;
  isDeleted: boolean;

  row: number;
}

export interface InvestmentAccount {
  accountId: string;
  accountName: string;

  owner: string;

  accountType: string;
  subType: string;

  cashBaselineConfigured: boolean;

  cashBaselineKrw: number | null;
  cashBaselineAt: string | null;
}

export interface LedgerConfig {
  ledgerStartDate: string | null;
}

export interface BootstrapData {
  backendVersion: string;

  transactionTypes:
    TransactionType[];

  investmentTradeTypes:
    InvestmentTradeType[];

  members: string[];

  spendingTargets: string[];

  accounts: Account[];

  categories: Category[];

  investmentAccounts:
    InvestmentAccount[];

  ledgerConfig:
    LedgerConfig;
}

export interface BootstrapResponse {
  success: true;

  apiVersion: string;

  data: BootstrapData;
}
