import type {
  Account,
  Category,
  InvestmentAccount,
  InvestmentTradeType,
  LedgerConfig,
  TransactionType
} from "./api";

import type { AutomationSettings } from "../api/automation";

import type { SharedInputPreferencesState } from "../utils/inputPreferences";

export interface BootstrapData {
  userName?: string;
  householdOverview?: { livingAccountIds: string[] | null };
  backendVersion: string;
  transactionTypes: TransactionType[];
  investmentTradeTypes: InvestmentTradeType[];
  members: string[];
  spendingTargets: string[];
  accounts: Account[];
  categories: Category[];
  investmentAccounts: InvestmentAccount[];
  ledgerConfig: LedgerConfig;
  inputPreferences?: SharedInputPreferencesState;
  automationSettings?: AutomationSettings;
}

export interface BootstrapResponse {
  success: boolean;
  apiVersion?: string;
  /** 인터넷 연결 없이 기기에 저장된 목록을 쓴 경우, 그 목록을 받은 시각(ms) */
  offlineSnapshotAt?: number;
  data?: BootstrapData;
  error?: {
    code?: string;
    message?: string;
  };
}
