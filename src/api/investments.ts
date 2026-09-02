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
  InvestmentTrade,
  InvestmentTradesResponse,
  SetInvestmentCashBaselinePayload,
  CreateInvestmentTradePayload
} from "../types/investment";


type MutationResponse =
  Record<
    string,
    unknown
  >;


type InvestmentTradeQuery = {
  accountId?:
    string;

  holdingId?:
    string;

  tradeType?:
    string;

  includeDeleted?:
    boolean;
};


type TradeCacheEntry = {
  data:
    InvestmentTradesResponse;

  fetchedAt:
    number;
};


const TRADE_CACHE_TTL_MS =
  30 * 1000;


let allActiveTradesCache:
  TradeCacheEntry |
  null =
    null;


let allActiveTradesRequest:
  Promise<InvestmentTradesResponse> |
  null =
    null;


function isAllTradesCacheFresh() {
  return !!(
    allActiveTradesCache &&
    Date.now() -
      allActiveTradesCache.fetchedAt <=
      TRADE_CACHE_TTL_MS
  );
}


function filterTrades(
  data:
    InvestmentTradesResponse,

  params:
    InvestmentTradeQuery
): InvestmentTradesResponse {
  let items:
    InvestmentTrade[] =
      Array.isArray(
        data.items
      )
        ? data.items
        : [];


  if (
    params.accountId
  ) {
    items =
      items.filter(
        trade =>
          trade.accountId ===
          params.accountId
      );
  }


  if (
    params.holdingId
  ) {
    items =
      items.filter(
        trade =>
          trade.holdingId ===
          params.holdingId
      );
  }


  if (
    params.tradeType
  ) {
    items =
      items.filter(
        trade =>
          trade.tradeType ===
          params.tradeType
      );
  }


  return {
    total:
      items.length,

    items
  };
}


function buildTradesUrl(
  params:
    InvestmentTradeQuery = {}
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


  return query
    ? `/api/investments/trades?${query}`
    : "/api/investments/trades";
}


async function requestInvestmentTrades(
  params:
    InvestmentTradeQuery = {}
) {
  const raw =
    await apiRequest<
      | ApiEnvelope<InvestmentTradesResponse>
      | InvestmentTradesResponse
    >(
      buildTradesUrl(
        params
      )
    );


  return unwrapEnvelope<
    InvestmentTradesResponse
  >(
    raw
  );
}


export function clearInvestmentPrefetchCache() {
  allActiveTradesCache =
    null;

  allActiveTradesRequest =
    null;
}


export async function prefetchInvestmentTrades() {
  if (
    isAllTradesCacheFresh()
  ) {
    return allActiveTradesCache!
      .data;
  }


  if (
    allActiveTradesRequest
  ) {
    return allActiveTradesRequest;
  }


  let request:
    Promise<InvestmentTradesResponse>;


  request =
    requestInvestmentTrades()
      .then(
        data => {
          allActiveTradesCache = {
            data,
            fetchedAt:
              Date.now()
          };

          return data;
        }
      )
      .finally(
        () => {
          if (
            allActiveTradesRequest ===
            request
          ) {
            allActiveTradesRequest =
              null;
          }
        }
      );


  allActiveTradesRequest =
    request;


  return request;
}


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


  const result =
    unwrapEnvelope<
      MutationResponse
    >(
      raw
    );


  clearInvestmentPrefetchCache();


  return result;
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
  params:
    InvestmentTradeQuery = {}
) {
  if (
    !params.includeDeleted
  ) {
    if (
      isAllTradesCacheFresh() &&
      allActiveTradesCache
    ) {
      return filterTrades(
        allActiveTradesCache.data,
        params
      );
    }


    if (
      allActiveTradesRequest
    ) {
      const data =
        await allActiveTradesRequest;

      return filterTrades(
        data,
        params
      );
    }
  }


  return requestInvestmentTrades(
    params
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

    expectedUpdatedAtMs:
      number |
      null;

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
