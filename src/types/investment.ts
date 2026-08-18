export type Market = "국내" | "해외";
export type QuoteMode = "자동" | "수동";
export type InvestmentTradeType = "매수" | "매도";

export interface InvestmentAccount {
  accountId: string;
  accountName: string;
  displayName: string;
  owner?: string;
}

export interface InvestmentCash {
  accountId: string;
  cashBalance: number;
  updatedAt?: string;
}

export interface Holding {
  holdingId: string;
  accountId: string;
  stockCode: string;
  stockName: string;
  market: Market;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number;
  evalAmountKrw: number;
  purchaseAmountKrw: number;
  profitRate: number;
  quoteMode: QuoteMode;
  lastUpdated?: string;
  elapsedDays?: number;
}

export interface InvestmentTrade {
  investmentTradeId: string;
  accountId: string;
  holdingId: string;
  tradeType: InvestmentTradeType;
  tradeDate: string;
  quantity: number;
  unitPrice: number;
  settlementKrw: number;
  realizedPnlKrw?: number;
  memo?: string;
}

export interface InvestmentAccountsResponse {
  total: number;
  items: InvestmentAccount[];
}

export interface HoldingsResponse {
  total: number;
  items: Holding[];
}

export interface InvestmentTradesResponse {
  total: number;
  items: InvestmentTrade[];
}

export interface SetInvestmentCashBaselinePayload {
  accountId: string;
  cashBalance: number;
  force?: boolean;
  requestId?: string;
}

export interface CreateInvestmentTradePayload {
  accountId: string;
  holdingId?: string;
  stockCode?: string;
  stockName?: string;
  market?: Market;
  quoteMode?: QuoteMode;
  tradeType: InvestmentTradeType;
  tradeDate: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
  fxRate?: number;
  feeKrw?: number;
  taxKrw?: number;
  memo?: string;
  requestId?: string;
}
