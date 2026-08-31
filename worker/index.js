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
    refresh: " "dashboard",
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
  await Promise.all([
    prefetchBootstrap(
      env,
      origin
    ),

    warmAppsScript(
      env
    )
  ]);
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
