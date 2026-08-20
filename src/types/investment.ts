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
  settlementKrw?: number;
  memo?: string;
  requestId?: string;
}
