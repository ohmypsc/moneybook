import type {
  Account,
  Category,
  InvestmentAccount,
  InvestmentTradeType,
  LedgerConfig,
  TransactionType
} from "./api";

import type {
  AutomationSettings
} from "../api/automation";

import type {
  SharedInputPreferencesState
} from "../utils/inputPreferences";

export interface BootstrapData {
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
  data?: BootstrapData;
  error?: {
    code?: string;
    message?: string;
  };
}
