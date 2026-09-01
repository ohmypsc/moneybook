import {
  apiRequest
} from "./client";

import type {
  DashboardData
} from "../types/dashboard";

import {
  unwrapEnvelope
} from "./envelope";

import type {
  ApiEnvelope
} from "./envelope";

import {
  subscribeLedgerChanges
} from "../utils/ledgerEvents";


interface PrefetchedDashboard {
  data: DashboardData;
  storedAt: number;
}


const PREFETCH_TTL_MS =
  60 * 1000;


let prefetchedCurrentDashboard:
  PrefetchedDashboard |
  null =
    null;


/*
 * App 시작 단계에서 이미 받아온
 * 현재 월 대시보드를 자산 화면용으로
 * 잠시 보관합니다.
 *
 * 홈 화면은 자체 캐시를 사용하므로
 * 이 캐시는 자산 화면의 첫 진입을
 * 빠르게 만드는 용도입니다.
 */
export function primeDashboardPrefetch(
  data: DashboardData
) {
  prefetchedCurrentDashboard = {
    data,
    storedAt:
      Date.now()
  };
}


export function clearDashboardPrefetch() {
  prefetchedCurrentDashboard =
    null;
}


function consumeDashboardPrefetch() {
  const cached =
    prefetchedCurrentDashboard;


  if (!cached) {
    return null;
  }


  if (
    Date.now() -
      cached.storedAt >
    PREFETCH_TTL_MS
  ) {
    prefetchedCurrentDashboard =
      null;

    return null;
  }


  /*
   * 한 번 사용한 뒤 제거합니다.
   *
   * 따라서 이후 예수금 수정,
   * 매수/매도 등의 새로고침에서는
   * 오래된 시작 캐시를 다시 쓰지 않습니다.
   */
  prefetchedCurrentDashboard =
    null;


  return cached.data;
}


export async function getDashboard(
  month?: string
) {
  /*
   * 월을 따로 지정하지 않은
   * 현재 대시보드 조회에서만
   * 시작 프리페치를 사용합니다.
   */
  if (!month) {
    const prefetched =
      consumeDashboardPrefetch();


    if (prefetched) {
      return prefetched;
    }
  }


  const query =
    month
      ? `?month=${encodeURIComponent(
          month
        )}`
      : "";


  const raw =
    await apiRequest<
      | ApiEnvelope<DashboardData>
      | DashboardData
    >(
      `/api/dashboard${query}`
    );


  return unwrapEnvelope<
    DashboardData
  >(
    raw
  );
}


/*
 * 이 기기에서 거래나 투자 정보가
 * 변경되면 시작 캐시는 즉시 폐기합니다.
 */
if (
  typeof window !==
  "undefined"
) {
  subscribeLedgerChanges(
    () => {
      clearDashboardPrefetch();
    }
  );
}
