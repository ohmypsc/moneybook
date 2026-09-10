export type Market =
  | "국내"
  | "해외";


export type QuoteMode =
  | "자동"
  | "수동";


export type InvestmentTradeType =
  | "매수"
  | "매도";


export interface InvestmentSymbolLookupResult {
  found: boolean;
  stockCode: string;
  stockName: string;
  market: Market;
  symbol?: string;
  exchange?: string;
  source?: string;
}


export interface InvestmentSymbolSearchItem {
  stockCode: string;
  stockName: string;
  market: Market;
  symbol?: string;
  exchange?: string;
  assetType?: string;
  source?: string;
}


export interface InvestmentSymbolSearchResponse {
  query: string;
  items: InvestmentSymbolSearchItem[];
}


/*
 * =========================================================
 * 투자거래 조회 결과
 * =========================================================
 *
 * 중요:
 * 백엔드 조회 응답은 tradeDate가 아니라
 * date라는 이름으로 날짜를 반환합니다.
 *
 * InvestmentTradeHistory에서도
 * date / createdAt / updatedAt / isDeleted를 사용합니다.
 */

export interface InvestmentTrade {
  investmentTradeId: string;

  date: string;

  /*
   * 향후 다른 응답 형태와의 호환용.
   * 현재 조회 API의 기본 날짜 필드는 date입니다.
   */
  tradeDate?: string;

  tradeType:
    InvestmentTradeType;

  accountId: string;
  accountName: string;

  holdingId: string;

  stockCode: string;
  stockName: string;

  market:
    Market;

  quantity: number;
  unitPrice: number;

  currency: string;
  fxRate: number;

  feeKrw: number;
  taxKrw: number;

  settlementKrw: number;

  realizedPnlKrw: number;

  memo: string;

  requestId:
    string |
    null;

  createdAt:
    string |
    null;

  updatedAt:
    string |
    null;

  updatedAtMs:
    number |
    null;

  isDeleted: boolean;
}


/*
 * =========================================================
 * 투자거래 목록 응답
 * =========================================================
 */

export interface InvestmentTradesResponse {
  total: number;

  items:
    InvestmentTrade[];
}


/*
 * =========================================================
 * 투자거래 생성 요청
 * =========================================================
 */

export interface CreateInvestmentTradePayload {
  accountId: string;

  /*
   * 기존 보유종목일 경우 사용 가능.
   */
  holdingId?: string;

  /*
   * 실제 백엔드는 stockCode를 기준으로
   * 기존 종목을 찾습니다.
   */
  stockCode?: string;

  /*
   * 신규 매수 종목일 때 사용.
   */
  stockName?: string;

  market?: Market;
  quoteMode?: QuoteMode;

  /*
   * 신규 종목이며 수동 시세를 사용할 때 필요.
   */
  manualPrice?: number;

  tradeType:
    InvestmentTradeType;

  /*
   * 생성 요청에서는 tradeDate를 사용해도
   * 백엔드가 정상 처리합니다.
   */
  tradeDate: string;

  quantity: number;
  unitPrice: number;

  currency?: string;
  fxRate?: number;

  /*
   * 선택 입력.
   * 비워두면 백엔드에서 0으로 처리.
   */
  feeKrw?: number;
  taxKrw?: number;

  /*
   * 실제 증권사 원화 출금/입금액.
   *
   * 전달되면
   * 수량 × 단가 × 환율 ± 수수료/세금보다
   * 이 값을 최종 결제금액으로 우선 사용합니다.
   */
  settlementKrw?: number;

  memo?: string;

  requestId?: string;
}


/*
 * =========================================================
 * 예수금 기준값 설정
 * =========================================================
 */

export interface SetInvestmentCashBaselinePayload {
  accountId: string;

  cashBaselineKrw: number;

  force?: boolean;

  requestId?: string;
}
