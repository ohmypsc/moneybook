import {
  apiRequest
} from "./client";

import {
  unwrapEnvelope
} from "./envelope";

import type {
  ApiEnvelope
} from "./envelope";

import type {
  InvestmentTradesResponse,
  SetInvestmentCashBaselinePayload,
  CreateInvestmentTradePayload
} from "../types/investment";


type MutationResponse =
  Record<
    string,
    unknown
  >;


async function postInvestmentMutation(
  path:
    string,

  payload:
    Record<
      string,
      unknown
    >
) {
  const raw =
    await apiRequest<
      | ApiEnvelope<MutationResponse>
      | MutationResponse
    >(
      path,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );


  return unwrapEnvelope<
    MutationResponse
  >(raw);
}


/*
 * =========================================================
 * 예수금
 * =========================================================
 */

export async function setInvestmentCashBaseline(
  payload:
    SetInvestmentCashBaselinePayload
) {
  return postInvestmentMutation(
    "/api/investments/cash-baseline",
    {
      ...payload
    }
  );
}


/*
 * =========================================================
 * 수동시세
 * =========================================================
 */

export async function updateHoldingManualPrice(
  input: {
    holdingId:
      string;

    manualPrice:
      number;

    lastUpdated:
      string;
  }
) {
  return postInvestmentMutation(
    "/api/investments/holdings/update",
    {
      holdingId:
        input.holdingId,

      manualPrice:
        input.manualPrice,

      lastUpdated:
        input.lastUpdated
    }
  );
}


/*
 * =========================================================
 * 투자거래 조회
 * =========================================================
 */

export async function getInvestmentTrades(
  params: {
    accountId?:
      string;

    holdingId?:
      string;

    tradeType?:
      string;

    includeDeleted?:
      boolean;
  } = {}
) {
  const searchParams =
    new URLSearchParams();


  if (
    params.accountId
  ) {
    searchParams.set(
      "accountId",
      params.accountId
    );
  }


  if (
    params.holdingId
  ) {
    searchParams.set(
      "holdingId",
      params.holdingId
    );
  }


  if (
    params.tradeType
  ) {
    searchParams.set(
      "tradeType",
      params.tradeType
    );
  }


  if (
    params.includeDeleted
  ) {
    searchParams.set(
      "includeDeleted",
      "true"
    );
  }


  const query =
    searchParams.toString();


  const url =
    query
      ? `/api/investments/trades?${query}`
      : "/api/investments/trades";


  const raw =
    await apiRequest<
      | ApiEnvelope<InvestmentTradesResponse>
      | InvestmentTradesResponse
    >(
      url
    );


  return unwrapEnvelope<
    InvestmentTradesResponse
  >(
    raw
  );
}


/*
 * =========================================================
 * 투자거래 생성
 * =========================================================
 */

export async function createInvestmentTrade(
  payload:
    CreateInvestmentTradePayload
) {
  return postInvestmentMutation(
    "/api/investments/trades",
    {
      ...payload
    }
  );
}


/*
 * =========================================================
 * 투자거래 수정
 * =========================================================
 */

export async function updateInvestmentTrade(
  input: {
    investmentTradeId:
      string;

    date?:
      string;

    quantity?:
      number;

    unitPrice?:
      number;

    currency?:
      string;

    fxRate?:
      number;

    feeKrw?:
      number;

    taxKrw?:
      number;

    settlementKrw?:
      number;

    memo?:
      string;
  }
) {
  return postInvestmentMutation(
    "/api/investments/trades/update",
    {
      ...input
    }
  );
}


/*
 * =========================================================
 * 투자거래 삭제
 * =========================================================
 */

export async function deleteInvestmentTrade(
  investmentTradeId:
    string
) {
  return postInvestmentMutation(
    "/api/investments/trades/delete",
    {
      investmentTradeId
    }
  );
}


/*
 * =========================================================
 * 투자거래 복원
 * =========================================================
 */

export async function restoreInvestmentTrade(
  investmentTradeId:
    string
) {
  return postInvestmentMutation(
    "/api/investments/trades/restore",
    {
      investmentTradeId
    }
  );
}
