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
  accountName?: string;

  holdingId: string;

  stockCode?: string;
  stockName?: string;

  market?: Market;

  tradeType: InvestmentTradeType;
  tradeDate: string;

  quantity: number;
  unitPrice: number;

  currency?: string;
  fxRate?: number;

  feeKrw?: number;
  taxKrw?: number;

  settlementKrw: number;

  realizedPnlKrw?: number;

  memo?: string;
  requestId?: string;
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

  /*
   * 신규 종목 + 수동 시세일 때 사용
   */
  manualPrice?: number;

  tradeType:
    InvestmentTradeType;

  tradeDate: string;

  quantity: number;
  unitPrice: number;

  currency?: string;
  fxRate?: number;

  /*
   * 선택 입력.
   * 입력하지 않으면 백엔드가 0으로 계산.
   */
  feeKrw?: number;
  taxKrw?: number;

  /*
   * 증권사에 실제 찍힌 원화 결제/입금액.
   *
   * 입력하면 백엔드가 이 값을
   * 최종 결제금액으로 우선 사용.
   */
  settlementKrw?: number;

  memo?: string;
  requestId?: string;
}


export interface SetInvestmentCashBaselinePayload {
  accountId: string;

  cashBaselineKrw: number;

  force?: boolean;
  requestId?: string;
}
