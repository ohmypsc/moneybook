import {
  markLedgerChanged
} from "../utils/ledgerEvents.ts";

import {
  syncInputPreferencesFromBootstrapPayload
} from "../utils/inputPreferences.ts";

interface CachedBootstrapResponse {
  body: string;
  expiresAt: number;
}

const BOOTSTRAP_TTL_MS =
  Number.POSITIVE_INFINITY;

const SETTINGS_PATH =
  "/api/settings/input-preferences";

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
    "/api/settings/automation",
    "/api/settings/ledger-start-date",
    "/api/settings/ledger-start-date/clear",
    "/api/backup/restore",
    ...MASTER_MUTATION_PATHS
  ]);

const LEDGER_MUTATION_PATHS =
  new Set([
    ...MASTER_MUTATION_PATHS,

    "/api/transactions",
    "/api/transactions/settle",
    "/api/transactions/update",
    "/api/transactions/delete",
    "/api/transactions/restore",

    "/api/investments/cash-baseline",
    "/api/investments/holdings/update",

    "/api/investments/trades",
    "/api/investments/trades/update",
    "/api/investments/trades/delete",
    "/api/investments/trades/restore",
    "/api/backup/restore"
  ]);

let bootstrapCache:
  CachedBootstrapResponse | null =
    null;

let bootstrapCacheGeneration =
  0;


function clearExpiredBootstrapCache() {
  if (
    bootstrapCache &&
    bootstrapCache.expiresAt <=
      Date.now()
  ) {
    bootstrapCache = null;
    bootstrapCacheGeneration += 1;
  }
}


export function clearBootstrapMemoryCache() {
  bootstrapCache = null;
  bootstrapCacheGeneration += 1;
}


export function getBootstrapCacheGeneration() {
  clearExpiredBootstrapCache();
  return bootstrapCacheGeneration;
}


/**
 * 이미 프리페치된 bootstrap 응답이 있으면 첫 렌더에서 바로 꺼내 씁니다.
 * 매번 새 객체를 반환해서 호출 측이 캐시 원본을 실수로 변경하지 않게 합니다.
 */
export function getCachedBootstrapPayload<T>() {
  clearExpiredBootstrapCache();

  if (!bootstrapCache) {
    return null;
  }

  try {
    return JSON.parse(
      bootstrapCache.body
    ) as T;
  } catch {
    return null;
  }
}


/**
 * 네트워크 요청을 시작했을 때의 generation과 현재 generation이 같을 때만
 * bootstrap을 기억합니다. 요청 도중 설정이 변경된 경우 오래된 응답이
 * 새 캐시를 덮어쓰지 못합니다.
 */
export function rememberBootstrapPayload(
  payload: unknown,
  requestGeneration: number
) {
  if (
    requestGeneration !==
      bootstrapCacheGeneration
  ) {
    return;
  }

  try {
    const parsed =
      payload as {
        success?: boolean;
      };

    if (
      parsed?.success === false ||
      requestGeneration !==
        bootstrapCacheGeneration
    ) {
      return;
    }

    const body =
      JSON.stringify(payload);

    bootstrapCache = {
      body,
      expiresAt:
        Date.now() +
        BOOTSTRAP_TTL_MS
    };

    syncInputPreferencesFromBootstrapPayload(
      payload
    );
  } catch {
    /*
     * 캐시 저장 또는 로컬 백업 동기화 실패가
     * 실제 bootstrap 요청을 실패시키면 안 됩니다.
     */
  }
}


/**
 * apiRequest가 성공한 뒤 한 번만 호출합니다.
 * 전역 fetch monkey patch 대신 모든 mutation 부수효과를 이 경로로 모읍니다.
 */
export function handleSuccessfulApiMutation(
  pathname: string
) {
  if (
    BOOTSTRAP_MUTATION_PATHS.has(
      pathname
    )
  ) {
    clearBootstrapMemoryCache();
  }

  if (
    LEDGER_MUTATION_PATHS.has(
      pathname
    )
  ) {
    markLedgerChanged();
  }
}
