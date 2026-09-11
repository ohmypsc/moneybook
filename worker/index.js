import { DurableObject } from "cloudflare:workers";

/**
 * 우리 가계부 Cloudflare Worker
 * - 미영·승철 로그인과 400일 슬라이딩 세션
 * - Apps Script 비밀키 중계
 * - bootstrap / 현재 월 대시보드 캐시
 * - 거래·투자·설정 API
 */

const COOKIE_NAME = "__Host-moneybook_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 400;
const BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_TTL_MS = 30 * 1000;
const BACKEND_WARM_INTERVAL_MS = 2 * 60 * 1000;
const SYMBOL_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const SYMBOL_LOOKUP_MAX_ENTRIES = 200;
const SYMBOL_SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const SYMBOL_SEARCH_MAX_ENTRIES = 120;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

const symbolLookupMemory = new Map();
const symbolSearchMemory = new Map();

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

function isSameOrigin(
  request
) {
  const origin =
    request.headers.get(
      "Origin"
    );

  return (
    !origin ||
    origin ===
      new URL(
        request.url
      ).origin
  );
}

function getLoginUsers(
  env
) {
  if (
    !env.LOGIN_USERS
  ) {
    throw new Error(
      "LOGIN_USERS Secret이 설정되지 않았습니다."
    );
  }

  let users;

  try {
    users =
      JSON.parse(
        env.LOGIN_USERS
      );
  } catch {
    throw new Error(
      "LOGIN_USERS가 올바른 JSON 형식이 아닙니다."
    );
  }

  if (
    !isObject(
      users
    )
  ) {
    throw new Error(
      "LOGIN_USERS 형식이 올바르지 않습니다."
    );
  }

  return users;
}

async function safeEqual(
  valueA,
  valueB
) {
  const [
    hashA,
    hashB
  ] =
    await Promise.all([
      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          String(valueA)
        )
      ),

      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          String(valueB)
        )
      )
    ]);

  const bytesA =
    new Uint8Array(
      hashA
    );

  const bytesB =
    new Uint8Array(
      hashB
    );

  let difference = 0;

  for (
    let index = 0;
    index < bytesA.length;
    index += 1
  ) {
    difference |=
      bytesA[index] ^
      bytesB[index];
  }

  return (
    difference === 0
  );
}

function bytesToBase64Url(
  bytes
) {
  let binary = "";

  for (
    const byte
    of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte
      );
  }

  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}

function base64UrlToBytes(
  value
) {
  let text =
    String(value)
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );

  text +=
    "=".repeat(
      (
        4 -
        (
          text.length %
          4
        )
      ) %
      4
    );

  const binary =
    atob(
      text
    );

  return Uint8Array.from(
    binary,
    character =>
      character.charCodeAt(
        0
      )
  );
}

async function getSessionKey(
  env
) {
  if (
    !env.SESSION_SECRET
  ) {
    throw new Error(
      "SESSION_SECRET Secret이 설정되지 않았습니다."
    );
  }

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(
      env.SESSION_SECRET
    ),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    [
      "sign",
      "verify"
    ]
  );
}

async function createSessionToken(
  name,
  env
) {
  const now =
    Math.floor(
      Date.now() /
      1000
    );

  const payload = {
    v: 1,
    name,
    iat: now,
    exp:
      now +
      SESSION_MAX_AGE
  };

  const body =
    bytesToBase64Url(
      encoder.encode(
        JSON.stringify(
          payload
        )
      )
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      await getSessionKey(
        env
      ),
      encoder.encode(
        body
      )
    );

  return (
    `${body}.${bytesToBase64Url(
      new Uint8Array(
        signature
      )
    )}`
  );
}

async function verifySessionToken(
  token,
  env
) {
  if (
    !token ||
    typeof token !==
      "string"
  ) {
    return null;
  }

  const parts =
    token.split(
      "."
    );

  if (
    parts.length !== 2
  ) {
    return null;
  }

  const [
    body,
    signature
  ] =
    parts;

  try {
    const valid =
      await crypto.subtle.verify(
        "HMAC",
        await getSessionKey(
          env
        ),
        base64UrlToBytes(
          signature
        ),
        encoder.encode(
          body
        )
      );

    if (
      !valid
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        decoder.decode(
          base64UrlToBytes(
            body
          )
        )
      );

    if (
      !isObject(
        payload
      ) ||
      payload.v !== 1 ||
      typeof payload.name !==
        "string" ||
      !Number.isFinite(
        payload.exp
      ) ||
      payload.exp <=
        Math.floor(
          Date.now() /
          1000
        )
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getCookie(
  request,
  name
) {
  const raw =
    request.headers.get(
      "Cookie"
    );

  if (
    !raw
  ) {
    return "";
  }

  for (
    const cookie
    of raw.split(";")
  ) {
    const part =
      cookie.trim();

    const index =
      part.indexOf(
        "="
      );

    if (
      index > -1 &&
      part
        .slice(
          0,
          index
        )
        .trim() ===
        name
    ) {
      return part.slice(
        index + 1
      );
    }
  }

  return "";
}

function createCookie(
  token
) {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join(
    "; "
  );
}

function clearCookie() {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join(
    "; "
  );
}

async function getSession(
  request,
  env
) {
  const payload =
    await verifySessionToken(
      getCookie(
        request,
        COOKIE_NAME
      ),
      env
    );

  if (
    !payload
  ) {
    return null;
  }

  const users =
    getLoginUsers(
      env
    );

  return Object.prototype
    .hasOwnProperty
    .call(
      users,
      payload.name
    )
      ? payload
      : null;
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
      await safeEqual(
        password,
        stored
      )
    )
  ) {
    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

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

function normalizeInvestmentLookupCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();

  if (!code) {
    return "";
  }

  if (!/^[A-Z0-9.^_-]{1,24}$/.test(code)) {
    return "";
  }

  return code;
}

function inferInvestmentMarket(code) {
  return /^\d+$/.test(code)
    ? "국내"
    : "해외";
}

function normalizeYahooSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function yahooBaseSymbol(symbol) {
  return normalizeYahooSymbol(symbol)
    .replace(/\.(KS|KQ)$/i, "");
}

function yahooQuoteName(quote) {
  return String(
    quote?.longname ||
    quote?.shortname ||
    quote?.displayName ||
    ""
  ).trim();
}

function scoreYahooQuote(quote, code) {
  const symbol = normalizeYahooSymbol(
    quote?.symbol
  );

  const base = yahooBaseSymbol(symbol);
  const exchange = String(
    quote?.exchange || ""
  ).toUpperCase();
  const quoteType = String(
    quote?.quoteType || ""
  ).toUpperCase();

  let score = 0;

  if (symbol === code) score += 100;
  if (base === code) score += 90;

  if (
    /^\d+$/.test(code) &&
    (exchange === "KSC" ||
      exchange === "KOE" ||
      /\.(KS|KQ)$/.test(symbol))
  ) {
    score += 30;
  }

  if (
    [
      "EQUITY",
      "ETF",
      "MUTUALFUND",
      "FUND"
    ].includes(quoteType)
  ) {
    score += 15;
  }

  if (yahooQuoteName(quote)) {
    score += 5;
  }

  return score;
}

function chooseYahooQuote(quotes, code) {
  return (Array.isArray(quotes) ? quotes : [])
    .filter(quote => yahooQuoteName(quote))
    .map(quote => ({
      quote,
      score: scoreYahooQuote(quote, code)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]
    ?.quote || null;
}

async function fetchYahooSymbolSearch(query) {
  const endpoint = new URL(
    "https://query1.finance.yahoo.com/v1/finance/search"
  );

  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("quotesCount", "8");
  endpoint.searchParams.set("newsCount", "0");
  endpoint.searchParams.set("listsCount", "0");
  endpoint.searchParams.set("lang", "ko-KR");
  endpoint.searchParams.set("region", "KR");
  endpoint.searchParams.set(
    "enableFuzzyQuery",
    "false"
  );

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    3500
  );

  let response;

  try {
    response = await fetch(
      endpoint.toString(),
      {
        headers: {
          "Accept": "application/json",
          "User-Agent":
            "Mozilla/5.0 moneybook-symbol-lookup"
        },
        signal: controller.signal
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return Array.isArray(data?.quotes)
    ? data.quotes
    : [];
}

function rememberSymbolLookup(code, data) {
  symbolLookupMemory.set(
    code,
    {
      data,
      expiresAt:
        Date.now() + SYMBOL_LOOKUP_TTL_MS
    }
  );

  if (
    symbolLookupMemory.size >
    SYMBOL_LOOKUP_MAX_ENTRIES
  ) {
    const oldestKey =
      symbolLookupMemory.keys().next().value;

    if (oldestKey) {
      symbolLookupMemory.delete(oldestKey);
    }
  }
}

async function lookupInvestmentSymbol(code) {
  const cached =
    symbolLookupMemory.get(code);

  if (
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.data;
  }

  const inferredMarket =
    inferInvestmentMarket(code);

  let quotes = [];

  try {
    quotes = await fetchYahooSymbolSearch(code);

    let match = chooseYahooQuote(
      quotes,
      code
    );

    if (
      !match &&
      inferredMarket === "국내"
    ) {
      const fallbackResults =
        await Promise.all([
          fetchYahooSymbolSearch(`${code}.KS`),
          fetchYahooSymbolSearch(`${code}.KQ`)
        ]);

      match = chooseYahooQuote(
        fallbackResults.flat(),
        code
      );
    }

    if (match) {
      const symbol = normalizeYahooSymbol(
        match.symbol
      );
      const exchange = String(
        match.exchange ||
        match.exchDisp ||
        ""
      ).trim();

      const domestic =
        /^\d+$/.test(code) ||
        /\.(KS|KQ)$/.test(symbol) ||
        ["KSC", "KOE"].includes(
          String(match.exchange || "")
            .toUpperCase()
        );

      const result = {
        found: true,
        stockCode: code,
        stockName: yahooQuoteName(match),
        market: domestic ? "국내" : "해외",
        symbol,
        exchange,
        source: "yahoo-finance"
      };

      rememberSymbolLookup(code, result);
      return result;
    }
  } catch {
    // 외부 조회 실패는 매매 기록 자체를 막지 않는다.
  }

  const result = {
    found: false,
    stockCode: code,
    stockName: "",
    market: inferredMarket,
    source: "fallback"
  };

  // 실패 결과는 짧게만 캐시해서 일시 장애가 오래 남지 않게 한다.
  symbolLookupMemory.set(
    code,
    {
      data: result,
      expiresAt: Date.now() + 5 * 60 * 1000
    }
  );

  return result;
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

function normalizeInvestmentSearchQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 60);
}

function applyKoreanFundAliases(value) {
  let query = String(value || "");

  const replacements = [
    [/코덱스/gi, "KODEX"],
    [/타이거/gi, "TIGER"],
    [/에이스/gi, "ACE"],
    [/라이즈/gi, "RISE"],
    [/솔/gi, "SOL"],
    [/플러스/gi, "PLUS"],
    [/타임폴리오/gi, "TIMEFOLIO"]
  ];

  for (const [pattern, replacement] of replacements) {
    query = query.replace(pattern, replacement);
  }

  return query;
}

function compactInvestmentSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeKrxShortCode(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();

  if (/^A[0-9A-Z]{6}$/.test(raw)) {
    return raw.slice(1);
  }

  return raw;
}

function krxFinderRows(data) {
  if (Array.isArray(data?.block1)) return data.block1;
  if (Array.isArray(data?.output)) return data.output;
  return [];
}

async function fetchKrxFinder(query, bld, assetType) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    3500
  );

  const body = new URLSearchParams();
  body.set("locale", "ko_KR");
  body.set("mktsel", "ALL");
  body.set("typeNo", "0");
  body.set("searchText", query);
  body.set("bld", bld);

  let response;

  try {
    response = await fetch(
      "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
      {
        method: "POST",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": "https://data.krx.co.kr/",
          "User-Agent":
            "Mozilla/5.0 moneybook-krx-symbol-search"
        },
        body: body.toString(),
        signal: controller.signal
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return [];

  let data;

  try {
    data = await response.json();
  } catch {
    return [];
  }

  return krxFinderRows(data)
    .map(row => {
      const stockCode = normalizeKrxShortCode(
        row?.short_code ||
          row?.shortCode ||
          row?.ISU_SRT_CD ||
          row?.isuSrtCd ||
          ""
      );

      const stockName = String(
        row?.codeName ||
          row?.isuNm ||
          row?.ISU_NM ||
          row?.ISU_ABBRV ||
          ""
      ).trim();

      if (!stockCode || !stockName) return null;

      return {
        stockCode,
        stockName,
        market: "국내",
        symbol: stockCode,
        exchange: String(
          row?.marketName ||
            row?.marketEngName ||
            row?.MKT_NM ||
            "KRX"
        ).trim(),
        assetType,
        source: "krx"
      };
    })
    .filter(Boolean);
}

function krxGoldSpotSearchItem() {
  return {
    stockCode: "04020000",
    stockName: "금 현물 99.99_1Kg",
    market: "국내",
    symbol: "04020000",
    exchange: "KRX 금시장",
    assetType: "금현물",
    source: "krx-gold"
  };
}

function yahooSearchItem(quote) {
  const symbol = normalizeYahooSymbol(
    quote?.symbol
  );

  const stockName = yahooQuoteName(quote);
  const exchangeCode = String(
    quote?.exchange || ""
  ).toUpperCase();
  const exchange = String(
    quote?.exchDisp || quote?.exchange || ""
  ).trim();
  const quoteType = String(
    quote?.quoteType || ""
  ).toUpperCase();

  if (!symbol || !stockName) return null;

  if (
    ![
      "EQUITY",
      "ETF",
      "MUTUALFUND",
      "FUND"
    ].includes(quoteType)
  ) {
    return null;
  }

  const domestic =
    /\.(KS|KQ)$/.test(symbol) ||
    ["KSC", "KOE"].includes(exchangeCode);

  const stockCode = domestic
    ? yahooBaseSymbol(symbol)
    : symbol;

  return {
    stockCode,
    stockName,
    market: domestic ? "국내" : "해외",
    symbol,
    exchange,
    assetType:
      quoteType === "ETF"
        ? "ETF"
        : quoteType === "EQUITY"
          ? "주식"
          : "펀드",
    source: "yahoo-finance"
  };
}

function scoreInvestmentSearchItem(item, query) {
  const rawQuery = compactInvestmentSearchText(query);
  const aliasedText = applyKoreanFundAliases(query);
  const aliasQuery = compactInvestmentSearchText(
    aliasedText
  );
  const name = compactInvestmentSearchText(
    item.stockName
  );
  const code = compactInvestmentSearchText(
    item.stockCode
  );
  const haystack = `${name}${code}${compactInvestmentSearchText(item.exchange || "")}${compactInvestmentSearchText(item.assetType || "")}`;

  const tokenTerms = aliasedText
    .split(/\s+/)
    .map(compactInvestmentSearchText)
    .filter(Boolean);

  let score = 0;

  for (const term of new Set([rawQuery, aliasQuery])) {
    if (!term) continue;

    if (code === term) score = Math.max(score, 220);
    if (name === term) score = Math.max(score, 210);
    if (name.startsWith(term)) score = Math.max(score, 180);
    if (name.includes(term)) score = Math.max(score, 150);
    if (code.startsWith(term)) score = Math.max(score, 140);
    if (code.includes(term)) score = Math.max(score, 120);
  }

  if (
    tokenTerms.length > 1 &&
    tokenTerms.every(term => haystack.includes(term))
  ) {
    score = Math.max(score, 170);
  }

  /*
   * KRX라는 이유만으로 무관한 종목을 검색 결과에 남기지 않습니다.
   * 실제 검색어와 일치한 경우에만 국내 공식 데이터에 작은 가산점을 줍니다.
   */
  if (
    score > 0 &&
    (item.source === "krx" || item.source === "krx-gold")
  ) {
    score += 25;
  }

  return score;
}

function buildKrxSearchQueries(query) {
  const full = applyKoreanFundAliases(query).trim();
  const knownBrands = new Set([
    "KODEX",
    "TIGER",
    "ACE",
    "RISE",
    "SOL",
    "PLUS",
    "TIMEFOLIO"
  ]);

  const tokens = full
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);

  const fallbackToken = tokens
    .filter(token => !knownBrands.has(token.toUpperCase()))
    .sort((a, b) => b.length - a.length)[0];

  return Array.from(
    new Set(
      [full, fallbackToken]
        .filter(Boolean)
    )
  ).slice(0, 2);
}

function dedupeInvestmentSearchItems(items, query) {
  const byKey = new Map();

  for (const item of items) {
    if (!item?.stockCode || !item?.stockName) continue;

    const key = `${item.market}:${String(
      item.stockCode
    ).toUpperCase()}`;

    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    // 동일 국내 종목이면 KRX의 한글 정식 종목명을 우선한다.
    if (
      existing.source !== "krx" &&
      item.source === "krx"
    ) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values())
    .map(item => ({
      item,
      score: scoreInvestmentSearchItem(item, query)
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      a.item.stockName.localeCompare(
        b.item.stockName,
        "ko"
      )
    )
    .slice(0, 40)
    .map(entry => entry.item);
}

function rememberSymbolSearch(key, data) {
  symbolSearchMemory.set(
    key,
    {
      data,
      expiresAt: Date.now() + SYMBOL_SEARCH_TTL_MS
    }
  );

  if (
    symbolSearchMemory.size >
    SYMBOL_SEARCH_MAX_ENTRIES
  ) {
    const oldestKey =
      symbolSearchMemory.keys().next().value;

    if (oldestKey) {
      symbolSearchMemory.delete(oldestKey);
    }
  }
}

async function searchInvestmentSymbols(query) {
  const normalized = normalizeInvestmentSearchQuery(
    query
  );

  if (!normalized) {
    return { query: "", items: [] };
  }

  const cacheKey = normalized.toLocaleLowerCase("ko");
  const cached = symbolSearchMemory.get(cacheKey);

  if (
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.data;
  }

  const domesticQuery =
    applyKoreanFundAliases(normalized);
  const krxQueries = buildKrxSearchQueries(
    normalized
  );

  const tasks = [
    ...krxQueries.flatMap(krxQuery => [
      fetchKrxFinder(
        krxQuery,
        "dbms/comm/finder/finder_stkisu",
        "주식"
      ),
      fetchKrxFinder(
        krxQuery,
        "dbms/comm/finder/finder_secuprodisu",
        "ETF·ETN"
      )
    ]),
    fetchYahooSymbolSearch(domesticQuery).then(
      quotes =>
        quotes
          .map(yahooSearchItem)
          .filter(Boolean)
    )
  ];

  const settled = await Promise.allSettled(tasks);
  const fulfilledExternalItems =
    settled.flatMap(result =>
      result.status === "fulfilled"
        ? result.value
        : []
    );
  const externalProviderSucceeded =
    settled.some(result =>
      result.status === "fulfilled"
    );
  const combined = [
    krxGoldSpotSearchItem(),
    ...fulfilledExternalItems
  ];

  const data = {
    query: normalized,
    items: dedupeInvestmentSearchItems(
      combined,
      normalized
    )
  };

  // 외부 제공처가 모두 일시 실패한 경우에는 짧게만 캐시한다.
  if (!externalProviderSucceeded) {
    symbolSearchMemory.set(
      cacheKey,
      {
        data,
        expiresAt: Date.now() + 2 * 60 * 1000
      }
    );
  } else {
    rememberSymbolSearch(cacheKey, data);
  }

  return data;
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

function mbD1DateOnly(value) {
  const text = mbD1Text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";
  return text;
}

function mbD1MonthOnly(value) {
  const text = mbD1Text(value);
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return "";
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? text : "";
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

function mbD1EstimateBilling(dateText, cutoff, paymentDay) {
  const date = mbD1DateOnly(dateText);
  if (!date || !cutoff || !paymentDay) return null;
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const effectiveCutoff = Math.min(Number(cutoff), lastDay);
  let offset = day <= effectiveCutoff ? 0 : 1;
  if (Number(paymentDay) <= Number(cutoff)) offset += 1;
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
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
  return {
    categoryId: mbD1Text(row.category_id),
    type: mbD1Text(row.type),
    name: mbD1Text(row.name),
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

const MB_D1_TRANSACTION_SELECT = `
  SELECT t.*,
         c.name AS category_name,
         fa.display_name AS from_account_name,
         ta.display_name AS to_account_name,
         pm.display_name AS payment_method_name
  FROM transactions t
  LEFT JOIN categories c ON c.category_id=t.category_id
  LEFT JOIN accounts fa ON fa.account_id=t.from_account_id
  LEFT JOIN accounts ta ON ta.account_id=t.to_account_id
  LEFT JOIN accounts pm ON pm.account_id=t.payment_method_id
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
  let assets = 0;
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

function mbD1RecurringOccurrenceDate(rule, month) {
  if (!mbD1MonthOnly(month)) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(rule.dayOfMonth, lastDay)).padStart(2, "0")}`;
}

function mbD1RecurringRuleActiveForMonth(rule, month) {
  if (!rule.enabled) return false;
  if (rule.startMonth && month < rule.startMonth) return false;
  if (rule.endMonth && month > rule.endMonth) return false;
  return true;
}

function mbD1RecurringPayload(rule, date, requestId) {
  const base = {
    date,
    type: rule.type,
    amount: rule.amount,
    categoryId: rule.categoryId,
    description: rule.description || rule.name,
    memo: rule.memo,
    requestId
  };
  if (rule.type === "지출") {
    return { ...base, paymentMethodId: rule.paymentMethodId, spendingTarget: rule.spendingTarget };
  }
  if (rule.type === "수입") {
    return { ...base, toAccountId: rule.toAccountId };
  }
  return { ...base, fromAccountId: rule.fromAccountId, toAccountId: rule.toAccountId };
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
  let items = await mbD1AllTransactions(env, includeDeleted);
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
  items = items.filter((item) => {
    if (type && item.type !== type) return false;
    if (categoryId && item.categoryId !== categoryId) return false;
    if (accountId && item.fromAccountId !== accountId && item.toAccountId !== accountId && item.paymentMethodId !== accountId) return false;
    if (spendingTarget && item.spendingTarget !== spendingTarget) return false;
    if (dateFrom && item.date < dateFrom) return false;
    if (dateTo && item.date > dateTo) return false;
    if (amount !== null && Math.abs(item.amount - amount) > 0.000001) return false;
    if (q) {
      const text = [
        item.type,
        item.category,
        item.fromAccount,
        item.toAccount,
        item.paymentMethod,
        item.spendingTarget,
        item.description,
        item.memo
      ].filter(Boolean).join(" ").toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });
  const total = items.length;
  const limit = Math.max(0, Math.min(1000, Number(url.searchParams.get("limit")) || 0));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  if (limit) items = items.slice(offset, offset + limit);
  return { total, items };
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
  const category = await mbD1CategoryById(env, categoryId, false);
  if (!category || (forCreate && !category.active)) mbD1Fail("CATEGORY_NOT_FOUND", "사용 가능한 카테고리를 찾을 수 없습니다.");
  if (category.type !== type) mbD1Fail("CATEGORY_TYPE_MISMATCH", `선택한 카테고리는 \"${category.type}\" 유형입니다.`);
  const rawAccounts = await mbD1RawAccounts(env);
  const accounts = rawAccounts.map(mbD1MapAccountRow).filter((account) => account.active && !account.isDeleted);
  const accountMap = new Map(accounts.map((account) => [account.accountId, account]));
  let fromAccount = null;
  let toAccount = null;
  let paymentMethod = null;
  let spendingTarget = "";
  if (type === "수입") {
    const toId = mbD1Text(mbD1Has(payload, "toAccountId") ? payload.toAccountId : source.toAccountId);
    if (!toId) mbD1Fail("INCOME_TO_REQUIRED", "수입 거래에는 입금수단이 필요합니다.");
    toAccount = accountMap.get(toId);
    if (!toAccount) mbD1Fail("TO_ACCOUNT_NOT_FOUND", "입금수단을 찾을 수 없습니다.");
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
    paymentMethod = accountMap.get(paymentId);
    if (!paymentMethod) mbD1Fail("PAYMENT_METHOD_NOT_FOUND", "결제수단을 찾을 수 없습니다.");
    spendingTarget = mbD1Text(mbD1Has(payload, "spendingTarget") ? payload.spendingTarget : source.spendingTarget);
    if (!spendingTarget) mbD1Fail("SPENDING_TARGET_REQUIRED", "지출 거래에는 지출대상이 필요합니다.");
    if (spendingTarget !== "공동") {
      const member = await mbD1MemberByName(env, spendingTarget);
      if (!member) mbD1Fail("INVALID_SPENDING_TARGET", "사용할 수 없는 지출대상입니다.");
    }
    if (paymentMethod.subType === "체크카드") {
      if (!paymentMethod.paymentAccountId) mbD1Fail("CHECK_CARD_ACCOUNT_MISSING", `${paymentMethod.displayName}의 결제계좌가 설정되어 있지 않습니다.`);
      fromAccount = accountMap.get(paymentMethod.paymentAccountId);
      if (!fromAccount) mbD1Fail("CHECK_CARD_ACCOUNT_NOT_FOUND", `${paymentMethod.displayName}의 연결 통장을 찾을 수 없습니다.`);
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
    fromAccount = accountMap.get(fromId);
    toAccount = accountMap.get(toId);
    if (!fromAccount) mbD1Fail("FROM_ACCOUNT_NOT_FOUND", "보내는 수단을 찾을 수 없습니다.");
    if (!toAccount) mbD1Fail("TO_ACCOUNT_NOT_FOUND", "받는 수단을 찾을 수 없습니다.");
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
    const namespace = env.HOUSEHOLD_REALTIME;
    const stub = typeof namespace.getByName === "function"
      ? namespace.getByName(MB_D1_HOUSEHOLD_ID)
      : namespace.get(namespace.idFromName(MB_D1_HOUSEHOLD_ID));
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

    await env.DB.batch(statements);
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
    if (financialChange && current.reversalOf) mbD1Fail("REVERSAL_FINANCIAL_EDIT_NOT_ALLOWED", "환불/취소 역거래의 금액·계좌·유형은 직접 수정할 수 없습니다.");
    if (financialChange && !current.reversalOf) {
      const reversal = await mbD1First(
        env,
        "SELECT transaction_id FROM transactions WHERE household_id=? AND reversal_of=? AND deleted_at IS NULL LIMIT 1",
        [MB_D1_HOUSEHOLD_ID, transactionId]
      );
      if (reversal) mbD1Fail("ORIGINAL_WITH_REVERSAL_EDIT_NOT_ALLOWED", "이미 환불/취소가 연결된 원거래의 금액·계좌·유형은 직접 수정할 수 없습니다.");
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
      if (reversal) mbD1Fail("ORIGINAL_WITH_REVERSAL_DELETE_NOT_ALLOWED", "활성 환불/취소가 연결된 원거래는 삭제할 수 없습니다. 연결된 역거래를 먼저 삭제하세요.");
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
      if (!original || original.isDeleted) mbD1Fail("REVERSAL_ORIGINAL_NOT_ACTIVE", "원거래가 활성 상태가 아니어서 환불/취소 역거래를 복원할 수 없습니다.");
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
    await env.DB.batch(statements);
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
  mbD1LastQuoteRefreshAt = Date.now();
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
  })().finally(() => {
    mbD1QuoteRefreshPromise = null;
  });
  return mbD1QuoteRefreshPromise;
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
    "/api/asset-snapshots",
    "/api/investments/accounts",
    "/api/investments/holdings",
    "/api/investments/trades",
    "/api/investments/cash"
  ]);
  const postPaths = new Set([
    "/api/transactions",
    "/api/transactions/update",
    "/api/transactions/delete",
    "/api/transactions/restore",
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
    "/api/investments/trades/restore"
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
        if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, false));
        return mbD1Envelope(await mbD1BuildDashboard(env, mbD1Text(url.searchParams.get("month"))));
      }
      if (path === "/api/categories") return mbD1Envelope(await mbD1GetCategoriesData(env, url));
      if (path === "/api/accounts") return mbD1Envelope(await mbD1GetAccountsData(env, url));
      if (path === "/api/settings/ledger-config") return mbD1Envelope(await mbD1GetLedgerConfigData(env));
      if (path === "/api/settings/automation") return mbD1Envelope(await mbD1AutomationSettingsData(env));
      if (path === "/api/benefits/reward-balances") return mbD1Envelope(await mbD1BenefitRewardBalancesData(env));
      if (path === "/api/transactions") return mbD1Envelope(await mbD1GetTransactionsData(env, url));
      if (path === "/api/asset-snapshots") return mbD1Envelope(await mbD1GetAssetSnapshotsData(env, url));
      if (path === "/api/investments/accounts") return mbD1Envelope(await mbD1GetInvestmentAccountsData(env));
      if (path === "/api/investments/holdings") {
        if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, false));
        return mbD1Envelope(await mbD1GetHoldingsData(env, url));
      }
      if (path === "/api/investments/trades") return mbD1Envelope(await mbD1GetTradesData(env, url));
      if (path === "/api/investments/cash") return mbD1Envelope(await mbD1GetInvestmentCashData(env, url));
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
    else return null;
    if (ctx?.waitUntil) {
      ctx.waitUntil(mbD1RealtimePoke(env, { path, changedBy: session?.name || null }));
    }
    return mbD1Envelope(data);
  } catch (error) {
    if (error instanceof MbD1Error) {
      return errorResponse(error.code, error.message, error.status || 400);
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
        request.method ===
          "GET" &&
        normalizedPath ===
          "/api/admin/migrate-d1"
      ) {
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
        const namespace = env.HOUSEHOLD_REALTIME;
        const stub = typeof namespace.getByName === "function"
          ? namespace.getByName(MB_D1_HOUSEHOLD_ID)
          : namespace.get(namespace.idFromName(MB_D1_HOUSEHOLD_ID));
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
            ["requestId",src.requestId,dst.request_id],["날짜",src.date,dst.date],["유형",src.type,dst.type],["카테고리",src.categoryId,dst.category_id],["출금계좌",src.fromAccountId,dst.from_account_id],["입금계좌",src.toAccountId,dst.to_account_id],["결제수단",src.paymentMethodId,dst.payment_method_id],["지출대상",src.spendingTarget,dst.spending_target],["메모",src.memo,dst.memo],["청구월수정",src.billingOverride,dst.billing_month_override],["청구월",src.billingMonth,dst.billing_month],["그룹",src.groupId,dst.group_id],["취소원거래",src.reversalOf,dst.reversal_of],["작성자",src.createdBy,dst.created_by],["수정자",src.updatedBy,dst.updated_by],["삭제자",src.deletedBy,dst.deleted_by]
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
            "INSERT INTO transactions (transaction_id,household_id,request_id,date,type,category_id,amount,from_account_id,to_account_id,payment_method_id,spending_target,spender_member_id,entered_by_member_id,description,memo,billing_month_override,billing_month,group_id,reversal_of,version,taxpayer_member_id,tax_category_code,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transaction_id) DO UPDATE SET household_id=excluded.household_id,request_id=excluded.request_id,date=excluded.date,type=excluded.type,category_id=excluded.category_id,amount=excluded.amount,from_account_id=excluded.from_account_id,to_account_id=excluded.to_account_id,payment_method_id=excluded.payment_method_id,spending_target=excluded.spending_target,spender_member_id=excluded.spender_member_id,entered_by_member_id=excluded.entered_by_member_id,memo=excluded.memo,billing_month_override=excluded.billing_month_override,billing_month=excluded.billing_month,group_id=excluded.group_id,reversal_of=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at,created_by=excluded.created_by,updated_by=excluded.updated_by,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,source_row=excluded.source_row"
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
            null,
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
              "refresh"
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
      return errorResponse(
        "WORKER_ERROR",
        error instanceof Error
          ? error.message
          : String(error),
        500
      );
    }
  }
};
