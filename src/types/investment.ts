export type Market =
  | "국내"
  | "해외";

export type QuoteMode =
  | "자동"
  | "수동";

export type InvestmentTradeType =
  | "매수"
  | "매도";


export interface InvestmentTrade {
  investmentTradeId: string;

  date: string;
  tradeType: InvestmentTradeType;

  accountId: string;
  accountName: string;

  holdingId: string;

  stockCode: string;
  stockName: string;

  market: Market;

  quantity: number;
  unitPrice: number;

  currency: string;
  fxRate: number;

  feeKrw: number;
  taxKrw: number;

  settlementKrw: number;
  realizedPnlKrw: number;

  memo: string;

  requestId: string | null;

  createdAt: string | null;
  updatedAt: string | null;

  isDeleted: boolean;
}


export interface InvestmentTradesResponse {
  total: number;
  items: InvestmentTrade[];
}


export interface CreateInvestmentTradePayload {
  accountId: string;

  holdingId?: string;

  stockCode?: string;
  stockName?: string;

  market?: Market;
  quoteMode?: QuoteMode;

  tradeType:
    InvestmentTradeType;

  tradeDate: string;

  quantity: number;
  unitPrice: number;

  currency?: string;
  fxRate?: number;

  feeKrw?: number;
  taxKrw?: number;

  settlementKrw?: number;

  manualPrice?: number;

  memo?: string;

  requestId?: string;
}


export interface SetInvestmentCashBaselinePayload {
  accountId: string;

  cashBaselineKrw: number;

  force?: boolean;

  requestId?: string;
}
