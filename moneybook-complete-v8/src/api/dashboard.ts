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


type DashboardCacheEntry = {
  data:
    DashboardData;

  fetchedAt:
    number;
};


type GetDashboardOptions = {
  forceRefresh?:
    boolean;
};


const CURRENT_KEY =
  "__current__";

const CURRENT_TTL_MS =
  30 * 1000;

const ARCHIVE_TTL_MS =
  5 * 60 * 1000;


const dashboardCache =
  new Map<
    string,
    DashboardCacheEntry
  >();


const dashboardRequests =
  new Map<
    string,
    Promise<DashboardData>
  >();


let dashboardGeneration =
  0;


function getCacheKey(
  month?: string
) {
  return month ||
    CURRENT_KEY;
}


function getTtl(
  month?: string
) {
  return month
    ? ARCHIVE_TTL_MS
    : CURRENT_TTL_MS;
}


function isFresh(
  entry:
    DashboardCacheEntry,

  month?:
    string
) {
  return (
    Date.now() -
      entry.fetchedAt <=
    getTtl(
      month
    )
  );
}


export function getDashboardSnapshot(
  month?: string
) {
  return dashboardCache.get(
    getCacheKey(
      month
    )
  )?.data ??
    null;
}


export function invalidateDashboardCache(
  month?: string
) {
  dashboardGeneration +=
    1;

  if (
    month
  ) {
    dashboardCache.delete(
      getCacheKey(
        month
      )
    );

    dashboardRequests.delete(
      getCacheKey(
        month
      )
    );

    return;
  }

  dashboardCache.clear();
  dashboardRequests.clear();
}


export async function getDashboard(
  month?: string,

  options:
    GetDashboardOptions = {}
) {
  const forceRefresh =
    options.forceRefresh ===
    true;

  const key =
    getCacheKey(
      month
    );


  if (
    forceRefresh
  ) {
    invalidateDashboardCache(
      month
    );
  }


  const cached =
    dashboardCache.get(
      key
    );


  if (
    !forceRefresh &&
    cached &&
    isFresh(
      cached,
      month
    )
  ) {
    return cached.data;
  }


  if (
    !forceRefresh
  ) {
    const existingRequest =
      dashboardRequests.get(
        key
      );

    if (
      existingRequest
    ) {
      return existingRequest;
    }
  }


  const requestGeneration =
    dashboardGeneration;


  const searchParams =
    new URLSearchParams();


  if (
    month
  ) {
    searchParams.set(
      "month",
      month
    );
  }


  if (
    forceRefresh
  ) {
    searchParams.set(
      "refresh",
      "1"
    );
  }


  const query =
    searchParams.toString();


  let request:
    Promise<DashboardData>;


  request =
    apiRequest<
      | ApiEnvelope<DashboardData>
      | DashboardData
    >(
      query
        ? `/api/dashboard?${query}`
        : "/api/dashboard"
    )
      .then(
        raw => {
          const data =
            unwrapEnvelope<
              DashboardData
            >(
              raw
            );


          if (
            requestGeneration ===
            dashboardGeneration
          ) {
            dashboardCache.set(
              key,
              {
                data,
                fetchedAt:
                  Date.now()
              }
            );
          }


          return data;
        }
      )
      .finally(
        () => {
          if (
            dashboardRequests.get(
              key
            ) ===
            request
          ) {
            dashboardRequests.delete(
              key
            );
          }
        }
      );


  if (
    !forceRefresh
  ) {
    dashboardRequests.set(
      key,
      request
    );
  }


  return request;
}


export async function prefetchDashboard(
  month?: string
) {
  try {
    await getDashboard(
      month
    );
  } catch {
    /*
     * 프리페치 실패는 실제 화면 진입을
     * 막지 않습니다.
     */
  }
}


if (
  typeof window !==
  "undefined"
) {
  subscribeLedgerChanges(
    () => {
      invalidateDashboardCache();
    }
  );
}
