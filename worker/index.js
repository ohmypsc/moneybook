import { DurableObject } from "cloudflare:workers";

import {
  clearCookie,
  createCookie,
  createSessionToken,
  getLoginUsers,
  getSession,
  isSameOrigin,
  verifyStoredPassword
} from "./auth.js";

import {
  dateOnly as mbD1DateOnly,
  estimateBillingMonth as mbD1EstimateBilling,
  monthOnly as mbD1MonthOnly
} from "./domain/date.js";

import {
  recurringOccurrenceDate as mbD1RecurringOccurrenceDate,
  recurringPayload as mbD1RecurringPayload,
  recurringRuleActiveForMonth as mbD1RecurringRuleActiveForMonth
} from "./domain/automation.js";

import {
  isBenefitTransaction as mbD1IsBenefitTransaction
} from "./domain/benefit.js";

import {
  SETTLEMENT_EXPENSE_CATEGORY_NAME,
  SETTLEMENT_INCOME_CATEGORY_NAME,
  SETTLEMENT_REQUEST_PREFIX,
  isSettlementEligibleCategory as mbD1IsSettlementEligibleCategory,
  isSettlementRequestId as mbD1IsSettlementRequestId,
  settlementRemaining as mbD1SettlementRemaining
} from "./domain/settlement.js";

import {
  getLoginRateLimitStatus,
  recordLoginFailureState
} from "./domain/loginRateLimit.js";

import {
  buildTransactionSearchWhere,
  normalizeTransactionPagination
} from "./domain/transactionSearch.js";

import {
  BackupValidationError,
  findRequestIdConflicts,
  validateBackupDocument
} from "./domain/backupRestore.js";

import {
  lookupInvestmentSymbol,
  normalizeInvestmentLookupCode,
  normalizeInvestmentSearchQuery,
  searchInvestmentSymbols
} from "./investmentSymbols.js";

import {
  chooseCategory as mbImportChooseCategory,
  choosePaymentMethod as mbImportChoosePaymentMethod,
  findDuplicateTransaction as mbImportFindDuplicate
} from "./domain/transactionImport.js";

import {
  analyzeTransactionImport
} from "./transactionImport.js";

import {
  deleteRealEstateAsset,
  ensureRealEstateSchema,
  listRealEstateAssets,
  realEstateSummary,
  refreshAllRealEstateAssets,
  refreshRealEstateAsset,
  resolveLegalRegion,
  saveRealEstateAsset
} from "./realEstate.js";

/**
 * 우리 가계부 Cloudflare Worker
 * - 미영·승철 로그인과 400일 슬라이딩 세션
 * - Apps Script 비밀키 중계
 * - bootstrap / 현재 월 대시보드 캐시
 * - 거래·투자·설정 API
 */

const BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_TTL_MS = 30 * 1000;
const BACKEND_WARM_INTERVAL_MS = 2 * 60 * 1000;

const encoder = new TextEncoder();

let bootstrapMemory = null;
let bootstrapOrigin = "";
let bootstrapExpiresAt = 0;
let bootstrapPromise = null;
let bootstrapGeneration = 0;

let dashboardMemory = null;
let dashboardMonth = "";
let dashboardExpiresAt = 0;
let dashboardPromise = null;
let dashboardGeneration = 0;

let lastAppsScriptActivityAt = 0;
let warmPromise = null;


const GET_ROUTES = {
  "/api/categories": {
    action: "categories",
    params: [
      "type",
      "includeDeleted"
    ]
  },

  "/api/accounts": {
    action: "accounts",
    params: [
      "owner",
      "accountType",
      "subType",
      "includeDeleted"
    ]
  },

  "/api/settings/ledger-config": {
    action: "ledgerConfig",
    params: []
  },

  "/api/transactions": {
    action: "transactions",
    params: [
      "dateFrom",
      "dateTo",
      "type",
      "categoryId",
      "accountId",
      "spendingTarget",
      "amount",
      "q",
      "includeDeleted",
      "limit",
      "offset"
    ]
  },

  "/api/asset-snapshots": {
    action: "assetSnapshots",
    params: [
      "month",
      "limit"
    ]
  },

  "/api/investments/accounts": {
    action: "investmentAccounts",
    params: []
  },

  "/api/investments/holdings": {
    action: "holdings",
    params: [
      "accountId",
      "market",
      "quoteMode",
      "includeDeleted"
    ]
  },

  "/api/investments/trades": {
    action: "investmentTrades",
    params: [
      "accountId",
      "holdingId",
      "tradeType",
      "includeDeleted"
    ]
  },

  "/api/investments/cash": {
    action: "investmentCash",
    params: [
      "accountId"
    ]
  }
};

const POST_ROUTES = {
  "/api/transactions": {
    action: "createTransaction",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "거래 입력 형식이 올바르지 않습니다."
  },

  "/api/transactions/update": {
    action: "updateTransaction",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "거래 수정 형식이 올바르지 않습니다."
  },

  "/api/transactions/delete": {
    action: "deleteTransaction",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "거래 삭제 형식이 올바르지 않습니다."
  },

  "/api/transactions/restore": {
    action: "restoreTransaction",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "거래 복원 형식이 올바르지 않습니다."
  },

  "/api/asset-snapshots": {
    action: "saveAssetSnapshot",
    refresh: "none",
    invalidCode: "INVALID_ASSET_SNAPSHOT",
    invalidMessage: "순자산 기록 형식이 올바르지 않습니다."
  },

  "/api/categories": {
    action: "createCategory",
    refresh: "master",
    invalidCode: "INVALID_CATEGORY",
    invalidMessage: "카테고리 요청 형식이 올바르지 않습니다."
  },

  "/api/categories/update": {
    action: "updateCategory",
    refresh: "master",
    invalidCode: "INVALID_CATEGORY",
    invalidMessage: "카테고리 요청 형식이 올바르지 않습니다."
  },

  "/api/categories/delete": {
    action: "deleteCategory",
    refresh: "master",
    invalidCode: "INVALID_CATEGORY",
    invalidMessage: "카테고리 요청 형식이 올바르지 않습니다."
  },

  "/api/categories/restore": {
    action: "restoreCategory",
    refresh: "master",
    invalidCode: "INVALID_CATEGORY",
    invalidMessage: "카테고리 요청 형식이 올바르지 않습니다."
  },

  "/api/accounts": {
    action: "createAccount",
    refresh: "master",
    invalidCode: "INVALID_ACCOUNT",
    invalidMessage: "계좌 요청 형식이 올바르지 않습니다."
  },

  "/api/accounts/update": {
    action: "updateAccount",
    refresh: "master",
    invalidCode: "INVALID_ACCOUNT",
    invalidMessage: "계좌 요청 형식이 올바르지 않습니다."
  },

  "/api/accounts/delete": {
    action: "deleteAccount",
    refresh: "master",
    invalidCode: "INVALID_ACCOUNT",
    invalidMessage: "계좌 요청 형식이 올바르지 않습니다."
  },

  "/api/accounts/restore": {
    action: "restoreAccount",
    refresh: "master",
    invalidCode: "INVALID_ACCOUNT",
    invalidMessage: "계좌 요청 형식이 올바르지 않습니다."
  },

  "/api/settings/ledger-start-date": {
    action: "setLedgerStartDate",
    refresh: "master",
    invalidCode: "INVALID_LEDGER_CONFIG",
    invalidMessage: "가계부 설정 형식이 올바르지 않습니다."
  },

  "/api/settings/ledger-start-date/clear": {
    action: "clearLedgerStartDate",
    refresh: "master",
    allowEmptyBody: true,
    invalidCode: "INVALID_LEDGER_CONFIG",
    invalidMessage: "가계부 설정 형식이 올바르지 않습니다."
  },

  "/api/investments/holdings/update": {
    action: "updateHolding",
    refresh: "dashboard",
    invalidCode: "INVALID_HOLDING",
    invalidMessage: "보유종목 수정 형식이 올바르지 않습니다."
  },

  "/api/investments/trades": {
    action: "createInvestmentTrade",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "투자거래 입력 형식이 올바르지 않습니다."
  },

  "/api/investments/trades/update": {
    action: "updateInvestmentTrade",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "투자거래 수정 형식이 올바르지 않습니다."
  },

  "/api/investments/trades/delete": {
    action: "deleteInvestmentTrade",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "투자거래 삭제 형식이 올바르지 않습니다."
  },

  "/api/investments/trades/restore": {
    action: "restoreInvestmentTrade",
    refresh: "dashboard",
    invalidCode: "INVALID_TRANSACTION",
    invalidMessage: "투자거래 복원 형식이 올바르지 않습니다."
  }
};

function jsonResponse(
  data,
  status = 200,
  extraHeaders = {}
) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers
    }
  );
}

function errorResponse(
  code,
  message,
  status
) {
  return jsonResponse(
    {
      success: false,

      error: {
        code,
        message
      }
    },
    status
  );
}

function unauthorized() {
  return jsonResponse(
    {
      success: false,
      loggedIn: false,

      error: {
        code: "LOGIN_REQUIRED",
        message: "로그인이 필요합니다."
      }
    },
    401
  );
}

function isObject(
  value
) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function markAppsScriptActivity() {
  lastAppsScriptActivityAt =
    Date.now();
}

async function appsScriptGet(
  env,
  action,
  params = {},
  useSecret = true
) {
  if (
    !env.APPS_SCRIPT_URL
  ) {
    throw new Error(
      "APPS_SCRIPT_URL Secret이 설정되지 않았습니다."
    );
  }

  const target =
    new URL(
      env.APPS_SCRIPT_URL
    );

  target.searchParams.set(
    "action",
    action
  );

  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      target.searchParams.set(
        key,
        String(value)
      );
    }
  }

  if (
    useSecret
  ) {
    if (
      !env.LEDGER_API_SECRET
    ) {
      throw new Error(
        "LEDGER_API_SECRET Secret이 설정되지 않았습니다."
      );
    }

    target.searchParams.set(
      "apiSecret",
      env.LEDGER_API_SECRET
    );
  }

  const response =
    await fetch(
      target.toString(),
      {
        method: "GET",
        redirect: "follow"
      }
    );

  const text =
    await response.text();

  markAppsScriptActivity();

  if (
    !response.ok
  ) {
    throw new Error(
      `Apps Script GET 요청 실패 (${response.status})`
    );
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      "Apps Script가 JSON이 아닌 응답을 반환했습니다."
    );
  }
}

async function appsScriptPost(
  env,
  action,
  payload = {}
) {
  if (
    !env.APPS_SCRIPT_URL
  ) {
    throw new Error(
      "APPS_SCRIPT_URL Secret이 설정되지 않았습니다."
    );
  }

  if (
    !env.LEDGER_API_SECRET
  ) {
    throw new Error(
      "LEDGER_API_SECRET Secret이 설정되지 않았습니다."
    );
  }

  const response =
    await fetch(
      env.APPS_SCRIPT_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            ...payload,
            action,
            apiSecret:
              env.LEDGER_API_SECRET
          }),

        redirect:
          "follow"
      }
    );

  const text =
    await response.text();

  markAppsScriptActivity();

  if (
    !response.ok
  ) {
    throw new Error(
      `Apps Script POST 요청 실패 (${response.status})`
    );
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      "Apps Script가 JSON이 아닌 응답을 반환했습니다."
    );
  }
}

async function warmAppsScript(
  env
) {
  if (
    lastAppsScriptActivityAt &&
    Date.now() -
      lastAppsScriptActivityAt <
      BACKEND_WARM_INTERVAL_MS
  ) {
    return;
  }

  if (
    !warmPromise
  ) {
    warmPromise =
      appsScriptGet(
        env,
        "health",
        {},
        false
      )
        .catch(
          () => null
        )
        .finally(
          () => {
            warmPromise =
              null;
          }
        );
  }

  return warmPromise;
}

function bootstrapCacheKey(
  origin
) {
  return new Request(
    `${origin}/__moneybook_internal/bootstrap-v2`
  );
}

function rememberBootstrap(
  data,
  origin
) {
  bootstrapMemory =
    data;

  bootstrapOrigin =
    origin;

  bootstrapExpiresAt =
    Date.now() +
    BOOTSTRAP_TTL_MS;
}

async function getCachedBootstrap(
  env,
  origin
) {
  if (
    bootstrapMemory &&
    bootstrapOrigin ===
      origin &&
    bootstrapExpiresAt >
      Date.now()
  ) {
    return bootstrapMemory;
  }

  bootstrapMemory =
    null;

  if (
    typeof caches !==
      "undefined" &&
    caches.default
  ) {
    const cached =
      await caches.default.match(
        bootstrapCacheKey(
          origin
        )
      );

    if (
      cached
    ) {
      try {
        const data =
          await cached.json();

        rememberBootstrap(
          data,
          origin
        );

        return data;
      } catch {
        /*
         * 손상된 캐시는 아래에서
         * 다시 불러옵니다.
         */
      }
    }
  }

  if (
    !bootstrapPromise
  ) {
    const generation =
      bootstrapGeneration;

    const loading =
      appsScriptGet(
        env,
        "bootstrap"
      )
        .then(
          async data => {
            if (
              data?.success !==
                false &&
              generation ===
                bootstrapGeneration
            ) {
              rememberBootstrap(
                data,
                origin
              );

              if (
                typeof caches !==
                  "undefined" &&
                caches.default
              ) {
                await caches.default.put(
                  bootstrapCacheKey(
                    origin
                  ),
                  new Response(
                    JSON.stringify(
                      data
                    ),
                    {
                      headers: {
                        "Content-Type":
                          "application/json; charset=utf-8",

                        "Cache-Control":
                          "public, max-age=300"
                      }
                    }
                  )
                );
              }
            }

            return data;
          }
        )
        .finally(
          () => {
            if (
              bootstrapPromise ===
              loading
            ) {
              bootstrapPromise =
                null;
            }
          }
        );

    bootstrapPromise =
      loading;
  }

  return bootstrapPromise;
}

async function mergeLatestInputPreferences(
  env,
  bootstrapPayload
) {
  if (
    !isObject(
      bootstrapPayload
    ) ||
    !isObject(
      bootstrapPayload.data
    )
  ) {
    return bootstrapPayload;
  }

  try {
    const latest =
      await appsScriptGet(
        env,
        "inputPreferences"
      );

    if (
      latest?.success !==
        true ||
      !isObject(
        latest.data
      )
    ) {
      return bootstrapPayload;
    }

    return {
      ...bootstrapPayload,

      data: {
        ...bootstrapPayload.data,

        inputPreferences:
          latest.data
      }
    };
  } catch {
    return bootstrapPayload;
  }
}

async function invalidateBootstrap(
  origin
) {
  bootstrapGeneration +=
    1;

  bootstrapMemory =
    null;

  bootstrapOrigin =
    "";

  bootstrapExpiresAt =
    0;

  bootstrapPromise =
    null;

  if (
    typeof caches !==
      "undefined" &&
    caches.default
  ) {
    try {
      await caches.default.delete(
        bootstrapCacheKey(
          origin
        )
      );
    } catch {
      /*
       * 실제 저장은 캐시 삭제 실패 때문에
       * 실패시키지 않습니다.
       */
    }
  }
}

function getCurrentMonthSeoul() {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit"
      }
    ).formatToParts(
      new Date()
    );

  const year =
    parts.find(
      part =>
        part.type ===
        "year"
    )?.value || "";

  const month =
    parts.find(
      part =>
        part.type ===
        "month"
    )?.value || "";

  return `${year}-${month}`;
}

function dashboardCacheKey(
  origin,
  month
) {
  return new Request(
    `${origin}/__moneybook_internal/dashboard-v2/${encodeURIComponent(
      month
    )}`
  );
}

function rememberDashboard(
  data,
  month
) {
  dashboardMemory =
    data;

  dashboardMonth =
    month;

  dashboardExpiresAt =
    Date.now() +
    DASHBOARD_TTL_MS;
}

async function invalidateDashboard(
  origin
) {
  const month =
    getCurrentMonthSeoul();

  dashboardGeneration +=
    1;

  dashboardMemory =
    null;

  dashboardMonth =
    "";

  dashboardExpiresAt =
    0;

  dashboardPromise =
    null;

  if (
    typeof caches !==
      "undefined" &&
    caches.default
  ) {
    try {
      await caches.default.delete(
        dashboardCacheKey(
          origin,
          month
        )
      );
    } catch {
      /*
       * 실제 저장은 캐시 삭제 실패 때문에
       * 실패시키지 않습니다.
       */
    }
  }
}

async function getDashboard(
  env,
  origin,
  requestedMonth,
  forceRefresh
) {
  const currentMonth =
    getCurrentMonthSeoul();

  const month =
    requestedMonth ||
    currentMonth;

  if (
    month !==
    currentMonth
  ) {
    return appsScriptGet(
      env,
      "dashboard",
      {
        month
      }
    );
  }

  if (
    forceRefresh
  ) {
    await invalidateDashboard(
      origin
    );
  }

  if (
    !forceRefresh &&
    dashboardMemory &&
    dashboardMonth ===
      month &&
    dashboardExpiresAt >
      Date.now()
  ) {
    return dashboardMemory;
  }

  if (
    !forceRefresh &&
    typeof caches !==
      "undefined" &&
    caches.default
  ) {
    const cached =
      await caches.default.match(
        dashboardCacheKey(
          origin,
          month
        )
      );

    if (
      cached
    ) {
      try {
        const data =
          await cached.json();

        rememberDashboard(
          data,
          month
        );

        return data;
      } catch {
        /*
         * 손상된 캐시는 아래에서
         * 다시 불러옵니다.
         */
      }
    }
  }

  if (
    !dashboardPromise
  ) {
    const generation =
      dashboardGeneration;

    const loading =
      appsScriptGet(
        env,
        "dashboard",
        {
          month
        }
      )
        .then(
          async data => {
            if (
              data?.success !==
                false &&
              generation ===
                dashboardGeneration
            ) {
              rememberDashboard(
                data,
                month
              );

              if (
                typeof caches !==
                  "undefined" &&
                caches.default
              ) {
                await caches.default.put(
                  dashboardCacheKey(
                    origin,
                    month
                  ),
                  new Response(
                    JSON.stringify(
                      data
                    ),
                    {
                      headers: {
                        "Content-Type":
                          "application/json; charset=utf-8",

                        "Cache-Control":
                          "public, max-age=30"
                      }
                    }
                  )
                );
              }
            }

            return data;
          }
        )
        .finally(
          () => {
            if (
              dashboardPromise ===
              loading
            ) {
              dashboardPromise =
                null;
            }
          }
        );

    dashboardPromise =
      loading;
  }

  return dashboardPromise;
}

async function prefetchBootstrap(
  env,
  origin
) {
  try {
    await getCachedBootstrap(
      env,
      origin
    );
  } catch {
    /*
     * 프리페치 실패는 실제 화면 진입을
     * 막지 않습니다.
     */
  }
}

async function prefetchDashboard(
  env,
  origin
) {
  try {
    await getDashboard(
      env,
      origin,
      getCurrentMonthSeoul(),
      false
    );
  } catch {
    /*
     * 프리페치 실패는 실제 화면 진입을
     * 막지 않습니다.
     */
  }
}

async function prepareBackend(
  env,
  origin
) {
  /*
   * 앱 첫 진입에서는 홈 대시보드가 가장 먼저 필요합니다.
   * 대시보드를 우선 준비한 뒤 입력용 bootstrap을 채워
   * Apps Script 냉시작 요청이 서로 경쟁하지 않게 합니다.
   */
  await prefetchDashboard(
    env,
    origin
  );

  await prefetchBootstrap(
    env,
    origin
  );
}

async function refreshAfterMutation(
  kind,
  data,
  ctx,
  env,
  origin
) {
  if (
    !data ||
    data.success ===
      false
  ) {
    return;
  }

  if (
    kind ===
    "none"
  ) {
    return;
  }

  if (
    kind ===
    "master"
  ) {
    await Promise.all([
      invalidateBootstrap(
        origin
      ),

      invalidateDashboard(
        origin
      )
    ]);

    if (
      ctx &&
      typeof ctx.waitUntil ===
        "function"
    ) {
      ctx.waitUntil(
        Promise.all([
          prefetchBootstrap(
            env,
            origin
          ),

          prefetchDashboard(
            env,
            origin
          )
        ])
      );
    }

    return;
  }

  await invalidateDashboard(
    origin
  );

  if (
    ctx &&
    typeof ctx.waitUntil ===
      "function"
  ) {
    ctx.waitUntil(
      prefetchDashboard(
        env,
        origin
      )
    );
  }
}

function collectGetParams(
  url,
  names
) {
  const params = {};

  for (
    const name
    of names
  ) {
    params[name] =
      url.searchParams.get(
        name
      ) || "";
  }

  return params;
}

async function readJsonObject(
  request,
  options = {}
) {
  if (
    options.allowEmptyBody
  ) {
    const text =
      await request.text();

    if (
      !text.trim()
    ) {
      return {};
    }

    try {
      const parsed =
        JSON.parse(
          text
        );

      return isObject(
        parsed
      )
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  try {
    const parsed =
      await request.json();

    return isObject(
      parsed
    )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function loginRateLimitKey(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function getHouseholdRealtimeStub(env) {
  if (!env.HOUSEHOLD_REALTIME) {
    return null;
  }

  const namespace = env.HOUSEHOLD_REALTIME;
  return typeof namespace.getByName === "function"
    ? namespace.getByName(MB_D1_HOUSEHOLD_ID)
    : namespace.get(namespace.idFromName(MB_D1_HOUSEHOLD_ID));
}

async function checkLoginRateLimit(request, env) {
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return { blocked: false, retryAfterSeconds: 0 };

    const response = await stub.fetch(
      "https://moneybook-realtime.internal/auth/rate-limit/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginRateLimitKey(request) })
      }
    );

    if (!response.ok) return { blocked: false, retryAfterSeconds: 0 };
    return await response.json();
  } catch {
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

async function updateLoginRateLimit(request, env, action) {
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return;

    await stub.fetch(
      `https://moneybook-realtime.internal/auth/rate-limit/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginRateLimitKey(request) })
      }
    );
  } catch {
    // rate limit storage failure should not make the household app unavailable
  }
}

async function handleLogin(
  request,
  env,
  ctx,
  origin
) {
  if (
    !isSameOrigin(
      request
    )
  ) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403
    );
  }

  const body =
    await readJsonObject(
      request
    );

  if (
    !body
  ) {
    return errorResponse(
      "INVALID_JSON",
      "로그인 요청 형식이 올바르지 않습니다.",
      400
    );
  }

  const name =
    String(
      body.name ||
      ""
    ).trim();

  const password =
    String(
      body.password ||
      ""
    );

  if (
    !name ||
    !password ||
    name.length > 100 ||
    password.length > 500
  ) {
    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

  const rateLimit =
    await checkLoginRateLimit(
      request,
      env
    );

  if (rateLimit.blocked) {
    return errorResponse(
      "LOGIN_RATE_LIMITED",
      "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
      429
    );
  }

  const users =
    getLoginUsers(
      env
    );

  const stored =
    Object.prototype
      .hasOwnProperty
      .call(
        users,
        name
      )
      ? String(
          users[name]
        )
      : "";

  if (
    !stored ||
    !(
      await verifyStoredPassword(
        password,
        stored
      )
    )
  ) {
    await updateLoginRateLimit(
      request,
      env,
      "failure"
    );

    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

  await updateLoginRateLimit(
    request,
    env,
    "success"
  );

  const token =
    await createSessionToken(
      name,
      env
    );

  if (
    ctx &&
    typeof ctx.waitUntil ===
      "function"
  ) {
    ctx.waitUntil(
      prepareBackend(
        env,
        origin
      )
    );
  }

  return jsonResponse(
    {
      success: true,
      loggedIn: true,

      user: {
        name
      }
    },
    200,
    {
      "Set-Cookie":
        createCookie(
          token
        )
    }
  );
}

async function handleSession(
  request,
  env,
  ctx,
  origin
) {
  const session =
    await getSession(
      request,
      env
    );

  if (
    !session
  ) {
    return unauthorized();
  }

  const token =
    await createSessionToken(
      session.name,
      env
    );

  if (
    ctx &&
    typeof ctx.waitUntil ===
      "function"
  ) {
    ctx.waitUntil(
      prepareBackend(
        env,
        origin
      )
    );
  }

  return jsonResponse(
    {
      success: true,
      loggedIn: true,

      user: {
        name:
          session.name
      }
    },
    200,
    {
      "Set-Cookie":
        createCookie(
          token
        )
    }
  );
}

async function handleInputPreferences(
  request,
  session,
  env,
  ctx,
  origin
) {
  if (
    !isSameOrigin(
      request
    )
  ) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403
    );
  }

  const body =
    await readJsonObject(
      request
    );

  if (
    !body ||
    !isObject(
      body.preferences
    )
  ) {
    return errorResponse(
      "INVALID_INPUT_PREFERENCES",
      "입력 설정 형식이 올바르지 않습니다.",
      400
    );
  }

  const data =
    await appsScriptPost(
      env,
      "setInputPreferences",
      {
        preferences:
          body.preferences,

        actor:
          session.name
      }
    );

  if (
    data?.success !==
      false
  ) {
    await invalidateBootstrap(
      origin
    );

    if (
      ctx &&
      typeof ctx.waitUntil ===
        "function"
    ) {
      ctx.waitUntil(
        prefetchBootstrap(
          env,
          origin
        )
      );
    }
  }

  return jsonResponse(
    data
  );
}

async function handleGenericPost(
  request,
  route,
  session,
  env,
  ctx,
  origin
) {
  if (
    !isSameOrigin(
      request
    )
  ) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403
    );
  }

  const body =
    await readJsonObject(
      request,
      {
        allowEmptyBody:
          route.allowEmptyBody
      }
    );

  if (
    !body
  ) {
    return errorResponse(
      route.invalidCode,
      route.invalidMessage,
      400
    );
  }

  const data =
    await appsScriptPost(
      env,
      route.action,
      {
        ...body,

        actor:
          session.name
      }
    );

  await refreshAfterMutation(
    route.refresh,
    data,
    ctx,
    env,
    origin
  );

  return jsonResponse(
    data
  );
}

async function handleInvestmentCashBaseline(
  request,
  session,
  env,
  ctx,
  origin
) {
  if (
    !isSameOrigin(
      request
    )
  ) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403
    );
  }

  const body =
    await readJsonObject(
      request
    );

  if (
    !body
  ) {
    return errorResponse(
      "INVALID_INVESTMENT_CASH",
      "예수금 설정 형식이 올바르지 않습니다.",
      400
    );
  }

  const data =
    await appsScriptPost(
      env,
      "setInvestmentCashBaseline",
      {
        ...body,

        amount:
          body.amount ??
          body.cashBaselineKrw,

        actor:
          session.name
      }
    );

  await refreshAfterMutation(
    "dashboard",
    data,
    ctx,
    env,
    origin
  );

  return jsonResponse(
    data
  );
}

async function handleInvestmentSymbolLookup(url) {
  const code = normalizeInvestmentLookupCode(
    url.searchParams.get("code")
  );

  if (!code) {
    return errorResponse(
      "INVALID_STOCK_CODE",
      "종목코드 형식이 올바르지 않습니다.",
      400
    );
  }

  const data =
    await lookupInvestmentSymbol(code);

  return jsonResponse(
    {
      success: true,
      data
    },
    200,
    {
      "Cache-Control":
        data.found
          ? "private, max-age=86400"
          : "private, max-age=300"
    }
  );
}

async function handleInvestmentSymbolSearch(url) {
  const query = normalizeInvestmentSearchQuery(
    url.searchParams.get("q")
  );

  if (!query) {
    return jsonResponse(
      {
        success: true,
        data: {
          query: "",
          items: []
        }
      },
      200,
      {
        "Cache-Control": "private, max-age=60"
      }
    );
  }

  const data = await searchInvestmentSymbols(query);

  return jsonResponse(
    {
      success: true,
      data
    },
    200,
    {
      "Cache-Control": "private, max-age=300"
    }
  );
}

async function handleBackendTest(
  env,
  session
) {
  const data =
    await appsScriptGet(
      env,
      "bootstrap"
    );

  if (
    !data.success
  ) {
    return jsonResponse(
      {
        success: false,
        backendAuthenticated: false,

        error:
          data.error || {
            code:
              "BACKEND_ERROR",

            message:
              "Apps Script 요청에 실패했습니다."
          }
      },
      502
    );
  }

  const bootstrap =
    data.data || {};

  return jsonResponse({
    success: true,
    backendAuthenticated: true,
    apiVersion:
      data.apiVersion,
    user:
      session.name,
    message:
      "로그인 + Cloudflare + Apps Script 연결 성공",

    counts: {
      accounts:
        Array.isArray(
          bootstrap.accounts
        )
          ? bootstrap.accounts
              .length
          : 0,

      categories:
        Array.isArray(
          bootstrap.categories
        )
          ? bootstrap.categories
              .length
          : 0,

      members:
        Array.isArray(
          bootstrap.members
        )
          ? bootstrap.members
              .length
          : 0,

      spendingTargets:
        Array.isArray(
          bootstrap.spendingTargets
        )
          ? bootstrap.spendingTargets
              .length
          : 0
    }
  });
}

const MB_D1_HOUSEHOLD_ID = "HH_MAIN";
const MB_D1_API_VERSION = "D1-2.0";

function mbD1AdminToolsEnabled(env) {
  const value = String(env?.ENABLE_D1_ADMIN_TOOLS ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
const MB_D1_QUOTE_REFRESH_MS = 5 * 60 * 1000;
let mbD1LastQuoteRefreshAt = 0;
let mbD1QuoteRefreshPromise = null;

class MbD1Error extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MbD1Error";
    this.code = code;
    this.status = status;
  }
}

function mbD1Fail(code, message, status = 400) {
  throw new MbD1Error(code, message, status);
}

function mbD1Text(value) {
  return String(value ?? "").trim();
}

function mbD1Number(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mbD1NullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mbD1Bool(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function mbD1Round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((mbD1Number(value) + Number.EPSILON) * factor) / factor;
}

function mbD1Has(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function mbD1Id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function mbD1Now() {
  return new Date().toISOString();
}

function mbD1TimestampMs(value) {
  const text = mbD1Text(value);
  if (!text) return null;
  let parsed;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    parsed = Date.parse(text.replace(" ", "T") + "+09:00");
  } else {
    parsed = Date.parse(text);
  }
  return Number.isFinite(parsed) ? parsed : null;
}

function mbD1CurrentYearSeoul() {
  return Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric"
  }).format(new Date()));
}

function mbD1CurrentDateSeoul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function mbD1CurrentMonthSeoul() {
  return mbD1CurrentDateSeoul().slice(0, 7);
}

function mbD1DisplayName(name, owner) {
  const cleanName = mbD1Text(name);
  const cleanOwner = mbD1Text(owner);
  return cleanOwner && cleanOwner !== "공동"
    ? `${cleanName}(${cleanOwner})`
    : cleanName;
}

function mbD1IsInvestmentAccount(account) {
  return Boolean(account) && (
    account.balanceMethod === "평가입력" ||
    account.subType === "주식" ||
    account.accountType === "투자"
  );
}

function mbD1AccountActive(row) {
  if (!row || row.deleted_at) return false;
  const year = mbD1CurrentYearSeoul();
  const start = mbD1NullableNumber(row.start_year);
  const end = mbD1NullableNumber(row.end_year);
  if (start !== null || end !== null) {
    return (start === null || year >= start) && (end === null || year <= end);
  }
  return mbD1Bool(row.is_active);
}

function mbD1Envelope(data) {
  return jsonResponse({
    success: true,
    apiVersion: MB_D1_API_VERSION,
    data
  });
}

async function mbD1All(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  const result = binds.length ? await statement.bind(...binds).all() : await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function mbD1First(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  return binds.length ? statement.bind(...binds).first() : statement.first();
}

async function mbD1MemberByName(env, name) {
  const clean = mbD1Text(name);
  if (!clean || clean === "공동") return null;
  return mbD1First(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=? AND display_name=? AND deleted_at IS NULL AND is_active=1 LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, clean]
  );
}

async function mbD1MemberIdByName(env, name) {
  const member = await mbD1MemberByName(env, name);
  return member?.member_id || null;
}

async function mbD1Members(env) {
  const rows = await mbD1All(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY display_name",
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows;
}

async function mbD1GetLedgerConfigData(env) {
  const row = await mbD1First(
    env,
    "SELECT ledger_start_date FROM households WHERE household_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  return { ledgerStartDate: row?.ledger_start_date || null };
}

async function mbD1ValidateLedgerDate(env, dateValue) {
  const date = mbD1DateOnly(dateValue);
  if (!date) mbD1Fail("INVALID_DATE", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const config = await mbD1GetLedgerConfigData(env);
  if (config.ledgerStartDate && date < config.ledgerStartDate) {
    mbD1Fail(
      "TRANSACTION_BEFORE_LEDGER_START",
      `가계부 시작일 ${config.ledgerStartDate}보다 이전 거래는 입력할 수 없습니다.`
    );
  }
  return date;
}

function mbD1MapCategory(row) {
  const type = mbD1Text(row.type);
  const name = mbD1Text(row.name);
  return {
    categoryId: mbD1Text(row.category_id),
    type,
    name,
    settlementEligible: mbD1IsSettlementEligibleCategory(type, name),
    active: mbD1Bool(row.is_active),
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

function mbD1MapAccountRow(row) {
  const owner = mbD1Text(row.owner_label || row.owner_name);
  const active = mbD1AccountActive(row);
  return {
    accountId: mbD1Text(row.account_id),
    accountName: mbD1Text(row.name),
    displayName: mbD1Text(row.display_name) || mbD1DisplayName(row.name, owner),
    accountType: mbD1Text(row.account_type),
    subType: mbD1Text(row.sub_type),
    owner,
    openingBalance: mbD1Number(row.opening_balance),
    billingCutoffDay: mbD1NullableNumber(row.billing_cutoff_day),
    paymentDay: mbD1NullableNumber(row.payment_day),
    startYear: mbD1NullableNumber(row.start_year),
    endYear: mbD1NullableNumber(row.end_year),
    active,
    balanceMethod: mbD1Text(row.balance_method),
    sheetCurrentBalance: mbD1Number(row.current_balance_override),
    paymentAccountId: row.payment_account_id || null,
    paymentAccountName: mbD1Text(row.payment_account_name) || null,
    assetAttribution: mbD1Text(row.asset_attribution),
    cashBaselineKrw: mbD1NullableNumber(row.investment_cash_baseline_krw),
    cashBaselineAtDate: row.investment_cash_baseline_at || null,
    cashBaselineAt: row.investment_cash_baseline_at || null,
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

async function mbD1RawAccounts(env) {
  return mbD1All(
    env,
    `SELECT a.*, m.display_name AS owner_name, p.display_name AS payment_account_name
     FROM accounts a
     LEFT JOIN members m ON m.member_id=a.owner_member_id
     LEFT JOIN accounts p ON p.account_id=a.payment_account_id
     WHERE a.household_id=?
     ORDER BY COALESCE(a.display_name,a.name), a.account_id`,
    [MB_D1_HOUSEHOLD_ID]
  );
}

function mbD1MapTransactionRow(row) {
  return {
    transactionId: mbD1Text(row.transaction_id),
    date: mbD1Text(row.date),
    type: mbD1Text(row.type),
    categoryId: row.category_id || null,
    category: mbD1Text(row.category_name),
    settlementEligible: mbD1IsSettlementEligibleCategory(row.type, row.category_name),
    amount: mbD1Number(row.amount),
    fromAccountId: row.from_account_id || null,
    fromAccount: mbD1Text(row.from_account_name) || null,
    toAccountId: row.to_account_id || null,
    toAccount: mbD1Text(row.to_account_name) || null,
    paymentMethodId: row.payment_method_id || null,
    paymentMethod: mbD1Text(row.payment_method_name) || null,
    spendingTarget: mbD1Text(row.spending_target) || null,
    description: mbD1Text(row.description),
    memo: mbD1Text(row.memo),
    billingOverride: row.billing_month_override || null,
    billingMonth: row.billing_month || null,
    groupId: row.group_id || null,
    requestId: row.request_id || null,
    reversalOf: row.reversal_of || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    updatedAtMs: mbD1TimestampMs(row.updated_at),
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by),
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

const MB_D1_TRANSACTION_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON c.category_id=t.category_id
  LEFT JOIN accounts fa ON fa.account_id=t.from_account_id
  LEFT JOIN accounts ta ON ta.account_id=t.to_account_id
  LEFT JOIN accounts pm ON pm.account_id=t.payment_method_id
`;

const MB_D1_TRANSACTION_SELECT = `
  SELECT t.*,
         c.name AS category_name,
         fa.display_name AS from_account_name,
         ta.display_name AS to_account_name,
         pm.display_name AS payment_method_name
  ${MB_D1_TRANSACTION_FROM}
`;

async function mbD1AllTransactions(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     ORDER BY t.date DESC, COALESCE(t.source_row,0) DESC, t.created_at DESC`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapTransactionRow);
}

async function mbD1RecentExpenseTransactions(env, limit = 800) {
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(Number(limit) || 800)));
  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? AND t.deleted_at IS NULL AND t.type='지출'
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ?`,
    [MB_D1_HOUSEHOLD_ID, safeLimit]
  );
  return rows.map(mbD1MapTransactionRow);
}

async function mbD1TransactionById(env, transactionId, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     WHERE t.household_id=? AND t.transaction_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
  return row ? mbD1MapTransactionRow(row) : null;
}

function mbD1MapHoldingRow(row) {
  const quantity = mbD1Number(row.quantity);
  const currentPrice = mbD1NullableNumber(row.current_price);
  const fx = mbD1NullableNumber(row.fx_rate) ?? (mbD1Text(row.market) === "국내" ? 1 : null);
  const value = mbD1NullableNumber(row.value_krw) ?? (
    currentPrice !== null && fx !== null ? quantity * currentPrice * fx : 0
  );
  const bookCost = mbD1NullableNumber(row.book_cost_krw) ?? 0;
  const returnRate = mbD1NullableNumber(row.return_rate) ?? (
    bookCost > 0 ? (value - bookCost) / bookCost : null
  );
  let elapsedDays = mbD1NullableNumber(row.elapsed_days);
  const lastUpdated = mbD1Text(row.last_updated) || null;
  if (lastUpdated && mbD1DateOnly(lastUpdated)) {
    const now = Date.parse(mbD1CurrentDateSeoul() + "T00:00:00+09:00");
    const then = Date.parse(lastUpdated + "T00:00:00+09:00");
    if (Number.isFinite(now) && Number.isFinite(then)) {
      elapsedDays = Math.max(0, Math.floor((now - then) / 86400000));
    }
  }
  return {
    holdingId: mbD1Text(row.holding_id),
    accountId: mbD1Text(row.account_id) || null,
    accountName: mbD1Text(row.account_name) || null,
    stockCode: mbD1Text(row.stock_code).toUpperCase(),
    stockName: mbD1Text(row.stock_name),
    market: mbD1Text(row.market),
    quantity,
    avgBuyPrice: mbD1Number(row.avg_buy_price),
    quoteMode: mbD1Text(row.quote_mode),
    manualPrice: mbD1NullableNumber(row.manual_price),
    currentPrice: currentPrice ?? 0,
    fx: fx ?? 0,
    valueKrw: mbD1Round(value, 2),
    costKrw: mbD1Round(bookCost, 2),
    bookCostKrw: mbD1Round(bookCost, 2),
    returnRate,
    owner: mbD1Text(row.owner_label),
    lastUpdated,
    elapsedDays,
    baselineQuantity: mbD1Number(row.baseline_quantity),
    baselineAvgPrice: mbD1Number(row.baseline_avg_price),
    baselineBookCostKrw: mbD1Number(row.baseline_book_cost_krw),
    baselineAt: row.baseline_at || null,
    baselineAtDate: row.baseline_at || null,
    managedByTradesV22: mbD1Bool(row.managed_by_trades),
    isDeleted: Boolean(row.deleted_at),
    row: mbD1Number(row.source_row, 0)
  };
}

async function mbD1Holdings(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `SELECT h.*, a.display_name AS account_name
     FROM holdings h
     LEFT JOIN accounts a ON a.account_id=h.account_id
     WHERE h.household_id=? ${includeDeleted ? "" : "AND h.deleted_at IS NULL"}
     ORDER BY h.account_id,h.stock_code,h.holding_id`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapHoldingRow);
}

function mbD1MapTradeRow(row) {
  return {
    investmentTradeId: mbD1Text(row.investment_trade_id),
    date: mbD1Text(row.trade_date),
    tradeDate: mbD1Text(row.trade_date),
    tradeType: mbD1Text(row.trade_type),
    accountId: mbD1Text(row.account_id),
    accountName: mbD1Text(row.account_name),
    holdingId: mbD1Text(row.holding_id),
    stockCode: mbD1Text(row.stock_code).toUpperCase(),
    stockName: mbD1Text(row.stock_name),
    market: mbD1Text(row.market),
    quantity: mbD1Number(row.quantity),
    unitPrice: mbD1Number(row.unit_price),
    currency: mbD1Text(row.currency).toUpperCase(),
    fxRate: mbD1Number(row.fx_rate),
    feeKrw: mbD1Number(row.fee_krw),
    taxKrw: mbD1Number(row.tax_krw),
    settlementKrw: mbD1Number(row.settlement_krw),
    realizedPnlKrw: mbD1Number(row.realized_pnl_krw),
    memo: mbD1Text(row.memo),
    requestId: row.request_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    updatedAtMs: mbD1TimestampMs(row.updated_at),
    isDeleted: Boolean(row.deleted_at),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by),
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    row: mbD1Number(row.source_row, 0)
  };
}

async function mbD1Trades(env, includeDeleted = false) {
  const rows = await mbD1All(
    env,
    `SELECT t.*, a.display_name AS account_name
     FROM investment_trades t
     LEFT JOIN accounts a ON a.account_id=t.account_id
     WHERE t.household_id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}
     ORDER BY t.trade_date,t.created_at,t.investment_trade_id`,
    [MB_D1_HOUSEHOLD_ID]
  );
  return rows.map(mbD1MapTradeRow);
}

function mbD1TransactionAfterBaseline(transaction, baselineAt) {
  const baselineMs = mbD1TimestampMs(baselineAt);
  if (baselineMs === null || !transaction?.date) return false;
  const baselineDate = new Date(baselineMs).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (transaction.date > baselineDate) return true;
  if (transaction.date < baselineDate) return false;
  const createdMs = mbD1TimestampMs(transaction.createdAt);
  return createdMs !== null && createdMs > baselineMs;
}

function mbD1InvestmentStatusFromData(accounts, transactions, trades, holdings, accountId = "") {
  const valueMap = new Map();
  for (const holding of holdings || []) {
    if (holding.isDeleted) continue;
    valueMap.set(
      holding.accountId,
      (valueMap.get(holding.accountId) || 0) + mbD1Number(holding.valueKrw)
    );
  }
  let items = (accounts || [])
    .filter((account) => !account.isDeleted && account.active && mbD1IsInvestmentAccount(account))
    .map((account) => {
      const configured = Boolean(account.cashBaselineAt);
      let ledgerDelta = 0;
      let tradeDelta = 0;
      let realized = 0;
      if (configured) {
        for (const tx of transactions || []) {
          if (tx.isDeleted || !mbD1TransactionAfterBaseline(tx, account.cashBaselineAt)) continue;
          if (tx.fromAccountId === account.accountId) ledgerDelta -= mbD1Number(tx.amount);
          if (tx.toAccountId === account.accountId) ledgerDelta += mbD1Number(tx.amount);
        }
        const baselineMs = mbD1TimestampMs(account.cashBaselineAt);
        for (const trade of trades || []) {
          if (trade.isDeleted || trade.accountId !== account.accountId) continue;
          const createdMs = mbD1TimestampMs(trade.createdAt);
          if (baselineMs !== null && createdMs !== null && createdMs < baselineMs) continue;
          tradeDelta += trade.tradeType === "매수"
            ? -mbD1Number(trade.settlementKrw)
            : mbD1Number(trade.settlementKrw);
          realized += mbD1Number(trade.realizedPnlKrw);
        }
      }
      const currentCash = configured
        ? mbD1Number(account.cashBaselineKrw) + ledgerDelta + tradeDelta
        : null;
      const holdingValue = mbD1Number(valueMap.get(account.accountId));
      return {
        accountId: account.accountId,
        accountName: account.displayName,
        owner: account.owner,
        accountType: account.accountType,
        subType: account.subType,
        cashBaselineConfigured: configured,
        cashBaselineKrw: configured ? mbD1Number(account.cashBaselineKrw) : null,
        cashBaselineAt: account.cashBaselineAt,
        ledgerCashDeltaKrw: configured ? mbD1Round(ledgerDelta, 2) : null,
        investmentTradeCashDeltaKrw: configured ? mbD1Round(tradeDelta, 2) : null,
        currentCashKrw: currentCash === null ? null : mbD1Round(currentCash, 2),
        holdingValueKrw: mbD1Round(holdingValue, 2),
        accountValueKrw: mbD1Round((currentCash === null ? 0 : currentCash) + holdingValue, 2),
        realizedPnlKrw: mbD1Round(realized, 2)
      };
    });
  if (accountId) items = items.filter((item) => item.accountId === accountId);
  return { accounts: items };
}

async function mbD1LoadFinancialData(env) {
  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const transactions = await mbD1AllTransactions(env, false);
  const holdings = await mbD1Holdings(env, false);
  const trades = await mbD1Trades(env, false);
  const investment = mbD1InvestmentStatusFromData(accounts, transactions, trades, holdings);
  const balances = new Map();
  for (const account of accounts) {
    if (account.active && !account.isDeleted) balances.set(account.accountId, mbD1Number(account.openingBalance));
  }
  for (const tx of transactions) {
    if (tx.fromAccountId && balances.has(tx.fromAccountId)) {
      balances.set(tx.fromAccountId, balances.get(tx.fromAccountId) - mbD1Number(tx.amount));
    }
    if (tx.toAccountId && balances.has(tx.toAccountId)) {
      balances.set(tx.toAccountId, balances.get(tx.toAccountId) + mbD1Number(tx.amount));
    }
  }
  for (const item of investment.accounts) {
    balances.set(item.accountId, item.accountValueKrw);
  }
  for (const account of accounts) {
    account.currentBalance = balances.has(account.accountId)
      ? mbD1Round(balances.get(account.accountId), 2)
      : mbD1Number(account.sheetCurrentBalance);
    const inv = investment.accounts.find((item) => item.accountId === account.accountId);
    if (inv) {
      account.investmentCashConfigured = inv.cashBaselineConfigured;
      account.investmentCashKrw = inv.currentCashKrw ?? 0;
      account.securitiesValueKrw = inv.holdingValueKrw;
      account.realizedPnlKrw = inv.realizedPnlKrw;
    }
  }
  return { accounts, transactions, holdings, trades, investment, balances };
}

function mbD1NetMonthStats(transactions, month) {
  const byId = new Map((transactions || []).map((tx) => [tx.transactionId, tx]));
  const monthTx = (transactions || []).filter((tx) => tx.date && tx.date.startsWith(month));
  let incomeGross = 0;
  let expenseGross = 0;
  let expenseRefunds = 0;
  let incomeReversals = 0;
  const categoryNet = new Map();
  const targetNet = new Map();
  for (const tx of monthTx) {
    if (mbD1IsBenefitTransaction(tx)) continue;

    if (tx.reversalOf) {
      const original = byId.get(tx.reversalOf);
      if (original && original.type === "지출" && tx.type === "수입") {
        expenseRefunds += tx.amount;
        const category = original.category || "미분류";
        const target = original.spendingTarget || "미분류";
        categoryNet.set(category, (categoryNet.get(category) || 0) - tx.amount);
        targetNet.set(target, (targetNet.get(target) || 0) - tx.amount);
      } else if (original && original.type === "수입" && tx.type === "지출") {
        incomeReversals += tx.amount;
      }
      continue;
    }
    if (tx.type === "수입") incomeGross += tx.amount;
    if (tx.type === "지출") {
      expenseGross += tx.amount;
      const category = tx.category || "미분류";
      const target = tx.spendingTarget || "미분류";
      categoryNet.set(category, (categoryNet.get(category) || 0) + tx.amount);
      targetNet.set(target, (targetNet.get(target) || 0) + tx.amount);
    }
  }
  const categoryExpense = Array.from(categoryNet.entries())
    .map(([name, amount]) => ({ name, amount: mbD1Round(amount, 2) }))
    .filter((item) => Math.abs(item.amount) > 0.0001)
    .sort((a, b) => b.amount - a.amount);
  const targetExpense = Array.from(targetNet.entries())
    .map(([name, amount]) => ({ name, amount: mbD1Round(amount, 2) }))
    .filter((item) => Math.abs(item.amount) > 0.0001)
    .sort((a, b) => b.amount - a.amount);
  const income = incomeGross - incomeReversals;
  const expense = expenseGross - expenseRefunds;
  return {
    incomeGross: mbD1Round(incomeGross, 2),
    expenseGross: mbD1Round(expenseGross, 2),
    expenseRefunds: mbD1Round(expenseRefunds, 2),
    incomeReversals: mbD1Round(incomeReversals, 2),
    income: mbD1Round(income, 2),
    expense: mbD1Round(expense, 2),
    net: mbD1Round(income - expense, 2),
    categoryExpense,
    targetExpense
  };
}

async function mbD1BuildDashboard(env, monthValue = "") {
  const month = monthValue || mbD1CurrentMonthSeoul();
  if (!mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  const data = await mbD1LoadFinancialData(env);
  const { accounts, transactions, holdings, trades, investment } = data;
  const realEstate = realEstateSummary(await listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, false));
  let assets = realEstate.totalValueKrw;
  let liabilities = 0;
  let investmentValue = 0;
  let cashLikeValue = 0;
  for (const account of accounts.filter((item) => item.active && !item.isDeleted)) {
    const balance = mbD1Number(account.currentBalance);
    if (account.accountType === "부채") {
      liabilities += Math.max(0, -balance);
    } else {
      assets += balance;
      if (mbD1IsInvestmentAccount(account)) investmentValue += balance;
      else cashLikeValue += balance;
    }
  }
  const stats = mbD1NetMonthStats(transactions, month);
  const transactionById = new Map(transactions.map((tx) => [tx.transactionId, tx]));
  const cards = accounts
    .filter((account) => account.active && !account.isDeleted && account.subType === "신용카드")
    .map((card) => {
      let usage = 0;
      let payments = 0;
      for (const tx of transactions) {
        if (tx.type === "지출" && tx.paymentMethodId === card.accountId) {
          const bill = tx.billingOverride || tx.billingMonth || mbD1EstimateBilling(
            tx.date,
            card.billingCutoffDay,
            card.paymentDay
          );
          if (bill === month) usage += tx.amount;
        }
        if (tx.type === "이체" && tx.toAccountId === card.accountId) {
          const bill = tx.billingOverride || tx.billingMonth || tx.date.slice(0, 7);
          if (bill === month) payments += tx.amount;
        }
        if (tx.reversalOf) {
          const original = transactionById.get(tx.reversalOf);
          if (
            tx.toAccountId === card.accountId &&
            original &&
            original.type === "지출" &&
            original.paymentMethodId === card.accountId
          ) {
            const bill = original.billingOverride || original.billingMonth || mbD1EstimateBilling(
              original.date,
              card.billingCutoffDay,
              card.paymentDay
            );
            if (bill === month) usage -= tx.amount;
          }
          if (
            tx.fromAccountId === card.accountId &&
            original &&
            original.type === "이체" &&
            original.toAccountId === card.accountId
          ) {
            const bill = original.billingOverride || original.billingMonth || original.date.slice(0, 7);
            if (bill === month) payments -= tx.amount;
          }
        }
      }
      return {
        accountId: card.accountId,
        accountName: card.displayName,
        billingMonth: month,
        usage: mbD1Round(usage, 2),
        payments: mbD1Round(payments, 2),
        estimatedRemaining: mbD1Round(usage - payments, 2)
      };
    });
  const trend = [];
  const [year, monthNumber] = month.split("-").map(Number);
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1 - index, 1));
    const trendMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const item = mbD1NetMonthStats(transactions, trendMonth);
    trend.push({ month: trendMonth, income: item.income, expense: item.expense, net: item.net });
  }
  const recentTransactions = transactions
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 20)
    .map((tx) => ({
      transactionId: tx.transactionId,
      date: tx.date,
      type: tx.type,
      categoryId: tx.categoryId,
      category: tx.category,
      amount: tx.amount,
      fromAccountId: tx.fromAccountId,
      fromAccount: tx.fromAccount,
      toAccountId: tx.toAccountId,
      toAccount: tx.toAccount,
      paymentMethodId: tx.paymentMethodId,
      paymentMethod: tx.paymentMethod,
      spendingTarget: tx.spendingTarget,
      description: tx.description,
      memo: tx.memo,
      reversalOf: tx.reversalOf
    }));
  const staleManual = holdings
    .filter((holding) => holding.quoteMode === "수동" && (
      holding.elapsedDays === null || holding.elapsedDays >= 7
    ))
    .map((holding) => ({
      holdingId: holding.holdingId,
      accountId: holding.accountId,
      accountName: holding.accountName,
      stockCode: holding.stockCode,
      stockName: holding.stockName,
      lastUpdated: holding.lastUpdated,
      elapsedDays: holding.elapsedDays
    }));
  return {
    backendVersion: MB_D1_API_VERSION,
    month,
    summary: {
      assets: mbD1Round(assets, 2),
      liabilities: mbD1Round(liabilities, 2),
      netWorth: mbD1Round(assets - liabilities, 2),
      investmentValue: mbD1Round(investmentValue, 2),
      cashLikeValue: mbD1Round(cashLikeValue, 2),
      realEstateValue: mbD1Round(realEstate.totalValueKrw, 2),
      realEstateCount: realEstate.count,
      monthIncome: stats.income,
      monthIncomeGross: stats.incomeGross,
      monthIncomeReversals: stats.incomeReversals,
      monthExpense: stats.expense,
      monthExpenseGross: stats.expenseGross,
      monthRefunds: stats.expenseRefunds,
      monthNetCashFlow: stats.net
    },
    accounts: accounts.filter((account) => account.active && !account.isDeleted),
    categoryExpense: stats.categoryExpense,
    spendingTargetExpense: stats.targetExpense,
    cards,
    monthlyTrend: trend,
    recentTransactions,
    realEstate,
    investments: {
      totalAccountValue: mbD1Round(investment.accounts.reduce((sum, item) => sum + item.accountValueKrw, 0), 2),
      cashTotal: mbD1Round(investment.accounts.reduce((sum, item) => sum + (item.currentCashKrw ?? 0), 0), 2),
      realizedPnlTotal: mbD1Round(trades.reduce((sum, item) => sum + item.realizedPnlKrw, 0), 2),
      accounts: investment.accounts,
      holdings,
      staleManualPrices: staleManual,
      cashBaselinePending: investment.accounts
        .filter((item) => !item.cashBaselineConfigured)
        .map((item) => ({ accountId: item.accountId, accountName: item.accountName }))
    }
  };
}


const MB_D1_AUTOMATION_PREF_ID = "PREF_AUTOMATION_SHARED";
const MB_D1_AUTOMATION_PREF_KEY = "automation_settings";

function mbD1DefaultAutomationSettings() {
  return {
    version: 1,
    recurringRules: [],
    benefitRules: []
  };
}

function mbD1AutomationId(value, prefix) {
  const clean = mbD1Text(value);
  return clean || mbD1Id(prefix);
}

function mbD1NormalizeBenefitRule(value, index = 0) {
  const source = isObject(value) ? value : {};
  const kind = ["none", "post_reward", "pre_discount"].includes(mbD1Text(source.kind))
    ? mbD1Text(source.kind)
    : "none";
  const ratePercent = Math.max(0, Math.min(100, mbD1Number(source.ratePercent, 0)));
  const monthlyCapRaw = mbD1NullableNumber(source.monthlyCap);
  const validFrom = mbD1DateOnly(source.validFrom) || null;
  const validTo = mbD1DateOnly(source.validTo) || null;
  const rewardOpeningBalance = Math.max(0, mbD1Number(source.rewardOpeningBalance, 0));
  return {
    id: mbD1AutomationId(source.id, `BEN${index + 1}`),
    accountId: mbD1Text(source.accountId),
    enabled: mbD1Bool(source.enabled),
    kind,
    ratePercent,
    monthlyCap: monthlyCapRaw === null ? null : Math.max(0, monthlyCapRaw),
    validFrom,
    validTo,
    rewardOpeningBalance
  };
}

function mbD1NormalizeRecurringRule(value, index = 0) {
  const source = isObject(value) ? value : {};
  const type = ["수입", "지출", "이체"].includes(mbD1Text(source.type))
    ? mbD1Text(source.type)
    : "지출";
  const mode = mbD1Text(source.mode) === "auto" ? "auto" : "confirm";
  const dayOfMonth = Math.max(1, Math.min(31, Math.floor(mbD1Number(source.dayOfMonth, 1))));
  const startMonth = mbD1MonthOnly(source.startMonth) || null;
  const endMonth = mbD1MonthOnly(source.endMonth) || null;
  return {
    id: mbD1AutomationId(source.id, `REC${index + 1}`),
    name: mbD1Text(source.name) || `고정 거래 ${index + 1}`,
    enabled: mbD1Bool(source.enabled),
    mode,
    dayOfMonth,
    startMonth,
    endMonth,
    type,
    amount: Math.max(0, mbD1Number(source.amount, 0)),
    categoryId: mbD1Text(source.categoryId),
    paymentMethodId: mbD1Text(source.paymentMethodId) || null,
    spendingTarget: mbD1Text(source.spendingTarget) || null,
    fromAccountId: mbD1Text(source.fromAccountId) || null,
    toAccountId: mbD1Text(source.toAccountId) || null,
    description: mbD1Text(source.description),
    memo: mbD1Text(source.memo)
  };
}

function mbD1NormalizeAutomationSettings(value) {
  const source = isObject(value) ? value : {};
  const recurringRules = Array.isArray(source.recurringRules)
    ? source.recurringRules.map((item, index) => mbD1NormalizeRecurringRule(item, index))
    : [];
  const benefitRules = Array.isArray(source.benefitRules)
    ? source.benefitRules.map((item, index) => mbD1NormalizeBenefitRule(item, index))
    : [];
  return {
    version: 1,
    recurringRules,
    benefitRules
  };
}

async function mbD1AutomationSettingsData(env) {
  const row = await mbD1First(
    env,
    "SELECT preference_json FROM user_preferences WHERE household_id=? AND preference_key=? ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, MB_D1_AUTOMATION_PREF_KEY]
  );
  if (!row?.preference_json) return mbD1DefaultAutomationSettings();
  try {
    return mbD1NormalizeAutomationSettings(JSON.parse(row.preference_json));
  } catch {
    return mbD1DefaultAutomationSettings();
  }
}

function mbD1ValidateAutomationSettings(settings) {
  const recurringIds = new Set();
  for (const rule of settings.recurringRules) {
    if (!rule.id || recurringIds.has(rule.id)) mbD1Fail("AUTOMATION_RULE_ID_DUPLICATE", "고정 거래 규칙 ID가 중복되었습니다.");
    recurringIds.add(rule.id);
    if (!rule.name) mbD1Fail("AUTOMATION_RULE_NAME_REQUIRED", "고정 거래 이름이 필요합니다.");
    if (!rule.categoryId) mbD1Fail("AUTOMATION_CATEGORY_REQUIRED", `${rule.name}의 카테고리를 선택해주세요.`);
    if (!Number.isFinite(rule.amount) || rule.amount <= 0) mbD1Fail("AUTOMATION_AMOUNT_REQUIRED", `${rule.name}의 금액을 입력해주세요.`);
    if (rule.startMonth && rule.endMonth && rule.startMonth > rule.endMonth) mbD1Fail("AUTOMATION_MONTH_RANGE_INVALID", `${rule.name}의 시작월이 종료월보다 늦습니다.`);
    if (rule.type === "지출" && (!rule.paymentMethodId || !rule.spendingTarget)) mbD1Fail("AUTOMATION_EXPENSE_FIELDS_REQUIRED", `${rule.name}의 결제수단과 지출대상을 선택해주세요.`);
    if (rule.type === "수입" && !rule.toAccountId) mbD1Fail("AUTOMATION_INCOME_ACCOUNT_REQUIRED", `${rule.name}의 입금수단을 선택해주세요.`);
    if (rule.type === "이체" && (!rule.fromAccountId || !rule.toAccountId || rule.fromAccountId === rule.toAccountId)) mbD1Fail("AUTOMATION_TRANSFER_ACCOUNT_REQUIRED", `${rule.name}의 보내는 수단과 받는 수단을 확인해주세요.`);
  }
  const benefitAccounts = new Set();
  for (const rule of settings.benefitRules) {
    if (!rule.accountId) mbD1Fail("BENEFIT_ACCOUNT_REQUIRED", "혜택을 적용할 계좌를 선택해주세요.");
    if (benefitAccounts.has(rule.accountId)) mbD1Fail("BENEFIT_ACCOUNT_DUPLICATE", "한 계좌에는 하나의 현재 혜택 규칙만 설정할 수 있습니다.");
    benefitAccounts.add(rule.accountId);
    if (rule.kind !== "none" && (!Number.isFinite(rule.ratePercent) || rule.ratePercent <= 0)) mbD1Fail("BENEFIT_RATE_REQUIRED", "혜택률은 0보다 커야 합니다.");
    if (!Number.isFinite(rule.rewardOpeningBalance) || rule.rewardOpeningBalance < 0) mbD1Fail("BENEFIT_OPENING_BALANCE_INVALID", "시작 잔액 중 캐시백은 0원 이상이어야 합니다.");
    if (rule.validFrom && rule.validTo && rule.validFrom > rule.validTo) mbD1Fail("BENEFIT_DATE_RANGE_INVALID", "혜택 적용 시작일이 종료일보다 늦습니다.");
  }
}

async function mbD1HandleAutomationSettings(body, session, env) {
  if (!isObject(body.settings)) mbD1Fail("INVALID_AUTOMATION_SETTINGS", "자동화 설정 형식이 올바르지 않습니다.");
  const settings = mbD1NormalizeAutomationSettings(body.settings);
  mbD1ValidateAutomationSettings(settings);
  const now = mbD1Now();
  const update = env.DB.prepare(
    `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
  ).bind(
    MB_D1_AUTOMATION_PREF_ID,
    MB_D1_HOUSEHOLD_ID,
    null,
    MB_D1_AUTOMATION_PREF_KEY,
    JSON.stringify(settings),
    1,
    now,
    now
  );
  const change = await mbD1InsertChange(env, "automation_settings", "shared", "updated", 1, session);
  await env.DB.batch([update, change]);
  return { settings, updatedAt: now, updatedBy: session.name };
}

function mbD1BenefitRuleIsActive(rule, date) {
  if (!rule || !rule.enabled || rule.kind === "none" || rule.ratePercent <= 0) return false;
  if (rule.validFrom && date < rule.validFrom) return false;
  if (rule.validTo && date > rule.validTo) return false;
  return true;
}

async function mbD1EnsureSystemCategory(env, { categoryId, type, name }) {
  let row = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND type=? AND name=? ORDER BY CASE WHEN deleted_at IS NULL AND is_active=1 THEN 0 ELSE 1 END LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, type, name]
  );
  if (row?.category_id && !row.deleted_at && mbD1Bool(row.is_active)) return row;

  const now = mbD1Now();
  if (row?.category_id) {
    await env.DB.prepare(
      "UPDATE categories SET is_active=1,deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(now, "system", MB_D1_HOUSEHOLD_ID, row.category_id).run();
    return { ...row, is_active: 1, deleted_at: null };
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    categoryId,
    MB_D1_HOUSEHOLD_ID,
    type,
    name,
    1,
    now,
    now,
    "system",
    "system",
    null,
    null
  ).run();

  row = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND type=? AND name=? AND deleted_at IS NULL AND is_active=1 ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, type, name]
  );
  if (!row?.category_id) mbD1Fail("SYSTEM_CATEGORY_CREATE_FAILED", `${name} 카테고리를 준비하지 못했습니다.`, 500);
  return row;
}

async function mbD1SettlementExpenseCategory(env) {
  const existing = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND type='지출' AND name=? ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, SETTLEMENT_EXPENSE_CATEGORY_NAME]
  );
  if (existing?.category_id) return existing;

  const now = mbD1Now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    "CAT_SYSTEM_GROUP_MEAL",
    MB_D1_HOUSEHOLD_ID,
    "지출",
    SETTLEMENT_EXPENSE_CATEGORY_NAME,
    1,
    now,
    now,
    "system",
    "system",
    null,
    null
  ).run();
  return mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at,type FROM categories WHERE household_id=? AND type='지출' AND name=? ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, SETTLEMENT_EXPENSE_CATEGORY_NAME]
  );
}

async function mbD1SettlementIncomeCategory(env) {
  return mbD1EnsureSystemCategory(env, {
    categoryId: "CAT_SYSTEM_SETTLEMENT_RECEIVED",
    type: "수입",
    name: SETTLEMENT_INCOME_CATEGORY_NAME
  });
}

async function mbD1BenefitCategory(env) {
  let row = await mbD1First(
    env,
    "SELECT category_id,name,is_active,deleted_at FROM categories WHERE household_id=? AND type='수입' AND name='캐시백/할인혜택' ORDER BY CASE WHEN deleted_at IS NULL AND is_active=1 THEN 0 ELSE 1 END LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  if (row?.category_id && !row.deleted_at && mbD1Bool(row.is_active)) {
    return { category_id: row.category_id, name: row.name };
  }

  const now = mbD1Now();
  if (row?.category_id) {
    await env.DB.prepare(
      "UPDATE categories SET is_active=1,deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(now, "system", MB_D1_HOUSEHOLD_ID, row.category_id).run();
    return { category_id: row.category_id, name: row.name };
  }

  const categoryId = "CAT_SYSTEM_CASHBACK_BENEFIT";
  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
  ).bind(
    categoryId,
    MB_D1_HOUSEHOLD_ID,
    "수입",
    "캐시백/할인혜택",
    1,
    now,
    now,
    "system",
    "system",
    null,
    null
  ).run();

  row = await mbD1First(
    env,
    "SELECT category_id,name FROM categories WHERE household_id=? AND type='수입' AND name='캐시백/할인혜택' AND deleted_at IS NULL AND is_active=1 ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  if (!row?.category_id) mbD1Fail("BENEFIT_CATEGORY_CREATE_FAILED", "혜택 기록용 수입 카테고리를 준비하지 못했습니다.", 500);
  return row;
}

let mbD1BenefitUsageSchemaReady = false;
let mbD1BenefitUsageSchemaPromise = null;

async function mbD1EnsureBenefitUsageSchema(env) {
  if (mbD1BenefitUsageSchemaReady) return;
  if (!mbD1BenefitUsageSchemaPromise) {
    mbD1BenefitUsageSchemaPromise = env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS benefit_reward_usage (
          transaction_id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          used_amount REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      ),
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_benefit_reward_usage_household_rule ON benefit_reward_usage(household_id, rule_id, account_id)"
      )
    ])
      .then(() => {
        mbD1BenefitUsageSchemaReady = true;
      })
      .catch((error) => {
        mbD1BenefitUsageSchemaPromise = null;
        throw error;
      });
  }
  await mbD1BenefitUsageSchemaPromise;
}

async function mbD1BenefitRewardUsageRecord(env, transactionId) {
  await mbD1EnsureBenefitUsageSchema(env);
  return mbD1First(
    env,
    `SELECT transaction_id,rule_id,account_id,used_amount
     FROM benefit_reward_usage
     WHERE household_id=? AND transaction_id=? LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
}

async function mbD1BenefitRewardBalance(env, rule, excludeTransactionId = "", excludeBenefitRequestId = "") {
  await mbD1EnsureBenefitUsageSchema(env);
  const earnedSql = `SELECT COALESCE(SUM(amount),0) AS earned
                     FROM transactions
                     WHERE household_id=? AND type='수입' AND to_account_id=?
                       AND request_id LIKE ? AND deleted_at IS NULL
                       ${excludeBenefitRequestId ? "AND request_id<>?" : ""}`;
  const earnedBinds = [MB_D1_HOUSEHOLD_ID, rule.accountId, `BENEFIT_${rule.id}_%`];
  if (excludeBenefitRequestId) earnedBinds.push(excludeBenefitRequestId);
  const earnedRow = await mbD1First(env, earnedSql, earnedBinds);
  const usedSql = `SELECT COALESCE(SUM(u.used_amount),0) AS used
                   FROM benefit_reward_usage u
                   JOIN transactions t
                     ON t.transaction_id=u.transaction_id
                    AND t.household_id=u.household_id
                   WHERE u.household_id=? AND u.rule_id=? AND u.account_id=?
                     AND t.deleted_at IS NULL
                     ${excludeTransactionId ? "AND u.transaction_id<>?" : ""}`;
  const usedBinds = [MB_D1_HOUSEHOLD_ID, rule.id, rule.accountId];
  if (excludeTransactionId) usedBinds.push(excludeTransactionId);
  const usedRow = await mbD1First(env, usedSql, usedBinds);
  const opening = Math.max(0, mbD1Number(rule.rewardOpeningBalance, 0));
  const earned = Math.max(0, mbD1Number(earnedRow?.earned, 0));
  const used = Math.max(0, mbD1Number(usedRow?.used, 0));
  return Math.max(0, Math.floor(opening + earned - used + 1e-9));
}


async function mbD1BenefitRewardBalancesData(env) {
  const settings = await mbD1AutomationSettingsData(env);
  const rules = settings.benefitRules.filter((rule) => rule.accountId && (rule.kind === "post_reward" || rule.rewardOpeningBalance > 0));
  return Promise.all(
    rules.map(async (rule) => ({
      ruleId: rule.id,
      accountId: rule.accountId,
      rewardBalance: await mbD1BenefitRewardBalance(env, rule)
    }))
  );
}

async function mbD1BenefitUsedThisMonth(env, rule, date, excludeRequestId = "") {
  if (rule.monthlyCap === null) return 0;
  const month = date.slice(0, 7);
  const sql = `SELECT COALESCE(SUM(amount),0) AS used
               FROM transactions
               WHERE household_id=? AND type='수입' AND date>=? AND date<?
                 AND request_id LIKE ? AND deleted_at IS NULL
                 ${excludeRequestId ? "AND request_id<>?" : ""}`;
  const binds = [MB_D1_HOUSEHOLD_ID, `${month}-01`, `${month}-32`, `BENEFIT_${rule.id}_%`];
  if (excludeRequestId) binds.push(excludeRequestId);
  const row = await mbD1First(env, sql, binds);
  return Math.max(0, mbD1Number(row?.used, 0));
}

async function mbD1CalculateBenefit(env, rule, baseAmount, date, excludeRequestId = "") {
  if (!mbD1BenefitRuleIsActive(rule, date)) return 0;
  const gross = Math.max(0, Math.floor((mbD1Number(baseAmount) * rule.ratePercent) / 100 + 1e-9));
  if (gross <= 0) return 0;
  if (rule.monthlyCap === null) return gross;
  const used = await mbD1BenefitUsedThisMonth(env, rule, date, excludeRequestId);
  return Math.max(0, Math.min(gross, Math.floor(rule.monthlyCap - used)));
}

async function mbD1PrepareBenefit(env, body, options = {}) {
  const ruleId = mbD1Text(body.benefitRuleId);
  if (!ruleId) return null;
  const settings = await mbD1AutomationSettingsData(env);
  const rule = settings.benefitRules.find((item) => item.id === ruleId);
  if (!rule) mbD1Fail("BENEFIT_RULE_NOT_FOUND", "선택한 혜택 규칙을 찾을 수 없습니다.");
  const date = mbD1DateOnly(body.date);
  if (!date || !mbD1BenefitRuleIsActive(rule, date)) return null;
  const type = mbD1Text(body.type);

  if (type === "지출") {
    if (rule.kind !== "post_reward" || mbD1Text(body.paymentMethodId) !== rule.accountId) return null;
    const faceAmount = Math.max(0, mbD1Number(body.amount));
    const rewardBalanceBefore = await mbD1BenefitRewardBalance(env, rule);
    const maxRewardUsable = Math.max(0, Math.min(faceAmount, rewardBalanceBefore));
    const requestedRewardUse = Math.max(0, Math.floor(mbD1Number(body.benefitRewardUsedAmount, 0)));
    if (options.strictRewardUsage && requestedRewardUse > maxRewardUsable) {
      mbD1Fail(
        "BENEFIT_REWARD_USAGE_EXCEEDS_BALANCE",
        `사용 가능한 캐시백은 ${Math.round(maxRewardUsable).toLocaleString("ko-KR")}원입니다.`
      );
    }
    const rewardUsedAmount = Math.min(requestedRewardUse, maxRewardUsable);
    const eligibleAmount = Math.max(0, faceAmount - rewardUsedAmount);
    const accrualEnabled = body.benefitAccrualEnabled !== false;
    const benefitAmount = accrualEnabled
      ? await mbD1CalculateBenefit(env, rule, eligibleAmount, date)
      : 0;
    return {
      rule,
      kind: rule.kind,
      faceAmount,
      actualAmount: faceAmount,
      eligibleAmount,
      benefitAmount,
      accountId: rule.accountId,
      creditAccountId: rule.accountId,
      rewardBalanceBefore,
      rewardUsedAmount,
      rewardBalanceAfter: Math.max(0, rewardBalanceBefore - rewardUsedAmount + benefitAmount),
      maxRewardUsable
    };
  }

  if (type === "이체") {
    if (rule.kind !== "pre_discount" || mbD1Text(body.toAccountId) !== rule.accountId) return null;
    const category = await mbD1CategoryById(env, mbD1Text(body.categoryId), false);
    if (!category || category.name !== "지역화폐충전") return null;
    const faceAmount = Math.max(0, mbD1Number(body.benefitFaceAmount || body.amount));
    const benefitAmount = await mbD1CalculateBenefit(env, rule, faceAmount, date);
    return {
      rule,
      kind: rule.kind,
      faceAmount,
      actualAmount: Math.max(0, faceAmount - benefitAmount),
      eligibleAmount: faceAmount,
      benefitAmount,
      accountId: rule.accountId,
      creditAccountId: mbD1Text(body.fromAccountId),
      rewardBalanceBefore: 0,
      rewardUsedAmount: 0,
      rewardBalanceAfter: 0,
      maxRewardUsable: 0
    };
  }

  return null;
}

async function mbD1PreviewBenefit(env, body) {
  const benefit = await mbD1PrepareBenefit(env, body);
  if (!benefit) return null;
  return {
    kind: benefit.kind,
    ratePercent: benefit.rule.ratePercent,
    benefitAmount: benefit.benefitAmount,
    faceAmount: benefit.faceAmount,
    actualAmount: benefit.actualAmount,
    eligibleAmount: benefit.eligibleAmount,
    rewardBalanceBefore: benefit.rewardBalanceBefore,
    rewardUsedAmount: benefit.rewardUsedAmount,
    rewardBalanceAfter: benefit.rewardBalanceAfter,
    maxRewardUsable: benefit.maxRewardUsable
  };
}

async function mbD1RecurringAlreadyCreated(env, ruleId, month) {
  const requestId = `RECUR_${ruleId}_${month}`;
  const row = await mbD1First(
    env,
    "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, requestId]
  );
  return Boolean(row?.transaction_id);
}

async function mbD1CreateRecurringOccurrence(env, session, rule, month) {
  const date = mbD1RecurringOccurrenceDate(rule, month);
  if (!date) mbD1Fail("RECURRING_MONTH_INVALID", "고정 거래 대상 월이 올바르지 않습니다.");
  const requestId = `RECUR_${rule.id}_${month}`;
  let result;
  try {
    result = await mbD1HandleTransactionMutation(
      "/api/transactions",
      mbD1RecurringPayload(rule, date, requestId),
      session,
      env
    );
  } catch (error) {
    const duplicate = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (!duplicate?.transaction_id) throw error;
    result = { transactionId: duplicate.transaction_id };
  }
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    transactionId: result.transactionId,
    month,
    date
  };
}

async function mbD1ProcessRecurring(env, session, options = {}) {
  const settings = await mbD1AutomationSettingsData(env);
  const month = mbD1MonthOnly(options.month) || mbD1CurrentMonthSeoul();
  const today = mbD1CurrentDateSeoul();
  const created = [];
  const due = [];
  for (const rule of settings.recurringRules) {
    if (!mbD1RecurringRuleActiveForMonth(rule, month)) continue;
    const date = mbD1RecurringOccurrenceDate(rule, month);
    let alreadyCreated = await mbD1RecurringAlreadyCreated(env, rule.id, month);
    const isDue = month < today.slice(0, 7) || (month === today.slice(0, 7) && date <= today);
    const requestedRuleId = mbD1Text(options.ruleId);
    const shouldCreate = requestedRuleId
      ? requestedRuleId === rule.id
      : rule.mode === "auto" && isDue;
    if (!alreadyCreated && shouldCreate) {
      created.push(await mbD1CreateRecurringOccurrence(env, session, rule, month));
      alreadyCreated = true;
    }
    due.push({
      ruleId: rule.id,
      ruleName: rule.name,
      month,
      date,
      alreadyCreated,
      enabled: rule.enabled,
      mode: rule.mode
    });
  }
  return { created, due };
}

async function mbD1InputPreferencesData(env) {
  const row = await mbD1First(
    env,
    "SELECT preference_json,version,updated_at FROM user_preferences WHERE household_id=? AND preference_key='input_preferences' ORDER BY updated_at DESC LIMIT 1",
    [MB_D1_HOUSEHOLD_ID]
  );
  if (!row) {
    return { configured: false, version: 1, preferences: null, updatedAt: null, updatedBy: null };
  }
  let preferences = null;
  try {
    preferences = JSON.parse(row.preference_json || "null");
  } catch {
    mbD1Fail("INPUT_PREFERENCES_CORRUPT", "저장된 입력 설정 형식을 읽을 수 없습니다.", 500);
  }
  return {
    configured: true,
    version: mbD1Number(row.version, 1),
    preferences,
    updatedAt: row.updated_at || null,
    updatedBy: null
  };
}

async function mbD1BuildBootstrap(env) {
  await mbD1SettlementExpenseCategory(env);
  const [members, rawAccounts, categoryRows, ledgerConfig, inputPreferences, automationSettings] = await Promise.all([
    mbD1Members(env),
    mbD1RawAccounts(env),
    mbD1All(
      env,
      "SELECT * FROM categories WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY CASE type WHEN '수입' THEN 1 WHEN '지출' THEN 2 WHEN '이체' THEN 3 ELSE 99 END,name",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1GetLedgerConfigData(env),
    mbD1InputPreferencesData(env),
    mbD1AutomationSettingsData(env)
  ]);
  const accounts = rawAccounts.map(mbD1MapAccountRow).filter((account) => account.active && !account.isDeleted);
  const categories = categoryRows.map(mbD1MapCategory);
  const memberNames = members.map((member) => mbD1Text(member.display_name)).filter(Boolean);
  return {
    backendVersion: MB_D1_API_VERSION,
    transactionTypes: ["수입", "지출", "이체"],
    investmentTradeTypes: ["매수", "매도"],
    members: memberNames,
    spendingTargets: [...memberNames, "공동"],
    accounts,
    categories,
    investmentAccounts: accounts
      .filter(mbD1IsInvestmentAccount)
      .map((account) => ({
        accountId: account.accountId,
        accountName: account.displayName,
        owner: account.owner,
        accountType: account.accountType,
        subType: account.subType,
        cashBaselineConfigured: Boolean(account.cashBaselineAt),
        cashBaselineKrw: account.cashBaselineKrw,
        cashBaselineAt: account.cashBaselineAt
      })),
    ledgerConfig,
    inputPreferences,
    automationSettings
  };
}

async function mbD1GetCategoriesData(env, url) {
  await mbD1SettlementExpenseCategory(env);
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  const type = mbD1Text(url.searchParams.get("type"));
  let rows = await mbD1All(
    env,
    `SELECT * FROM categories WHERE household_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY CASE type WHEN '수입' THEN 1 WHEN '지출' THEN 2 WHEN '이체' THEN 3 ELSE 99 END,name`,
    [MB_D1_HOUSEHOLD_ID]
  );
  if (type) rows = rows.filter((row) => row.type === type);
  const items = rows.map(mbD1MapCategory);
  return { total: items.length, items };
}

async function mbD1GetAccountsData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  const owner = mbD1Text(url.searchParams.get("owner"));
  const accountType = mbD1Text(url.searchParams.get("accountType"));
  const subType = mbD1Text(url.searchParams.get("subType"));
  const financial = await mbD1LoadFinancialData(env);
  let items = financial.accounts;
  if (!includeDeleted) items = items.filter((item) => !item.isDeleted);
  if (owner) items = items.filter((item) => item.owner === owner);
  if (accountType) items = items.filter((item) => item.accountType === accountType);
  if (subType) items = items.filter((item) => item.subType === subType);
  return { total: items.length, items };
}

async function mbD1GetTransactionsData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  const type = mbD1Text(url.searchParams.get("type"));
  const categoryId = mbD1Text(url.searchParams.get("categoryId"));
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const spendingTarget = mbD1Text(url.searchParams.get("spendingTarget"));
  const q = mbD1Text(url.searchParams.get("q")).toLowerCase();
  const amountRaw = mbD1Text(url.searchParams.get("amount"));
  const dateFrom = mbD1Text(url.searchParams.get("dateFrom"));
  const dateTo = mbD1Text(url.searchParams.get("dateTo"));

  if (dateFrom && !mbD1DateOnly(dateFrom)) mbD1Fail("INVALID_DATE_FROM", "dateFrom은 YYYY-MM-DD 형식이어야 합니다.");
  if (dateTo && !mbD1DateOnly(dateTo)) mbD1Fail("INVALID_DATE_TO", "dateTo는 YYYY-MM-DD 형식이어야 합니다.");
  if (dateFrom && dateTo && dateFrom > dateTo) mbD1Fail("INVALID_DATE_RANGE", "조회 시작일은 종료일보다 늦을 수 없습니다.");

  let amount = null;
  if (amountRaw) {
    amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) mbD1Fail("INVALID_AMOUNT_FILTER", "amount는 0 이상의 숫자여야 합니다.");
  }

  const { limit, offset } = normalizeTransactionPagination(
    url.searchParams.get("limit"),
    url.searchParams.get("offset")
  );

  const { whereSql, binds } = buildTransactionSearchWhere({
    householdId: MB_D1_HOUSEHOLD_ID,
    includeDeleted,
    type,
    categoryId,
    accountId,
    spendingTarget,
    dateFrom,
    dateTo,
    amount,
    query: q
  });
  const countRow = await mbD1First(
    env,
    `SELECT COUNT(*) AS total ${MB_D1_TRANSACTION_FROM} ${whereSql}`,
    binds
  );
  const total = mbD1Number(countRow?.total, 0);

  const listBinds = [...binds];
  let pagingSql = "";
  if (limit > 0) {
    pagingSql = " LIMIT ? OFFSET ?";
    listBinds.push(limit, offset);
  }

  const rows = await mbD1All(
    env,
    `${MB_D1_TRANSACTION_SELECT}
     ${whereSql}
     ORDER BY t.date DESC, COALESCE(t.source_row,0) DESC, t.created_at DESC${pagingSql}`,
    listBinds
  );

  return {
    total,
    items: rows.map(mbD1MapTransactionRow)
  };
}

async function mbD1SettlementSummaryData(env, transactionId) {
  const original = await mbD1TransactionById(env, transactionId, true);
  if (!original || original.isDeleted) {
    mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
  }
  if (!mbD1IsSettlementEligibleCategory(original.type, original.category)) {
    mbD1Fail("SETTLEMENT_NOT_ELIGIBLE", "정산받기는 정산 가능한 지출에서만 사용할 수 있습니다.");
  }

  const rows = await mbD1All(
    env,
    `SELECT t.transaction_id,t.request_id,t.date,t.amount,t.to_account_id,t.memo,a.display_name AS to_account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.account_id=t.to_account_id
     WHERE t.household_id=? AND t.reversal_of=? AND t.deleted_at IS NULL
     ORDER BY t.date ASC,t.created_at ASC`,
    [MB_D1_HOUSEHOLD_ID, transactionId]
  );
  const linkedAmounts = rows.map((row) => mbD1Number(row.amount));
  const settlements = rows
    .filter((row) => mbD1IsSettlementRequestId(row.request_id))
    .map((row) => ({
      transactionId: mbD1Text(row.transaction_id),
      date: mbD1Text(row.date),
      amount: mbD1Number(row.amount),
      toAccountId: row.to_account_id || null,
      toAccount: mbD1Text(row.to_account_name) || null,
      memo: mbD1Text(row.memo) || null
    }));
  const settledAmount = settlements.reduce((sum, item) => sum + item.amount, 0);
  const offsetAmount = linkedAmounts.reduce((sum, value) => sum + value, 0);
  return {
    transactionId,
    originalAmount: mbD1Number(original.amount),
    settledAmount: mbD1Round(settledAmount, 2),
    otherOffsetAmount: mbD1Round(Math.max(0, offsetAmount - settledAmount), 2),
    remainingAmount: mbD1Round(mbD1SettlementRemaining(original.amount, linkedAmounts), 2),
    settlements
  };
}

async function mbD1GetAssetSnapshotsData(env, url) {
  const month = mbD1Text(url.searchParams.get("month"));
  if (month && !mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  let rows = await mbD1All(
    env,
    `SELECT * FROM asset_snapshots WHERE household_id=? ${month ? "AND month=?" : ""} ORDER BY month DESC`,
    month ? [MB_D1_HOUSEHOLD_ID, month] : [MB_D1_HOUSEHOLD_ID]
  );
  const limit = Math.max(0, Math.min(120, Number(url.searchParams.get("limit")) || 0));
  if (limit) rows = rows.slice(0, limit);
  return {
    total: rows.length,
    items: rows.map((row) => ({
      month: row.month,
      assets: mbD1Number(row.assets),
      liabilities: mbD1Number(row.liabilities),
      netWorth: mbD1Number(row.net_worth),
      investmentValue: mbD1Number(row.investment_value),
      cashLikeValue: mbD1Number(row.cash_like_value),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      createdBy: mbD1Text(row.created_by),
      updatedBy: mbD1Text(row.updated_by),
      row: 0
    }))
  };
}

async function mbD1GetInvestmentAccountsData(env) {
  const raw = await mbD1RawAccounts(env);
  const items = raw.map(mbD1MapAccountRow)
    .filter((account) => account.active && !account.isDeleted && mbD1IsInvestmentAccount(account))
    .map((account) => ({
      accountId: account.accountId,
      accountName: account.displayName,
      owner: account.owner,
      accountType: account.accountType,
      subType: account.subType,
      cashBaselineConfigured: Boolean(account.cashBaselineAt),
      cashBaselineKrw: account.cashBaselineKrw,
      cashBaselineAt: account.cashBaselineAt
    }));
  return { items };
}

async function mbD1GetHoldingsData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  let items = await mbD1Holdings(env, includeDeleted);
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const market = mbD1Text(url.searchParams.get("market"));
  const quoteMode = mbD1Text(url.searchParams.get("quoteMode"));
  if (accountId) items = items.filter((item) => item.accountId === accountId);
  if (market) items = items.filter((item) => item.market === market);
  if (quoteMode) items = items.filter((item) => item.quoteMode === quoteMode);
  return { total: items.length, items };
}

async function mbD1GetTradesData(env, url) {
  const includeDeleted = ["1", "true"].includes((url.searchParams.get("includeDeleted") || "").toLowerCase());
  let items = await mbD1Trades(env, includeDeleted);
  const accountId = mbD1Text(url.searchParams.get("accountId"));
  const holdingId = mbD1Text(url.searchParams.get("holdingId"));
  const tradeType = mbD1Text(url.searchParams.get("tradeType") || url.searchParams.get("type"));
  if (accountId) items = items.filter((item) => item.accountId === accountId);
  if (holdingId) items = items.filter((item) => item.holdingId === holdingId);
  if (tradeType) items = items.filter((item) => item.tradeType === tradeType);
  return { total: items.length, items };
}

async function mbD1GetInvestmentCashData(env, url) {
  const financial = await mbD1LoadFinancialData(env);
  return mbD1InvestmentStatusFromData(
    financial.accounts,
    financial.transactions,
    financial.trades,
    financial.holdings,
    mbD1Text(url.searchParams.get("accountId"))
  );
}

async function mbD1CategoryById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT * FROM categories WHERE household_id=? AND category_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapCategory(row) : null;
}

async function mbD1AccountById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT a.*,m.display_name AS owner_name,p.display_name AS payment_account_name
     FROM accounts a
     LEFT JOIN members m ON m.member_id=a.owner_member_id
     LEFT JOIN accounts p ON p.account_id=a.payment_account_id
     WHERE a.household_id=? AND a.account_id=? ${includeDeleted ? "" : "AND a.deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapAccountRow(row) : null;
}

async function mbD1BuildTransactionModel(env, payload, current = null, forCreate = false) {
  const source = current || {};
  const dateInput = mbD1Has(payload, "date") ? payload.date : source.date;
  const date = forCreate
    ? await mbD1ValidateLedgerDate(env, dateInput)
    : mbD1DateOnly(dateInput);
  if (!date) mbD1Fail("INVALID_DATE", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  if (!forCreate && mbD1Has(payload, "date")) await mbD1ValidateLedgerDate(env, date);
  const type = mbD1Text(mbD1Has(payload, "type") ? payload.type : source.type);
  if (!["수입", "지출", "이체"].includes(type)) mbD1Fail("INVALID_TYPE", "유형은 수입, 지출, 이체 중 하나여야 합니다.");
  const amount = Number(mbD1Has(payload, "amount") ? payload.amount : source.amount);
  if (!Number.isFinite(amount) || amount <= 0) mbD1Fail("INVALID_NUMBER", "금액은 0보다 큰 숫자여야 합니다.");
  const categoryId = mbD1Text(mbD1Has(payload, "categoryId") ? payload.categoryId : source.categoryId);
  const keepsExistingCategory = !forCreate && categoryId === mbD1Text(source.categoryId);
  const category = await mbD1CategoryById(env, categoryId, keepsExistingCategory);
  if (!category || ((!category.active || category.isDeleted) && !keepsExistingCategory)) {
    mbD1Fail("CATEGORY_NOT_FOUND", "사용 가능한 카테고리를 찾을 수 없습니다.");
  }
  if (category.type !== type) mbD1Fail("CATEGORY_TYPE_MISMATCH", `선택한 카테고리는 \"${category.type}\" 유형입니다.`);

  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow);
  const accountMap = new Map(accounts.map((account) => [account.accountId, account]));
  const keepsExistingType = !forCreate && type === mbD1Text(source.type);

  function resolveTransactionAccount(id, existingIds, code, message) {
    const account = accountMap.get(id);
    const keepsExistingAccount = !forCreate && existingIds.some((existingId) => mbD1Text(existingId) === id);
    if (!account || ((!account.active || account.isDeleted) && !keepsExistingAccount)) {
      mbD1Fail(code, message);
    }
    return account;
  }
  let fromAccount = null;
  let toAccount = null;
  let paymentMethod = null;
  let spendingTarget = "";
  if (type === "수입") {
    const toId = mbD1Text(mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId);
    if (!toId) mbD1Fail("INCOME_TO_REQUIRED", "수입 거래에는 입금수단이 필요합니다.");
    toAccount = resolveTransactionAccount(
      toId,
      keepsExistingType ? [source.toAccountId] : [],
      "TO_ACCOUNT_NOT_FOUND",
      "입금수단을 찾을 수 없습니다."
    );
    if (mbD1Has(payload, "fromAccountId") && mbD1Text(payload.fromAccountId)) mbD1Fail("INCOME_FROM_NOT_ALLOWED", "수입 거래에는 출금수단을 사용할 수 없습니다.");
    if (mbD1Has(payload, "paymentMethodId") && mbD1Text(payload.paymentMethodId)) mbD1Fail("INCOME_PAYMENT_NOT_ALLOWED", "수입 거래에는 결제수단을 사용할 수 없습니다.");
  }
  if (type === "지출") {
    const paymentId = mbD1Text(
      mbD1Has(payload, "paymentMethodId")
        ? payload.paymentMethodId
        : (source.paymentMethodId || source.fromAccountId)
    );
    if (!paymentId) mbD1Fail("PAYMENT_METHOD_REQUIRED", "지출 거래에는 결제수단이 필요합니다.");
    paymentMethod = resolveTransactionAccount(
      paymentId,
      keepsExistingType ? [source.paymentMethodId, source.fromAccountId] : [],
      "PAYMENT_METHOD_NOT_FOUND",
      "결제수단을 찾을 수 없습니다."
    );
    spendingTarget = mbD1Text(mbD1Has(payload, "spendingTarget") ? payload.spendingTarget : source.spendingTarget);
    if (!spendingTarget) mbD1Fail("SPENDING_TARGET_REQUIRED", "지출 거래에는 지출대상이 필요합니다.");
    if (spendingTarget !== "공동") {
      const member = await mbD1MemberByName(env, spendingTarget);
      if (!member) mbD1Fail("INVALID_SPENDING_TARGET", "사용할 수 없는 지출대상입니다.");
    }
    if (paymentMethod.subType === "체크카드") {
      const keepsExistingPaymentMethod = keepsExistingType && paymentId === mbD1Text(source.paymentMethodId || source.fromAccountId);
      const paymentAccountId = keepsExistingPaymentMethod && source.fromAccountId
        ? mbD1Text(source.fromAccountId)
        : mbD1Text(paymentMethod.paymentAccountId);
      if (!paymentAccountId) mbD1Fail("CHECK_CARD_ACCOUNT_MISSING", `${paymentMethod.displayName}의 결제계좌가 설정되어 있지 않습니다.`);
      fromAccount = resolveTransactionAccount(
        paymentAccountId,
        keepsExistingPaymentMethod ? [source.fromAccountId] : [],
        "CHECK_CARD_ACCOUNT_NOT_FOUND",
        `${paymentMethod.displayName}의 연결 통장을 찾을 수 없습니다.`
      );
    } else {
      fromAccount = paymentMethod;
    }
    if (mbD1Has(payload, "toAccountId") && mbD1Text(payload.toAccountId)) mbD1Fail("EXPENSE_TO_NOT_ALLOWED", "지출 거래에는 입금수단을 사용할 수 없습니다.");
  }
  if (type === "이체") {
    const fromId = mbD1Text(mbD1Has(payload, "fromAccountId") ? payload.fromAccountId : source.fromAccountId);
    const toId = mbD1Text(mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId);
    if (!fromId || !toId) mbD1Fail("TRANSFER_ACCOUNT_REQUIRED", "이체에는 보내는 수단과 받는 수단이 모두 필요합니다.");
    if (fromId === toId) mbD1Fail("SAME_TRANSFER_ACCOUNT", "이체의 보내는 수단과 받는 수단은 같을 수 없습니다.");
    fromAccount = resolveTransactionAccount(
      fromId,
      keepsExistingType ? [source.fromAccountId] : [],
      "FROM_ACCOUNT_NOT_FOUND",
      "보내는 수단을 찾을 수 없습니다."
    );
    toAccount = resolveTransactionAccount(
      toId,
      keepsExistingType ? [source.toAccountId] : [],
      "TO_ACCOUNT_NOT_FOUND",
      "받는 수단을 찾을 수 없습니다."
    );
    if (mbD1Has(payload, "paymentMethodId") && mbD1Text(payload.paymentMethodId)) mbD1Fail("TRANSFER_PAYMENT_NOT_ALLOWED", "이체에는 결제수단을 사용할 수 없습니다.");
  }
  const billingInput = mbD1Has(payload, "billingMonth")
    ? mbD1Text(payload.billingMonth)
    : mbD1Text(source.billingOverride || source.billingMonth);
  if (billingInput && !mbD1MonthOnly(billingInput)) mbD1Fail("INVALID_BILLING_MONTH", "청구월은 YYYY-MM 형식이어야 합니다.");
  let billingMonth = billingInput || null;
  if (!billingMonth && type === "지출" && paymentMethod?.subType === "신용카드") {
    billingMonth = mbD1EstimateBilling(date, paymentMethod.billingCutoffDay, paymentMethod.paymentDay);
  }
  return {
    date,
    type,
    categoryId,
    amount,
    fromAccountId: fromAccount?.accountId || null,
    toAccountId: toAccount?.accountId || null,
    paymentMethodId: paymentMethod?.accountId || null,
    spendingTarget: type === "지출" ? spendingTarget : null,
    spenderMemberId: type === "지출" ? await mbD1MemberIdByName(env, spendingTarget) : null,
    description: mbD1Has(payload, "description") ? mbD1Text(payload.description) : mbD1Text(source.description),
    memo: mbD1Has(payload, "memo") ? mbD1Text(payload.memo) : mbD1Text(source.memo),
    billingOverride: billingInput || null,
    billingMonth,
    groupId: mbD1Has(payload, "groupId") ? mbD1Text(payload.groupId) || null : source.groupId || null,
    reversalOf: mbD1Has(payload, "reversalOf") ? mbD1Text(payload.reversalOf) || null : source.reversalOf || null
  };
}

async function mbD1InsertChange(env, entityType, entityId, action, version, session, payload = null) {
  const memberId = await mbD1MemberIdByName(env, session?.name);
  return env.DB.prepare(
    "INSERT INTO change_log (household_id,entity_type,entity_id,action,entity_version,changed_by_member_id,payload_json,changed_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(
    MB_D1_HOUSEHOLD_ID,
    entityType,
    entityId,
    action,
    version ?? null,
    memberId,
    payload ? JSON.stringify(payload) : null,
    mbD1Now()
  );
}

async function mbD1GetChangesData(env, url) {
  const latestRow = await mbD1First(
    env,
    "SELECT COALESCE(MAX(change_seq),0) AS latest_seq FROM change_log WHERE household_id=?",
    [MB_D1_HOUSEHOLD_ID]
  );
  const latestSeq = Math.max(0, Math.floor(mbD1Number(latestRow?.latest_seq, 0)));
  if (url.searchParams.get("head") === "1") {
    return { latestSeq, changes: [], hasMore: false };
  }
  const after = Math.max(0, Math.floor(mbD1Number(url.searchParams.get("after"), 0)));
  const limit = Math.max(1, Math.min(200, Math.floor(mbD1Number(url.searchParams.get("limit"), 100))));
  const rows = await mbD1All(
    env,
    `SELECT c.change_seq,c.entity_type,c.entity_id,c.action,c.entity_version,c.payload_json,c.changed_at,
            m.display_name AS changed_by
     FROM change_log c
     LEFT JOIN members m ON m.member_id=c.changed_by_member_id
     WHERE c.household_id=? AND c.change_seq>?
     ORDER BY c.change_seq ASC
     LIMIT ?`,
    [MB_D1_HOUSEHOLD_ID, after, limit]
  );
  const changes = rows.map((row) => {
    let payload = null;
    if (row.payload_json) {
      try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
    }
    return {
      changeSeq: Math.max(0, Math.floor(mbD1Number(row.change_seq, 0))),
      entityType: mbD1Text(row.entity_type),
      entityId: mbD1Text(row.entity_id),
      action: mbD1Text(row.action),
      entityVersion: mbD1NullableNumber(row.entity_version),
      changedBy: mbD1Text(row.changed_by) || null,
      changedAt: row.changed_at || null,
      payload
    };
  });
  const lastSeq = changes.length ? changes[changes.length - 1].changeSeq : after;
  return {
    latestSeq,
    changes,
    hasMore: lastSeq < latestSeq
  };
}

async function mbD1RealtimePoke(env, detail = {}) {
  if (!env.HOUSEHOLD_REALTIME) return;
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return;
    await stub.fetch("https://moneybook-realtime.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ledger.poke",
        householdId: MB_D1_HOUSEHOLD_ID,
        changedAt: mbD1Now(),
        ...detail
      })
    });
  } catch {
  }
}


function mbD1BenefitRuleIdFromRequestId(requestId, originalRequestId) {
  const request = mbD1Text(requestId);
  const original = mbD1Text(originalRequestId);
  const prefix = "BENEFIT_";
  const suffix = `_${original}`;
  if (!original || !request.startsWith(prefix) || !request.endsWith(suffix)) return "";
  return request.slice(prefix.length, request.length - suffix.length);
}

async function mbD1LinkedBenefit(env, current) {
  if (!current?.groupId || mbD1Text(current.requestId).startsWith("BENEFIT_")) return null;
  const row = await mbD1First(
    env,
    `SELECT transaction_id,request_id,version,deleted_at
     FROM transactions
     WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%'
     ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, current.groupId]
  );
  if (!row) return null;
  const ruleId = mbD1BenefitRuleIdFromRequestId(row.request_id, current.requestId);
  return ruleId ? { ...row, ruleId } : null;
}

async function mbD1LinkedBenefitUpdateStatements(env, current, model, actor, session, now) {
  const [linked, usage] = await Promise.all([
    mbD1LinkedBenefit(env, current),
    mbD1BenefitRewardUsageRecord(env, current.transactionId)
  ]);
  const ruleId = linked?.ruleId || mbD1Text(usage?.rule_id);
  if (!ruleId) return [];

  const settings = await mbD1AutomationSettingsData(env);
  const rule = settings.benefitRules.find((item) => item.id === ruleId);
  if (!rule) return [];

  const statements = [];
  let eligible = Boolean(mbD1BenefitRuleIsActive(rule, model.date));
  let creditAccountId = null;
  let benefitBaseAmount = model.amount;

  if (eligible && rule.kind === "post_reward") {
    eligible = model.type === "지출" && model.paymentMethodId === rule.accountId;
    creditAccountId = rule.accountId;

    if (eligible) {
      const rewardBalanceBefore = await mbD1BenefitRewardBalance(
        env,
        rule,
        current.transactionId,
        linked?.request_id || ""
      );
      const oldRewardUsed = Math.max(0, Math.floor(mbD1Number(usage?.used_amount, 0)));
      const rewardUsedAmount = Math.min(oldRewardUsed, Math.max(0, model.amount), rewardBalanceBefore);
      benefitBaseAmount = Math.max(0, model.amount - rewardUsedAmount);

      if (rewardUsedAmount > 0) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(transaction_id) DO UPDATE SET
               rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
          ).bind(
            current.transactionId,
            MB_D1_HOUSEHOLD_ID,
            rule.id,
            rule.accountId,
            rewardUsedAmount,
            now,
            now
          )
        );
      } else if (usage) {
        statements.push(
          env.DB.prepare(
            "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
          ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
        );
      }
    } else if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  } else if (eligible && rule.kind === "pre_discount") {
    const category = await mbD1CategoryById(env, model.categoryId, false);
    eligible = model.type === "이체" && model.toAccountId === rule.accountId && category?.name === "지역화폐충전";
    creditAccountId = model.fromAccountId;
    if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  } else {
    eligible = false;
    if (usage) {
      statements.push(
        env.DB.prepare(
          "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
        ).bind(MB_D1_HOUSEHOLD_ID, current.transactionId)
      );
    }
  }

  if (!eligible || !creditAccountId) {
    if (linked && !linked.deleted_at) {
      const nextVersion = mbD1Number(linked.version, 1) + 1;
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
        ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
        await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", nextVersion, session, { automaticBenefit: true })
      );
    }
    return statements;
  }

  const benefitAmount = await mbD1CalculateBenefit(
    env,
    rule,
    benefitBaseAmount,
    model.date,
    linked?.request_id || ""
  );

  if (benefitAmount <= 0) {
    if (linked && !linked.deleted_at) {
      const nextVersion = mbD1Number(linked.version, 1) + 1;
      statements.push(
        env.DB.prepare(
          "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
        ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
        await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", nextVersion, session, { automaticBenefit: true })
      );
    }
    return statements;
  }

  const benefitCategory = await mbD1BenefitCategory(env);
  if (!benefitCategory?.category_id) mbD1Fail("BENEFIT_CATEGORY_MISSING", "수입 카테고리 '캐시백/할인혜택'이 필요합니다.");
  const account = await mbD1AccountById(env, creditAccountId, false);
  if (!account) mbD1Fail("BENEFIT_ACCOUNT_NOT_FOUND", "혜택 반영 계좌를 찾을 수 없습니다.");
  const description = rule.kind === "pre_discount"
    ? `${account.displayName} 선할인`
    : `${account.displayName} 혜택 적립`;

  if (linked) {
    const nextVersion = mbD1Number(linked.version, 1) + 1;
    statements.push(
      env.DB.prepare(
        `UPDATE transactions
         SET date=?,category_id=?,amount=?,from_account_id=NULL,to_account_id=?,payment_method_id=NULL,
             spending_target=NULL,spender_member_id=NULL,description=?,memo=NULL,billing_month_override=NULL,billing_month=NULL,
             group_id=?,version=?,updated_at=?,updated_by=?,deleted_at=NULL,deleted_by=NULL
         WHERE household_id=? AND transaction_id=?`
      ).bind(
        model.date,
        benefitCategory.category_id,
        benefitAmount,
        creditAccountId,
        description,
        current.groupId,
        nextVersion,
        now,
        actor,
        MB_D1_HOUSEHOLD_ID,
        linked.transaction_id
      ),
      await mbD1InsertChange(env, "transaction", linked.transaction_id, "updated", nextVersion, session, {
        automaticBenefit: true,
        amount: benefitAmount
      })
    );
    return statements;
  }

  if (!current.groupId || !current.requestId) return statements;
  const enteredBy = await mbD1MemberIdByName(env, actor);
  const benefitRequestId = `BENEFIT_${rule.id}_${current.requestId}`;
  const benefitModel = await mbD1BuildTransactionModel(
    env,
    {
      date: model.date,
      type: "수입",
      categoryId: benefitCategory.category_id,
      amount: benefitAmount,
      toAccountId: creditAccountId,
      description,
      memo: "",
      groupId: current.groupId
    },
    null,
    true
  );
  const benefitTransactionId = mbD1Id("TX");
  statements.push(
    env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      benefitTransactionId, MB_D1_HOUSEHOLD_ID, benefitRequestId, benefitModel.date, benefitModel.type, benefitModel.categoryId, benefitModel.amount,
      benefitModel.fromAccountId, benefitModel.toAccountId, benefitModel.paymentMethodId, benefitModel.spendingTarget, benefitModel.spenderMemberId,
      enteredBy, benefitModel.description || null, benefitModel.memo || null, benefitModel.billingOverride, benefitModel.billingMonth,
      benefitModel.groupId, benefitModel.reversalOf, 1, now, now, actor, actor, null, null, null
    ),
    await mbD1InsertChange(env, "transaction", benefitTransactionId, "created", 1, session, {
      date: benefitModel.date,
      type: benefitModel.type,
      amount: benefitModel.amount,
      automaticBenefit: true
    })
  );
  return statements;
}

function mbD1LooksLikeRequestIdUniqueConflict(error, tableName) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("UNIQUE constraint failed") &&
    message.includes(`${tableName}.household_id`) &&
    message.includes(`${tableName}.request_id`);
}

async function mbD1HandleTransactionMutation(path, body, session, env) {
  const actor = session.name;
  if (path === "/api/transactions") {
    const started = Date.now();
    const requestId = mbD1Text(body.requestId) || mbD1Id("REQ");
    const duplicateRow = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (duplicateRow?.transaction_id) {
      const transaction = await mbD1TransactionById(env, duplicateRow.transaction_id, true);
      return {
        created: false,
        duplicate: true,
        transactionId: duplicateRow.transaction_id,
        requestId,
        row: transaction?.row || 0,
        transaction,
        serverElapsedMs: Date.now() - started
      };
    }

    const benefit = await mbD1PrepareBenefit(env, body, { strictRewardUsage: true });
    const needsBenefitGroup = Boolean(
      benefit && (benefit.benefitAmount > 0 || benefit.rewardUsedAmount > 0)
    );
    const benefitGroupId = needsBenefitGroup
      ? mbD1Text(body.groupId) || `BENEFIT_GROUP_${requestId}`
      : mbD1Text(body.groupId) || null;
    const modelInput = benefitGroupId
      ? { ...body, groupId: benefitGroupId }
      : body;
    const model = await mbD1BuildTransactionModel(env, modelInput, null, true);
    const transactionId = mbD1Id("TX");
    const now = mbD1Now();
    const enteredBy = await mbD1MemberIdByName(env, actor);
    const insert = env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      transactionId, MB_D1_HOUSEHOLD_ID, requestId, model.date, model.type, model.categoryId, model.amount,
      model.fromAccountId, model.toAccountId, model.paymentMethodId, model.spendingTarget, model.spenderMemberId,
      enteredBy, model.description || null, model.memo || null, model.billingOverride, model.billingMonth,
      model.groupId, model.reversalOf, 1, now, now, actor, actor, null, null, null
    );
    const change = await mbD1InsertChange(env, "transaction", transactionId, "created", 1, session, {
      date: model.date,
      type: model.type,
      amount: model.amount
    });

    const statements = [insert, change];
    let benefitTransactionId = null;
    if (benefit && benefit.benefitAmount > 0) {
      const benefitCategory = await mbD1BenefitCategory(env);
      if (!benefitCategory?.category_id) {
        mbD1Fail("BENEFIT_CATEGORY_MISSING", "수입 카테고리 '캐시백/할인혜택'이 필요합니다.");
      }
      const account = await mbD1AccountById(env, benefit.creditAccountId, false);
      if (!account) mbD1Fail("BENEFIT_ACCOUNT_NOT_FOUND", "혜택 반영 계좌를 찾을 수 없습니다.");
      const benefitRequestId = `BENEFIT_${benefit.rule.id}_${requestId}`;
      const benefitDescription = benefit.kind === "pre_discount"
        ? `${account.displayName} 선할인`
        : `${account.displayName} 혜택 적립`;
      const benefitModel = await mbD1BuildTransactionModel(
        env,
        {
          date: model.date,
          type: "수입",
          categoryId: benefitCategory.category_id,
          amount: benefit.benefitAmount,
          toAccountId: benefit.creditAccountId,
          description: benefitDescription,
          memo: "",
          groupId: benefitGroupId
        },
        null,
        true
      );
      benefitTransactionId = mbD1Id("TX");
      const benefitInsert = env.DB.prepare(
        `INSERT INTO transactions (
          transaction_id,household_id,request_id,date,type,category_id,amount,
          from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
          entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
          version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        benefitTransactionId, MB_D1_HOUSEHOLD_ID, benefitRequestId, benefitModel.date, benefitModel.type, benefitModel.categoryId, benefitModel.amount,
        benefitModel.fromAccountId, benefitModel.toAccountId, benefitModel.paymentMethodId, benefitModel.spendingTarget, benefitModel.spenderMemberId,
        enteredBy, benefitModel.description || null, benefitModel.memo || null, benefitModel.billingOverride, benefitModel.billingMonth,
        benefitModel.groupId, benefitModel.reversalOf, 1, now, now, actor, actor, null, null, null
      );
      const benefitChange = await mbD1InsertChange(env, "transaction", benefitTransactionId, "created", 1, session, {
        date: benefitModel.date,
        type: benefitModel.type,
        amount: benefitModel.amount,
        automaticBenefit: true
      });
      statements.push(benefitInsert, benefitChange);
    }

    if (benefit?.kind === "post_reward" && benefit.rewardUsedAmount > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(transaction_id) DO UPDATE SET
             rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
        ).bind(
          transactionId,
          MB_D1_HOUSEHOLD_ID,
          benefit.rule.id,
          benefit.rule.accountId,
          benefit.rewardUsedAmount,
          now,
          now
        )
      );
    }

    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "transactions")) {
        const duplicate = await mbD1First(
          env,
          "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.transaction_id) {
          const transaction = await mbD1TransactionById(env, duplicate.transaction_id, true);
          return {
            created: false,
            duplicate: true,
            transactionId: duplicate.transaction_id,
            requestId,
            row: transaction?.row || 0,
            transaction,
            serverElapsedMs: Date.now() - started
          };
        }
      }
      throw error;
    }
    const transaction = await mbD1TransactionById(env, transactionId, true);
    return {
      created: true,
      duplicate: false,
      transactionId,
      requestId,
      row: 0,
      transaction,
      benefit: benefit
        ? {
            kind: benefit.kind,
            ratePercent: benefit.rule.ratePercent,
            faceAmount: benefit.faceAmount,
            actualAmount: benefit.actualAmount,
            benefitAmount: benefit.benefitAmount,
            eligibleAmount: benefit.eligibleAmount,
            rewardBalanceBefore: benefit.rewardBalanceBefore,
            rewardUsedAmount: benefit.rewardUsedAmount,
            rewardBalanceAfter: benefit.rewardBalanceAfter,
            benefitTransactionId
          }
        : null,
      serverElapsedMs: Date.now() - started
    };
  }

  const transactionId = mbD1Text(body.transactionId);
  if (!transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "transactionId가 필요합니다.");
  const current = await mbD1TransactionById(env, transactionId, true);
  if (!current) mbD1Fail("TRANSACTION_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);

  if (path === "/api/transactions/settle") {
    if (current.isDeleted) mbD1Fail("TRANSACTION_NOT_FOUND", "정산할 거래를 찾을 수 없습니다.", 404);
    if (!mbD1IsSettlementEligibleCategory(current.type, current.category)) {
      mbD1Fail("SETTLEMENT_NOT_ELIGIBLE", "정산받기는 정산 가능한 지출에서만 사용할 수 있습니다.");
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) mbD1Fail("INVALID_SETTLEMENT_AMOUNT", "정산받은 금액을 입력해주세요.");
    const receiveAccountId = mbD1Text(body.toAccountId);
    if (!receiveAccountId) mbD1Fail("SETTLEMENT_ACCOUNT_REQUIRED", "정산금을 받은 현금 또는 계좌를 선택해주세요.");
    const receiveAccount = await mbD1AccountById(env, receiveAccountId, false);
    if (!receiveAccount || !receiveAccount.active || receiveAccount.isDeleted) {
      mbD1Fail("SETTLEMENT_ACCOUNT_NOT_FOUND", "정산금을 받은 계좌를 찾을 수 없습니다.");
    }
    if (receiveAccount.accountType !== "자산" || ["신용카드", "체크카드"].includes(receiveAccount.subType)) {
      mbD1Fail("SETTLEMENT_ACCOUNT_INVALID", "정산금은 현금이나 입금 가능한 자산 계좌로 받아주세요.");
    }

    const before = await mbD1SettlementSummaryData(env, transactionId);
    if (amount > before.remainingAmount + 0.0001) {
      mbD1Fail(
        "SETTLEMENT_AMOUNT_EXCEEDS_REMAINING",
        `남은 정산 가능 금액 ${Math.round(before.remainingAmount).toLocaleString("ko-KR")}원을 초과할 수 없습니다.`
      );
    }

    const rawRequestId = mbD1Text(body.requestId);
    const requestId = rawRequestId
      ? (rawRequestId.startsWith(SETTLEMENT_REQUEST_PREFIX) ? rawRequestId : `${SETTLEMENT_REQUEST_PREFIX}${rawRequestId}`)
      : `${SETTLEMENT_REQUEST_PREFIX}${transactionId}_${mbD1Id("REQ")}`;
    const duplicateRow = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (duplicateRow?.transaction_id) {
      return {
        created: false,
        duplicate: true,
        transaction: await mbD1TransactionById(env, duplicateRow.transaction_id, true),
        summary: await mbD1SettlementSummaryData(env, transactionId)
      };
    }

    const category = await mbD1SettlementIncomeCategory(env);
    const date = await mbD1ValidateLedgerDate(env, body.date || mbD1CurrentDateSeoul());
    const model = await mbD1BuildTransactionModel(
      env,
      {
        date,
        type: "수입",
        categoryId: category.category_id,
        amount,
        toAccountId: receiveAccountId,
        description: `${current.description || current.category || SETTLEMENT_EXPENSE_CATEGORY_NAME} 정산받음`,
        memo: mbD1Text(body.memo),
        reversalOf: transactionId
      },
      null,
      true
    );
    const settlementTransactionId = mbD1Id("TX");
    const now = mbD1Now();
    const enteredBy = await mbD1MemberIdByName(env, actor);
    const insert = env.DB.prepare(
      `INSERT INTO transactions (
        transaction_id,household_id,request_id,date,type,category_id,amount,
        from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,
        entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,
        version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      settlementTransactionId, MB_D1_HOUSEHOLD_ID, requestId, model.date, model.type, model.categoryId, model.amount,
      model.fromAccountId, model.toAccountId, model.paymentMethodId, model.spendingTarget, model.spenderMemberId,
      enteredBy, model.description || null, model.memo || null, model.billingOverride, model.billingMonth,
      model.groupId, model.reversalOf, 1, now, now, actor, actor, null, null, null
    );
    const change = await mbD1InsertChange(env, "transaction", settlementTransactionId, "created", 1, session, {
      date: model.date,
      type: model.type,
      amount: model.amount,
      settlementOf: transactionId
    });
    try {
      await env.DB.batch([insert, change]);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "transactions")) {
        const duplicate = await mbD1First(
          env,
          "SELECT transaction_id FROM transactions WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.transaction_id) {
          return {
            created: false,
            duplicate: true,
            transaction: await mbD1TransactionById(env, duplicate.transaction_id, true),
            summary: await mbD1SettlementSummaryData(env, transactionId)
          };
        }
      }
      throw error;
    }
    return {
      created: true,
      duplicate: false,
      transaction: await mbD1TransactionById(env, settlementTransactionId, true),
      summary: await mbD1SettlementSummaryData(env, transactionId)
    };
  }

  if (path === "/api/transactions/update") {
    if (current.isDeleted) mbD1Fail("TRANSACTION_NOT_FOUND", "수정할 거래를 찾을 수 없습니다.", 404);
    if (!mbD1Has(body, "expectedUpdatedAtMs")) mbD1Fail("UPDATE_VERSION_REQUIRED", "거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.", 409);
    const expected = body.expectedUpdatedAtMs === null || body.expectedUpdatedAtMs === ""
      ? null
      : Number(body.expectedUpdatedAtMs);
    if (expected !== null && !Number.isFinite(expected)) mbD1Fail("INVALID_UPDATE_VERSION", "업데이트 버전 정보가 올바르지 않습니다.");
    if (current.updatedAtMs !== expected) mbD1Fail("CONCURRENT_MODIFICATION", "거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.", 409);
    const financialKeys = ["date","type","categoryId","amount","fromAccountId","toAccountId","paymentMethodId","spendingTarget","billingMonth","groupId","reversalOf"];
    const financialChange = financialKeys.some((key) => mbD1Has(body, key));
    if (financialChange && current.reversalOf) mbD1Fail("REVERSAL_FINANCIAL_EDIT_NOT_ALLOWED", "환불/정산 거래의 금액·계좌·유형은 직접 수정할 수 없습니다.");
    if (financialChange && !current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal) mbD1Fail("ORIGINAL_WITH_REVERSAL_EDIT_NOT_ALLOWED", "이미 환불/정산이 연결된 원거래의 금액·계좌·유형은 직접 수정할 수 없습니다.");
    }
    const model = await mbD1BuildTransactionModel(env, body, current, false);
    const now = mbD1Now();
    const nextVersion = mbD1Number((await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [transactionId]))?.version, 1) + 1;
    const update = env.DB.prepare(
      `UPDATE transactions SET date=?,type=?,category_id=?,amount=?,from_account_id=?,to_account_id=?,payment_method_id=?,
       spending_target=?,spender_member_id=?,description=?,memo=?,billing_month_override=?,billing_month=?,group_id=?,reversal_of=?,
       version=?,updated_at=?,updated_by=? WHERE household_id=? AND transaction_id=? AND deleted_at IS NULL`
    ).bind(
      model.date, model.type, model.categoryId, model.amount, model.fromAccountId, model.toAccountId, model.paymentMethodId,
      model.spendingTarget, model.spenderMemberId, model.description || null, model.memo || null, model.billingOverride,
      model.billingMonth, model.groupId, model.reversalOf, nextVersion, now, actor, MB_D1_HOUSEHOLD_ID, transactionId
    );
    const change = await mbD1InsertChange(env, "transaction", transactionId, "updated", nextVersion, session, {
      date: model.date,
      type: model.type,
      amount: model.amount
    });
    const linkedBenefitStatements = financialChange
      ? await mbD1LinkedBenefitUpdateStatements(env, current, model, actor, session, now)
      : [];
    await env.DB.batch([update, change, ...linkedBenefitStatements]);
    return { updated: true, transaction: await mbD1TransactionById(env, transactionId, true) };
  }

  if (path === "/api/transactions/delete") {
    if (current.isDeleted) return { deleted: true, alreadyDeleted: true, transactionId };
    if (!current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal) mbD1Fail("ORIGINAL_WITH_REVERSAL_DELETE_NOT_ALLOWED", "활성 환불/정산이 연결된 원거래는 삭제할 수 없습니다. 연결된 거래를 먼저 삭제하세요.");
    }
    const now = mbD1Now();
    const versionRow = await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [transactionId]);
    const nextVersion = mbD1Number(versionRow?.version, 1) + 1;
    const update = env.DB.prepare(
      "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
    ).bind(now, actor, now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, transactionId);
    const change = await mbD1InsertChange(env, "transaction", transactionId, "deleted", nextVersion, session);
    const statements = [update, change];
    if (current.groupId && !mbD1Text(current.requestId).startsWith("BENEFIT_")) {
      const linkedBenefits = await mbD1All(
        env,
        "SELECT transaction_id,version FROM transactions WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%' AND deleted_at IS NULL",
        [MB_D1_HOUSEHOLD_ID, current.groupId]
      );
      for (const linked of linkedBenefits) {
        const linkedVersion = mbD1Number(linked.version, 1) + 1;
        statements.push(
          env.DB.prepare(
            "UPDATE transactions SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
          ).bind(now, actor, now, actor, linkedVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
          await mbD1InsertChange(env, "transaction", linked.transaction_id, "deleted", linkedVersion, session, { automaticBenefit: true })
        );
      }
    }
    await env.DB.batch(statements);
    return { deleted: true, transactionId };
  }

  if (path === "/api/transactions/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, transactionId };
    if (mbD1Text(current.requestId).startsWith("BENEFIT_") && current.groupId) {
      const activeMain = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND group_id=? AND request_id NOT LIKE 'BENEFIT_%' AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, current.groupId]
      );
      if (!activeMain) mbD1Fail("BENEFIT_ORIGINAL_NOT_ACTIVE", "혜택 적립의 원거래를 먼저 복원해주세요.");
    }
    if (current.reversalOf) {
      const original = await mbD1TransactionById(env, current.reversalOf, true);
      if (!original || original.isDeleted) mbD1Fail("REVERSAL_ORIGINAL_NOT_ACTIVE", "원거래가 활성 상태가 아니어서 환불/정산 거래를 복원할 수 없습니다.");
      if (mbD1IsSettlementRequestId(current.requestId)) {
        const summary = await mbD1SettlementSummaryData(env, current.reversalOf);
        if (mbD1Number(current.amount) > summary.remainingAmount + 0.0001) {
          mbD1Fail(
            "SETTLEMENT_RESTORE_EXCEEDS_REMAINING",
            `현재 남은 정산 가능 금액 ${Math.round(summary.remainingAmount).toLocaleString("ko-KR")}원을 초과해 이 정산 내역을 복원할 수 없습니다.`
          );
        }
      }
    }
    await mbD1BuildTransactionModel(env, {}, current, false);
    const now = mbD1Now();
    const versionRow = await mbD1First(env, "SELECT version FROM transactions WHERE transaction_id=?", [transactionId]);
    const nextVersion = mbD1Number(versionRow?.version, 1) + 1;
    const update = env.DB.prepare(
      "UPDATE transactions SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
    ).bind(now, actor, nextVersion, MB_D1_HOUSEHOLD_ID, transactionId);
    const change = await mbD1InsertChange(env, "transaction", transactionId, "restored", nextVersion, session);
    const statements = [update, change];
    if (current.groupId && !mbD1Text(current.requestId).startsWith("BENEFIT_")) {
      const linkedBenefits = await mbD1All(
        env,
        "SELECT transaction_id,version FROM transactions WHERE household_id=? AND group_id=? AND request_id LIKE 'BENEFIT_%' AND deleted_at=?",
        [MB_D1_HOUSEHOLD_ID, current.groupId, current.deletedAt]
      );
      for (const linked of linkedBenefits) {
        const linkedVersion = mbD1Number(linked.version, 1) + 1;
        statements.push(
          env.DB.prepare(
            "UPDATE transactions SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=? WHERE household_id=? AND transaction_id=?"
          ).bind(now, actor, linkedVersion, MB_D1_HOUSEHOLD_ID, linked.transaction_id),
          await mbD1InsertChange(env, "transaction", linked.transaction_id, "restored", linkedVersion, session, { automaticBenefit: true })
        );
      }
    }
    await env.DB.batch(statements);
    return { restored: true, transaction: await mbD1TransactionById(env, transactionId, true) };
  }

  mbD1Fail("UNSUPPORTED_TRANSACTION_ACTION", "지원하지 않는 거래 작업입니다.");
}

async function mbD1HandleCategoryMutation(path, body, session, env) {
  const actor = session.name;
  if (path === "/api/categories") {
    const type = mbD1Text(body.type);
    const name = mbD1Text(body.name || body.category);
    if (!["수입", "지출", "이체"].includes(type)) mbD1Fail("INVALID_CATEGORY_TYPE", "카테고리 유형은 수입/지출/이체여야 합니다.");
    if (!name) mbD1Fail("CATEGORY_NAME_REQUIRED", "대분류 이름이 필요합니다.");
    const duplicate = await mbD1First(
      env,
      "SELECT category_id FROM categories WHERE household_id=? AND type=? AND name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, type, name]
    );
    if (duplicate) mbD1Fail("CATEGORY_DUPLICATE", "같은 유형/대분류가 이미 존재합니다.", 409);
    const id = mbD1Id("CAT");
    const now = mbD1Now();
    const active = mbD1Has(body, "active") ? (mbD1Bool(body.active) ? 1 : 0) : 1;
    const insert = env.DB.prepare(
      "INSERT INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)"
    ).bind(id, MB_D1_HOUSEHOLD_ID, type, name, active, now, now, actor, actor, null, null);
    const change = await mbD1InsertChange(env, "category", id, "created", 1, session, { type, name });
    await env.DB.batch([insert, change]);
    return { created: true, category: await mbD1CategoryById(env, id, true) };
  }

  const id = mbD1Text(body.categoryId);
  if (!id) mbD1Fail("CATEGORY_ID_REQUIRED", "categoryId가 필요합니다.");
  const current = await mbD1CategoryById(env, id, true);
  if (!current) mbD1Fail("CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다.", 404);

  if (path === "/api/categories/update") {
    if (current.isDeleted) mbD1Fail("CATEGORY_NOT_FOUND", "수정할 카테고리를 찾을 수 없습니다.", 404);
    const type = mbD1Has(body, "type") ? mbD1Text(body.type) : current.type;
    const name = mbD1Has(body, "name") ? mbD1Text(body.name) : current.name;
    const active = mbD1Has(body, "active") ? mbD1Bool(body.active) : current.active;
    if (!["수입", "지출", "이체"].includes(type)) mbD1Fail("INVALID_CATEGORY_TYPE", "카테고리 유형은 수입/지출/이체여야 합니다.");
    if (!name) mbD1Fail("CATEGORY_NAME_REQUIRED", "대분류 이름이 필요합니다.");
    const duplicate = await mbD1First(
      env,
      "SELECT category_id FROM categories WHERE household_id=? AND category_id<>? AND type=? AND name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, type, name]
    );
    if (duplicate) mbD1Fail("CATEGORY_DUPLICATE", "같은 유형/대분류가 이미 존재합니다.", 409);
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE categories SET type=?,name=?,is_active=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(type, name, active ? 1 : 0, now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "category", id, "updated", null, session, { type, name, active });
    await env.DB.batch([update, change]);
    return { updated: true, category: await mbD1CategoryById(env, id, true) };
  }

  if (path === "/api/categories/delete") {
    if (current.isDeleted) return { deleted: true, categoryId: id };
    const used = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND category_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id]
    );
    if (used) mbD1Fail("CATEGORY_IN_USE", "거래에서 사용 중인 카테고리는 삭제할 수 없습니다. 사용여부를 끄는 방식을 사용하세요.");
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE categories SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "category", id, "deleted", null, session);
    await env.DB.batch([update, change]);
    return { deleted: true, restored: false, categoryId: id };
  }

  if (path === "/api/categories/restore") {
    if (!current.isDeleted) return { restored: true, categoryId: id };
    const duplicate = await mbD1First(
      env,
      "SELECT category_id FROM categories WHERE household_id=? AND category_id<>? AND type=? AND name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, current.type, current.name]
    );
    if (duplicate) mbD1Fail("CATEGORY_RESTORE_CONFLICT", "같은 유형과 이름의 카테고리가 이미 있어 복원할 수 없습니다.", 409);
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE categories SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=? WHERE household_id=? AND category_id=?"
    ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "category", id, "restored", null, session);
    await env.DB.batch([update, change]);
    return { restored: true, deleted: false, categoryId: id, category: await mbD1CategoryById(env, id, true) };
  }

  mbD1Fail("UNSUPPORTED_CATEGORY_ACTION", "지원하지 않는 카테고리 작업입니다.");
}

async function mbD1AccountModel(env, body, current = null, selfId = null) {
  const source = current || {};
  const accountName = mbD1Text(mbD1Has(body, "accountName") ? body.accountName : source.accountName);
  const accountType = mbD1Text(mbD1Has(body, "accountType") ? body.accountType : source.accountType);
  const subType = mbD1Text(mbD1Has(body, "subType") ? body.subType : source.subType);
  const owner = mbD1Text(mbD1Has(body, "owner") ? body.owner : source.owner);
  if (!accountName) mbD1Fail("ACCOUNT_NAME_REQUIRED", "계좌명이 필요합니다.");
  if (!accountType) mbD1Fail("ACCOUNT_TYPE_REQUIRED", "계좌유형이 필요합니다.");
  if (!subType) mbD1Fail("ACCOUNT_SUBTYPE_REQUIRED", "세부구분이 필요합니다.");
  if (!owner) mbD1Fail("ACCOUNT_OWNER_REQUIRED", "명의자가 필요합니다.");
  const ownerMemberId = await mbD1MemberIdByName(env, owner);
  if (owner !== "공동" && !ownerMemberId) mbD1Fail("ACCOUNT_OWNER_REQUIRED", "등록된 구성원을 명의자로 선택해주세요.");
  const openingBalance = Number(mbD1Has(body, "openingBalance") ? body.openingBalance : source.openingBalance);
  if (!Number.isFinite(openingBalance)) mbD1Fail("INVALID_NUMBER", "시작잔액은 숫자여야 합니다.");
  const nullableInteger = (value, code, message, min, max) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) mbD1Fail(code, message);
    return number;
  };
  const billingCutoffDay = nullableInteger(
    mbD1Has(body, "billingCutoffDay") ? body.billingCutoffDay : source.billingCutoffDay,
    "INVALID_CUTOFF_DAY", "청구마감일은 1~31 정수여야 합니다.", 1, 31
  );
  const paymentDay = nullableInteger(
    mbD1Has(body, "paymentDay") ? body.paymentDay : source.paymentDay,
    "INVALID_PAYMENT_DAY", "결제일은 1~31 정수여야 합니다.", 1, 31
  );
  const startYear = nullableInteger(
    mbD1Has(body, "startYear") ? body.startYear : source.startYear,
    "INVALID_START_YEAR", "사용시작연도가 올바르지 않습니다.", 1900, 2200
  );
  const endYear = nullableInteger(
    mbD1Has(body, "endYear") ? body.endYear : source.endYear,
    "INVALID_END_YEAR", "사용종료연도가 올바르지 않습니다.", 1900, 2200
  );
  if (startYear !== null && endYear !== null && startYear > endYear) mbD1Fail("INVALID_YEAR_RANGE", "사용시작연도는 사용종료연도보다 늦을 수 없습니다.");
  const year = mbD1CurrentYearSeoul();
  const active = (startYear === null || year >= startYear) && (endYear === null || year <= endYear);
  const balanceMethod = mbD1Text(mbD1Has(body, "balanceMethod") ? body.balanceMethod : source.balanceMethod) || (subType === "주식" ? "평가입력" : "자동계산");
  const assetAttribution = mbD1Text(mbD1Has(body, "assetAttribution") ? body.assetAttribution : source.assetAttribution) || owner;
  let paymentAccountId = mbD1Text(mbD1Has(body, "paymentAccountId") ? body.paymentAccountId : source.paymentAccountId);
  if (subType === "선불/지역화폐") paymentAccountId = "";
  if ((subType === "체크카드" || subType === "신용카드") && !paymentAccountId) mbD1Fail("CARD_PAYMENT_ACCOUNT_REQUIRED", "카드는 결제계좌가 필요합니다.");
  if (paymentAccountId) {
    if (paymentAccountId === selfId) mbD1Fail("SELF_PAYMENT_ACCOUNT", "자기 자신을 결제계좌로 지정할 수 없습니다.");
    const payment = await mbD1AccountById(env, paymentAccountId, false);
    if (!payment || payment.isDeleted) mbD1Fail("PAYMENT_ACCOUNT_NOT_FOUND", "결제계좌를 찾을 수 없습니다.");
  }
  return {
    accountName,
    accountType,
    subType,
    owner,
    ownerMemberId,
    openingBalance,
    billingCutoffDay,
    paymentDay,
    startYear,
    endYear,
    active,
    balanceMethod,
    assetAttribution,
    paymentAccountId: paymentAccountId || null,
    displayName: mbD1DisplayName(accountName, owner)
  };
}

async function mbD1HandleAccountMutation(path, body, session, env) {
  const actor = session.name;
  if (path === "/api/accounts") {
    const model = await mbD1AccountModel(env, body, null, null);
    const duplicate = await mbD1First(
      env,
      "SELECT account_id FROM accounts WHERE household_id=? AND display_name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, model.displayName]
    );
    if (duplicate) mbD1Fail("ACCOUNT_DUPLICATE", "같은 표시명의 계좌가 이미 존재합니다.", 409);
    const id = mbD1Id("ACC");
    const now = mbD1Now();
    const insert = env.DB.prepare(
      `INSERT INTO accounts (
        account_id,household_id,name,display_name,account_type,sub_type,owner_member_id,owner_label,
        opening_balance,billing_cutoff_day,payment_day,payment_account_id,start_year,end_year,is_active,balance_method,
        current_balance_override,asset_attribution,investment_cash_baseline_krw,investment_cash_baseline_at,
        created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, MB_D1_HOUSEHOLD_ID, model.accountName, model.displayName, model.accountType, model.subType,
      model.ownerMemberId, model.owner, model.openingBalance, model.billingCutoffDay, model.paymentDay,
      model.paymentAccountId, model.startYear, model.endYear, model.active ? 1 : 0, model.balanceMethod,
      null, model.assetAttribution, null, null, now, now, actor, actor, null, null, null
    );
    const change = await mbD1InsertChange(env, "account", id, "created", null, session, { displayName: model.displayName });
    await env.DB.batch([insert, change]);
    return { created: true, account: await mbD1AccountById(env, id, true) };
  }

  const id = mbD1Text(body.accountId);
  if (!id) mbD1Fail("ACCOUNT_ID_REQUIRED", "accountId가 필요합니다.");
  const current = await mbD1AccountById(env, id, true);
  if (!current) mbD1Fail("ACCOUNT_NOT_FOUND", "계좌를 찾을 수 없습니다.", 404);

  if (path === "/api/accounts/update") {
    if (current.isDeleted) mbD1Fail("ACCOUNT_NOT_FOUND", "수정할 계좌를 찾을 수 없습니다.", 404);
    const model = await mbD1AccountModel(env, body, current, id);
    const duplicate = await mbD1First(
      env,
      "SELECT account_id FROM accounts WHERE household_id=? AND account_id<>? AND display_name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, model.displayName]
    );
    if (duplicate) mbD1Fail("ACCOUNT_DUPLICATE", "같은 표시명의 계좌가 이미 존재합니다.", 409);
    const now = mbD1Now();
    const update = env.DB.prepare(
      `UPDATE accounts SET name=?,display_name=?,account_type=?,sub_type=?,owner_member_id=?,owner_label=?,opening_balance=?,
       billing_cutoff_day=?,payment_day=?,payment_account_id=?,start_year=?,end_year=?,is_active=?,balance_method=?,asset_attribution=?,
       updated_at=?,updated_by=? WHERE household_id=? AND account_id=?`
    ).bind(
      model.accountName, model.displayName, model.accountType, model.subType, model.ownerMemberId, model.owner,
      model.openingBalance, model.billingCutoffDay, model.paymentDay, model.paymentAccountId, model.startYear,
      model.endYear, model.active ? 1 : 0, model.balanceMethod, model.assetAttribution, now, actor,
      MB_D1_HOUSEHOLD_ID, id
    );
    const change = await mbD1InsertChange(env, "account", id, "updated", null, session, { displayName: model.displayName });
    await env.DB.batch([update, change]);
    return { updated: true, account: await mbD1AccountById(env, id, true) };
  }

  if (path === "/api/accounts/delete") {
    if (current.isDeleted) return { deleted: true, accountId: id };
    const cardUse = await mbD1First(
      env,
      "SELECT account_id,display_name FROM accounts WHERE household_id=? AND account_id<>? AND payment_account_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, id]
    );
    if (cardUse) mbD1Fail("ACCOUNT_IN_USE_AS_PAYMENT_ACCOUNT", `${cardUse.display_name || "다른 카드"}의 결제계좌로 사용 중이라 삭제할 수 없습니다.`);
    const txUse = await mbD1First(
      env,
      "SELECT transaction_id FROM transactions WHERE household_id=? AND deleted_at IS NULL AND (from_account_id=? OR to_account_id=? OR payment_method_id=?) LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, id, id]
    );
    if (txUse) mbD1Fail("ACCOUNT_IN_USE", "거래에서 사용 중인 계좌는 삭제할 수 없습니다. 사용종료연도 또는 사용여부를 이용하세요.");
    const holdingUse = await mbD1First(
      env,
      "SELECT holding_id FROM holdings WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id]
    );
    if (holdingUse) mbD1Fail("ACCOUNT_IN_USE", "보유종목이 연결된 계좌는 삭제할 수 없습니다.");
    const tradeUse = await mbD1First(
      env,
      "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id]
    );
    if (tradeUse) mbD1Fail("INVESTMENT_ACCOUNT_IN_USE", "매매내역이 있는 투자계좌는 삭제할 수 없습니다.");
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE accounts SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
    ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "account", id, "deleted", null, session);
    await env.DB.batch([update, change]);
    return { deleted: true, accountId: id };
  }

  if (path === "/api/accounts/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, accountId: id };
    const duplicate = await mbD1First(
      env,
      "SELECT account_id FROM accounts WHERE household_id=? AND account_id<>? AND display_name=? AND deleted_at IS NULL LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, id, current.displayName]
    );
    if (duplicate) mbD1Fail("ACCOUNT_RESTORE_CONFLICT", "같은 표시명의 계좌가 이미 있어 복원할 수 없습니다.", 409);
    if (current.paymentAccountId) {
      const payment = await mbD1AccountById(env, current.paymentAccountId, false);
      if (!payment || payment.isDeleted) mbD1Fail("ACCOUNT_RESTORE_PAYMENT_ACCOUNT_MISSING", "연결된 결제계좌를 먼저 복원한 뒤 다시 시도하세요.");
    }
    const now = mbD1Now();
    const update = env.DB.prepare(
      "UPDATE accounts SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
    ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id);
    const change = await mbD1InsertChange(env, "account", id, "restored", null, session);
    await env.DB.batch([update, change]);
    return { restored: true, accountId: id, account: await mbD1AccountById(env, id, true) };
  }

  mbD1Fail("UNSUPPORTED_ACCOUNT_ACTION", "지원하지 않는 계좌 작업입니다.");
}

async function mbD1HandleInputPreferences(body, session, env) {
  if (!isObject(body.preferences)) mbD1Fail("INVALID_INPUT_PREFERENCES", "입력 설정 형식이 올바르지 않습니다.");
  const preferences = body.preferences;
  if (Number(preferences.version) !== 1) mbD1Fail("INVALID_INPUT_PREFERENCES_VERSION", "지원하지 않는 입력 설정 버전입니다.");
  if (!isObject(preferences.categoryOrder)) mbD1Fail("INVALID_INPUT_PREFERENCES", "카테고리 순서 형식이 올바르지 않습니다.");
  for (const type of ["지출", "수입", "이체"]) {
    if (!Array.isArray(preferences.categoryOrder[type])) mbD1Fail("INVALID_INPUT_PREFERENCES", `${type} 카테고리 순서는 배열이어야 합니다.`);
  }
  const now = mbD1Now();
  const update = env.DB.prepare(
    `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
  ).bind(
    "PREF_INPUT_SHARED", MB_D1_HOUSEHOLD_ID, null, "input_preferences", JSON.stringify(preferences), 1, now, now
  );
  const change = await mbD1InsertChange(env, "input_preferences", "shared", "updated", 1, session);
  await env.DB.batch([update, change]);
  return { configured: true, version: 1, preferences, updatedAt: now, updatedBy: session.name };
}

async function mbD1HandleLedgerConfig(path, body, session, env) {
  const now = mbD1Now();
  if (path.endsWith("/clear")) {
    const update = env.DB.prepare(
      "UPDATE households SET ledger_start_date=NULL,updated_at=? WHERE household_id=?"
    ).bind(now, MB_D1_HOUSEHOLD_ID);
    const change = await mbD1InsertChange(env, "ledger_config", "ledger-start-date", "updated", null, session, { ledgerStartDate: null });
    await env.DB.batch([update, change]);
    return { cleared: true, ledgerStartDate: null };
  }
  const value = mbD1DateOnly(body.ledgerStartDate || body.date);
  if (!value) mbD1Fail("INVALID_LEDGER_START_DATE", "가계부 시작일은 YYYY-MM-DD 형식이어야 합니다.");
  const update = env.DB.prepare(
    "UPDATE households SET ledger_start_date=?,updated_at=? WHERE household_id=?"
  ).bind(value, now, MB_D1_HOUSEHOLD_ID);
  const change = await mbD1InsertChange(env, "ledger_config", "ledger-start-date", "updated", null, session, { ledgerStartDate: value });
  await env.DB.batch([update, change]);
  return { updated: true, ledgerStartDate: value };
}

async function mbD1HandleAssetSnapshot(body, session, env) {
  const month = mbD1Text(body.month) || mbD1CurrentMonthSeoul();
  if (!mbD1MonthOnly(month)) mbD1Fail("INVALID_MONTH", "month는 YYYY-MM 형식이어야 합니다.");
  if (month !== mbD1CurrentMonthSeoul()) mbD1Fail("SNAPSHOT_CURRENT_MONTH_ONLY", "순자산 스냅샷은 현재 월만 기록할 수 있습니다.");
  const dashboard = await mbD1BuildDashboard(env, month);
  const now = mbD1Now();
  const existing = await mbD1First(
    env,
    "SELECT month FROM asset_snapshots WHERE household_id=? AND month=? LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, month]
  );
  const upsert = env.DB.prepare(
    `INSERT INTO asset_snapshots (household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value,created_at,updated_at,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(household_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,
     investment_value=excluded.investment_value,cash_like_value=excluded.cash_like_value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
  ).bind(
    MB_D1_HOUSEHOLD_ID, month, dashboard.summary.assets, dashboard.summary.liabilities,
    dashboard.summary.netWorth, dashboard.summary.investmentValue, dashboard.summary.cashLikeValue,
    now, now, session.name, session.name
  );
  const change = await mbD1InsertChange(env, "asset_snapshot", month, existing ? "updated" : "created", null, session, { month });
  await env.DB.batch([upsert, change]);
  const row = await mbD1First(
    env,
    "SELECT * FROM asset_snapshots WHERE household_id=? AND month=?",
    [MB_D1_HOUSEHOLD_ID, month]
  );
  return {
    saved: true,
    updated: Boolean(existing),
    snapshot: {
      month: row.month,
      assets: mbD1Number(row.assets),
      liabilities: mbD1Number(row.liabilities),
      netWorth: mbD1Number(row.net_worth),
      investmentValue: mbD1Number(row.investment_value),
      cashLikeValue: mbD1Number(row.cash_like_value),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      row: 0
    }
  };
}

async function mbD1HoldingById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT h.*,a.display_name AS account_name FROM holdings h LEFT JOIN accounts a ON a.account_id=h.account_id
     WHERE h.household_id=? AND h.holding_id=? ${includeDeleted ? "" : "AND h.deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapHoldingRow(row) : null;
}

async function mbD1HandleCashBaseline(body, session, env) {
  const accountId = mbD1Text(body.accountId);
  if (!accountId) mbD1Fail("INVESTMENT_ACCOUNT_ID_REQUIRED", "투자계좌 accountId가 필요합니다.");
  const amountRaw = mbD1Has(body, "amount") ? body.amount : body.cashBaselineKrw;
  if (amountRaw === null || amountRaw === undefined || amountRaw === "") mbD1Fail("INVESTMENT_CASH_AMOUNT_REQUIRED", "현재 예수금 금액이 필요합니다.");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) mbD1Fail("INVALID_NUMBER", "예수금은 숫자여야 합니다.");
  const account = await mbD1AccountById(env, accountId, false);
  if (!account || !account.active || !mbD1IsInvestmentAccount(account)) mbD1Fail("INVESTMENT_ACCOUNT_NOT_FOUND", "사용 가능한 투자계좌를 찾을 수 없습니다.");
  const hasTrades = await mbD1First(
    env,
    "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, accountId]
  );
  if (account.cashBaselineAt && hasTrades && !mbD1Bool(body.force)) mbD1Fail("INVESTMENT_CASH_BASELINE_LOCKED", "이미 투자거래가 있는 계좌입니다. 새 기준점으로 강제 재설정하려면 force가 필요합니다.");
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE accounts SET investment_cash_baseline_krw=?,investment_cash_baseline_at=?,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
  ).bind(amount, now, now, session.name, MB_D1_HOUSEHOLD_ID, accountId);
  const change = await mbD1InsertChange(env, "account", accountId, "updated", null, session, { cashBaselineKrw: amount });
  await env.DB.batch([update, change]);
  return { updated: true, accountId, accountName: account.displayName, cashBaselineKrw: amount, cashBaselineAt: now };
}

async function mbD1HandleHoldingUpdate(body, session, env) {
  const holdingId = mbD1Text(body.holdingId);
  if (!holdingId) mbD1Fail("HOLDING_ID_REQUIRED", "holdingId가 필요합니다.");
  const holding = await mbD1HoldingById(env, holdingId, false);
  if (!holding) mbD1Fail("HOLDING_NOT_FOUND", "수정할 보유종목을 찾을 수 없습니다.", 404);
  const manualPrice = Number(body.manualPrice);
  if (!Number.isFinite(manualPrice) || manualPrice < 0) mbD1Fail("INVALID_NUMBER", "수동입력가는 0 이상의 숫자여야 합니다.");
  const lastUpdated = mbD1DateOnly(body.lastUpdated) || mbD1CurrentDateSeoul();
  const fx = holding.market === "국내" ? 1 : (holding.fx || 0);
  const valueKrw = mbD1Round(holding.quantity * manualPrice * fx, 2);
  const returnRate = holding.bookCostKrw > 0 ? (valueKrw - holding.bookCostKrw) / holding.bookCostKrw : null;
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE holdings SET manual_price=?,current_price=?,value_krw=?,return_rate=?,last_updated=?,elapsed_days=0,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND holding_id=?"
  ).bind(manualPrice, manualPrice, valueKrw, returnRate, lastUpdated, now, session.name, MB_D1_HOUSEHOLD_ID, holdingId);
  const change = await mbD1InsertChange(env, "holding", holdingId, "updated", null, session, { manualPrice, lastUpdated });
  await env.DB.batch([update, change]);
  return { updated: true, holding: await mbD1HoldingById(env, holdingId, true) };
}

function mbD1ValidatePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) mbD1Fail("INVALID_NUMBER", `${label}은 0보다 큰 숫자여야 합니다.`);
  return number;
}

function mbD1ValidateNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) mbD1Fail("INVALID_NUMBER", `${label}은 0 이상의 숫자여야 합니다.`);
  return number;
}

function mbD1TradeModel(payload, current, account, holding, requestId) {
  const source = current || {};
  const tradeType = mbD1Text(mbD1Has(payload, "tradeType") || mbD1Has(payload, "type") ? (payload.tradeType || payload.type) : source.tradeType);
  if (!["매수", "매도"].includes(tradeType)) mbD1Fail("INVALID_INVESTMENT_TRADE_TYPE", "투자거래 구분은 매수/매도 중 하나여야 합니다.");
  const date = mbD1DateOnly(mbD1Has(payload, "date") || mbD1Has(payload, "tradeDate") ? (payload.date || payload.tradeDate) : source.date || source.tradeDate);
  if (!date) mbD1Fail("INVALID_INVESTMENT_TRADE_DATE", "투자거래일은 YYYY-MM-DD 형식이어야 합니다.");
  const quantity = mbD1ValidatePositive(mbD1Has(payload, "quantity") ? payload.quantity : source.quantity, "수량");
  const unitPrice = mbD1ValidatePositive(mbD1Has(payload, "unitPrice") ? payload.unitPrice : (mbD1Has(payload, "price") ? payload.price : source.unitPrice), "체결단가");
  let currency = mbD1Text(mbD1Has(payload, "currency") ? payload.currency : source.currency).toUpperCase();
  if (!currency) currency = holding.market === "국내" ? "KRW" : "USD";
  if (!/^[A-Z]{3}$/.test(currency)) mbD1Fail("INVALID_INVESTMENT_CURRENCY", "통화는 KRW, USD처럼 3자리 코드로 입력해야 합니다.");
  if (holding.market === "국내" && currency !== "KRW") mbD1Fail("DOMESTIC_CURRENCY_MUST_BE_KRW", "국내 종목의 체결통화는 KRW여야 합니다.");
  const fxRate = currency === "KRW" ? 1 : mbD1ValidatePositive(mbD1Has(payload, "fxRate") ? payload.fxRate : source.fxRate, "체결환율");
  const feeKrw = mbD1ValidateNonNegative(mbD1Has(payload, "feeKrw") ? payload.feeKrw : source.feeKrw, "수수료");
  const taxKrw = mbD1ValidateNonNegative(mbD1Has(payload, "taxKrw") ? payload.taxKrw : source.taxKrw, "세금");
  const financeChanged = !source.investmentTradeId || ["tradeType","type","quantity","unitPrice","price","currency","fxRate","feeKrw","taxKrw"].some((key) => mbD1Has(payload, key));
  let settlementKrw;
  if (mbD1Has(payload, "settlementKrw")) {
    settlementKrw = mbD1ValidatePositive(payload.settlementKrw, "원화결제금액");
  } else if (!financeChanged && mbD1Number(source.settlementKrw) > 0) {
    settlementKrw = mbD1Number(source.settlementKrw);
  } else {
    const gross = quantity * unitPrice * fxRate;
    settlementKrw = tradeType === "매수" ? gross + feeKrw + taxKrw : gross - feeKrw - taxKrw;
    if (!Number.isFinite(settlementKrw) || settlementKrw <= 0) mbD1Fail("INVALID_INVESTMENT_SETTLEMENT", "원화결제금액 계산 결과가 0보다 커야 합니다.");
  }
  return {
    date,
    tradeType,
    accountId: account.accountId,
    accountName: account.displayName,
    holdingId: holding.holdingId,
    stockCode: holding.stockCode,
    stockName: holding.stockName,
    market: holding.market,
    quantity,
    unitPrice,
    currency,
    fxRate,
    feeKrw,
    taxKrw,
    settlementKrw: mbD1Round(settlementKrw, 2),
    memo: mbD1Has(payload, "memo") ? mbD1Text(payload.memo) : mbD1Text(source.memo),
    requestId
  };
}

function mbD1SimulateHolding(holding, trades) {
  let quantity = mbD1Number(holding.baselineQuantity);
  let avgPrice = mbD1Number(holding.baselineAvgPrice);
  let bookCost = mbD1Number(holding.baselineBookCostKrw);
  const realized = new Map();
  const sorted = trades.slice().sort((a, b) =>
    (a.date || "").localeCompare(b.date || "") ||
    (a.createdAt || "").localeCompare(b.createdAt || "") ||
    a.investmentTradeId.localeCompare(b.investmentTradeId)
  );
  for (const trade of sorted) {
    if (trade.tradeType === "매수") {
      const nativeBefore = quantity * avgPrice;
      const nativeBuy = trade.quantity * trade.unitPrice;
      const nextQty = quantity + trade.quantity;
      avgPrice = nextQty > 0 ? (nativeBefore + nativeBuy) / nextQty : 0;
      quantity = nextQty;
      bookCost += trade.settlementKrw;
      realized.set(trade.investmentTradeId, 0);
      continue;
    }
    if (trade.quantity > quantity + 1e-9) mbD1Fail("SELL_QUANTITY_EXCEEDS_HOLDING", `${trade.date} 매도수량 ${trade.quantity}주가 당시 보유수량 ${mbD1Round(quantity, 8)}주를 초과합니다.`);
    if (quantity <= 0) mbD1Fail("SELL_WITHOUT_HOLDING", `${trade.date} 매도 시점에 보유수량이 없습니다.`);
    const removedBook = bookCost * (trade.quantity / quantity);
    const pnl = trade.settlementKrw - removedBook;
    quantity -= trade.quantity;
    bookCost -= removedBook;
    if (Math.abs(quantity) < 1e-9) {
      quantity = 0;
      avgPrice = 0;
      bookCost = 0;
    }
    if (Math.abs(bookCost) < 0.000001) bookCost = 0;
    realized.set(trade.investmentTradeId, mbD1Round(pnl, 2));
  }
  return {
    quantity: mbD1Round(quantity, 8),
    avgBuyPrice: mbD1Round(avgPrice, 8),
    bookCostKrw: mbD1Round(bookCost, 2),
    realized
  };
}

async function mbD1CashForAccountWithTrades(env, account, proposedTrades) {
  if (!account.cashBaselineAt) return null;
  const transactions = await mbD1AllTransactions(env, false);
  let ledgerDelta = 0;
  for (const tx of transactions) {
    if (!mbD1TransactionAfterBaseline(tx, account.cashBaselineAt)) continue;
    if (tx.fromAccountId === account.accountId) ledgerDelta -= tx.amount;
    if (tx.toAccountId === account.accountId) ledgerDelta += tx.amount;
  }
  const baselineMs = mbD1TimestampMs(account.cashBaselineAt);
  let tradeDelta = 0;
  for (const trade of proposedTrades) {
    const createdMs = mbD1TimestampMs(trade.createdAt);
    if (baselineMs !== null && createdMs !== null && createdMs < baselineMs) continue;
    tradeDelta += trade.tradeType === "매수" ? -trade.settlementKrw : trade.settlementKrw;
  }
  return mbD1Round(mbD1Number(account.cashBaselineKrw) + ledgerDelta + tradeDelta, 2);
}

async function mbD1HandleTradeMutation(path, body, session, env, ctx) {
  const actor = session.name;
  if (path === "/api/investments/trades") {
    const requestId = mbD1Text(body.requestId) || mbD1Id("IREQ");
    const dup = await mbD1First(
      env,
      "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (dup?.investment_trade_id) {
      const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === dup.investment_trade_id) || null;
      return { created: false, duplicate: true, investmentTradeId: dup.investment_trade_id, requestId, trade };
    }
    const accountId = mbD1Text(body.accountId);
    const account = await mbD1AccountById(env, accountId, false);
    if (!account || !account.active || !mbD1IsInvestmentAccount(account)) mbD1Fail("INVESTMENT_ACCOUNT_NOT_FOUND", "사용 가능한 투자계좌를 찾을 수 없습니다.");
    if (!account.cashBaselineAt) mbD1Fail("INVESTMENT_CASH_BASELINE_REQUIRED", "먼저 이 투자계좌의 현재 예수금 기준값을 설정해야 합니다.");
    const type = mbD1Text(body.tradeType || body.type);
    if (!["매수", "매도"].includes(type)) mbD1Fail("INVALID_INVESTMENT_TRADE_TYPE", "투자거래 구분은 매수/매도 중 하나여야 합니다.");
    const stockCode = mbD1Text(body.stockCode).toUpperCase();
    if (!stockCode) mbD1Fail("STOCK_CODE_REQUIRED", "종목코드가 필요합니다.");
    let holding = (await mbD1Holdings(env, false)).find((item) => item.accountId === accountId && item.stockCode.toUpperCase() === stockCode) || null;
    let newHolding = false;
    const now = mbD1Now();
    const statements = [];
    if (!holding) {
      if (type === "매도") mbD1Fail("SELL_HOLDING_NOT_FOUND", "매도할 보유종목을 찾을 수 없습니다.");
      const market = mbD1Text(body.market);
      if (!["국내", "해외"].includes(market)) mbD1Fail("INVALID_MARKET", "신규 종목의 시장은 국내/해외 중 하나여야 합니다.");
      const quoteMode = mbD1Text(body.quoteMode) || "자동";
      if (!["자동", "수동"].includes(quoteMode)) mbD1Fail("INVALID_QUOTE_MODE", "시세조회방식은 자동/수동이어야 합니다.");
      let manualPrice = null;
      if (quoteMode === "수동") manualPrice = mbD1ValidatePositive(body.manualPrice, "수동입력가");
      else if (mbD1Has(body, "manualPrice") && body.manualPrice !== "" && body.manualPrice !== null) manualPrice = mbD1ValidateNonNegative(body.manualPrice, "수동입력가");
      const holdingId = mbD1Id("STK");
      holding = {
        holdingId,
        accountId,
        accountName: account.displayName,
        stockCode,
        stockName: mbD1Text(body.stockName),
        market,
        quantity: 0,
        avgBuyPrice: 0,
        quoteMode,
        manualPrice,
        currentPrice: manualPrice || 0,
        fx: market === "국내" ? 1 : 0,
        valueKrw: 0,
        bookCostKrw: 0,
        returnRate: null,
        owner: account.owner,
        lastUpdated: quoteMode === "수동" ? mbD1CurrentDateSeoul() : null,
        elapsedDays: 0,
        baselineQuantity: 0,
        baselineAvgPrice: 0,
        baselineBookCostKrw: 0,
        baselineAt: now,
        managedByTradesV22: true,
        isDeleted: false
      };
      statements.push(env.DB.prepare(
        `INSERT INTO holdings (holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        holdingId, MB_D1_HOUSEHOLD_ID, accountId, stockCode, holding.stockName || null, market, 0, 0,
        quoteMode, manualPrice, manualPrice, market === "국내" ? 1 : null, 0, 0, null, account.owner,
        holding.lastUpdated, 0, 0, 0, 0, now, 1, 1, now, now, actor, actor, null, null, null
      ));
      newHolding = true;
    } else if (!holding.baselineAt) {
      const baselineBook = holding.bookCostKrw || (holding.quantity * holding.avgBuyPrice * (holding.fx || 1));
      holding.baselineQuantity = holding.quantity;
      holding.baselineAvgPrice = holding.avgBuyPrice;
      holding.baselineBookCostKrw = baselineBook;
      holding.baselineAt = now;
      holding.managedByTradesV22 = true;
      statements.push(env.DB.prepare(
        "UPDATE holdings SET baseline_quantity=?,baseline_avg_price=?,baseline_book_cost_krw=?,baseline_at=?,book_cost_krw=?,managed_by_trades=1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
      ).bind(
        holding.baselineQuantity, holding.baselineAvgPrice, holding.baselineBookCostKrw, holding.baselineAt,
        holding.baselineBookCostKrw, now, actor, MB_D1_HOUSEHOLD_ID, holding.holdingId
      ));
    }
    const tradeDate = mbD1DateOnly(body.tradeDate || body.date);
    if (holding.baselineAt && tradeDate) {
      const baselineDate = new Date(mbD1TimestampMs(holding.baselineAt)).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      if (tradeDate < baselineDate) mbD1Fail("INVESTMENT_TRADE_BEFORE_BASELINE", `기준일 ${baselineDate}보다 이전의 매매는 등록할 수 없습니다.`);
    }
    const model = mbD1TradeModel(body, null, account, holding, requestId);
    const tradeId = mbD1Id("ITX");
    const existingTrades = (await mbD1Trades(env, false)).filter((item) => item.holdingId === holding.holdingId);
    const proposedTrade = {
      investmentTradeId: tradeId,
      ...model,
      createdAt: now,
      updatedAt: now,
      isDeleted: false
    };
    const proposedTrades = [...existingTrades, proposedTrade];
    const state = mbD1SimulateHolding(holding, proposedTrades);
    const allAccountTrades = (await mbD1Trades(env, false)).filter((item) => item.accountId === accountId);
    const cashBefore = await mbD1CashForAccountWithTrades(env, account, allAccountTrades);
    if (type === "매수" && (cashBefore === null || cashBefore + 0.000001 < model.settlementKrw)) {
      mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", `예수금이 부족합니다. 현재 ${cashBefore ?? 0}원 / 필요 ${model.settlementKrw}원`);
    }
    const cashAfter = await mbD1CashForAccountWithTrades(env, account, [...allAccountTrades, proposedTrade]);
    if (cashAfter !== null && cashAfter < -0.000001) mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", "거래 후 예수금이 음수가 됩니다.");
    statements.push(env.DB.prepare(
      `INSERT INTO investment_trades (investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      tradeId, MB_D1_HOUSEHOLD_ID, requestId, model.date, model.tradeType, accountId, holding.holdingId,
      holding.stockCode, holding.stockName || null, holding.market, model.quantity, model.unitPrice, model.currency,
      model.fxRate, model.feeKrw, model.taxKrw, model.settlementKrw, state.realized.get(tradeId) || 0,
      model.memo || null, 1, now, now, actor, actor, null, null, null
    ));
    for (const [id, pnl] of state.realized.entries()) {
      if (id === tradeId) continue;
      statements.push(env.DB.prepare("UPDATE investment_trades SET realized_pnl_krw=? WHERE household_id=? AND investment_trade_id=?").bind(pnl, MB_D1_HOUSEHOLD_ID, id));
    }
    const currentPrice = holding.quoteMode === "수동" ? (holding.manualPrice || 0) : (holding.currentPrice || 0);
    const fx = holding.market === "국내" ? 1 : (holding.fx || model.fxRate || 0);
    const valueKrw = mbD1Round(state.quantity * currentPrice * fx, 2);
    const returnRate = state.bookCostKrw > 0 ? (valueKrw - state.bookCostKrw) / state.bookCostKrw : null;
    statements.push(env.DB.prepare(
      "UPDATE holdings SET quantity=?,avg_buy_price=?,book_cost_krw=?,value_krw=?,return_rate=?,managed_by_trades=1,version=version+1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
    ).bind(state.quantity, state.avgBuyPrice, state.bookCostKrw, valueKrw, returnRate, now, actor, MB_D1_HOUSEHOLD_ID, holding.holdingId));
    statements.push(await mbD1InsertChange(env, "investment_trade", tradeId, "created", 1, session, { accountId, holdingId: holding.holdingId, tradeType: model.tradeType }));
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "investment_trades")) {
        const duplicate = await mbD1First(
          env,
          "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.investment_trade_id) {
          const trade = (await mbD1Trades(env, true)).find(
            (item) => item.investmentTradeId === duplicate.investment_trade_id
          ) || null;
          return {
            created: false,
            duplicate: true,
            investmentTradeId: duplicate.investment_trade_id,
            requestId,
            trade
          };
        }
      }
      throw error;
    }
    if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, true));
    const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === tradeId) || null;
    return {
      created: true,
      duplicate: false,
      newHoldingCreated: newHolding,
      investmentTradeId: tradeId,
      requestId,
      trade,
      holding: {
        holdingId: holding.holdingId,
        accountId,
        stockCode: holding.stockCode,
        stockName: holding.stockName,
        quantity: state.quantity,
        avgBuyPrice: state.avgBuyPrice,
        bookCostKrw: state.bookCostKrw,
        activeTradeCount: proposedTrades.length
      }
    };
  }

  const id = mbD1Text(body.investmentTradeId);
  if (!id) mbD1Fail("INVESTMENT_TRADE_ID_REQUIRED", "investmentTradeId가 필요합니다.");
  const allTrades = await mbD1Trades(env, true);
  const current = allTrades.find((item) => item.investmentTradeId === id) || null;
  if (!current) mbD1Fail("INVESTMENT_TRADE_NOT_FOUND", "투자거래를 찾을 수 없습니다.", 404);
  const account = await mbD1AccountById(env, current.accountId, false);
  const holding = await mbD1HoldingById(env, current.holdingId, false);
  if (!account || !holding) mbD1Fail("INVESTMENT_LINK_BROKEN", "연결된 투자계좌 또는 보유종목을 찾을 수 없습니다.");

  const recomputeAndWrite = async (nextTrade, action) => {
    const activeHoldingTrades = (await mbD1Trades(env, false)).filter((item) => item.holdingId === holding.holdingId && item.investmentTradeId !== id);
    if (nextTrade && !nextTrade.isDeleted) activeHoldingTrades.push(nextTrade);
    const state = mbD1SimulateHolding(holding, activeHoldingTrades);
    const activeAccountTrades = (await mbD1Trades(env, false)).filter((item) => item.accountId === account.accountId && item.investmentTradeId !== id);
    if (nextTrade && !nextTrade.isDeleted) activeAccountTrades.push(nextTrade);
    const cash = await mbD1CashForAccountWithTrades(env, account, activeAccountTrades);
    if (cash !== null && cash < -0.000001) mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", "변경 결과 예수금이 음수가 됩니다.");
    const now = mbD1Now();
    const statements = [];
    if (action === "updated") {
      statements.push(env.DB.prepare(
        `UPDATE investment_trades SET trade_date=?,trade_type=?,quantity=?,unit_price=?,currency=?,fx_rate=?,fee_krw=?,tax_krw=?,settlement_krw=?,memo=?,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?`
      ).bind(nextTrade.date, nextTrade.tradeType, nextTrade.quantity, nextTrade.unitPrice, nextTrade.currency, nextTrade.fxRate, nextTrade.feeKrw, nextTrade.taxKrw, nextTrade.settlementKrw, nextTrade.memo || null, now, actor, MB_D1_HOUSEHOLD_ID, id));
    } else if (action === "deleted") {
      statements.push(env.DB.prepare(
        "UPDATE investment_trades SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?"
      ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id));
    } else if (action === "restored") {
      statements.push(env.DB.prepare(
        "UPDATE investment_trades SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?"
      ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id));
    }
    for (const trade of activeHoldingTrades) {
      statements.push(env.DB.prepare("UPDATE investment_trades SET realized_pnl_krw=? WHERE household_id=? AND investment_trade_id=?").bind(state.realized.get(trade.investmentTradeId) || 0, MB_D1_HOUSEHOLD_ID, trade.investmentTradeId));
    }
    const currentPrice = holding.quoteMode === "수동" ? (holding.manualPrice || 0) : (holding.currentPrice || 0);
    const fx = holding.market === "국내" ? 1 : (holding.fx || 0);
    const valueKrw = mbD1Round(state.quantity * currentPrice * fx, 2);
    const returnRate = state.bookCostKrw > 0 ? (valueKrw - state.bookCostKrw) / state.bookCostKrw : null;
    statements.push(env.DB.prepare(
      "UPDATE holdings SET quantity=?,avg_buy_price=?,book_cost_krw=?,value_krw=?,return_rate=?,version=version+1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
    ).bind(state.quantity, state.avgBuyPrice, state.bookCostKrw, valueKrw, returnRate, now, actor, MB_D1_HOUSEHOLD_ID, holding.holdingId));
    statements.push(await mbD1InsertChange(env, "investment_trade", id, action, null, session));
    await env.DB.batch(statements);
    return state;
  };

  if (path === "/api/investments/trades/update") {
    if (current.isDeleted) mbD1Fail("INVESTMENT_TRADE_NOT_FOUND", "수정할 투자거래를 찾을 수 없습니다.", 404);
    if (!mbD1Has(body, "expectedUpdatedAtMs")) mbD1Fail("UPDATE_VERSION_REQUIRED", "투자거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.", 409);
    const expected = body.expectedUpdatedAtMs === null || body.expectedUpdatedAtMs === "" ? null : Number(body.expectedUpdatedAtMs);
    if (expected !== current.updatedAtMs) mbD1Fail("CONCURRENT_MODIFICATION", "투자거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.", 409);
    for (const [key, oldValue, label] of [["accountId", current.accountId, "투자계좌"],["holdingId", current.holdingId, "보유종목"],["stockCode", current.stockCode, "종목코드"]]) {
      if (mbD1Has(body, key) && mbD1Text(body[key]).toUpperCase() !== mbD1Text(oldValue).toUpperCase()) mbD1Fail("INVESTMENT_LINK_CHANGE_NOT_ALLOWED", `${label} 변경은 기존 거래를 삭제한 뒤 새 거래로 등록해야 합니다.`);
    }
    const model = mbD1TradeModel(body, current, account, holding, current.requestId);
    if (holding.baselineAt) {
      const baselineDate = new Date(mbD1TimestampMs(holding.baselineAt)).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      if (model.date < baselineDate) mbD1Fail("INVESTMENT_TRADE_BEFORE_BASELINE", `기준일 ${baselineDate}보다 이전의 매매는 등록할 수 없습니다.`);
    }
    const nextTrade = { ...current, ...model, investmentTradeId: id, createdAt: current.createdAt, updatedAt: mbD1Now(), isDeleted: false };
    const state = await recomputeAndWrite(nextTrade, "updated");
    const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === id) || null;
    return { updated: true, investmentTradeId: id, trade, holding: { holdingId: holding.holdingId, accountId: holding.accountId, stockCode: holding.stockCode, stockName: holding.stockName, quantity: state.quantity, avgBuyPrice: state.avgBuyPrice, bookCostKrw: state.bookCostKrw, activeTradeCount: state.realized.size } };
  }

  if (path === "/api/investments/trades/delete") {
    if (current.isDeleted) return { deleted: true, alreadyDeleted: true, investmentTradeId: id };
    const state = await recomputeAndWrite(null, "deleted");
    return { deleted: true, investmentTradeId: id, holding: { holdingId: holding.holdingId, accountId: holding.accountId, stockCode: holding.stockCode, stockName: holding.stockName, quantity: state.quantity, avgBuyPrice: state.avgBuyPrice, bookCostKrw: state.bookCostKrw, activeTradeCount: state.realized.size } };
  }

  if (path === "/api/investments/trades/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, investmentTradeId: id };
    const nextTrade = { ...current, isDeleted: false };
    const state = await recomputeAndWrite(nextTrade, "restored");
    const trade = (await mbD1Trades(env, true)).find((item) => item.investmentTradeId === id) || null;
    return { restored: true, investmentTradeId: id, trade, holding: { holdingId: holding.holdingId, accountId: holding.accountId, stockCode: holding.stockCode, stockName: holding.stockName, quantity: state.quantity, avgBuyPrice: state.avgBuyPrice, bookCostKrw: state.bookCostKrw, activeTradeCount: state.realized.size } };
  }

  mbD1Fail("UNSUPPORTED_INVESTMENT_ACTION", "지원하지 않는 투자거래 작업입니다.");
}

async function mbD1FetchYahooChart(symbol) {
  const clean = mbD1Text(symbol);
  if (!clean) return null;
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?range=1d&interval=1d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 moneybook-price" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, currency: mbD1Text(meta?.currency).toUpperCase(), symbol: clean };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mbD1FxRate(currency) {
  const code = mbD1Text(currency).toUpperCase();
  if (!code || code === "KRW") return 1;
  const candidates = code === "USD" ? ["KRW=X", "USDKRW=X"] : [`${code}KRW=X`];
  for (const symbol of candidates) {
    const quote = await mbD1FetchYahooChart(symbol);
    if (quote) return quote.price;
  }
  return null;
}

async function mbD1QuoteForHolding(holding) {
  const code = mbD1Text(holding.stockCode).toUpperCase();
  const candidates = [];
  try {
    const lookup = await lookupInvestmentSymbol(code);
    if (lookup?.found && lookup.symbol) candidates.push(lookup.symbol);
  } catch {}
  if (holding.market === "국내" && /^\d{6}$/.test(code)) {
    candidates.push(`${code}.KS`, `${code}.KQ`);
  } else {
    candidates.push(code);
  }
  const unique = Array.from(new Set(candidates.filter(Boolean)));
  for (const symbol of unique) {
    const quote = await mbD1FetchYahooChart(symbol);
    if (!quote) continue;
    const fx = holding.market === "국내" ? 1 : await mbD1FxRate(quote.currency || "USD");
    if (fx === null) continue;
    return { price: quote.price, fx };
  }
  return null;
}

async function mbD1RefreshQuotes(env, force = false) {
  if (!env.DB) return;
  if (!force && Date.now() - mbD1LastQuoteRefreshAt < MB_D1_QUOTE_REFRESH_MS) return;
  if (mbD1QuoteRefreshPromise) return mbD1QuoteRefreshPromise;

  mbD1QuoteRefreshPromise = (async () => {
    const holdings = (await mbD1Holdings(env, false)).filter((holding) => holding.quoteMode === "자동");
    for (const holding of holdings) {
      const quote = await mbD1QuoteForHolding(holding);
      if (!quote) continue;
      const valueKrw = mbD1Round(holding.quantity * quote.price * quote.fx, 2);
      const returnRate = holding.bookCostKrw > 0 ? (valueKrw - holding.bookCostKrw) / holding.bookCostKrw : null;
      await env.DB.prepare(
        "UPDATE holdings SET current_price=?,fx_rate=?,value_krw=?,return_rate=?,updated_at=? WHERE household_id=? AND holding_id=?"
      ).bind(quote.price, quote.fx, valueKrw, returnRate, mbD1Now(), MB_D1_HOUSEHOLD_ID, holding.holdingId).run();
    }

    mbD1LastQuoteRefreshAt = Date.now();
  })().finally(() => {
    mbD1QuoteRefreshPromise = null;
  });
  return mbD1QuoteRefreshPromise;
}

async function mbD1BuildBackupDocument(env) {
  await mbD1EnsureBenefitUsageSchema(env);
  const [
    bootstrap,
    categoryRows,
    accountRows,
    transactionRows,
    snapshotRows,
    holdingRows,
    tradeRows,
    benefitUsageRows,
    investmentCash,
    realEstateAssets
  ] = await Promise.all([
    mbD1BuildBootstrap(env),
    mbD1All(env, "SELECT * FROM categories WHERE household_id=? ORDER BY category_id", [MB_D1_HOUSEHOLD_ID]),
    mbD1RawAccounts(env),
    mbD1All(env, `${MB_D1_TRANSACTION_SELECT} WHERE t.household_id=? ORDER BY t.date,t.transaction_id`, [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, "SELECT * FROM asset_snapshots WHERE household_id=? ORDER BY month", [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, `SELECT h.*, a.display_name AS account_name FROM holdings h LEFT JOIN accounts a ON a.account_id=h.account_id WHERE h.household_id=? ORDER BY h.holding_id`, [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, `SELECT t.*, a.display_name AS account_name FROM investment_trades t LEFT JOIN accounts a ON a.account_id=t.account_id WHERE t.household_id=? ORDER BY t.trade_date,t.investment_trade_id`, [MB_D1_HOUSEHOLD_ID]),
    mbD1All(env, "SELECT transaction_id,rule_id,account_id,used_amount,created_at,updated_at FROM benefit_reward_usage WHERE household_id=? ORDER BY transaction_id", [MB_D1_HOUSEHOLD_ID]),
    mbD1GetInvestmentCashData(env, new URL("https://moneybook.internal/api/investments/cash")),
    listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, true)
  ]);

  const categories = categoryRows.map((row) => ({
    ...mbD1MapCategory(row),
    storedActive: mbD1Bool(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by)
  }));

  const accounts = accountRows.map((row) => ({
    ...mbD1MapAccountRow(row),
    storedActive: mbD1Bool(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by)
  }));

  const transactions = transactionRows.map((row) => ({
    ...mbD1MapTransactionRow(row),
    version: mbD1Number(row.version, 1),
    taxpayerMemberId: row.taxpayer_member_id || null,
    taxCategoryCode: row.tax_category_code || null
  }));

  const assetSnapshots = snapshotRows.map((row) => ({
    month: row.month,
    assets: mbD1Number(row.assets),
    liabilities: mbD1Number(row.liabilities),
    netWorth: mbD1Number(row.net_worth),
    investmentValue: mbD1Number(row.investment_value),
    cashLikeValue: mbD1Number(row.cash_like_value),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    row: 0
  }));

  const investmentHoldings = holdingRows.map((row) => ({
    ...mbD1MapHoldingRow(row),
    version: mbD1Number(row.version, 1),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdBy: mbD1Text(row.created_by),
    updatedBy: mbD1Text(row.updated_by),
    deletedAt: row.deleted_at || null,
    deletedBy: mbD1Text(row.deleted_by)
  }));

  const investmentTrades = tradeRows.map((row) => ({
    ...mbD1MapTradeRow(row),
    version: mbD1Number(row.version, 1)
  }));

  const benefitRewardUsage = benefitUsageRows.map((row) => ({
    transactionId: mbD1Text(row.transaction_id),
    ruleId: mbD1Text(row.rule_id),
    accountId: mbD1Text(row.account_id),
    usedAmount: mbD1Number(row.used_amount),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }));

  return {
    format: "moneybook-backup",
    version: 3,
    exportedAt: mbD1Now(),
    payload: {
      bootstrap,
      categories,
      accounts,
      transactions,
      assetSnapshots,
      investmentHoldings,
      investmentTrades,
      investmentCash,
      benefitRewardUsage,
      realEstateAssets
    }
  };
}

async function mbD1BackupCurrentIdSets(env) {
  await ensureRealEstateSchema(env);
  const tableSpecs = [
    ["categories", "category_id", "categories"],
    ["accounts", "account_id", "accounts"],
    ["transactions", "transaction_id", "transactions"],
    ["holdings", "holding_id", "investmentHoldings"],
    ["investment_trades", "investment_trade_id", "investmentTrades"],
    ["asset_snapshots", "month", "assetSnapshots"],
    ["benefit_reward_usage", "transaction_id", "benefitRewardUsage"],
    ["real_estate_assets", "property_id", "realEstateAssets"]
  ];
  const entries = await Promise.all(tableSpecs.map(async ([table, column, key]) => {
    const rows = await mbD1All(env, `SELECT ${column} AS id FROM ${table} WHERE household_id=?`, [MB_D1_HOUSEHOLD_ID]);
    return [key, new Set(rows.map((row) => mbD1Text(row.id)).filter(Boolean))];
  }));
  return Object.fromEntries(entries);
}

async function mbD1AssertBackupRequestIdCompatibility(validated, env) {
  const [transactionRows, tradeRows] = await Promise.all([
    mbD1All(
      env,
      "SELECT transaction_id AS id,request_id FROM transactions WHERE household_id=? AND request_id IS NOT NULL",
      [MB_D1_HOUSEHOLD_ID]
    ),
    mbD1All(
      env,
      "SELECT investment_trade_id AS id,request_id FROM investment_trades WHERE household_id=? AND request_id IS NOT NULL",
      [MB_D1_HOUSEHOLD_ID]
    )
  ]);

  const transactionConflicts = findRequestIdConflicts(
    validated.payload.transactions,
    "transactionId",
    transactionRows
  );
  const tradeConflicts = findRequestIdConflicts(
    validated.payload.investmentTrades,
    "investmentTradeId",
    tradeRows
  );
  const conflicts = [
    ...transactionConflicts.map((item) => `거래 requestId ${item.requestId}`),
    ...tradeConflicts.map((item) => `투자거래 requestId ${item.requestId}`)
  ];

  if (conflicts.length > 0) {
    const sample = conflicts.slice(0, 3).join(", ");
    const suffix = conflicts.length > 3 ? ` 외 ${conflicts.length - 3}건` : "";
    throw new BackupValidationError(
      "BACKUP_REQUEST_ID_CONFLICT",
      `현재 가계부의 다른 항목과 요청 ID가 충돌합니다: ${sample}${suffix}. 복원하지 않고 기존 데이터를 먼저 확인해주세요.`
    );
  }
}

async function mbD1PreviewBackupRestore(document, env) {
  await mbD1EnsureBenefitUsageSchema(env);
  await ensureRealEstateSchema(env);
  const validated = validateBackupDocument(document);
  await mbD1AssertBackupRequestIdCompatibility(validated, env);
  const current = await mbD1BackupCurrentIdSets(env);
  const payload = validated.payload;
  const specs = [
    ["categories", payload.categories, "categoryId"],
    ["accounts", payload.accounts, "accountId"],
    ["transactions", payload.transactions, "transactionId"],
    ["investmentHoldings", payload.investmentHoldings, "holdingId"],
    ["investmentTrades", payload.investmentTrades, "investmentTradeId"],
    ["assetSnapshots", payload.assetSnapshots, "month"],
    ["benefitRewardUsage", validated.version >= 2 ? (payload.benefitRewardUsage || []) : [], "transactionId"],
    ["realEstateAssets", validated.version >= 3 ? (payload.realEstateAssets || []) : [], "propertyId"]
  ];
  const existing = {};
  const additions = {};
  for (const [key, items, idKey] of specs) {
    const found = items.reduce((count, item) => count + (current[key].has(mbD1Text(item?.[idKey])) ? 1 : 0), 0);
    existing[key] = found;
    additions[key] = items.length - found;
  }
  return {
    mode: "merge",
    version: validated.version,
    exportedAt: validated.exportedAt,
    summary: validated.summary,
    existing,
    additions,
    warnings: validated.warnings,
    notes: [
      "같은 ID의 항목은 백업 값으로 갱신합니다.",
      "백업에 없는 현재 데이터는 삭제하지 않습니다.",
      "다른 항목이 같은 requestId를 사용 중이면 실제 복원 전에 차단합니다.",
      "복원은 여러 D1 배치로 처리되므로, 복원 직전에 현재 상태의 안전 백업을 먼저 보관합니다."
    ]
  };
}

function mbD1BackupDeletedAt(item) {
  if (item?.deletedAt) return item.deletedAt;
  return item?.isDeleted ? "1970-01-01T00:00:00.000Z" : null;
}

function mbD1BackupNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mbD1BackupNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function mbD1RunBackupBatches(env, statements, size = 40) {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size));
  }
}

function mbD1BackupMemberId(name) {
  const clean = mbD1Text(name);
  if (!clean || clean === "공동") return null;
  const bytes = encoder.encode(clean);
  return "MEM_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mbD1RestoreBackupMerge(document, session, env) {
  const validated = validateBackupDocument(document);
  const payload = validated.payload;
  const now = mbD1Now();
  const actor = session?.name || "restore";
  await mbD1EnsureBenefitUsageSchema(env);
  await ensureRealEstateSchema(env);
  await mbD1AssertBackupRequestIdCompatibility(validated, env);

  let restoreStarted = false;
  try {
    const currentMembers = await mbD1All(
    env,
    "SELECT member_id,display_name FROM members WHERE household_id=?",
    [MB_D1_HOUSEHOLD_ID]
  );
  const memberMap = new Map(currentMembers.map((row) => [mbD1Text(row.display_name), row.member_id]));
  const memberStatements = [];
  for (const name of validated.members) {
    const memberId = memberMap.get(name) || mbD1BackupMemberId(name);
    memberMap.set(name, memberId);
    memberStatements.push(env.DB.prepare(
      `INSERT INTO members (member_id,household_id,display_name,is_active,created_at,updated_at,deleted_at)
       VALUES (?,?,?,?,?,?,NULL)
       ON CONFLICT(member_id) DO UPDATE SET display_name=excluded.display_name,is_active=1,updated_at=excluded.updated_at,deleted_at=NULL`
    ).bind(memberId, MB_D1_HOUSEHOLD_ID, name, 1, now, now));
  }
    restoreStarted = true;
    await mbD1RunBackupBatches(env, memberStatements);

  const ledgerStartDate = payload.bootstrap?.ledgerConfig?.ledgerStartDate || null;
  await env.DB.prepare(
    "UPDATE households SET ledger_start_date=?,updated_at=? WHERE household_id=?"
  ).bind(ledgerStartDate, now, MB_D1_HOUSEHOLD_ID).run();

  const categoryStatements = payload.categories.map((item) => env.DB.prepare(
    `INSERT INTO categories (category_id,household_id,type,name,is_active,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(category_id) DO UPDATE SET type=excluded.type,name=excluded.name,is_active=excluded.is_active,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.categoryId, MB_D1_HOUSEHOLD_ID, item.type, item.name,
    item.storedActive === undefined ? (item.active ? 1 : 0) : (item.storedActive ? 1 : 0),
    item.createdAt || now, item.updatedAt || now, item.createdBy || actor, item.updatedBy || actor,
    mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  await mbD1RunBackupBatches(env, categoryStatements);

  const accountBaseStatements = payload.accounts.map((item) => env.DB.prepare(
    `INSERT INTO accounts (account_id,household_id,name,display_name,account_type,sub_type,owner_member_id,owner_label,opening_balance,billing_cutoff_day,payment_day,payment_account_id,start_year,end_year,is_active,balance_method,current_balance_override,asset_attribution,investment_cash_baseline_krw,investment_cash_baseline_at,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(account_id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,account_type=excluded.account_type,sub_type=excluded.sub_type,owner_member_id=excluded.owner_member_id,owner_label=excluded.owner_label,opening_balance=excluded.opening_balance,billing_cutoff_day=excluded.billing_cutoff_day,payment_day=excluded.payment_day,payment_account_id=NULL,start_year=excluded.start_year,end_year=excluded.end_year,is_active=excluded.is_active,balance_method=excluded.balance_method,current_balance_override=excluded.current_balance_override,asset_attribution=excluded.asset_attribution,investment_cash_baseline_krw=excluded.investment_cash_baseline_krw,investment_cash_baseline_at=excluded.investment_cash_baseline_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.accountId, MB_D1_HOUSEHOLD_ID, item.accountName || item.displayName || "", item.displayName || item.accountName || "",
    item.accountType || "", item.subType || "", memberMap.get(mbD1Text(item.owner)) || null, item.owner || null,
    mbD1BackupNumber(item.openingBalance), mbD1BackupNullableNumber(item.billingCutoffDay), mbD1BackupNullableNumber(item.paymentDay), null,
    mbD1BackupNullableNumber(item.startYear), mbD1BackupNullableNumber(item.endYear),
    item.storedActive === undefined ? (item.active ? 1 : 0) : (item.storedActive ? 1 : 0),
    item.balanceMethod || "", mbD1BackupNullableNumber(item.sheetCurrentBalance), item.assetAttribution || "",
    mbD1BackupNullableNumber(item.cashBaselineKrw), item.cashBaselineAt || item.cashBaselineAtDate || null,
    item.createdAt || now, item.updatedAt || now, item.createdBy || actor, item.updatedBy || actor,
    mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  await mbD1RunBackupBatches(env, accountBaseStatements);

  const accountLinkStatements = payload.accounts
    .filter((item) => item.paymentAccountId)
    .map((item) => env.DB.prepare(
      "UPDATE accounts SET payment_account_id=? WHERE household_id=? AND account_id=?"
    ).bind(item.paymentAccountId, MB_D1_HOUSEHOLD_ID, item.accountId));
  await mbD1RunBackupBatches(env, accountLinkStatements);

  const holdingStatements = payload.investmentHoldings.map((item) => env.DB.prepare(
    `INSERT INTO holdings (holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(holding_id) DO UPDATE SET account_id=excluded.account_id,stock_code=excluded.stock_code,stock_name=excluded.stock_name,market=excluded.market,quantity=excluded.quantity,avg_buy_price=excluded.avg_buy_price,quote_mode=excluded.quote_mode,manual_price=excluded.manual_price,current_price=excluded.current_price,fx_rate=excluded.fx_rate,value_krw=excluded.value_krw,book_cost_krw=excluded.book_cost_krw,return_rate=excluded.return_rate,owner_label=excluded.owner_label,last_updated=excluded.last_updated,elapsed_days=excluded.elapsed_days,baseline_quantity=excluded.baseline_quantity,baseline_avg_price=excluded.baseline_avg_price,baseline_book_cost_krw=excluded.baseline_book_cost_krw,baseline_at=excluded.baseline_at,managed_by_trades=excluded.managed_by_trades,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.holdingId, MB_D1_HOUSEHOLD_ID, item.accountId || null, item.stockCode || "", item.stockName || "", item.market || "",
    mbD1BackupNumber(item.quantity), mbD1BackupNumber(item.avgBuyPrice), item.quoteMode || "", mbD1BackupNullableNumber(item.manualPrice),
    mbD1BackupNullableNumber(item.currentPrice), mbD1BackupNullableNumber(item.fx), mbD1BackupNullableNumber(item.valueKrw),
    mbD1BackupNullableNumber(item.bookCostKrw ?? item.costKrw), mbD1BackupNullableNumber(item.returnRate), item.owner || null,
    item.lastUpdated || null, mbD1BackupNullableNumber(item.elapsedDays), mbD1BackupNumber(item.baselineQuantity), mbD1BackupNumber(item.baselineAvgPrice),
    mbD1BackupNumber(item.baselineBookCostKrw), item.baselineAt || item.baselineAtDate || null, item.managedByTradesV22 ? 1 : 0,
    Math.max(1, Math.floor(mbD1BackupNumber(item.version, 1))), item.createdAt || now, item.updatedAt || now,
    item.createdBy || actor, item.updatedBy || actor, mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  await mbD1RunBackupBatches(env, holdingStatements);

  const transactionStatements = payload.transactions.map((item) => env.DB.prepare(
    `INSERT INTO transactions (transaction_id,household_id,request_id,date,type,category_id,amount,from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,version,taxpayer_member_id,tax_category_code,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(transaction_id) DO UPDATE SET request_id=excluded.request_id,date=excluded.date,type=excluded.type,category_id=excluded.category_id,amount=excluded.amount,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,payment_method_id=excluded.payment_method_id,spending_target=excluded.spending_target,spender_member_id=excluded.spender_member_id,entered_by_member_id=excluded.entered_by_member_id,description=excluded.description,memo=excluded.memo,billing_month_override=excluded.billing_month_override,billing_month=excluded.billing_month,group_id=excluded.group_id,reversal_of=NULL,version=excluded.version,taxpayer_member_id=excluded.taxpayer_member_id,tax_category_code=excluded.tax_category_code,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.transactionId, MB_D1_HOUSEHOLD_ID, item.requestId || null, item.date, item.type, item.categoryId || null, mbD1BackupNumber(item.amount),
    item.fromAccountId || null, item.toAccountId || null, item.paymentMethodId || null, item.spendingTarget || null,
    memberMap.get(mbD1Text(item.spendingTarget)) || null, memberMap.get(mbD1Text(item.createdBy)) || null,
    item.description || null, item.memo || null, item.billingOverride || null, item.billingMonth || null, item.groupId || null, null,
    Math.max(1, Math.floor(mbD1BackupNumber(item.version, 1))), item.taxpayerMemberId || null, item.taxCategoryCode || null,
    item.createdAt || now, item.updatedAt || item.createdAt || now, item.createdBy || actor, item.updatedBy || actor,
    mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  await mbD1RunBackupBatches(env, transactionStatements);

  const reversalStatements = payload.transactions
    .filter((item) => item.reversalOf)
    .map((item) => env.DB.prepare(
      "UPDATE transactions SET reversal_of=? WHERE household_id=? AND transaction_id=?"
    ).bind(item.reversalOf, MB_D1_HOUSEHOLD_ID, item.transactionId));
  await mbD1RunBackupBatches(env, reversalStatements);

  const tradeStatements = payload.investmentTrades.map((item) => env.DB.prepare(
    `INSERT INTO investment_trades (investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(investment_trade_id) DO UPDATE SET request_id=excluded.request_id,trade_date=excluded.trade_date,trade_type=excluded.trade_type,account_id=excluded.account_id,holding_id=excluded.holding_id,stock_code=excluded.stock_code,stock_name=excluded.stock_name,market=excluded.market,quantity=excluded.quantity,unit_price=excluded.unit_price,currency=excluded.currency,fx_rate=excluded.fx_rate,fee_krw=excluded.fee_krw,tax_krw=excluded.tax_krw,settlement_krw=excluded.settlement_krw,realized_pnl_krw=excluded.realized_pnl_krw,memo=excluded.memo,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row`
  ).bind(
    item.investmentTradeId, MB_D1_HOUSEHOLD_ID, item.requestId || null, item.tradeDate || item.date, item.tradeType,
    item.accountId, item.holdingId, item.stockCode || "", item.stockName || null, item.market || null,
    mbD1BackupNumber(item.quantity), mbD1BackupNumber(item.unitPrice), item.currency || null, mbD1BackupNullableNumber(item.fxRate),
    mbD1BackupNumber(item.feeKrw), mbD1BackupNumber(item.taxKrw), mbD1BackupNumber(item.settlementKrw), mbD1BackupNumber(item.realizedPnlKrw),
    item.memo || null, Math.max(1, Math.floor(mbD1BackupNumber(item.version, 1))), item.createdAt || now, item.updatedAt || item.createdAt || now,
    item.createdBy || actor, item.updatedBy || actor, mbD1BackupDeletedAt(item), item.deletedBy || null, item.row || null
  ));
  await mbD1RunBackupBatches(env, tradeStatements);

  const snapshotStatements = payload.assetSnapshots.map((item) => env.DB.prepare(
    `INSERT INTO asset_snapshots (household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value,created_at,updated_at,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(household_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,investment_value=excluded.investment_value,cash_like_value=excluded.cash_like_value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
  ).bind(
    MB_D1_HOUSEHOLD_ID, item.month, mbD1BackupNumber(item.assets), mbD1BackupNumber(item.liabilities), mbD1BackupNumber(item.netWorth),
    mbD1BackupNumber(item.investmentValue), mbD1BackupNumber(item.cashLikeValue), item.createdAt || now, item.updatedAt || now,
    item.createdBy || actor, item.updatedBy || actor
  ));
  await mbD1RunBackupBatches(env, snapshotStatements);

  const inputState = payload.bootstrap?.inputPreferences;
  if (inputState?.preferences) {
    await env.DB.prepare(
      `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
    ).bind(
      "PREF_INPUT_SHARED", MB_D1_HOUSEHOLD_ID, null, "input_preferences", JSON.stringify(inputState.preferences),
      Number(inputState.version) || 1, inputState.updatedAt || now, inputState.updatedAt || now
    ).run();
  } else if (inputState?.configured === false) {
    await env.DB.prepare(
      "DELETE FROM user_preferences WHERE household_id=? AND preference_key='input_preferences'"
    ).bind(MB_D1_HOUSEHOLD_ID).run();
  }

  const automationSettings = payload.bootstrap?.automationSettings;
  if (automationSettings) {
    const normalized = mbD1NormalizeAutomationSettings(automationSettings);
    mbD1ValidateAutomationSettings(normalized);
    await env.DB.prepare(
      `INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at`
    ).bind(MB_D1_AUTOMATION_PREF_ID, MB_D1_HOUSEHOLD_ID, null, MB_D1_AUTOMATION_PREF_KEY, JSON.stringify(normalized), 1, now, now).run();
  }

  if (validated.version >= 2) {
    const deleteUsageStatements = payload.transactions.map((item) => env.DB.prepare(
      "DELETE FROM benefit_reward_usage WHERE household_id=? AND transaction_id=?"
    ).bind(MB_D1_HOUSEHOLD_ID, item.transactionId));
    await mbD1RunBackupBatches(env, deleteUsageStatements);

    const usageStatements = (payload.benefitRewardUsage || []).map((item) => env.DB.prepare(
      `INSERT INTO benefit_reward_usage (transaction_id,household_id,rule_id,account_id,used_amount,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(transaction_id) DO UPDATE SET rule_id=excluded.rule_id,account_id=excluded.account_id,used_amount=excluded.used_amount,updated_at=excluded.updated_at`
    ).bind(
      item.transactionId, MB_D1_HOUSEHOLD_ID, item.ruleId, item.accountId, mbD1BackupNumber(item.usedAmount), item.createdAt || now, item.updatedAt || now
    ));
    await mbD1RunBackupBatches(env, usageStatements);
  }

  if (validated.version >= 3) {
    const realEstateStatements = (payload.realEstateAssets || []).map((item) => env.DB.prepare(
      `INSERT INTO real_estate_assets (
        property_id,household_id,name,property_type,address,lawd_code,apartment_name,exclusive_area_sqm,floor,owner_label,purchase_price_krw,
        valuation_mode,manual_value_krw,estimated_value_krw,estimate_low_krw,estimate_high_krw,estimate_trade_count,estimate_updated_at,last_trade_date,recent_trades_json,
        created_at,updated_at,created_by,updated_by,deleted_at,deleted_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(property_id) DO UPDATE SET
        name=excluded.name,property_type=excluded.property_type,address=excluded.address,lawd_code=excluded.lawd_code,apartment_name=excluded.apartment_name,
        exclusive_area_sqm=excluded.exclusive_area_sqm,floor=excluded.floor,owner_label=excluded.owner_label,purchase_price_krw=excluded.purchase_price_krw,
        valuation_mode=excluded.valuation_mode,manual_value_krw=excluded.manual_value_krw,estimated_value_krw=excluded.estimated_value_krw,
        estimate_low_krw=excluded.estimate_low_krw,estimate_high_krw=excluded.estimate_high_krw,estimate_trade_count=excluded.estimate_trade_count,
        estimate_updated_at=excluded.estimate_updated_at,last_trade_date=excluded.last_trade_date,recent_trades_json=excluded.recent_trades_json,
        updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by`
    ).bind(
      item.propertyId, MB_D1_HOUSEHOLD_ID, item.name || item.apartmentName || "아파트", item.propertyType || "아파트",
      item.address || "", item.lawdCode || "", item.apartmentName || item.name || "", mbD1BackupNumber(item.exclusiveAreaSqm),
      mbD1BackupNullableNumber(item.floor), item.owner || null, mbD1BackupNumber(item.purchasePriceKrw),
      item.valuationMode === "manual" ? "manual" : "auto", mbD1BackupNullableNumber(item.manualValueKrw),
      mbD1BackupNumber(item.estimatedValueKrw), mbD1BackupNumber(item.estimateLowKrw), mbD1BackupNumber(item.estimateHighKrw),
      Math.max(0, Math.floor(mbD1BackupNumber(item.estimateTradeCount))), item.estimateUpdatedAt || null, item.lastTradeDate || null,
      JSON.stringify(Array.isArray(item.recentTrades) ? item.recentTrades : []), item.createdAt || now, item.updatedAt || now,
      item.createdBy || actor, item.updatedBy || actor, item.deletedAt || (item.isDeleted ? "1970-01-01T00:00:00.000Z" : null), item.deletedBy || null
    ));
    await mbD1RunBackupBatches(env, realEstateStatements);
  }

  const change = await mbD1InsertChange(env, "backup_restore", `restore-${Date.now()}`, "merged", null, session, {
    version: validated.version,
    exportedAt: validated.exportedAt,
    summary: validated.summary
  });
  await env.DB.batch([change]);

    return {
      restored: true,
      mode: "merge",
      version: validated.version,
      exportedAt: validated.exportedAt,
      summary: validated.summary,
      warnings: validated.warnings,
      restoredAt: now,
      restoredBy: actor
    };
  } catch (error) {
    if (restoreStarted) {
      try {
        const failureChange = await mbD1InsertChange(
          env,
          "backup_restore",
          `restore-failed-${Date.now()}`,
          "partial_failure",
          null,
          session,
          {
            version: validated.version,
            exportedAt: validated.exportedAt,
            summary: validated.summary
          }
        );
        await env.DB.batch([failureChange]);
      } catch {
        // 원래 복원 오류를 보존합니다.
      }
    }
    throw error;
  }
}



async function mbD1AnalyzeImportedTransactions(body, session, env) {
  const analysisPromise = analyzeTransactionImport(env, {
    text: body.text,
    images: body.images,
    today: mbD1CurrentDateSeoul()
  }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  const categoriesPromise = mbD1All(
    env,
    "SELECT * FROM categories WHERE household_id=? AND type='지출' AND deleted_at IS NULL AND is_active=1 ORDER BY name",
    [MB_D1_HOUSEHOLD_ID]
  ).then((rows) => rows.map(mbD1MapCategory));
  const accountsPromise = mbD1RawAccounts(env).then((rows) => rows.map(mbD1MapAccountRow));
  const recentTransactionsPromise = mbD1RecentExpenseTransactions(env, 800);
  const membersPromise = mbD1Members(env);

  const [analysisResult, categories, accounts, recentTransactions, memberRows] = await Promise.all([
    analysisPromise,
    categoriesPromise,
    accountsPromise,
    recentTransactionsPromise,
    membersPromise
  ]);
  const paymentMethods = accounts.filter((account) =>
    account.active && !account.isDeleted && ["신용카드", "체크카드", "선불/지역화폐"].includes(account.subType)
  );

  let extracted;
  try {
    if (!analysisResult.ok) throw analysisResult.error;
    extracted = analysisResult.value;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "");
    const looksLikeLimit = error?.status === 429 || /(?:429|quota|rate.?limit|neuron|usage.?limit|too many requests)/i.test(rawMessage);
    if (looksLikeLimit) {
      mbD1Fail("AI_DAILY_LIMIT", "오늘 사용할 수 있는 AI 분석량을 모두 사용했습니다. 무료 할당량이 초기화된 뒤 다시 이용해주세요.", 429);
    }
    const code = error?.code || "AI_ANALYSIS_FAILED";
    const message = rawMessage || "거래 내역을 분석하지 못했습니다.";
    mbD1Fail(code, message, code === "AI_NOT_BOUND" ? 503 : 400);
  }

  const memberNames = memberRows.map((row) => mbD1Text(row.display_name)).filter(Boolean);
  const defaultTarget = memberNames.includes(session?.name) ? session.name : "공동";
  return {
    model: "@cf/moondream/moondream3.1-9B-A2B",
    items: extracted.map((candidate) => {
      let paymentMethod = mbImportChoosePaymentMethod(candidate.cardName, paymentMethods);
      if (!paymentMethod && paymentMethods.length === 1) paymentMethod = paymentMethods[0];
      const categoryMatch = mbImportChooseCategory(candidate, categories, recentTransactions);
      const duplicate = candidate.kind === "expense"
        ? mbImportFindDuplicate(candidate, recentTransactions, paymentMethod?.accountId || null)
        : null;
      const reasons = [];
      if (!candidate.date) reasons.push("날짜 확인 필요");
      if (!candidate.amount) reasons.push("금액 확인 필요");
      if (!candidate.merchant) reasons.push("가맹점 확인 필요");
      if (!paymentMethod) reasons.push("결제수단 선택 필요");
      if (!categoryMatch.category) reasons.push("카테고리 선택 필요");
      if (candidate.confidence === "low") reasons.push("인식 결과 확인 필요");
      if (duplicate) reasons.push("중복 거래 의심");
      if (candidate.kind === "refund") reasons.push("취소/환불은 원거래 연결 확인 필요");
      return {
        ...candidate,
        categoryId: categoryMatch.category?.categoryId || null,
        categoryName: categoryMatch.category?.name || "",
        categorySuggestionSource: categoryMatch.source,
        paymentMethodId: paymentMethod?.accountId || null,
        paymentMethodName: paymentMethod?.displayName || "",
        spendingTarget: defaultTarget,
        duplicate: duplicate ? {
          transactionId: duplicate.transactionId,
          date: duplicate.date,
          amount: duplicate.amount,
          description: duplicate.description,
          paymentMethod: duplicate.paymentMethod,
          category: duplicate.category
        } : null,
        selected: candidate.kind === "expense" && reasons.length === 0,
        reviewReasons: reasons
      };
    })
  };
}

async function mbD1GetRealEstateData(env) {
  const items = await listRealEstateAssets(env, MB_D1_HOUSEHOLD_ID, false);
  return realEstateSummary(items);
}

async function mbD1SaveRealEstate(body, session, env) {
  let result;
  try {
    result = await saveRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, body, session.name, mbD1Now());
  } catch (error) {
    mbD1Fail(error?.code || "REAL_ESTATE_SAVE_FAILED", error instanceof Error ? error.message : "부동산 자산을 저장하지 못했습니다.");
  }
  const change = await mbD1InsertChange(env, "real_estate", result.item.propertyId, result.created ? "created" : "updated", null, session, {
    name: result.item.name,
    currentValueKrw: result.item.currentValueKrw
  });
  await env.DB.batch([change]);
  return result;
}

async function mbD1DeleteRealEstate(body, session, env) {
  const propertyId = mbD1Text(body.propertyId);
  if (!propertyId) mbD1Fail("REAL_ESTATE_ID_REQUIRED", "부동산 자산 ID가 필요합니다.");
  const result = await deleteRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, propertyId, session.name, mbD1Now());
  const change = await mbD1InsertChange(env, "real_estate", propertyId, "deleted", null, session, {});
  await env.DB.batch([change]);
  return result;
}

async function mbD1RefreshRealEstate(body, session, env) {
  const propertyId = mbD1Text(body.propertyId);
  if (!propertyId) mbD1Fail("REAL_ESTATE_ID_REQUIRED", "부동산 자산 ID가 필요합니다.");
  let item;
  try {
    item = await refreshRealEstateAsset(env, MB_D1_HOUSEHOLD_ID, propertyId, session.name, mbD1Now(), mbD1CurrentDateSeoul());
  } catch (error) {
    mbD1Fail(error?.code || "REAL_ESTATE_REFRESH_FAILED", error instanceof Error ? error.message : "아파트 실거래 시세를 갱신하지 못했습니다.", 400);
  }
  try {
    const change = await mbD1InsertChange(env, "real_estate", propertyId, "updated", null, session, {
      refresh: true,
      estimatedValueKrw: item.estimatedValueKrw,
      tradeCount: item.estimateTradeCount
    });
    await env.DB.batch([change]);
  } catch (error) {
    console.error("real estate refresh change-log failed", propertyId, error);
    mbD1Fail(
      "REAL_ESTATE_CHANGE_LOG_FAILED",
      error instanceof Error
        ? `시세는 갱신됐지만 변경 이력 저장에 실패했습니다: ${error.message}`
        : "시세는 갱신됐지만 변경 이력 저장에 실패했습니다.",
      500
    );
  }
  return { refreshed: true, item };
}

async function mbD1ProductionRoute(request, url, session, env, ctx) {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const getPaths = new Set([
    "/api/bootstrap",
    "/api/dashboard",
    "/api/categories",
    "/api/accounts",
    "/api/settings/ledger-config",
    "/api/settings/automation",
    "/api/benefits/reward-balances",
    "/api/transactions",
    "/api/transactions/settlement-summary",
    "/api/asset-snapshots",
    "/api/investments/accounts",
    "/api/investments/holdings",
    "/api/investments/trades",
    "/api/investments/cash",
    "/api/real-estate",
    "/api/real-estate/regions",
    "/api/backup/export"
  ]);
  const postPaths = new Set([
    "/api/transactions",
    "/api/transactions/update",
    "/api/transactions/delete",
    "/api/transactions/restore",
    "/api/transactions/settle",
    "/api/categories",
    "/api/categories/update",
    "/api/categories/delete",
    "/api/categories/restore",
    "/api/accounts",
    "/api/accounts/update",
    "/api/accounts/delete",
    "/api/accounts/restore",
    "/api/settings/ledger-start-date",
    "/api/settings/ledger-start-date/clear",
    "/api/settings/input-preferences",
    "/api/settings/automation",
    "/api/automations/recurring/process",
    "/api/automations/recurring/create",
    "/api/benefits/preview",
    "/api/asset-snapshots",
    "/api/investments/cash-baseline",
    "/api/investments/holdings/update",
    "/api/investments/trades",
    "/api/investments/trades/update",
    "/api/investments/trades/delete",
    "/api/investments/trades/restore",
    "/api/import/transactions/analyze",
    "/api/real-estate/save",
    "/api/real-estate/delete",
    "/api/real-estate/refresh",
    "/api/backup/preview",
    "/api/backup/restore"
  ]);
  if (request.method === "GET" && !getPaths.has(path)) return null;
  if (request.method === "POST" && !postPaths.has(path)) return null;
  if (!["GET", "POST"].includes(request.method)) return null;
  if (!env.DB) {
    return errorResponse(
      "D1_NOT_BOUND",
      "D1 바인딩 DB가 연결되어 있지 않습니다. Cloudflare Bindings에서 DB를 moneybook-prod에 연결해주세요.",
      500
    );
  }
  try {
    if (request.method === "GET") {
      if (path === "/api/bootstrap") return mbD1Envelope(await mbD1BuildBootstrap(env));
      if (path === "/api/dashboard") {
        const refreshQuotes = url.searchParams.get("refreshQuotes") === "1";

        if (refreshQuotes) {
          await mbD1RefreshQuotes(env, true);
        } else if (ctx?.waitUntil) {
          ctx.waitUntil(mbD1RefreshQuotes(env, false));
        }

        return mbD1Envelope(await mbD1BuildDashboard(env, mbD1Text(url.searchParams.get("month"))));
      }
      if (path === "/api/categories") return mbD1Envelope(await mbD1GetCategoriesData(env, url));
      if (path === "/api/accounts") return mbD1Envelope(await mbD1GetAccountsData(env, url));
      if (path === "/api/settings/ledger-config") return mbD1Envelope(await mbD1GetLedgerConfigData(env));
      if (path === "/api/settings/automation") return mbD1Envelope(await mbD1AutomationSettingsData(env));
      if (path === "/api/benefits/reward-balances") return mbD1Envelope(await mbD1BenefitRewardBalancesData(env));
      if (path === "/api/transactions/settlement-summary") {
        const transactionId = mbD1Text(url.searchParams.get("transactionId"));
        if (!transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "transactionId가 필요합니다.");
        return mbD1Envelope(await mbD1SettlementSummaryData(env, transactionId));
      }
      if (path === "/api/transactions") return mbD1Envelope(await mbD1GetTransactionsData(env, url));
      if (path === "/api/asset-snapshots") return mbD1Envelope(await mbD1GetAssetSnapshotsData(env, url));
      if (path === "/api/investments/accounts") return mbD1Envelope(await mbD1GetInvestmentAccountsData(env));
      if (path === "/api/investments/holdings") {
        if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, false));
        return mbD1Envelope(await mbD1GetHoldingsData(env, url));
      }
      if (path === "/api/investments/trades") return mbD1Envelope(await mbD1GetTradesData(env, url));
      if (path === "/api/investments/cash") return mbD1Envelope(await mbD1GetInvestmentCashData(env, url));
      if (path === "/api/real-estate") return mbD1Envelope(await mbD1GetRealEstateData(env));
      if (path === "/api/real-estate/regions") {
        let items;
        try {
          items = await resolveLegalRegion(env, mbD1Text(url.searchParams.get("q")));
        } catch (error) {
          mbD1Fail(error?.code || "REGION_LOOKUP_FAILED", error instanceof Error ? error.message : "주소의 지역코드를 찾지 못했습니다.", 400);
        }
        return mbD1Envelope({ items });
      }
      if (path === "/api/backup/export") return mbD1Envelope(await mbD1BuildBackupDocument(env));
    }
    if (!isSameOrigin(request)) return errorResponse("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
    const allowEmpty = path === "/api/settings/ledger-start-date/clear";
    const body = await readJsonObject(request, { allowEmptyBody: allowEmpty });
    if (!body) return errorResponse("INVALID_JSON", "요청 형식이 올바르지 않습니다.", 400);
    let data;
    if (path.startsWith("/api/transactions")) data = await mbD1HandleTransactionMutation(path, body, session, env);
    else if (path.startsWith("/api/categories")) data = await mbD1HandleCategoryMutation(path, body, session, env);
    else if (path.startsWith("/api/accounts")) data = await mbD1HandleAccountMutation(path, body, session, env);
    else if (path.startsWith("/api/settings/ledger-start-date")) data = await mbD1HandleLedgerConfig(path, body, session, env);
    else if (path === "/api/settings/input-preferences") data = await mbD1HandleInputPreferences(body, session, env);
    else if (path === "/api/settings/automation") data = await mbD1HandleAutomationSettings(body, session, env);
    else if (path === "/api/automations/recurring/process") data = await mbD1ProcessRecurring(env, session, {});
    else if (path === "/api/automations/recurring/create") data = await mbD1ProcessRecurring(env, session, { ruleId: body.ruleId, month: body.month });
    else if (path === "/api/benefits/preview") data = await mbD1PreviewBenefit(env, body);
    else if (path === "/api/asset-snapshots") data = await mbD1HandleAssetSnapshot(body, session, env);
    else if (path === "/api/investments/cash-baseline") data = await mbD1HandleCashBaseline(body, session, env);
    else if (path === "/api/investments/holdings/update") data = await mbD1HandleHoldingUpdate(body, session, env);
    else if (path.startsWith("/api/investments/trades")) data = await mbD1HandleTradeMutation(path, body, session, env, ctx);
    else if (path === "/api/import/transactions/analyze") data = await mbD1AnalyzeImportedTransactions(body, session, env);
    else if (path === "/api/real-estate/save") data = await mbD1SaveRealEstate(body, session, env);
    else if (path === "/api/real-estate/delete") data = await mbD1DeleteRealEstate(body, session, env);
    else if (path === "/api/real-estate/refresh") data = await mbD1RefreshRealEstate(body, session, env);
    else if (path === "/api/backup/preview") data = await mbD1PreviewBackupRestore(body.backup, env);
    else if (path === "/api/backup/restore") {
      if (body.confirm !== "RESTORE_MERGE") mbD1Fail("BACKUP_RESTORE_CONFIRM_REQUIRED", "복원 확인 문구가 올바르지 않습니다.", 400);
      data = await mbD1RestoreBackupMerge(body.backup, session, env);
    }
    else return null;
    if (ctx?.waitUntil) {
      ctx.waitUntil(mbD1RealtimePoke(env, { path, changedBy: session?.name || null }));
    }
    return mbD1Envelope(data);
  } catch (error) {
    if (error instanceof MbD1Error) {
      return errorResponse(error.code, error.message, error.status || 400);
    }
    if (error instanceof BackupValidationError) {
      return errorResponse(error.code || "BACKUP_INVALID", error.message, 400);
    }
    throw error;
  }
}


export class HouseholdRealtime extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/auth/rate-limit/")
    ) {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid request" }, { status: 400 });
      }

      const key = String(body?.key || "").trim().slice(0, 200);
      if (!key) {
        return Response.json({ error: "missing key" }, { status: 400 });
      }

      const storageKey = `login-rate:${key}`;
      const current = await this.ctx.storage.get(storageKey);
      const now = Date.now();

      if (url.pathname.endsWith("/check")) {
        const status = getLoginRateLimitStatus(current, now);
        if (!status.blocked && current) {
          if (status.record.failures.length > 0) {
            await this.ctx.storage.put(storageKey, status.record);
          } else {
            await this.ctx.storage.delete(storageKey);
          }
        }
        return Response.json({
          blocked: status.blocked,
          retryAfterSeconds: Math.max(0, Math.ceil(status.retryAfterMs / 1000))
        });
      }

      if (url.pathname.endsWith("/failure")) {
        const next = recordLoginFailureState(current, now);
        await this.ctx.storage.put(storageKey, next);
        return Response.json({ ok: true });
      }

      if (url.pathname.endsWith("/success")) {
        await this.ctx.storage.delete(storageKey);
        return Response.json({ ok: true });
      }

      return Response.json({ error: "unknown action" }, { status: 404 });
    }

    if (request.method === "POST" && url.pathname === "/broadcast") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        payload = { type: "ledger.poke" };
      }
      const message = JSON.stringify(payload || { type: "ledger.poke" });
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(message); } catch { }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    if (typeof message === "string" && message === "ping") {
      try { socket.send("pong"); } catch { }
    }
  }

  webSocketClose() {
  }

  webSocketError() {
  }
}

export default {
  async scheduled(
    _controller,
    env,
    ctx
  ) {
    if (!env.DB) {
      console.error("[moneybook cron] D1 binding is missing.");
      return;
    }

    const automationSession = {
      name: "자동화"
    };
    const cronErrors = [];

    try {
      const result = await mbD1ProcessRecurring(
        env,
        automationSession,
        {}
      );

      if (result.created.length > 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(
            mbD1RealtimePoke(env, {
              path: "/cron/automations/recurring",
              changedBy: automationSession.name
            })
          );
        }

        console.log(
          `[moneybook cron] recurring transactions created: ${result.created.length}`
        );
      }
    } catch (error) {
      cronErrors.push(error);
      console.error(
        "[moneybook cron] recurring transaction processing failed",
        error
      );
    }

    try {
      const refreshedHomes = await refreshAllRealEstateAssets(
        env,
        MB_D1_HOUSEHOLD_ID,
        automationSession.name,
        mbD1Now(),
        mbD1CurrentDateSeoul()
      );
      if (refreshedHomes.length > 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(mbD1RealtimePoke(env, {
            path: "/cron/real-estate/refresh",
            changedBy: automationSession.name
          }));
        }
        console.log(`[moneybook cron] real estate refreshed: ${refreshedHomes.length}`);
      }
    } catch (error) {
      cronErrors.push(error);
      console.error(
        "[moneybook cron] real estate refresh failed",
        error
      );
    }

    if (cronErrors.length > 0) {
      throw new AggregateError(cronErrors, "One or more Moneybook cron jobs failed.");
    }
  },

  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(
        request.url
      );

    const origin =
      url.origin;

    const normalizedPath =
      url.pathname.length > 1
        ? url.pathname.replace(/\/+$/, "")
        : url.pathname;

    try {
      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/ping"
      ) {
        return jsonResponse({
          success: true,
          message:
            "Cloudflare Worker is running."
        });
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/health"
      ) {
        return jsonResponse(
          await appsScriptGet(
            env,
            "health",
            {},
            false
          )
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/login"
      ) {
        return handleLogin(
          request,
          env,
          ctx,
          origin
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/auth/session"
      ) {
        return handleSession(
          request,
          env,
          ctx,
          origin
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/logout"
      ) {
        if (
          !isSameOrigin(
            request
          )
        ) {
          return errorResponse(
            "INVALID_ORIGIN",
            "허용되지 않은 요청입니다.",
            403
          );
        }

        return jsonResponse(
          {
            success: true,
            loggedIn: false
          },
          200,
          {
            "Set-Cookie":
              clearCookie()
          }
        );
      }

      if (
        (normalizedPath === "/api/admin/migrate-d1" ||
          normalizedPath === "/api/admin/verify-d1") &&
        !mbD1AdminToolsEnabled(env)
      ) {
        return errorResponse(
          "NOT_FOUND",
          "페이지를 찾을 수 없습니다.",
          404
        );
      }

      if (
        request.method ===
          "GET" &&
        normalizedPath ===
          "/api/admin/migrate-d1"
      ) {
        const adminSession =
          await getSession(
            request,
            env
          );

        if (!adminSession) {
          return unauthorized();
        }

        return new Response(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>가계부 D1 이전</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#202124}button{font:inherit;padding:12px 18px;border:0;border-radius:10px;background:#146ef5;color:white;font-weight:700;cursor:pointer}button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;background:#f6f7f9;border-radius:12px;padding:16px;min-height:180px}.ok{color:#137333}.bad{color:#b3261e}</style>
</head>
<body>
<h1>D1 데이터 이전</h1>
<p>기존 Google Sheets는 변경하지 않고 D1로 복사합니다. 완료 후 검증 결과가 모두 일치해야 합니다.</p>
<form method="post" action="/api/admin/migrate-d1?mode=chain&confirm=yes&kind=setup&offset=0">
<button type="submit">이전 시작</button>
</form>
<pre>버튼을 누르면 브라우저가 자동으로 이전 단계를 이어서 처리합니다. 완료될 때까지 이 탭을 닫지 마세요.</pre>
</body>
</html>`, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (
        request.method ===
          "GET" &&
        normalizedPath ===
          "/api/admin/verify-d1"
      ) {
        const adminSession =
          await getSession(
            request,
            env
          );

        if (!adminSession) {
          return unauthorized();
        }

        return new Response(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>가계부 D1 최종 이전 및 전체 검증</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.65;color:#202124}button{font:inherit;padding:13px 20px;border:0;border-radius:10px;background:#146ef5;color:white;font-weight:700;cursor:pointer}.box{background:#f6f7f9;border-radius:12px;padding:18px;margin:18px 0}.note{color:#5f6368}</style>
</head>
<body>
<h1>D1 최종 이전 + 전체 검증</h1>
<p>현재 Google Sheets의 최신 내용을 D1에 한 번 더 덮어쓴 뒤, 전환 전에 필요한 검증을 한꺼번에 수행합니다.</p>
<div class="box">스키마·인덱스·DB 무결성·구성원·입력설정·카테고리·계좌·거래 전체 필드·삭제건·중복 요청ID·월별 수입/지출·환불/취소·카드 청구월·계좌 잔액·보유종목·투자거래·자산스냅샷·참조 연결을 한 번에 확인합니다.</div>
<form method="post" action="/api/admin/migrate-d1?mode=chain&confirm=yes&kind=setup&offset=0&final=yes">
<button type="submit">최종 이전 및 전체 검증 시작</button>
</form>
<p class="note">기존 Google Sheets는 읽기만 하며 수정하지 않습니다. 실행 중에는 가계부 입력을 잠시 하지 않는 것이 좋습니다.</p>
</body>
</html>`, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (
        !url.pathname.startsWith(
          "/api/"
        )
      ) {
        return errorResponse(
          "NOT_FOUND",
          "페이지를 찾을 수 없습니다.",
          404
        );
      }

      const session =
        await getSession(
          request,
          env
        );

      if (
        !session
      ) {
        return unauthorized();
      }

      if (
        request.method === "GET" &&
        normalizedPath === "/api/changes"
      ) {
        if (!env.DB) {
          return errorResponse("D1_NOT_BOUND", "D1 바인딩 DB를 찾을 수 없습니다.", 500);
        }
        return mbD1Envelope(await mbD1GetChangesData(env, url));
      }

      if (
        request.method === "GET" &&
        normalizedPath === "/api/realtime"
      ) {
        if (request.headers.get("Upgrade") !== "websocket") {
          return errorResponse("WEBSOCKET_REQUIRED", "WebSocket 연결이 필요합니다.", 426);
        }
        if (!env.HOUSEHOLD_REALTIME) {
          return errorResponse("REALTIME_BINDING_UNAVAILABLE", "실시간 WebSocket 바인딩이 아직 활성화되지 않았습니다.", 503);
        }
        const stub = await getHouseholdRealtimeStub(env);
        return stub.fetch(request);
      }

      if (
        normalizedPath ===
          "/api/admin/verify-d1"
      ) {
        if (!env.DB) {
          return errorResponse(
            "D1_NOT_BOUND",
            "D1 바인딩 DB를 찾을 수 없습니다.",
            500
          );
        }

        if (
          request.method !== "POST" ||
          url.searchParams.get("confirm") !== "yes"
        ) {
          return errorResponse(
            "INVALID_VERIFY_REQUEST",
            "올바른 검증 요청이 아닙니다.",
            400
          );
        }

        if (!isSameOrigin(request)) {
          return errorResponse(
            "INVALID_ORIGIN",
            "허용되지 않은 요청입니다.",
            403
          );
        }

        const auditUnwrap = (result, label) => {
          if (!result || result.success !== true) {
            throw new Error(result?.error?.message || `${label} 데이터를 읽지 못했습니다.`);
          }
          return result.data;
        };

        const auditText = (value) => String(value ?? "").trim();
        const auditNumber = (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? n : 0;
        };
        const auditNullableNumberEqual = (a, b, tolerance = 0.005) => {
          const aBlank = a === null || a === undefined || a === "";
          const bBlank = b === null || b === undefined || b === "";
          if (aBlank && bBlank) return true;
          if (aBlank !== bBlank) return false;
          return Math.abs(auditNumber(a) - auditNumber(b)) < tolerance;
        };
        const auditNumberEqual = (a, b, tolerance = 0.005) => Math.abs(auditNumber(a) - auditNumber(b)) < tolerance;
        const auditBool = (value) => value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
        const auditDeleted = (row) => !!auditText(row?.deleted_at);
        const auditSourceDeleted = (row) => !!row?.isDeleted;
        const auditRound = (value) => Math.round((auditNumber(value) + Number.EPSILON) * 100) / 100;
        const auditMonth = (date) => /^\d{4}-\d{2}/.test(auditText(date)) ? auditText(date).slice(0, 7) : "";
        const auditMemberId = (name) => {
          const clean = auditText(name);
          if (!clean || clean === "공동") return null;
          const bytes = encoder.encode(clean);
          return "MEM_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        };
        const auditStableJson = (value) => {
          if (Array.isArray(value)) return value.map(auditStableJson);
          if (value && typeof value === "object") {
            return Object.fromEntries(Object.keys(value).sort().map((key) => [key, auditStableJson(value[key])]));
          }
          return value;
        };
        const auditJsonEqual = (a, b) => JSON.stringify(auditStableJson(a)) === JSON.stringify(auditStableJson(b));

        const issues = [];
        const warnings = [];
        const details = {};
        const pushIssue = (group, message) => {
          if (issues.length < 200) issues.push({ group, message });
        };
        const pushWarning = (group, message) => {
          if (warnings.length < 100) warnings.push({ group, message });
        };

        const auditLoadAllTransactions = async () => {
          const out = [];
          let offset = 0;
          const limit = 1000;
          let total = 0;
          do {
            const data = auditUnwrap(
              await appsScriptGet(env, "transactions", { includeDeleted: 1, limit, offset }),
              "거래"
            );
            const items = Array.isArray(data?.items) ? data.items : [];
            total = auditNumber(data?.total) || items.length;
            out.push(...items);
            offset += items.length;
            if (!items.length) break;
          } while (offset < total);
          return out;
        };

        const sourceMembersData = auditUnwrap(await appsScriptGet(env, "members", {}), "구성원");
        const sourceLedgerConfig = auditUnwrap(await appsScriptGet(env, "ledgerConfig", {}), "가계부 설정");
        const sourceInputPreferences = auditUnwrap(await appsScriptGet(env, "inputPreferences", {}), "입력 설정");
        const sourceCategoriesData = auditUnwrap(await appsScriptGet(env, "categories", { includeDeleted: 1 }), "카테고리");
        const sourceAccountsData = auditUnwrap(await appsScriptGet(env, "accounts", { includeDeleted: 1 }), "계좌");
        const sourceHoldingsData = auditUnwrap(await appsScriptGet(env, "holdings", { includeDeleted: 1 }), "보유종목");
        const sourceTradesData = auditUnwrap(await appsScriptGet(env, "investmentTrades", { includeDeleted: 1 }), "투자거래");
        const sourceSnapshotsData = auditUnwrap(await appsScriptGet(env, "assetSnapshots", { limit: 120 }), "자산스냅샷");
        const sourceTransactions = await auditLoadAllTransactions();
        const sourceDashboard = auditUnwrap(await appsScriptGet(env, "dashboard", {}), "대시보드");

        const sourceMembers = Array.from(new Set((sourceMembersData?.members || []).map(auditText).filter(Boolean))).sort((a,b) => a.localeCompare(b, "ko"));
        const sourceCategories = Array.isArray(sourceCategoriesData?.items) ? sourceCategoriesData.items : [];
        const sourceAccounts = Array.isArray(sourceAccountsData?.items) ? sourceAccountsData.items : [];
        const sourceHoldings = Array.isArray(sourceHoldingsData?.items) ? sourceHoldingsData.items : [];
        const sourceTrades = Array.isArray(sourceTradesData?.items) ? sourceTradesData.items : [];
        const sourceSnapshots = Array.isArray(sourceSnapshotsData?.items) ? sourceSnapshotsData.items : [];

        const tableRows = await env.DB.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
        const indexRows = await env.DB.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name").all();
        const tables = new Set((tableRows.results || []).map((row) => row.name));
        const indexes = new Set((indexRows.results || []).map((row) => row.name));
        const requiredTables = [
          "schema_meta","households","members","categories","accounts","transactions","change_log","user_preferences","holdings","investment_trades","asset_snapshots","tax_categories","tax_rule_sets","tax_year_profiles"
        ];
        const requiredIndexes = [
          "idx_members_household","idx_categories_household_type","idx_accounts_household","idx_accounts_owner","idx_transactions_household_date","idx_transactions_type_date","idx_transactions_category_date","idx_transactions_payment_billing","idx_transactions_from_account","idx_transactions_to_account","idx_transactions_request","idx_transactions_group","idx_transactions_reversal","idx_change_log_household_seq","idx_preferences_household_member","idx_holdings_account","idx_holdings_stock","idx_investment_trades_account_date","idx_investment_trades_holding_date","idx_investment_trades_request","idx_asset_snapshots_month","idx_tax_profiles_year"
        ];
        const missingTables = requiredTables.filter((name) => !tables.has(name));
        const missingIndexes = requiredIndexes.filter((name) => !indexes.has(name));
        missingTables.forEach((name) => pushIssue("스키마", `필수 테이블 없음: ${name}`));
        missingIndexes.forEach((name) => pushIssue("스키마", `필수 인덱스 없음: ${name}`));

        const criticalColumns = {
          households:["household_id","name","timezone","currency","ledger_start_date"],
          members:["member_id","household_id","display_name","is_active","deleted_at"],
          categories:["category_id","household_id","type","name","is_active","default_tax_category_code","deleted_at"],
          accounts:["account_id","household_id","name","display_name","account_type","sub_type","owner_member_id","owner_label","opening_balance","billing_cutoff_day","payment_day","payment_account_id","balance_method","asset_attribution","investment_cash_baseline_krw","investment_cash_baseline_at","deleted_at"],
          transactions:["transaction_id","household_id","request_id","date","type","category_id","amount","from_account_id","to_account_id","payment_method_id","spending_target","spender_member_id","entered_by_member_id","description","memo","billing_month_override","billing_month","group_id","reversal_of","version","taxpayer_member_id","tax_category_code","deleted_at"],
          holdings:["holding_id","household_id","account_id","stock_code","quantity","avg_buy_price","book_cost_krw","baseline_quantity","baseline_avg_price","baseline_book_cost_krw","managed_by_trades","deleted_at"],
          investment_trades:["investment_trade_id","household_id","request_id","trade_date","trade_type","account_id","holding_id","quantity","unit_price","fee_krw","tax_krw","settlement_krw","realized_pnl_krw","deleted_at"],
          asset_snapshots:["household_id","month","assets","liabilities","net_worth","investment_value","cash_like_value"],
          user_preferences:["preference_id","household_id","member_id","preference_key","preference_json","version"]
        };
        for (const [table, expected] of Object.entries(criticalColumns)) {
          if (!tables.has(table)) continue;
          try {
            const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
            const found = new Set((info.results || []).map((row) => row.name));
            expected.filter((name) => !found.has(name)).forEach((name) => pushIssue("스키마", `${table}.${name} 컬럼 없음`));
          } catch (error) {
            pushIssue("스키마", `${table} 컬럼 검사 실패: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const integrityCheck = await env.DB.prepare("PRAGMA integrity_check").all();
          const values = (integrityCheck.results || []).flatMap((row) => Object.values(row)).map(auditText).filter(Boolean);
          details.sqliteIntegrity = values;
          if (!values.length || values.some((value) => value.toLowerCase() !== "ok")) pushIssue("DB 무결성", `SQLite integrity_check: ${values.join(", ") || "결과 없음"}`);
        } catch (error) {
          pushWarning("DB 무결성", `integrity_check 실행 불가: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          const foreignCheck = await env.DB.prepare("PRAGMA foreign_key_check").all();
          details.foreignKeyCheckCount = (foreignCheck.results || []).length;
          if ((foreignCheck.results || []).length) pushIssue("DB 무결성", `foreign_key_check 오류 ${(foreignCheck.results || []).length}건`);
        } catch (error) {
          pushWarning("DB 무결성", `foreign_key_check 실행 불가: ${error instanceof Error ? error.message : String(error)}`);
        }

        const household = await env.DB.prepare("SELECT * FROM households WHERE household_id=?").bind("HH_MAIN").first();
        if (!household) {
          pushIssue("가구 설정", "HH_MAIN 가구 정보가 없습니다.");
        } else {
          if (auditText(household.timezone) !== "Asia/Seoul") pushIssue("가구 설정", `timezone 불일치: ${auditText(household.timezone)}`);
          if (auditText(household.currency) !== "KRW") pushIssue("가구 설정", `currency 불일치: ${auditText(household.currency)}`);
          if (auditText(household.ledger_start_date) !== auditText(sourceLedgerConfig?.ledgerStartDate)) pushIssue("가구 설정", `가계부 시작일 불일치: Sheets=${auditText(sourceLedgerConfig?.ledgerStartDate)} / D1=${auditText(household.ledger_start_date)}`);
        }

        const schemaVersion = await env.DB.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").first();
        if (!schemaVersion || auditNumber(schemaVersion.value) < 2) pushIssue("스키마", `schema_version이 2 이상이 아닙니다: ${auditText(schemaVersion?.value) || "없음"}`);

        const d1Members = await env.DB.prepare("SELECT member_id,display_name,is_active,deleted_at FROM members WHERE household_id=? ORDER BY display_name").bind("HH_MAIN").all();
        const targetMembers = (d1Members.results || []).filter((row) => !auditDeleted(row)).map((row) => auditText(row.display_name)).sort((a,b) => a.localeCompare(b,"ko"));
        if (!auditJsonEqual(sourceMembers, targetMembers)) pushIssue("구성원", `구성원 목록 불일치: Sheets=${JSON.stringify(sourceMembers)} / D1=${JSON.stringify(targetMembers)}`);
        for (const row of d1Members.results || []) {
          const expectedId = auditMemberId(row.display_name);
          if (expectedId && auditText(row.member_id) !== expectedId) pushIssue("구성원", `${row.display_name} member_id 불일치`);
          if (!auditDeleted(row) && !auditBool(row.is_active)) pushIssue("구성원", `${row.display_name}이 비활성 상태입니다.`);
        }

        const prefRow = await env.DB.prepare("SELECT preference_json,version FROM user_preferences WHERE household_id=? AND preference_key='input_preferences' ORDER BY updated_at DESC LIMIT 1").bind("HH_MAIN").first();
        if (sourceInputPreferences?.preferences) {
          if (!prefRow) pushIssue("입력 설정", "D1에 input_preferences가 없습니다.");
          else {
            let parsed = null;
            try { parsed = JSON.parse(prefRow.preference_json || "null"); } catch (error) { pushIssue("입력 설정", "D1 preference_json이 JSON 형식이 아닙니다."); }
            if (parsed !== null && !auditJsonEqual(sourceInputPreferences.preferences, parsed)) pushIssue("입력 설정", "Sheets와 D1 입력 설정 내용이 다릅니다.");
            if (auditNumber(prefRow.version) !== auditNumber(sourceInputPreferences.version || 1)) pushIssue("입력 설정", `버전 불일치: Sheets=${sourceInputPreferences.version || 1} / D1=${prefRow.version}`);
          }
        } else if (prefRow) {
          pushWarning("입력 설정", "Sheets에는 입력 설정이 없지만 D1에는 기존 입력 설정이 있습니다.");
        }

        const d1Categories = await env.DB.prepare("SELECT category_id,household_id,type,name,is_active,deleted_at,source_row FROM categories WHERE household_id=? ORDER BY category_id").bind("HH_MAIN").all();
        const d1Accounts = await env.DB.prepare("SELECT account_id,household_id,name,display_name,account_type,sub_type,owner_member_id,owner_label,opening_balance,billing_cutoff_day,payment_day,payment_account_id,start_year,end_year,is_active,balance_method,asset_attribution,investment_cash_baseline_krw,investment_cash_baseline_at,deleted_at,source_row FROM accounts WHERE household_id=? ORDER BY account_id").bind("HH_MAIN").all();
        const d1Transactions = await env.DB.prepare("SELECT transaction_id,household_id,request_id,date,type,category_id,amount,from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,version,taxpayer_member_id,tax_category_code,created_by,updated_by,deleted_at,deleted_by,source_row FROM transactions WHERE household_id=? ORDER BY transaction_id").bind("HH_MAIN").all();
        const d1Holdings = await env.DB.prepare("SELECT holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,deleted_at,source_row FROM holdings WHERE household_id=? ORDER BY holding_id").bind("HH_MAIN").all();
        const d1Trades = await env.DB.prepare("SELECT investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_by,updated_by,deleted_at,deleted_by,source_row FROM investment_trades WHERE household_id=? ORDER BY investment_trade_id").bind("HH_MAIN").all();
        const d1Snapshots = await env.DB.prepare("SELECT household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value FROM asset_snapshots WHERE household_id=? ORDER BY month").bind("HH_MAIN").all();

        const compareMapIds = (group, sourceItems, targetItems, sourceIdKey, targetIdKey) => {
          const sIds = new Set(sourceItems.map((x) => auditText(x?.[sourceIdKey])).filter(Boolean));
          const tIds = new Set(targetItems.map((x) => auditText(x?.[targetIdKey])).filter(Boolean));
          for (const id of sIds) if (!tIds.has(id)) pushIssue(group, `D1에 없음: ${id}`);
          for (const id of tIds) if (!sIds.has(id)) pushIssue(group, `Sheets에 없는 D1 추가 데이터: ${id}`);
          return { source:sIds.size, d1:tIds.size };
        };

        const targetCategories = d1Categories.results || [];
        const targetAccounts = d1Accounts.results || [];
        const targetTransactions = d1Transactions.results || [];
        const targetHoldings = d1Holdings.results || [];
        const targetTrades = d1Trades.results || [];
        const targetSnapshots = d1Snapshots.results || [];

        details.counts = {
          members:{sheets:sourceMembers.length,d1:targetMembers.length},
          categories:compareMapIds("카테고리",sourceCategories,targetCategories,"categoryId","category_id"),
          accounts:compareMapIds("계좌",sourceAccounts,targetAccounts,"accountId","account_id"),
          transactions:compareMapIds("거래",sourceTransactions,targetTransactions,"transactionId","transaction_id"),
          holdings:compareMapIds("보유종목",sourceHoldings,targetHoldings,"holdingId","holding_id"),
          investmentTrades:compareMapIds("투자거래",sourceTrades,targetTrades,"investmentTradeId","investment_trade_id"),
          assetSnapshots:compareMapIds("자산스냅샷",sourceSnapshots,targetSnapshots,"month","month")
        };

        const sourceCategoryMap = new Map(sourceCategories.map((x) => [auditText(x.categoryId), x]));
        const targetCategoryMap = new Map(targetCategories.map((x) => [auditText(x.category_id), x]));
        for (const [id, src] of sourceCategoryMap) {
          const dst = targetCategoryMap.get(id);
          if (!dst) continue;
          if (auditText(src.type) !== auditText(dst.type)) pushIssue("카테고리", `${id} 유형 불일치`);
          if (auditText(src.name) !== auditText(dst.name)) pushIssue("카테고리", `${id} 이름 불일치`);
          if (!!src.active !== auditBool(dst.is_active)) pushIssue("카테고리", `${id} 사용여부 불일치`);
          if (auditSourceDeleted(src) !== auditDeleted(dst)) pushIssue("카테고리", `${id} 삭제여부 불일치`);
          if (src.row && auditNumber(src.row) !== auditNumber(dst.source_row)) pushIssue("카테고리", `${id} 원본 행번호 불일치`);
        }

        const sourceAccountMap = new Map(sourceAccounts.map((x) => [auditText(x.accountId), x]));
        const targetAccountMap = new Map(targetAccounts.map((x) => [auditText(x.account_id), x]));
        for (const [id, src] of sourceAccountMap) {
          const dst = targetAccountMap.get(id);
          if (!dst) continue;
          const textChecks = [
            ["계좌명",src.accountName,dst.name],["표시명",src.displayName,dst.display_name],["계좌유형",src.accountType,dst.account_type],["세부구분",src.subType,dst.sub_type],["명의자",src.owner,dst.owner_label],["결제계좌",src.paymentAccountId,dst.payment_account_id],["잔액계산방식",src.balanceMethod,dst.balance_method],["자산귀속",src.assetAttribution,dst.asset_attribution],["투자기준시각",src.cashBaselineAt,dst.investment_cash_baseline_at]
          ];
          for (const [label,a,b] of textChecks) if (auditText(a) !== auditText(b)) pushIssue("계좌", `${id} ${label} 불일치: Sheets=${auditText(a)} / D1=${auditText(b)}`);
          const numChecks = [["시작잔액",src.openingBalance,dst.opening_balance,false],["청구마감일",src.billingCutoffDay,dst.billing_cutoff_day,true],["결제일",src.paymentDay,dst.payment_day,true],["사용시작연도",src.startYear,dst.start_year,true],["사용종료연도",src.endYear,dst.end_year,true],["투자예수금기준",src.cashBaselineKrw,dst.investment_cash_baseline_krw,true]];
          for (const [label,a,b,nullable] of numChecks) if (!(nullable ? auditNullableNumberEqual(a,b) : auditNumberEqual(a,b))) pushIssue("계좌", `${id} ${label} 불일치: Sheets=${a ?? ""} / D1=${b ?? ""}`);
          if (!!src.active !== auditBool(dst.is_active)) pushIssue("계좌", `${id} 사용여부 불일치`);
          if (auditSourceDeleted(src) !== auditDeleted(dst)) pushIssue("계좌", `${id} 삭제여부 불일치`);
          const expectedOwnerId = sourceMembers.includes(auditText(src.owner)) ? auditMemberId(src.owner) : null;
          if (auditText(expectedOwnerId) !== auditText(dst.owner_member_id)) pushIssue("계좌", `${id} 명의자 member_id 연결 불일치`);
          if (src.row && auditNumber(src.row) !== auditNumber(dst.source_row)) pushIssue("계좌", `${id} 원본 행번호 불일치`);
        }

        const sourceTxMap = new Map(sourceTransactions.map((x) => [auditText(x.transactionId), x]));
        const targetTxMap = new Map(targetTransactions.map((x) => [auditText(x.transaction_id), x]));
        for (const [id, src] of sourceTxMap) {
          const dst = targetTxMap.get(id);
          if (!dst) continue;
          const textChecks = [
            ["requestId",src.requestId,dst.request_id],["날짜",src.date,dst.date],["유형",src.type,dst.type],["카테고리",src.categoryId,dst.category_id],["출금계좌",src.fromAccountId,dst.from_account_id],["입금계좌",src.toAccountId,dst.to_account_id],["결제수단",src.paymentMethodId,dst.payment_method_id],["지출대상",src.spendingTarget,dst.spending_target],["설명",src.description,dst.description],["메모",src.memo,dst.memo],["청구월수정",src.billingOverride,dst.billing_month_override],["청구월",src.billingMonth,dst.billing_month],["그룹",src.groupId,dst.group_id],["취소원거래",src.reversalOf,dst.reversal_of],["작성자",src.createdBy,dst.created_by],["수정자",src.updatedBy,dst.updated_by],["삭제자",src.deletedBy,dst.deleted_by]
          ];
          for (const [label,a,b] of textChecks) if (auditText(a) !== auditText(b)) pushIssue("거래", `${id} ${label} 불일치: Sheets=${auditText(a)} / D1=${auditText(b)}`);
          if (!auditNumberEqual(src.amount,dst.amount)) pushIssue("거래", `${id} 금액 불일치: Sheets=${src.amount} / D1=${dst.amount}`);
          if (auditSourceDeleted(src) !== auditDeleted(dst)) pushIssue("거래", `${id} 삭제여부 불일치`);
          if (src.row && auditNumber(src.row) !== auditNumber(dst.source_row)) pushIssue("거래", `${id} 원본 행번호 불일치`);
          const expectedSpender = auditMemberId(src.spendingTarget);
          const expectedEntered = sourceMembers.includes(auditText(src.createdBy)) ? auditMemberId(src.createdBy) : null;
          if (auditText(expectedSpender) !== auditText(dst.spender_member_id)) pushIssue("거래", `${id} 소비자 member_id 연결 불일치`);
          if (auditText(expectedEntered) !== auditText(dst.entered_by_member_id)) pushIssue("거래", `${id} 입력자 member_id 연결 불일치`);
          if (auditNumber(dst.version) < 1) pushIssue("거래", `${id} version 값 오류`);
        }

        const sourceHoldingMap = new Map(sourceHoldings.map((x) => [auditText(x.holdingId), x]));
        const targetHoldingMap = new Map(targetHoldings.map((x) => [auditText(x.holding_id), x]));
        for (const [id, src] of sourceHoldingMap) {
          const dst = targetHoldingMap.get(id);
          if (!dst) continue;
          const textChecks = [["계좌",src.accountId,dst.account_id],["종목코드",src.stockCode,dst.stock_code],["종목명",src.stockName,dst.stock_name],["시장",src.market,dst.market],["시세방식",src.quoteMode,dst.quote_mode],["명의자",src.owner,dst.owner_label],["최종수정일",src.lastUpdated,dst.last_updated],["기준시각",src.baselineAt,dst.baseline_at]];
          for (const [label,a,b] of textChecks) if (auditText(a) !== auditText(b)) pushIssue("보유종목", `${id} ${label} 불일치`);
          const numChecks = [["수량",src.quantity,dst.quantity],["평단",src.avgBuyPrice,dst.avg_buy_price],["수동가",src.manualPrice,dst.manual_price,true],["장부가",src.bookCostKrw ?? src.costKrw,dst.book_cost_krw,true],["기준수량",src.baselineQuantity,dst.baseline_quantity],["기준평단",src.baselineAvgPrice,dst.baseline_avg_price],["기준장부가",src.baselineBookCostKrw,dst.baseline_book_cost_krw]];
          for (const [label,a,b,nullable] of numChecks) if (!(nullable ? auditNullableNumberEqual(a,b) : auditNumberEqual(a,b))) pushIssue("보유종목", `${id} ${label} 불일치: Sheets=${a ?? ""} / D1=${b ?? ""}`);
          if (!!src.managedByTradesV22 !== auditBool(dst.managed_by_trades)) pushIssue("보유종목", `${id} 거래관리여부 불일치`);
          if (auditSourceDeleted(src) !== auditDeleted(dst)) pushIssue("보유종목", `${id} 삭제여부 불일치`);
          if (src.row && auditNumber(src.row) !== auditNumber(dst.source_row)) pushIssue("보유종목", `${id} 원본 행번호 불일치`);
          const volatileChecks = [["현재가",src.currentPrice,dst.current_price],["환율",src.fx,dst.fx_rate],["평가금액",src.valueKrw,dst.value_krw],["수익률",src.returnRate,dst.return_rate]];
          for (const [label,a,b] of volatileChecks) if (!auditNullableNumberEqual(a,b,0.05)) pushWarning("보유종목 시세", `${id} ${label} 차이: 검증 시점의 GOOGLEFINANCE 변동 가능`);
        }

        const sourceTradeMap = new Map(sourceTrades.map((x) => [auditText(x.investmentTradeId), x]));
        const targetTradeMap = new Map(targetTrades.map((x) => [auditText(x.investment_trade_id), x]));
        for (const [id, src] of sourceTradeMap) {
          const dst = targetTradeMap.get(id);
          if (!dst) continue;
          const textChecks = [["requestId",src.requestId,dst.request_id],["거래일",src.tradeDate,dst.trade_date],["구분",src.tradeType,dst.trade_type],["계좌",src.accountId,dst.account_id],["보유종목",src.holdingId,dst.holding_id],["종목코드",src.stockCode,dst.stock_code],["종목명",src.stockName,dst.stock_name],["시장",src.market,dst.market],["통화",src.currency,dst.currency],["메모",src.memo,dst.memo],["작성자",src.createdBy,dst.created_by],["수정자",src.updatedBy,dst.updated_by],["삭제자",src.deletedBy,dst.deleted_by]];
          for (const [label,a,b] of textChecks) if (auditText(a) !== auditText(b)) pushIssue("투자거래", `${id} ${label} 불일치`);
          const numChecks = [["수량",src.quantity,dst.quantity],["체결단가",src.unitPrice,dst.unit_price],["체결환율",src.fxRate,dst.fx_rate],["수수료",src.feeKrw,dst.fee_krw],["세금",src.taxKrw,dst.tax_krw],["원화결제금액",src.settlementKrw,dst.settlement_krw],["실현손익",src.realizedPnlKrw,dst.realized_pnl_krw]];
          for (const [label,a,b] of numChecks) if (!auditNumberEqual(a,b)) pushIssue("투자거래", `${id} ${label} 불일치: Sheets=${a} / D1=${b}`);
          if (auditSourceDeleted(src) !== auditDeleted(dst)) pushIssue("투자거래", `${id} 삭제여부 불일치`);
          if (src.row && auditNumber(src.row) !== auditNumber(dst.source_row)) pushIssue("투자거래", `${id} 원본 행번호 불일치`);
        }

        const targetSnapshotMap = new Map(targetSnapshots.map((x) => [auditText(x.month),x]));
        for (const src of sourceSnapshots) {
          const month = auditText(src.month);
          const dst = targetSnapshotMap.get(month);
          if (!dst) continue;
          const checks = [["자산",src.assets,dst.assets],["부채",src.liabilities,dst.liabilities],["순자산",src.netWorth,dst.net_worth],["투자자산",src.investmentValue,dst.investment_value],["현금성자산",src.cashLikeValue,dst.cash_like_value]];
          for (const [label,a,b] of checks) if (!auditNumberEqual(a,b)) pushIssue("자산스냅샷", `${month} ${label} 불일치: Sheets=${a} / D1=${b}`);
        }

        const sourceReqIds = new Map();
        for (const tx of sourceTransactions) {
          const rid = auditText(tx.requestId);
          if (rid) sourceReqIds.set(rid,(sourceReqIds.get(rid)||0)+1);
        }
        for (const [rid,count] of sourceReqIds) if (count > 1) pushIssue("중복", `Sheets 거래 requestId 중복 ${rid}: ${count}건`);
        const txDuplicateRequests = await env.DB.prepare("SELECT request_id,COUNT(*) AS cnt FROM transactions WHERE household_id=? AND request_id IS NOT NULL GROUP BY request_id HAVING COUNT(*)>1 LIMIT 50").bind("HH_MAIN").all();
        for (const row of txDuplicateRequests.results || []) pushIssue("중복", `D1 거래 requestId 중복 ${row.request_id}: ${row.cnt}건`);
        const tradeDuplicateRequests = await env.DB.prepare("SELECT request_id,COUNT(*) AS cnt FROM investment_trades WHERE household_id=? AND request_id IS NOT NULL GROUP BY request_id HAVING COUNT(*)>1 LIMIT 50").bind("HH_MAIN").all();
        for (const row of tradeDuplicateRequests.results || []) pushIssue("중복", `D1 투자거래 requestId 중복 ${row.request_id}: ${row.cnt}건`);

        const orphanRow = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM accounts a LEFT JOIN members m ON m.member_id=a.owner_member_id WHERE a.household_id=? AND a.owner_member_id IS NOT NULL AND m.member_id IS NULL) AS accountOwner,(SELECT COUNT(*) FROM accounts a LEFT JOIN accounts p ON p.account_id=a.payment_account_id WHERE a.household_id=? AND a.payment_account_id IS NOT NULL AND p.account_id IS NULL) AS paymentAccount,(SELECT COUNT(*) FROM transactions t LEFT JOIN categories c ON c.category_id=t.category_id WHERE t.household_id=? AND t.category_id IS NOT NULL AND c.category_id IS NULL) AS txCategory,(SELECT COUNT(*) FROM transactions t LEFT JOIN accounts a ON a.account_id=t.from_account_id WHERE t.household_id=? AND t.from_account_id IS NOT NULL AND a.account_id IS NULL) AS txFrom,(SELECT COUNT(*) FROM transactions t LEFT JOIN accounts a ON a.account_id=t.to_account_id WHERE t.household_id=? AND t.to_account_id IS NOT NULL AND a.account_id IS NULL) AS txTo,(SELECT COUNT(*) FROM transactions t LEFT JOIN accounts a ON a.account_id=t.payment_method_id WHERE t.household_id=? AND t.payment_method_id IS NOT NULL AND a.account_id IS NULL) AS txPayment,(SELECT COUNT(*) FROM transactions t LEFT JOIN transactions o ON o.transaction_id=t.reversal_of WHERE t.household_id=? AND t.reversal_of IS NOT NULL AND o.transaction_id IS NULL) AS txReversal,(SELECT COUNT(*) FROM transactions t LEFT JOIN members m ON m.member_id=t.spender_member_id WHERE t.household_id=? AND t.spender_member_id IS NOT NULL AND m.member_id IS NULL) AS txSpender,(SELECT COUNT(*) FROM transactions t LEFT JOIN members m ON m.member_id=t.entered_by_member_id WHERE t.household_id=? AND t.entered_by_member_id IS NOT NULL AND m.member_id IS NULL) AS txEntered,(SELECT COUNT(*) FROM holdings h LEFT JOIN accounts a ON a.account_id=h.account_id WHERE h.household_id=? AND a.account_id IS NULL) AS holdingAccount,(SELECT COUNT(*) FROM investment_trades i LEFT JOIN accounts a ON a.account_id=i.account_id WHERE i.household_id=? AND a.account_id IS NULL) AS tradeAccount,(SELECT COUNT(*) FROM investment_trades i LEFT JOIN holdings h ON h.holding_id=i.holding_id WHERE i.household_id=? AND h.holding_id IS NULL) AS tradeHolding").bind("HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN").first();
        details.orphans = Object.fromEntries(Object.entries(orphanRow || {}).map(([key,value]) => [key,auditNumber(value)]));
        for (const [key,value] of Object.entries(details.orphans)) if (value !== 0) pushIssue("참조 연결", `${key}: ${value}건`);

        const quality = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM transactions WHERE household_id=? AND (date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR amount<0 OR version<1)) AS invalidTransactions,(SELECT COUNT(*) FROM transactions WHERE household_id=? AND billing_month IS NOT NULL AND billing_month<>'' AND billing_month NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]') AS invalidBillingMonth,(SELECT COUNT(*) FROM asset_snapshots WHERE household_id=? AND month NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]') AS invalidSnapshotMonth,(SELECT COUNT(*) FROM members WHERE household_id=? AND TRIM(display_name)='') AS blankMembers,(SELECT COUNT(*) FROM categories WHERE household_id=? AND (TRIM(name)='' OR TRIM(type)='')) AS blankCategories,(SELECT COUNT(*) FROM accounts WHERE household_id=? AND TRIM(name)='') AS blankAccounts").bind("HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN").first();
        details.dataQuality = Object.fromEntries(Object.entries(quality || {}).map(([key,value]) => [key,auditNumber(value)]));
        for (const [key,value] of Object.entries(details.dataQuality)) if (value !== 0) pushIssue("데이터 형식", `${key}: ${value}건`);

        const toSourceLikeTargetTx = (row) => ({
          transactionId:auditText(row.transaction_id),date:auditText(row.date),type:auditText(row.type),categoryId:auditText(row.category_id)||null,amount:auditNumber(row.amount),fromAccountId:auditText(row.from_account_id)||null,toAccountId:auditText(row.to_account_id)||null,paymentMethodId:auditText(row.payment_method_id)||null,spendingTarget:auditText(row.spending_target)||null,billingOverride:auditText(row.billing_month_override)||null,billingMonth:auditText(row.billing_month)||null,reversalOf:auditText(row.reversal_of)||null,isDeleted:auditDeleted(row)
        });
        const activeSourceTx = sourceTransactions.filter((tx) => !auditSourceDeleted(tx));
        const activeTargetTx = targetTransactions.filter((tx) => !auditDeleted(tx)).map(toSourceLikeTargetTx);
        const buildNetMonth = (items) => {
          const byId = new Map(items.map((tx) => [auditText(tx.transactionId),tx]));
          const out = new Map();
          for (const tx of items) {
            const month = auditMonth(tx.date);
            if (!month) continue;
            if (!out.has(month)) out.set(month,{incomeGross:0,expenseGross:0,expenseRefunds:0,incomeReversals:0});
            const x = out.get(month);
            if (tx.reversalOf) {
              const original = byId.get(auditText(tx.reversalOf));
              if (original && original.type === "지출" && tx.type === "수입") x.expenseRefunds += auditNumber(tx.amount);
              else if (original && original.type === "수입" && tx.type === "지출") x.incomeReversals += auditNumber(tx.amount);
              continue;
            }
            if (tx.type === "수입") x.incomeGross += auditNumber(tx.amount);
            if (tx.type === "지출") x.expenseGross += auditNumber(tx.amount);
          }
          for (const x of out.values()) {
            x.income = auditRound(x.incomeGross-x.incomeReversals);
            x.expense = auditRound(x.expenseGross-x.expenseRefunds);
            x.net = auditRound(x.income-x.expense);
            x.incomeGross=auditRound(x.incomeGross);x.expenseGross=auditRound(x.expenseGross);x.expenseRefunds=auditRound(x.expenseRefunds);x.incomeReversals=auditRound(x.incomeReversals);
          }
          return out;
        };
        const sourceMonthMap = buildNetMonth(activeSourceTx);
        const targetMonthMap = buildNetMonth(activeTargetTx);
        const allMonths = new Set([...sourceMonthMap.keys(),...targetMonthMap.keys()]);
        for (const month of Array.from(allMonths).sort()) {
          const a = sourceMonthMap.get(month) || {};
          const b = targetMonthMap.get(month) || {};
          for (const key of ["incomeGross","expenseGross","expenseRefunds","incomeReversals","income","expense","net"]) if (!auditNumberEqual(a[key],b[key])) pushIssue("월별 합계", `${month} ${key} 불일치: Sheets=${auditNumber(a[key])} / D1=${auditNumber(b[key])}`);
        }
        details.monthCount = allMonths.size;

        const estimateBilling = (dateText, cutoff, paymentDay) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(auditText(dateText));
          if (!m || !cutoff || !paymentDay) return null;
          const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
          const lastDay = new Date(Date.UTC(year,month,0)).getUTCDate();
          const effectiveCutoff=Math.min(Number(cutoff),lastDay);
          let offset=day<=effectiveCutoff?0:1;
          if (Number(paymentDay)<=Number(cutoff)) offset++;
          const dt=new Date(Date.UTC(year,month-1+offset,1));
          return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,"0")}`;
        };
        const buildCardMap = (items, accountItems) => {
          const byId = new Map(items.map((tx) => [auditText(tx.transactionId),tx]));
          const cards = accountItems.filter((a) => !a.isDeleted && a.active && auditText(a.subType) === "신용카드");
          const out = new Map();
          const add=(cardId,month,key,amount)=>{if(!month)return;const mapKey=`${cardId}|${month}`;if(!out.has(mapKey))out.set(mapKey,{usage:0,payments:0});out.get(mapKey)[key]+=auditNumber(amount);};
          for (const card of cards) {
            for (const tx of items) {
              if (tx.type === "지출" && auditText(tx.paymentMethodId) === auditText(card.accountId)) {
                const bill=tx.billingOverride||tx.billingMonth||estimateBilling(tx.date,card.billingCutoffDay,card.paymentDay);add(card.accountId,bill,"usage",tx.amount);
              }
              if (tx.type === "이체" && auditText(tx.toAccountId) === auditText(card.accountId)) {
                const bill=tx.billingOverride||tx.billingMonth||auditMonth(tx.date);add(card.accountId,bill,"payments",tx.amount);
              }
              if (tx.reversalOf) {
                const original=byId.get(auditText(tx.reversalOf));
                if (auditText(tx.toAccountId)===auditText(card.accountId)&&original&&original.type==="지출"&&auditText(original.paymentMethodId)===auditText(card.accountId)) {
                  const bill=original.billingOverride||original.billingMonth||estimateBilling(original.date,card.billingCutoffDay,card.paymentDay);add(card.accountId,bill,"usage",-auditNumber(tx.amount));
                }
                if (auditText(tx.fromAccountId)===auditText(card.accountId)&&original&&original.type==="이체"&&auditText(original.toAccountId)===auditText(card.accountId)) {
                  const bill=original.billingOverride||original.billingMonth||auditMonth(original.date);add(card.accountId,bill,"payments",-auditNumber(tx.amount));
                }
              }
            }
          }
          for(const x of out.values()){x.usage=auditRound(x.usage);x.payments=auditRound(x.payments);x.estimatedRemaining=auditRound(x.usage-x.payments);}
          return out;
        };
        const targetAccountsSourceLike = targetAccounts.map((a)=>({accountId:a.account_id,subType:a.sub_type,billingCutoffDay:a.billing_cutoff_day,paymentDay:a.payment_day,active:auditBool(a.is_active),isDeleted:auditDeleted(a)}));
        const sourceCards = buildCardMap(activeSourceTx,sourceAccounts);
        const targetCards = buildCardMap(activeTargetTx,targetAccountsSourceLike);
        const cardKeys = new Set([...sourceCards.keys(),...targetCards.keys()]);
        for(const key of cardKeys){const a=sourceCards.get(key)||{};const b=targetCards.get(key)||{};for(const field of ["usage","payments","estimatedRemaining"])if(!auditNumberEqual(a[field],b[field]))pushIssue("카드 청구",`${key} ${field} 불일치: Sheets=${auditNumber(a[field])} / D1=${auditNumber(b[field])}`);}
        details.cardBillingPeriods = cardKeys.size;

        if (sourceDashboard?.month) {
          const currentStats = targetMonthMap.get(sourceDashboard.month) || {income:0,expense:0,net:0,incomeGross:0,expenseGross:0,expenseRefunds:0,incomeReversals:0};
          const summary = sourceDashboard.summary || {};
          const dashboardChecks = [["monthIncome",summary.monthIncome,currentStats.income],["monthExpense",summary.monthExpense,currentStats.expense],["monthNetCashFlow",summary.monthNetCashFlow,currentStats.net],["monthIncomeGross",summary.monthIncomeGross,currentStats.incomeGross],["monthExpenseGross",summary.monthExpenseGross,currentStats.expenseGross],["monthRefunds",summary.monthRefunds,currentStats.expenseRefunds],["monthIncomeReversals",summary.monthIncomeReversals,currentStats.incomeReversals]];
          for(const [label,a,b] of dashboardChecks)if(!auditNumberEqual(a,b))pushIssue("대시보드",`${sourceDashboard.month} ${label} 불일치: Apps Script=${a} / D1 계산=${b}`);
          for(const card of sourceDashboard.cards || []){
            const key=`${auditText(card.accountId)}|${auditText(card.billingMonth)}`;const d=targetCards.get(key)||{};for(const field of ["usage","payments","estimatedRemaining"])if(!auditNumberEqual(card[field],d[field]))pushIssue("대시보드 카드",`${key} ${field} 불일치: Apps Script=${card[field]} / D1 계산=${auditNumber(d[field])}`);
          }
        }

        const targetSimpleBalance = new Map();
        for(const account of targetAccounts){if(!auditDeleted(account)&&auditBool(account.is_active))targetSimpleBalance.set(auditText(account.account_id),auditNumber(account.opening_balance));}
        for(const tx of activeTargetTx){if(tx.fromAccountId&&targetSimpleBalance.has(tx.fromAccountId))targetSimpleBalance.set(tx.fromAccountId,targetSimpleBalance.get(tx.fromAccountId)-auditNumber(tx.amount));if(tx.toAccountId&&targetSimpleBalance.has(tx.toAccountId))targetSimpleBalance.set(tx.toAccountId,targetSimpleBalance.get(tx.toAccountId)+auditNumber(tx.amount));}
        for(const src of sourceAccounts){const isInvestment=auditText(src.balanceMethod)==="평가입력"||auditText(src.subType)==="주식"||auditText(src.accountType)==="투자";if(src.isDeleted||!src.active||isInvestment)continue;const expected=targetSimpleBalance.get(auditText(src.accountId));if(expected!==undefined&&!auditNumberEqual(src.currentBalance,expected))pushIssue("계좌 잔액",`${src.displayName||src.accountName} 불일치: Apps Script=${src.currentBalance} / D1 거래계산=${auditRound(expected)}`);}

        const unexpectedHouseholds = {};
        for(const table of ["members","categories","accounts","transactions","holdings","investment_trades","asset_snapshots","user_preferences","change_log","tax_year_profiles"]){
          try{const row=await env.DB.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE household_id<>?`).bind("HH_MAIN").first();unexpectedHouseholds[table]=auditNumber(row?.cnt);if(auditNumber(row?.cnt)!==0)pushWarning("가구 범위",`${table}에 HH_MAIN 외 데이터 ${row.cnt}건`);}catch(error){}
        }
        details.otherHouseholdRows = unexpectedHouseholds;

        const allMatched = issues.length === 0;
        details.issueCount = issues.length;
        details.warningCount = warnings.length;
        details.schema = {missingTables,missingIndexes};
        details.dashboardMonth = sourceDashboard?.month || null;

        const result = { allMatched, issues, warnings, details };
        const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
        return new Response(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>D1 전체 검증 결과</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:980px;margin:36px auto;padding:0 20px;line-height:1.6;color:#202124}.ok{color:#137333}.bad{color:#b3261e}.warn{color:#a15c00}.card{background:#f6f7f9;border-radius:12px;padding:18px;margin:14px 0}pre{white-space:pre-wrap;word-break:break-word;background:#f6f7f9;border-radius:12px;padding:18px;max-height:620px;overflow:auto}a{display:inline-block;margin-top:14px;color:#146ef5;font-weight:700}</style>
</head>
<body>
<h1>D1 전체 검증 결과</h1>
<h2 class="${allMatched ? "ok" : "bad"}">${allMatched ? "전체 검증 성공: 전환 전 핵심 검사가 모두 통과했습니다." : "검증 필요: 수정해야 할 항목이 있습니다."}</h2>
<div class="card"><strong>오류</strong> ${issues.length}건 · <strong>경고</strong> ${warnings.length}건 · 비교한 월 ${details.monthCount || 0}개월 · 카드 청구구간 ${details.cardBillingPeriods || 0}개</div>
${warnings.length ? `<p class="warn">경고는 GOOGLEFINANCE 시세처럼 검증 시점에 변할 수 있는 값 등이 포함되며, 오류가 0건이면 데이터 이전 실패로 보지는 않습니다.</p>` : ""}
<pre>${esc(JSON.stringify(result, null, 2))}</pre>
<a href="/api/admin/verify-d1">전체 검증 화면으로 돌아가기</a>
</body>
</html>`, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (
        normalizedPath ===
          "/api/admin/migrate-d1"
      ) {
        if (!env.DB) {
          return errorResponse(
            "D1_NOT_BOUND",
            "D1 바인딩 DB를 찾을 수 없습니다.",
            500
          );
        }

        const migrationMemberId = (name) => {
          const clean = String(name || "").trim();
          if (!clean || clean === "공동") return null;
          const bytes = encoder.encode(clean);
          return "MEM_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        };

        const migrationUnwrap = (result, label) => {
          if (!result || result.success !== true) {
            const message = result?.error?.message || `${label} 데이터를 읽지 못했습니다.`;
            throw new Error(message);
          }
          return result.data;
        };

        const migrationDeletedAt = (item) => {
          if (item?.deletedAt) return item.deletedAt;
          return item?.isDeleted ? "1970-01-01 00:00:00" : null;
        };

        const migrationRunBatch = async (statements, size = 40) => {
          for (let i = 0; i < statements.length; i += size) {
            await env.DB.batch(statements.slice(i, i + size));
          }
        };

        const migrationMemberMap = async () => {
          const result = await env.DB.prepare(
            "SELECT member_id, display_name FROM members WHERE household_id = ? AND deleted_at IS NULL"
          ).bind("HH_MAIN").all();
          return new Map((result.results || []).map((row) => [String(row.display_name || "").trim(), row.member_id]));
        };

        const migrationRequiredTables = async () => {
          const required = [
            "schema_meta",
            "households",
            "members",
            "categories",
            "accounts",
            "transactions",
            "change_log",
            "user_preferences",
            "holdings",
            "investment_trades",
            "asset_snapshots",
            "tax_categories",
            "tax_rule_sets",
            "tax_year_profiles"
          ];
          const result = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
          ).all();
          const found = new Set((result.results || []).map((row) => row.name));
          return required.filter((name) => !found.has(name));
        };

        if (
          request.method === "POST" &&
          !isSameOrigin(request)
        ) {
          return errorResponse(
            "INVALID_ORIGIN",
            "허용되지 않은 요청입니다.",
            403
          );
        }

        const migrationMode = url.searchParams.get("mode") || "";

        if (
          request.method !== "POST" ||
          !["step", "chain"].includes(migrationMode) ||
          url.searchParams.get("confirm") !== "yes"
        ) {
          return errorResponse(
            "INVALID_MIGRATION_REQUEST",
            "올바른 이전 요청이 아닙니다.",
            400
          );
        }

        const missingTables = await migrationRequiredTables();
        if (missingTables.length) {
          return errorResponse(
            "D1_SCHEMA_INCOMPLETE",
            "D1 테이블이 아직 모두 만들어지지 않았습니다: " + missingTables.join(", "),
            409
          );
        }

        const kind = url.searchParams.get("kind") || "";
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const now = new Date().toISOString();

        const migrationRedirect = (nextKind, nextOffset = 0) => {
          const finalSuffix = url.searchParams.get("final") === "yes" ? "&final=yes" : "";
          const location = `/api/admin/migrate-d1?mode=chain&confirm=yes&kind=${encodeURIComponent(nextKind)}&offset=${Math.max(0, Number(nextOffset) || 0)}${finalSuffix}`;
          return new Response(null, {
            status: 307,
            headers: {
              Location: location,
              "Cache-Control": "no-store"
            }
          });
        };

        const migrationResultPage = (allMatched, counts) => new Response(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>D1 이전 결과</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.65;color:#202124}h1{margin-bottom:8px}.ok{color:#137333}.bad{color:#b3261e}pre{white-space:pre-wrap;background:#f6f7f9;border-radius:12px;padding:18px}a{display:inline-block;margin-top:14px;color:#146ef5;font-weight:700}</style>
</head>
<body>
<h1>D1 데이터 이전 결과</h1>
<h2 class="${allMatched ? "ok" : "bad"}">${allMatched ? "검증 성공: 모든 건수가 일치합니다." : "검증 필요: 일치하지 않는 항목이 있습니다."}</h2>
<pre>${JSON.stringify(counts, null, 2)}</pre>
<a href="/api/admin/migrate-d1">이전 화면으로 돌아가기</a>
</body>
</html>`, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });

        if (kind === "setup") {
          const membersData = migrationUnwrap(
            await appsScriptGet(env, "members", {}),
            "구성원"
          );
          const ledgerConfig = migrationUnwrap(
            await appsScriptGet(env, "ledgerConfig", {}),
            "가계부 설정"
          );
          const inputPreferences = migrationUnwrap(
            await appsScriptGet(env, "inputPreferences", {}),
            "입력 설정"
          );
          const names = Array.from(new Set((membersData?.members || []).map((x) => String(x || "").trim()).filter(Boolean)));

          await env.DB.prepare(
            "INSERT INTO households (household_id,name,timezone,currency,ledger_start_date,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(household_id) DO UPDATE SET name=excluded.name,timezone=excluded.timezone,currency=excluded.currency,ledger_start_date=excluded.ledger_start_date,updated_at=excluded.updated_at"
          ).bind(
            "HH_MAIN",
            "우리 집",
            "Asia/Seoul",
            "KRW",
            ledgerConfig?.ledgerStartDate || null,
            now
          ).run();

          const memberStatements = names.map((name) => env.DB.prepare(
            "INSERT INTO members (member_id,household_id,display_name,is_active,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(member_id) DO UPDATE SET household_id=excluded.household_id,display_name=excluded.display_name,is_active=1,updated_at=excluded.updated_at,deleted_at=NULL"
          ).bind(
            migrationMemberId(name),
            "HH_MAIN",
            name,
            1,
            now,
            now
          ));
          await migrationRunBatch(memberStatements);

          if (inputPreferences?.preferences) {
            await env.DB.prepare(
              "INSERT INTO user_preferences (preference_id,household_id,member_id,preference_key,preference_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(preference_id) DO UPDATE SET preference_json=excluded.preference_json,version=excluded.version,updated_at=excluded.updated_at"
            ).bind(
              "PREF_INPUT_SHARED",
              "HH_MAIN",
              null,
              "input_preferences",
              JSON.stringify(inputPreferences.preferences),
              Number(inputPreferences.version) || 1,
              inputPreferences.updatedAt || now,
              inputPreferences.updatedAt || now
            ).run();
          }

          await env.DB.prepare(
            "INSERT INTO schema_meta (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
          ).bind("migration_started_at", now, now).run();

          if (migrationMode === "chain") return migrationRedirect("categories", 0);
          return jsonResponse({success:true,kind,processed:names.length});
        }

        if (kind === "categories") {
          const data = migrationUnwrap(
            await appsScriptGet(env, "categories", {includeDeleted: 1}),
            "카테고리"
          );
          const items = data?.items || [];
          const statements = items.map((item) => env.DB.prepare(
            "INSERT INTO categories (category_id,household_id,type,name,is_active,deleted_at,source_row) VALUES (?,?,?,?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET household_id=excluded.household_id,type=excluded.type,name=excluded.name,is_active=excluded.is_active,deleted_at=excluded.deleted_at,source_row=excluded.source_row,updated_at=CURRENT_TIMESTAMP"
          ).bind(
            item.categoryId,
            "HH_MAIN",
            item.type,
            item.name,
            item.active ? 1 : 0,
            migrationDeletedAt(item),
            item.row || null
          ));
          await migrationRunBatch(statements);
          if (migrationMode === "chain") return migrationRedirect("accounts", 0);
          return jsonResponse({success:true,kind,processed:items.length});
        }

        if (kind === "accounts") {
          const data = migrationUnwrap(
            await appsScriptGet(env, "accounts", {includeDeleted: 1}),
            "계좌"
          );
          const items = data?.items || [];
          const ids = new Set(items.map((item) => item.accountId));
          for (const item of items) {
            if (item.paymentAccountId && !ids.has(item.paymentAccountId)) {
              throw new Error(`계좌 ${item.accountId}의 결제계좌 ${item.paymentAccountId}를 찾을 수 없습니다.`);
            }
          }
          const memberMap = await migrationMemberMap();
          const baseStatements = items.map((item) => env.DB.prepare(
            "INSERT INTO accounts (account_id,household_id,name,display_name,account_type,sub_type,owner_member_id,owner_label,opening_balance,billing_cutoff_day,payment_day,payment_account_id,start_year,end_year,is_active,balance_method,current_balance_override,asset_attribution,investment_cash_baseline_krw,investment_cash_baseline_at,deleted_at,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET household_id=excluded.household_id,name=excluded.name,display_name=excluded.display_name,account_type=excluded.account_type,sub_type=excluded.sub_type,owner_member_id=excluded.owner_member_id,owner_label=excluded.owner_label,opening_balance=excluded.opening_balance,billing_cutoff_day=excluded.billing_cutoff_day,payment_day=excluded.payment_day,payment_account_id=NULL,start_year=excluded.start_year,end_year=excluded.end_year,is_active=excluded.is_active,balance_method=excluded.balance_method,current_balance_override=excluded.current_balance_override,asset_attribution=excluded.asset_attribution,investment_cash_baseline_krw=excluded.investment_cash_baseline_krw,investment_cash_baseline_at=excluded.investment_cash_baseline_at,deleted_at=excluded.deleted_at,source_row=excluded.source_row,updated_at=CURRENT_TIMESTAMP"
          ).bind(
            item.accountId,
            "HH_MAIN",
            item.accountName,
            item.displayName || item.accountName,
            item.accountType,
            item.subType || null,
            memberMap.get(String(item.owner || "").trim()) || null,
            item.owner || null,
            Number(item.openingBalance) || 0,
            item.billingCutoffDay ?? null,
            item.paymentDay ?? null,
            null,
            item.startYear ?? null,
            item.endYear ?? null,
            item.active ? 1 : 0,
            item.balanceMethod || null,
            null,
            item.assetAttribution || null,
            item.cashBaselineKrw ?? null,
            item.cashBaselineAt || null,
            migrationDeletedAt(item),
            item.row || null
          ));
          await migrationRunBatch(baseStatements);
          const linkStatements = items.map((item) => env.DB.prepare(
            "UPDATE accounts SET payment_account_id=? WHERE household_id=? AND account_id=?"
          ).bind(
            item.paymentAccountId || null,
            "HH_MAIN",
            item.accountId
          ));
          await migrationRunBatch(linkStatements);
          if (migrationMode === "chain") return migrationRedirect("holdings", 0);
          return jsonResponse({success:true,kind,processed:items.length});
        }

        if (kind === "holdings") {
          const data = migrationUnwrap(
            await appsScriptGet(env, "holdings", {includeDeleted: 1}),
            "보유종목"
          );
          const items = data?.items || [];
          const statements = items.map((item) => {
            if (!item.accountId) throw new Error(`보유종목 ${item.holdingId}의 accountId가 없습니다.`);
            return env.DB.prepare(
              "INSERT INTO holdings (holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,deleted_at,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(holding_id) DO UPDATE SET household_id=excluded.household_id,account_id=excluded.account_id,stock_code=excluded.stock_code,stock_name=excluded.stock_name,market=excluded.market,quantity=excluded.quantity,avg_buy_price=excluded.avg_buy_price,quote_mode=excluded.quote_mode,manual_price=excluded.manual_price,current_price=excluded.current_price,fx_rate=excluded.fx_rate,value_krw=excluded.value_krw,book_cost_krw=excluded.book_cost_krw,return_rate=excluded.return_rate,owner_label=excluded.owner_label,last_updated=excluded.last_updated,elapsed_days=excluded.elapsed_days,baseline_quantity=excluded.baseline_quantity,baseline_avg_price=excluded.baseline_avg_price,baseline_book_cost_krw=excluded.baseline_book_cost_krw,baseline_at=excluded.baseline_at,managed_by_trades=excluded.managed_by_trades,deleted_at=excluded.deleted_at,source_row=excluded.source_row,updated_at=CURRENT_TIMESTAMP"
            ).bind(
              item.holdingId,
              "HH_MAIN",
              item.accountId,
              item.stockCode || "",
              item.stockName || null,
              item.market || null,
              Number(item.quantity) || 0,
              Number(item.avgBuyPrice) || 0,
              item.quoteMode || null,
              item.manualPrice ?? null,
              item.currentPrice ?? null,
              item.fx ?? null,
              item.valueKrw ?? null,
              item.bookCostKrw ?? item.costKrw ?? null,
              item.returnRate ?? null,
              item.owner || null,
              item.lastUpdated || null,
              typeof item.elapsedDays === "number" ? item.elapsedDays : null,
              Number(item.baselineQuantity) || 0,
              Number(item.baselineAvgPrice) || 0,
              Number(item.baselineBookCostKrw) || 0,
              item.baselineAt || null,
              item.managedByTradesV22 ? 1 : 0,
              1,
              migrationDeletedAt(item),
              item.row || null
            );
          });
          await migrationRunBatch(statements);
          if (migrationMode === "chain") return migrationRedirect("transactions", 0);
          return jsonResponse({success:true,kind,processed:items.length});
        }

        if (kind === "transactions") {
          const pageSize = migrationMode === "chain" ? 1000 : 250;
          const data = migrationUnwrap(
            await appsScriptGet(env, "transactions", {
              includeDeleted: 1,
              limit: pageSize,
              offset
            }),
            "거래"
          );
          const items = data?.items || [];
          const total = Number(data?.total) || items.length;
          const memberMap = await migrationMemberMap();
          const statements = items.map((item) => env.DB.prepare(
            "INSERT INTO transactions (transaction_id,household_id,request_id,date,type,category_id,amount,from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,version,taxpayer_member_id,tax_category_code,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transaction_id) DO UPDATE SET household_id=excluded.household_id,request_id=excluded.request_id,date=excluded.date,type=excluded.type,category_id=excluded.category_id,amount=excluded.amount,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,payment_method_id=excluded.payment_method_id,spending_target=excluded.spending_target,spender_member_id=excluded.spender_member_id,entered_by_member_id=excluded.entered_by_member_id,description=excluded.description,memo=excluded.memo,billing_month_override=excluded.billing_month_override,billing_month=excluded.billing_month,group_id=excluded.group_id,reversal_of=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at,created_by=excluded.created_by,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row"
          ).bind(
            item.transactionId,
            "HH_MAIN",
            item.requestId || null,
            item.date,
            item.type,
            item.categoryId || null,
            Number(item.amount) || 0,
            item.fromAccountId || null,
            item.toAccountId || null,
            item.paymentMethodId || null,
            item.spendingTarget || null,
            memberMap.get(String(item.spendingTarget || "").trim()) || null,
            memberMap.get(String(item.createdBy || "").trim()) || null,
            item.description || null,
            item.memo || null,
            item.billingOverride || null,
            item.billingMonth || null,
            item.groupId || null,
            null,
            1,
            null,
            null,
            item.createdAt || now,
            item.updatedAt || item.createdAt || now,
            item.createdBy || null,
            item.updatedBy || null,
            migrationDeletedAt(item),
            item.deletedBy || null,
            item.row || null
          ));
          await migrationRunBatch(statements);
          const nextOffset = offset + items.length;
          const done = nextOffset >= total || items.length === 0;
          if (migrationMode === "chain") {
            return done
              ? migrationRedirect("transaction-links", 0)
              : migrationRedirect("transactions", nextOffset);
          }
          return jsonResponse({
            success:true,
            kind,
            processed:Math.min(nextOffset,total),
            total,
            nextOffset,
            done
          });
        }

        if (kind === "transaction-links") {
          const pageSize = migrationMode === "chain" ? 1000 : 250;
          const data = migrationUnwrap(
            await appsScriptGet(env, "transactions", {
              includeDeleted: 1,
              limit: pageSize,
              offset
            }),
            "거래 연결"
          );
          const items = data?.items || [];
          const total = Number(data?.total) || items.length;
          const statements = items
            .filter((item) => item.reversalOf)
            .map((item) => env.DB.prepare(
              "UPDATE transactions SET reversal_of=? WHERE household_id=? AND transaction_id=?"
            ).bind(item.reversalOf, "HH_MAIN", item.transactionId));
          await migrationRunBatch(statements);
          const nextOffset = offset + items.length;
          const done = nextOffset >= total || items.length === 0;
          if (migrationMode === "chain") {
            return done
              ? migrationRedirect("investment-trades", 0)
              : migrationRedirect("transaction-links", nextOffset);
          }
          return jsonResponse({
            success:true,
            kind,
            processed:Math.min(nextOffset,total),
            total,
            nextOffset,
            done
          });
        }

        if (kind === "investment-trades") {
          const data = migrationUnwrap(
            await appsScriptGet(env, "investmentTrades", {includeDeleted: 1}),
            "투자거래"
          );
          const items = data?.items || [];
          const statements = items.map((item) => env.DB.prepare(
            "INSERT INTO investment_trades (investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(investment_trade_id) DO UPDATE SET household_id=excluded.household_id,request_id=excluded.request_id,trade_date=excluded.trade_date,trade_type=excluded.trade_type,account_id=excluded.account_id,holding_id=excluded.holding_id,stock_code=excluded.stock_code,stock_name=excluded.stock_name,market=excluded.market,quantity=excluded.quantity,unit_price=excluded.unit_price,currency=excluded.currency,fx_rate=excluded.fx_rate,fee_krw=excluded.fee_krw,tax_krw=excluded.tax_krw,settlement_krw=excluded.settlement_krw,realized_pnl_krw=excluded.realized_pnl_krw,memo=excluded.memo,updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row"
          ).bind(
            item.investmentTradeId,
            "HH_MAIN",
            item.requestId || null,
            item.tradeDate,
            item.tradeType,
            item.accountId,
            item.holdingId,
            item.stockCode || "",
            item.stockName || null,
            item.market || null,
            Number(item.quantity) || 0,
            Number(item.unitPrice) || 0,
            item.currency || null,
            item.fxRate ?? null,
            Number(item.feeKrw) || 0,
            Number(item.taxKrw) || 0,
            Number(item.settlementKrw) || 0,
            Number(item.realizedPnlKrw) || 0,
            item.memo || null,
            1,
            item.createdAt || now,
            item.updatedAt || item.createdAt || now,
            item.createdBy || null,
            item.updatedBy || null,
            migrationDeletedAt(item),
            item.deletedBy || null,
            item.row || null
          ));
          await migrationRunBatch(statements);
          if (migrationMode === "chain") return migrationRedirect("asset-snapshots", 0);
          return jsonResponse({success:true,kind,processed:items.length});
        }

        if (kind === "asset-snapshots") {
          const data = migrationUnwrap(
            await appsScriptGet(env, "assetSnapshots", {limit: 120}),
            "자산스냅샷"
          );
          const items = data?.items || [];
          const statements = items.map((item) => env.DB.prepare(
            "INSERT INTO asset_snapshots (household_id,month,assets,liabilities,net_worth,investment_value,cash_like_value,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(household_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,investment_value=excluded.investment_value,cash_like_value=excluded.cash_like_value,updated_at=excluded.updated_at,updated_by=excluded.updated_by"
          ).bind(
            "HH_MAIN",
            item.month,
            Number(item.assets) || 0,
            Number(item.liabilities) || 0,
            Number(item.netWorth) || 0,
            Number(item.investmentValue) || 0,
            Number(item.cashLikeValue) || 0,
            item.createdAt || now,
            item.updatedAt || item.createdAt || now,
            item.createdBy || null,
            item.updatedBy || null
          ));
          await migrationRunBatch(statements);
          if (migrationMode === "chain") return migrationRedirect("verify", 0);
          return jsonResponse({success:true,kind,processed:items.length});
        }

        if (kind === "verify") {
          const sourceMembers = migrationUnwrap(await appsScriptGet(env, "members", {}), "구성원");
          const sourceCategories = migrationUnwrap(await appsScriptGet(env, "categories", {includeDeleted: 1}), "카테고리");
          const sourceAccounts = migrationUnwrap(await appsScriptGet(env, "accounts", {includeDeleted: 1}), "계좌");
          const sourceTransactions = migrationUnwrap(await appsScriptGet(env, "transactions", {includeDeleted: 1,limit: 1,offset: 0}), "거래");
          const sourceHoldings = migrationUnwrap(await appsScriptGet(env, "holdings", {includeDeleted: 1}), "보유종목");
          const sourceTrades = migrationUnwrap(await appsScriptGet(env, "investmentTrades", {includeDeleted: 1}), "투자거래");
          const sourceSnapshots = migrationUnwrap(await appsScriptGet(env, "assetSnapshots", {limit: 120}), "자산스냅샷");
          const d1 = await env.DB.prepare(
            "SELECT (SELECT COUNT(*) FROM members WHERE household_id=?) AS members,(SELECT COUNT(*) FROM categories WHERE household_id=?) AS categories,(SELECT COUNT(*) FROM accounts WHERE household_id=?) AS accounts,(SELECT COUNT(*) FROM transactions WHERE household_id=?) AS transactions,(SELECT COUNT(*) FROM holdings WHERE household_id=?) AS holdings,(SELECT COUNT(*) FROM investment_trades WHERE household_id=?) AS investmentTrades,(SELECT COUNT(*) FROM asset_snapshots WHERE household_id=?) AS assetSnapshots"
          ).bind("HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN","HH_MAIN").first();
          const source = {
            members:(sourceMembers?.members || []).length,
            categories:Number(sourceCategories?.total) || 0,
            accounts:Number(sourceAccounts?.total) || 0,
            transactions:Number(sourceTransactions?.total) || 0,
            holdings:Number(sourceHoldings?.total) || 0,
            investmentTrades:Number(sourceTrades?.total) || (sourceTrades?.items || []).length,
            assetSnapshots:Number(sourceSnapshots?.total) || 0
          };
          const target = {
            members:Number(d1?.members) || 0,
            categories:Number(d1?.categories) || 0,
            accounts:Number(d1?.accounts) || 0,
            transactions:Number(d1?.transactions) || 0,
            holdings:Number(d1?.holdings) || 0,
            investmentTrades:Number(d1?.investmentTrades) || 0,
            assetSnapshots:Number(d1?.assetSnapshots) || 0
          };
          const allMatched = Object.keys(source).every((key) => source[key] === target[key]);
          if (allMatched) {
            await env.DB.prepare(
              "INSERT INTO schema_meta (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
            ).bind("migration_verified_at", now, now).run();
          }
          if (migrationMode === "chain") {
            if (url.searchParams.get("final") === "yes" && allMatched) {
              return new Response(null, {
                status: 307,
                headers: {
                  Location: "/api/admin/verify-d1?confirm=yes",
                  "Cache-Control": "no-store"
                }
              });
            }
            return migrationResultPage(allMatched, {source,target});
          }
          return jsonResponse({success:true,kind,allMatched,counts:{source,target}});
        }

        return errorResponse(
          "UNKNOWN_MIGRATION_STEP",
          "지원하지 않는 이전 단계입니다.",
          400
        );
      }


      const d1ProductionResponse =
        await mbD1ProductionRoute(
          request,
          url,
          session,
          env,
          ctx
        );

      if (d1ProductionResponse) {
        return d1ProductionResponse;
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/investments/symbol-search"
      ) {
        return handleInvestmentSymbolSearch(
          url
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/investments/symbol-lookup"
      ) {
        return handleInvestmentSymbolLookup(
          url
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/backend-test"
      ) {
        return handleBackendTest(
          env,
          session
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/bootstrap"
      ) {
        const cached =
          await getCachedBootstrap(
            env,
            origin
          );

        const data =
          await mergeLatestInputPreferences(
            env,
            cached
          );

        if (
          ctx &&
          typeof ctx.waitUntil ===
            "function"
        ) {
          ctx.waitUntil(
            warmAppsScript(
              env
            )
          );
        }

        return jsonResponse(
          data
        );
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/dashboard"
      ) {
        return jsonResponse(
          await getDashboard(
            env,
            origin,
            url.searchParams.get(
              "month"
            ) || "",
            url.searchParams.get(
              "refreshQuotes"
            ) === "1"
          )
        );
      }

      if (
        request.method ===
          "GET" &&
        GET_ROUTES[
          url.pathname
        ]
      ) {
        const route =
          GET_ROUTES[
            url.pathname
          ];

        return jsonResponse(
          await appsScriptGet(
            env,
            route.action,
            collectGetParams(
              url,
              route.params
            )
          )
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/settings/input-preferences"
      ) {
        return handleInputPreferences(
          request,
          session,
          env,
          ctx,
          origin
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/investments/cash-baseline"
      ) {
        return handleInvestmentCashBaseline(
          request,
          session,
          env,
          ctx,
          origin
        );
      }

      if (
        request.method ===
          "POST" &&
        POST_ROUTES[
          url.pathname
        ]
      ) {
        return handleGenericPost(
          request,
          POST_ROUTES[
            url.pathname
          ],
          session,
          env,
          ctx,
          origin
        );
      }

      return errorResponse(
        "API_NOT_FOUND",
        "지원하지 않는 API입니다.",
        404
      );
    } catch (
      error
    ) {
      console.error(
        "[moneybook worker] unhandled error",
        error
      );

      return errorResponse(
        "WORKER_ERROR",
        "서버 처리 중 오류가 발생했습니다.",
        500
      );
    }
  }
};
