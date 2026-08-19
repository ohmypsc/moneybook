export type Market = "국내" | "해외";
export type QuoteMode = "자동" | "수동";
export type InvestmentTradeType = "매수" | "매도";

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

/**
 * ⚠️ cashBaselineKrw 필드명은 대시보드 응답의
 * accounts[].cashBaselineKrw 네이밍 패턴에 맞춘 추정입니다.
 * 저장 후 dashboard의 cashBaselineConfigured가 true로
 * 바뀌지 않으면 이 필드명부터 의심하세요.
 */
export interface SetInvestmentCashBaselinePayload {
  accountId: string;
  cashBaselineKrw: number;
  force?: boolean;
  requestId?: string;
}
