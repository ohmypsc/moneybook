import {
  markLedgerChanged
} from "../utils/ledgerEvents";

interface CachedBootstrapResponse {
  body: string;
  status: number;
  statusText: string;
  contentType: string;
  expiresAt: number;
}

const BOOTSTRAP_PATH =
  "/api/bootstrap";

const SETTINGS_PATH =
  "/api/settings/input-preferences";

const BOOTSTRAP_TTL_MS =
  5 * 60 * 1000;

const FETCH_PATCH_MARKER =
  "__moneybookBootstrapCacheFetchPatched";

const MASTER_MUTATION_PATHS =
  new Set([
    "/api/categories",
    "/api/categories/update",
    "/api/categories/delete",
    "/api/categories/restore",

    "/api/accounts",
    "/api/accounts/update",
    "/api/accounts/delete",
    "/api/accounts/restore"
  ]);

const BOOTSTRAP_MUTATION_PATHS =
  new Set([
    SETTINGS_PATH,
    ...MASTER_MUTATION_PATHS
  ]);

const LEDGER_MUTATION_PATHS =
  new Set([
    ...MASTER_MUTATION_PATHS,

    "/api/transactions",
    "/api/transactions/update",
    "/api/transactions/delete",
    "/api/transactions/restore",

    "/api/investments/cash-baseline",
    "/api/investments/holdings/update",

    "/api/investments/trades",
    "/api/investments/trades/update",
    "/api/investments/trades/delete",
    "/api/investments/trades/restore"
  ]);

let bootstrapCache:
  CachedBootstrapResponse | null =
    null;

let bootstrapPrefetchPromise:
  Promise<void> | null =
    null;

let bootstrapCacheGeneration =
  0;


function getRequestUrl(
  input: RequestInfo | URL
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return null;
  }

  try {
    const raw =
      typeof input ===
      "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    return new URL(
      raw,
      window.location.origin
    );

  } catch {
    return null;
  }
}


function getRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const method =
    init?.method ||
    (
      typeof Request !==
        "undefined" &&
      input instanceof Request
        ? input.method
        : "GET"
    );

  return String(
    method || "GET"
  ).toUpperCase();
}


function isSameOriginUrl(
  url: URL | null
) {
  return !!(
    url &&
    typeof window !==
      "undefined" &&
    url.origin ===
      window.location.origin
  );
}


function clearExpiredBootstrapCache() {
  if (
    bootstrapCache &&
    bootstrapCache.expiresAt <=
      Date.now()
  ) {
    bootstrapCache = null;
    bootstrapCacheGeneration +=
      1;
  }
}


export function clearBootstrapMemoryCache() {
  bootstrapCache = null;

  bootstrapPrefetchPromise =
    null;

  bootstrapCacheGeneration +=
    1;
}


export function getBootstrapCacheGeneration() {
  clearExpiredBootstrapCache();

  return bootstrapCacheGeneration;
}


function responseFromBootstrapCache(
  cached:
    CachedBootstrapResponse
) {
  return new Response(
    cached.body,
    {
      status:
        cached.status,

      statusText:
        cached.statusText,

      headers: {
        "Content-Type":
          cached.contentType ||
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


async function rememberBootstrapResponse(
  response: Response,
  requestGeneration: number
) {
  if (
    !response.ok ||
    requestGeneration !==
      bootstrapCacheGeneration
  ) {
    return;
  }

  try {
    const clone =
      response.clone();

    const body =
      await clone.text();

    const parsed =
      JSON.parse(body) as {
        success?: boolean;
      };

    if (
      parsed?.success ===
      false ||
      requestGeneration !==
        bootstrapCacheGeneration
    ) {
      return;
    }

    bootstrapCache = {
      body,

      status:
        response.status,

      statusText:
        response.statusText,

      contentType:
        response.headers.get(
          "Content-Type"
        ) ||
        "application/json; charset=utf-8",

      expiresAt:
        Date.now() +
        BOOTSTRAP_TTL_MS
    };

  } catch {
    /*
     * 캐시 저장 실패가 실제 bootstrap 요청을
     * 실패시키면 안 됩니다.
     */
  }
}


async function responseSucceeded(
  response: Response
) {
  if (!response.ok) {
    return false;
  }

  try {
    const payload =
      await response
        .clone()
        .json() as {
          success?: boolean;
        };

    return (
      payload?.success !==
      false
    );

  } catch {
    return true;
  }
}


async function inspectMutationResponse(
  response: Response,
  pathname: string
) {
  const invalidatesBootstrap =
    BOOTSTRAP_MUTATION_PATHS.has(
      pathname
    );

  const changesLedger =
    LEDGER_MUTATION_PATHS.has(
      pathname
    );

  if (
    !invalidatesBootstrap &&
    !changesLedger
  ) {
    return;
  }

  const succeeded =
    await responseSucceeded(
      response
    );

  if (!succeeded) {
    return;
  }

  if (
    invalidatesBootstrap
  ) {
    clearBootstrapMemoryCache();
  }

  if (
    changesLedger
  ) {
    markLedgerChanged();
  }
}


function installBootstrapCacheFetch() {
  if (
    typeof window ===
      "undefined" ||
    typeof window.fetch !==
      "function"
  ) {
    return;
  }

  const markedWindow =
    window as typeof window & {
      [FETCH_PATCH_MARKER]?:
        boolean;
    };

  if (
    markedWindow[
      FETCH_PATCH_MARKER
    ]
  ) {
    return;
  }

  const originalFetch =
    window.fetch.bind(
      window
    );

  markedWindow[
    FETCH_PATCH_MARKER
  ] =
    true;

  window.fetch =
    (async (
      input:
        RequestInfo | URL,
      init?:
        RequestInit
    ) => {
      const url =
        getRequestUrl(
          input
        );

      const method =
        getRequestMethod(
          input,
          init
        );

      const sameOrigin =
        isSameOriginUrl(
          url
        );

      const isBootstrapRequest =
        sameOrigin &&
        method === "GET" &&
        url?.pathname ===
          BOOTSTRAP_PATH;

      if (
        isBootstrapRequest
      ) {
        clearExpiredBootstrapCache();

        if (
          bootstrapCache
        ) {
          return responseFromBootstrapCache(
            bootstrapCache
          );
        }

        /*
         * 로그인 직후 App의 bootstrap 프리페치가 아직 진행 중이면
         * InputPage가 같은 /api/bootstrap 요청을 하나 더 보내지 않습니다.
         * 기존 프리페치가 끝날 때까지 기다린 뒤 메모리 캐시를 재사용합니다.
         */
        if (
          bootstrapPrefetchPromise
        ) {
          await bootstrapPrefetchPromise;

          clearExpiredBootstrapCache();

          if (
            bootstrapCache
          ) {
            return responseFromBootstrapCache(
              bootstrapCache
            );
          }
        }
      }

      const requestGeneration =
        bootstrapCacheGeneration;

      const response =
        await originalFetch(
          input,
          init
        );

      if (
        isBootstrapRequest
      ) {
        await rememberBootstrapResponse(
          response,
          requestGeneration
        );
      }

      if (
        sameOrigin &&
        method !== "GET" &&
        url
      ) {
        await inspectMutationResponse(
          response,
          url.pathname
        );
      }

      return response;
    }) as typeof window.fetch;
}


/**
 * 홈을 보고 있는 동안 bootstrap을 미리 받아 둡니다.
 * 실제 InputPage가 열릴 때는 같은 응답을 브라우저 메모리에서
 * 즉시 돌려주므로 별도 네트워크 대기를 하지 않습니다.
 */
export async function prefetchBootstrap() {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  clearExpiredBootstrapCache();

  if (
    bootstrapCache
  ) {
    return;
  }

  if (
    bootstrapPrefetchPromise
  ) {
    return bootstrapPrefetchPromise;
  }

  const task =
    (async () => {
      const response =
        await window.fetch(
          BOOTSTRAP_PATH,
          {
            method:
              "GET",

            credentials:
              "same-origin",

            headers: {
              Accept:
                "application/json"
            }
          }
        );

      if (!response.ok) {
        throw new Error(
          "입력 정보를 미리 불러오지 못했습니다."
        );
      }

      /*
       * body를 실제로 사용할 필요는 없지만
       * 요청 완료는 보장합니다.
       */
      await response
        .clone()
        .text();
    })()
      .catch(
        () => {
          /*
           * 프리페치 실패는 홈 화면을 막지 않습니다.
           * InputPage가 열릴 때 정상 요청을 다시 시도합니다.
           */
        }
      );

  bootstrapPrefetchPromise =
    task;

  void task.finally(
    () => {
      if (
        bootstrapPrefetchPromise ===
          task
      ) {
        bootstrapPrefetchPromise =
          null;
      }
    }
  );

  return task;
}


installBootstrapCacheFetch();
