/**
 * =========================================================
 * 투자 관련 공통 타입
 * =========================================================
 */


/**
 * 시장
 */
export type Market =
  | "국내"
  | "해외";


/**
 * 시세 조회 방식
 */
export type QuoteMode =
  | "자동"
  | "수동";


/**
 * 투자 거래 유형
 */
export type InvestmentTradeType =
  | "매수"
  | "매도";


/**
 * =========================================================
 * 투자거래 조회 결과
 * =========================================================
 *
 * Apps Script의 publicTrade_() 실제 응답 구조 기준
 */
export interface InvestmentTrade {
  investmentTradeId: string;

  date: string;

  tradeType:
    InvestmentTradeType;

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

  requestId: string;

  createdAt?: string | null;
  updatedAt?: string | null;

  isDeleted?: boolean;
}


/**
 * 투자거래 목록 조회 결과
 */
export interface InvestmentTradesResponse {
  total: number;

  items:
    InvestmentTrade[];
}


/**
 * =========================================================
 * 매수 / 매도 생성 요청
 * =========================================================
 */
export interface CreateInvestmentTradePayload {
  /**
   * 투자계좌
   */
  accountId: string;


  /**
   * 매수 / 매도
   */
  tradeType:
    InvestmentTradeType;


  /**
   * 거래일
   *
   * 백엔드는 date와 tradeDate 모두 받지만
   * 프론트에서는 tradeDate로 통일
   */
  tradeDate: string;


  /**
   * 종목코드
   *
   * 기존 보유종목이든 신규 종목이든 필수
   */
  stockCode: string;


  /**
   * 수량
   */
  quantity: number;


  /**
   * 체결단가
   */
  unitPrice: number;


  /**
   * =====================================================
   * 신규 종목 첫 매수 때 사용
   * =====================================================
   */

  /**
   * 종목명
   *
   * 신규 종목일 때 전달
   */
  stockName?: string;


  /**
   * 국내 / 해외
   *
   * 신규 종목이면 필수
   */
  market?: Market;


  /**
   * 자동 / 수동
   *
   * 신규 종목이면 사용
   * 미입력 시 백엔드 기본값은 자동
   */
  quoteMode?: QuoteMode;


  /**
   * 수동 시세
   *
   * 신규 종목이고
   * quoteMode === "수동"이면 필수
   */
  manualPrice?: number;


  /**
   * =====================================================
   * 통화 및 환율
   * =====================================================
   */

  /**
   * 국내 종목은 KRW
   * 해외 종목은 USD 등
   */
  currency?: string;


  /**
   * 해외 종목 체결환율
   *
   * KRW가 아니면 필수
   */
  fxRate?: number;


  /**
   * =====================================================
   * 비용
   * =====================================================
   */

  /**
   * 원화 수수료
   */
  feeKrw?: number;


  /**
   * 원화 세금
   */
  taxKrw?: number;


  /**
   * 메모
   */
  memo?: string;


  /**
   * 중복 저장 방지용
   */
  requestId?: string;
}


/**
 * =========================================================
 * 매수 / 매도 생성 결과
 * =========================================================
 */
export interface CreateInvestmentTradeResponse {
  created: boolean;

  duplicate: boolean;

  newHoldingCreated?: boolean;

  investmentTradeId: string;

  requestId: string;

  trade:
    InvestmentTrade;


  holding?: {
    holdingId: string;

    quantity: number;

    avgBuyPrice: number;

    bookCostKrw: number;

    activeTradeCount: number;
  };
}


/**
 * =========================================================
 * 투자계좌 예수금 기준값
 * =========================================================
 *
 * 프론트에서는 cashBaselineKrw라는 의미 있는 이름을 사용하고,
 * src/api/investments.ts에서 Apps Script가 요구하는
 * amount 필드로 변환하여 전송함.
 */
export interface SetInvestmentCashBaselinePayload {
  accountId: string;

  cashBaselineKrw: number;

  force?: boolean;

  requestId?: string;
}
