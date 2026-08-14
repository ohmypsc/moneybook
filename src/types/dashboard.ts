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

  billingCutoffDay:
    number | null;

  paymentDay:
    number | null;

  startYear:
    number | null;

  endYear:
    number | null;

  active: boolean;

  balanceMethod: string;

  sheetCurrentBalance: number;

  paymentAccountId:
    string | null;

  paymentAccountName:
    string | null;

  assetAttribution: string;

  cashBaselineKrw:
    number | null;

  cashBaselineAtDate:
    string | null;

  cashBaselineAt:
    string | null;

  isDeleted: boolean;

  row: number;

  currentBalance: number;
}


export interface DashboardExpenseItem {
  name: string;
  amount: number;
}


export interface DashboardCard {
  accountId: string;
  accountName: string;

  billingMonth: string;

  usage: number;
  payments: number;

  estimatedRemaining: number;
}


export interface DashboardMonthlyTrend {
  month: string;

  income: number;
  expense: number;
  net: number;
}


export interface DashboardInvestmentAccount {
  accountId: string;
  accountName: string;

  owner: string;

  accountType: string;
  subType: string;

  cashBaselineConfigured:
    boolean;

  cashBaselineKrw:
    number | null;

  cashBaselineAt:
    string | null;

  ledgerCashDeltaKrw:
    number | null;

  investmentTradeCashDeltaKrw:
    number | null;

  currentCashKrw:
    number | null;

  holdingValueKrw:
    number;

  accountValueKrw:
    number;

  realizedPnlKrw:
    number;
}


export interface DashboardHolding {
  holdingId: string;

  accountId: string;
  accountName: string;

  stockCode: string;
  stockName: string;

  market: string;

  quantity: number;

  avgBuyPrice: number;

  quoteMode: string;

  manualPrice:
    number | null;

  currentPrice:
    number | null;

  fx: number;

  valueKrw: number;
  costKrw: number;

  returnRate: number;

  owner: string;

  lastUpdated:
    string | null;

  elapsedDays:
    number |
    "미입력" |
    null;

  baselineQuantity:
    number | null;

  baselineAvgPrice:
    number | null;

  baselineBookCostKrw:
    number | null;

  baselineAtDate:
    string | null;

  baselineAt:
    string | null;

  bookCostKrw: number;

  managedByTradesV22:
    boolean;

  isDeleted: boolean;

  row: number;
}


export interface DashboardStaleManualPrice {
  holdingId: string;

  stockCode: string;
  stockName: string;

  lastUpdated:
    string | null;

  elapsedDays:
    number |
    "미입력" |
    null;
}


export interface DashboardCashBaselinePending {
  accountId: string;
  accountName: string;
}


export interface DashboardInvestments {
  totalAccountValue: number;

  cashTotal: number;

  realizedPnlTotal: number;

  accounts:
    DashboardInvestmentAccount[];

  holdings:
    DashboardHolding[];

  staleManualPrices:
    DashboardStaleManualPrice[];

  cashBaselinePending:
    DashboardCashBaselinePending[];
}


export interface DashboardData {
  backendVersion: string;

  month: string;

  summary:
    DashboardSummary;

  accounts:
    DashboardAccount[];

  categoryExpense:
    DashboardExpenseItem[];

  spendingTargetExpense:
    DashboardExpenseItem[];

  cards:
    DashboardCard[];

  monthlyTrend:
    DashboardMonthlyTrend[];

  investments:
    DashboardInvestments;
}


export interface DashboardResponse {
  success: true;

  apiVersion: string;

  data:
    DashboardData;
}
