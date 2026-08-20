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
  accountId: string;
  holdingId: string;

  tradeType:
    InvestmentTradeType;

  tradeDate: string;

  quantity: number;
  unitPrice: number;

  settlementKrw: number;

  realizedPnlKrw?: number;

  memo?: string;
}


export interface InvestmentTradesResponse {
  total: number;

  items:
    InvestmentTrade[];
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

  /*
   * 증권사에 실제로 표시된
   * 원화 출금/입금액을 직접 입력한 경우 사용
   */
  settlementKrw?: number;

  /*
   * 신규 종목이 수동 시세 방식일 때 사용
   */
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
