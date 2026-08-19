export interface DashboardSummary {
  assets: number;
  liabilities: number;
  netWorth: number;
  investmentValue: number;
  cashLikeValue: number;
  monthIncome: number;
  monthIncomeGross: number;
  monthIncomeReversals: number;
  monthExpense: number;
  monthExpenseGross: number;
  monthRefunds: number;
  monthNetCashFlow: number;
}

export interface DashboardAccount {
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
  currentBalance: number;
}

export interface DashboardCard {
  accountId: string;
  accountName: string;
  billingMonth: string;
  usage: number;
  payments: number;
  estimatedRemaining: number;
}

export interface MonthlyTrendItem {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface NamedAmount {
  name: string;
  amount: number;
}

export interface RecentTransaction {
  transactionId: string;
  date: string;
  type: string;
  categoryId: string;
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
  reversalOf: string | null;
}

export interface InvestmentAccountSummary {
  accountId: string;
  accountName: string;
  owner: string;
  accountType: string;
  subType: string;
  cashBaselineConfigured: boolean;
  cashBaselineKrw: number | null;
  cashBaselineAt: string | null;
  ledgerCashDeltaKrw: number | null;
  investmentTradeCashDeltaKrw: number | null;
  currentCashKrw: number | null;
  holdingValueKrw: number;
  accountValueKrw: number;
  realizedPnlKrw: number;
}

export interface HoldingSummary {
  holdingId: string;
  accountId: string;
  accountName: string;
  stockCode: string;
  stockName: string;
  market: string;
  quantity: number;
  avgBuyPrice: number;
  quoteMode: string;
  manualPrice: number | null;
  currentPrice: number;
  fx: number;
  valueKrw: number;
  costKrw: number;
  returnRate: number;
  owner: string;
  lastUpdated: string | null;
  elapsedDays: number | null;
  isDeleted: boolean;
}

export interface CashBaselinePendingItem {
  accountId: string;
  accountName: string;
}

export interface DashboardInvestments {
  totalAccountValue: number;
  cashTotal: number;
  realizedPnlTotal: number;
  accounts: InvestmentAccountSummary[];
  holdings: HoldingSummary[];
  staleManualPrices: unknown[];
  cashBaselinePending: CashBaselinePendingItem[];
}

export interface DashboardData {
  backendVersion: string;
  month: string;
  summary: DashboardSummary;
  accounts: DashboardAccount[];
  categoryExpense: NamedAmount[];
  spendingTargetExpense: NamedAmount[];
  cards: DashboardCard[];
  monthlyTrend: MonthlyTrendItem[];
  recentTransactions: RecentTransaction[];
  investments: DashboardInvestments;
}
