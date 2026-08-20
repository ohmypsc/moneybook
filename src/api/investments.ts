import { apiRequest } from "./client";

import type {
  InvestmentTradesResponse,
  SetInvestmentCashBaselinePayload,
  CreateInvestmentTradePayload
} from "../types/investment";


/**
 * =========================================================
 * 투자계좌 예수금 기준값 설정
 * =========================================================
 *
 * 프론트에서는 cashBaselineKrw라는 이름을 사용하지만,
 * Apps Script 백엔드는 amount라는 필드명을 요구합니다.
 *
 * 여기서 API 규격에 맞게 변환해서 전달합니다.
 */
export function setInvestmentCashBaseline(
  payload: SetInvestmentCashBaselinePayload
) {
  return apiRequest("/api/investments/cash-baseline", {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      accountId: payload.accountId,

      // 중요:
      // Apps Script가 요구하는 필드명은 amount
      amount: payload.cashBaselineKrw,

      force: payload.force,

      requestId: payload.requestId
    })
  });
}


/**
 * =========================================================
 * 투자거래 조회
 * =========================================================
 */
export async function getInvestmentTrades(
  params: {
    accountId?: string;
    holdingId?: string;
    tradeType?: string;
  } = {}
) {
  const searchParams =
    new URLSearchParams();


  if (params.accountId) {
    searchParams.set(
      "accountId",
      params.accountId
    );
  }


  if (params.holdingId) {
    searchParams.set(
      "holdingId",
      params.holdingId
    );
  }


  if (params.tradeType) {
    searchParams.set(
      "tradeType",
      params.tradeType
    );
  }


  const query =
    searchParams.toString();


  const url =
    query
      ? `/api/investments/trades?${query}`
      : "/api/investments/trades";


  return apiRequest<InvestmentTradesResponse>(
    url
  );
}


/**
 * =========================================================
 * 투자거래 생성
 * =========================================================
 */
export function createInvestmentTrade(
  payload: CreateInvestmentTradePayload
) {
  return apiRequest("/api/investments/trades", {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify(payload)
  });
}

export function updateInvestmentTrade(
  input: {
    investmentTradeId: string;
    date?: string;
    quantity?: number;
    unitPrice?: number;
    currency?: string;
    fxRate?: number;
    feeKrw?: number;
    taxKrw?: number;
    settlementKrw?: number;
    memo?: string;
  }
) {
  return apiRequest(
    "/api/investments/trades/update",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify(
        input
      )
    }
  );
}


export function deleteInvestmentTrade(
  investmentTradeId: string
) {
  return apiRequest(
    "/api/investments/trades/delete",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        investmentTradeId
      })
    }
  );
}
