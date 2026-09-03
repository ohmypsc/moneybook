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
      "q",
      "includeDeleted",
      "limit",
      "offset"
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

  let score = item.source === "krx" || item.source === "krx-gold" ? 25 : 0;

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
    .slice(0, 12)
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
  const combined = [
    krxGoldSpotSearchItem(),
    ...settled.flatMap(result =>
      result.status === "fulfilled"
        ? result.value
        : []
    )
  ];

  const data = {
    query: normalized,
    items: dedupeInvestmentSearchItems(
      combined,
      normalized
    )
  };

  // 외부 제공처가 모두 일시 실패한 경우에는 짧게만 캐시한다.
  if (combined.length === 0) {
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
