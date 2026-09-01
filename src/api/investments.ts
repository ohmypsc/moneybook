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


interface InvestmentTradeQuery {
  accountId?:
    string;

  holdingId?:
    string;

  tradeType?:
    string;

  includeDeleted?:
    boolean;
}


interface PrefetchedTradeEntry {
  data:
    InvestmentTradesResponse;

  storedAt:
    number;
}


const TRADE_PREFETCH_TTL_MS =
  60 * 1000;


const prefetchedTradeCache =
  new Map<
    string,
    PrefetchedTradeEntry
  >();


const tradePrefetchRequests =
  new Map<
    string,
    Promise<
      InvestmentTradesResponse
    >
  >();


function createTradeQueryKey(
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


  return searchParams
    .toString();
}


function createTradeUrl(
  params:
    InvestmentTradeQuery = {}
) {
  const query =
    createTradeQueryKey(
      params
    );


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
      | ApiEnvelope<
          InvestmentTradesResponse
        >
      | InvestmentTradesResponse
    >(
      createTradeUrl(
        params
      )
    );


  return unwrapEnvelope<
    InvestmentTradesResponse
  >(
    raw
  );
}


function getPrefetchedTrades(
  params:
    InvestmentTradeQuery
) {
  const key =
    createTradeQueryKey(
      params
    );


  const cached =
    prefetchedTradeCache.get(
      key
    );


  if (!cached) {
    return null;
  }


  if (
    Date.now() -
      cached.storedAt >
    TRADE_PREFETCH_TTL_MS
  ) {
    prefetchedTradeCache.delete(
      key
    );

    return null;
  }


  /*
   * 시작 시 받은 매매내역은
   * 첫 표시에서 한 번만 사용합니다.
   *
   * 그 뒤 수정/삭제/복원 시에는
   * 서버에서 새로 받아오게 합니다.
   */
  prefetchedTradeCache.delete(
    key
  );


  return cached.data;
}


export function clearInvestmentPrefetchCache() {
  prefetchedTradeCache.clear();
  tradePrefetchRequests.clear();
}


/*
 * 앱 시작 후 투자계좌별
 * 일반 매매내역을 미리 준비합니다.
 *
 * 삭제된 거래는 여기서 불러오지 않습니다.
 */
export async function prefetchInvestmentTradesForAccounts(
  accountIds:
    string[]
) {
  const uniqueIds =
    Array.from(
      new Set(
        accountIds
          .map(
            value =>
              value.trim()
          )
          .filter(
            Boolean
          )
      )
    );


  await Promise.allSettled(
    uniqueIds.map(
      async accountId => {
        const params:
          InvestmentTradeQuery = {
            accountId
          };


        const key =
          createTradeQueryKey(
            params
          );


        const existing =
          prefetchedTradeCache.get(
            key
          );


        if (
          existing &&
          Date.now() -
            existing.storedAt <=
            TRADE_PREFETCH_TTL_MS
        ) {
          return;
        }


        const existingRequest =
          tradePrefetchRequests.get(
            key
          );


        if (
          existingRequest
        ) {
          await existingRequest;

          return;
        }


        let request:
          Promise<
            InvestmentTradesResponse
          >;


        request =
          requestInvestmentTrades(
            params
          )
            .then(
              data => {
                prefetchedTradeCache.set(
                  key,
                  {
                    data,
                    storedAt:
                      Date.now()
                  }
                );


                return data;
              }
            )
            .finally(
              () => {
                if (
                  tradePrefetchRequests.get(
                    key
                  ) ===
                  request
                ) {
                  tradePrefetchRequests.delete(
                    key
                  );
                }
              }
            );


        tradePrefetchRequests.set(
          key,
          request
        );


        await request;
      }
    )
  );
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
      | ApiEnvelope<
          MutationResponse
        >
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


  /*
   * 매수/매도, 예수금, 수동시세 등
   * 투자 정보가 바뀌었으므로
   * 시작 단계에서 받아둔 투자 캐시는
   * 다시 사용하지 않습니다.
   */
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
  /*
   * 삭제 거래 조회는 항상 서버에서
   * 새로 가져옵니다.
   */
  if (
    !params.includeDeleted
  ) {
    const prefetched =
      getPrefetchedTrades(
        params
      );


    if (
      prefetched
    ) {
      return prefetched;
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
