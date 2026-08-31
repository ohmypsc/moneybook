/**
 * =========================================================
 * 우리 가계부 - Cloudflare Worker
 * 로그인 + 장기 세션 + Apps Script 보안 중계
 * =========================================================
 */

const COOKIE_NAME = "__Host-moneybook_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 400; // 400일
const BOOTSTRAP_CACHE_TTL_SECONDS = 60 * 5;
const BACKEND_WARM_INTERVAL_MS = 2 * 60 * 1000;
const DASHBOARD_CACHE_TTL_SECONDS = 30;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let bootstrapMemoryValue = null;
let bootstrapMemoryExpiresAt = 0;
let bootstrapMemoryCacheUrl = "";
let bootstrapLoadPromise = null;
let bootstrapCacheGeneration = 0;

let lastAppsScriptActivityAt = 0;
let backendWarmPromise = null;

let dashboardMemoryValue = null;
let dashboardMemoryMonth = "";
let dashboardMemoryExpiresAt = 0;
let dashboardLoadPromise = null;
let dashboardCacheGeneration = 0;


/**
 * =========================================================
 * 공통 응답
 * =========================================================
 */

function jsonResponse(
  data,
  status = 200,
  extraHeaders = {}
) {
  const headers =
    new Headers({
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "X-Content-Type-Options":
        "nosniff"
    });

  Object.entries(
    extraHeaders
  ).forEach(
    (
      [
        key,
        value
      ]
    ) => {
      headers.set(
        key,
        value
      );
    }
  );

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


/**
 * =========================================================
 * LOGIN_USERS
 * =========================================================
 */

function getLoginUsers(env) {
  if (!env.LOGIN_USERS) {
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
  } catch (error) {
    throw new Error(
      "LOGIN_USERS가 올바른 JSON 형식이 아닙니다."
    );
  }

  if (
    !users ||
    typeof users !==
      "object" ||
    Array.isArray(users)
  ) {
    throw new Error(
      "LOGIN_USERS 형식이 올바르지 않습니다."
    );
  }

  return users;
}


/**
 * =========================================================
 * 안전한 문자열 비교
 * =========================================================
 */

async function safeEqual(
  valueA,
  valueB
) {
  const a =
    encoder.encode(
      String(valueA)
    );

  const b =
    encoder.encode(
      String(valueB)
    );

  const [
    hashA,
    hashB
  ] =
    await Promise.all([
      crypto.subtle.digest(
        "SHA-256",
        a
      ),

      crypto.subtle.digest(
        "SHA-256",
        b
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

  return difference === 0;
}


/**
 * =========================================================
 * Base64 URL
 * =========================================================
 */

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

  return btoa(binary)
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
    value
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
    atob(text);

  return Uint8Array.from(
    binary,
    character =>
      character.charCodeAt(
        0
      )
  );
}


/**
 * =========================================================
 * 세션 서명
 * =========================================================
 */

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

  return crypto.subtle
    .importKey(
      "raw",

      encoder.encode(
        env.SESSION_SECRET
      ),

      {
        name:
          "HMAC",

        hash:
          "SHA-256"
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

    iat:
      now,

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

  const key =
    await getSessionKey(
      env
    );

  const signature =
    await crypto.subtle
      .sign(
        "HMAC",

        key,

        encoder.encode(
          body
        )
      );

  const signatureText =
    bytesToBase64Url(
      new Uint8Array(
        signature
      )
    );

  return (
    body +
    "." +
    signatureText
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
    token.split(".");

  if (
    parts.length !==
    2
  ) {
    return null;
  }

  const [
    body,
    signature
  ] =
    parts;

  try {
    const key =
      await getSessionKey(
        env
      );

    const valid =
      await crypto.subtle
        .verify(
          "HMAC",

          key,

          base64UrlToBytes(
            signature
          ),

          encoder.encode(
            body
          )
        );

    if (!valid) {
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

    const now =
      Math.floor(
        Date.now() /
        1000
      );

    if (
      !payload ||
      payload.v !== 1 ||
      typeof payload.name !==
        "string" ||
      !Number.isFinite(
        payload.exp
      ) ||
      payload.exp <= now
    ) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}


/**
 * =========================================================
 * Cookie
 * =========================================================
 */

function getCookie(
  request,
  name
) {
  const raw =
    request.headers.get(
      "Cookie"
    );

  if (!raw) {
    return "";
  }

  const cookies =
    raw.split(";");

  for (
    const cookie
    of cookies
  ) {
    const part =
      cookie.trim();

    const index =
      part.indexOf(
        "="
      );

    if (index < 0) {
      continue;
    }

    const key =
      part
        .slice(
          0,
          index
        )
        .trim();

    const value =
      part.slice(
        index + 1
      );

    if (key === name) {
      return value;
    }
  }

  return "";
}


function createCookie(
  token
) {
  return [
    COOKIE_NAME +
      "=" +
      token,

    "Path=/",

    "Max-Age=" +
      SESSION_MAX_AGE,

    "HttpOnly",

    "Secure",

    "SameSite=Strict"
  ].join("; ");
}


function clearCookie() {
  return [
    COOKIE_NAME +
      "=",

    "Path=/",

    "Max-Age=0",

    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",

    "HttpOnly",

    "Secure",

    "SameSite=Strict"
  ].join("; ");
}


/**
 * =========================================================
 * 로그인 상태 확인
 * =========================================================
 */

async function getSession(
  request,
  env
) {
  const token =
    getCookie(
      request,
      COOKIE_NAME
    );

  const payload =
    await verifySessionToken(
      token,
      env
    );

  if (!payload) {
    return null;
  }

  const users =
    getLoginUsers(
      env
    );

  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        users,
        payload.name
      )
  ) {
    return null;
  }

  return payload;
}


function unauthorized() {
  return jsonResponse(
    {
      success: false,

      loggedIn: false,

      error: {
        code:
          "LOGIN_REQUIRED",

        message:
          "로그인이 필요합니다."
      }
    },

    401
  );
}


/**
 * =========================================================
 * 같은 사이트 POST 요청만 허용
 * =========================================================
 */

function isSameOrigin(
  request
) {
  const origin =
    request.headers.get(
      "Origin"
    );

  if (!origin) {
    return true;
  }

  return (
    origin ===
    new URL(
      request.url
    ).origin
  );
}


/**
 * =========================================================
 * Apps Script 활동 표시
 * =========================================================
 */

function markAppsScriptActivity() {
  lastAppsScriptActivityAt =
    Date.now();
}


/**
 * =========================================================
 * Apps Script GET
 * =========================================================
 */

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

  Object.entries(
    params
  ).forEach(
    (
      [
        key,
        value
      ]
    ) => {
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
  );

  if (useSecret) {
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
        method:
          "GET",

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
  } catch (error) {
    throw new Error(
      "Apps Script가 JSON이 아닌 응답을 반환했습니다."
    );
  }
}


/**
 * =========================================================
 * Apps Script POST
 * =========================================================
 */

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

  const body = {
    ...payload,

    action,

    apiSecret:
      env.LEDGER_API_SECRET
  };

  const response =
    await fetch(
      env.APPS_SCRIPT_URL,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            body
          ),

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
  } catch (error) {
    throw new Error(
      "Apps Script가 JSON이 아닌 응답을 반환했습니다."
    );
  }
}


/**
 * =========================================================
 * Apps Script 런타임 예열
 * =========================================================
 */

async function warmAppsScript(
  env
) {
  const now =
    Date.now();

  if (
    lastAppsScriptActivityAt &&
    now -
      lastAppsScriptActivityAt <
      BACKEND_WARM_INTERVAL_MS
  ) {
    return;
  }

  if (backendWarmPromise) {
    return backendWarmPromise;
  }

  backendWarmPromise =
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
          backendWarmPromise =
            null;
        }
      );

  return backendWarmPromise;
}


/**
 * =========================================================
 * Bootstrap 캐시 / 프리페치
 * =========================================================
 */

function bootstrapCacheUrl(
  origin
) {
  return `${origin}/__moneybook_internal/bootstrap-v2`;
}


function bootstrapCacheKey(
  origin
) {
  return new Request(
    bootstrapCacheUrl(
      origin
    ),
    {
      method:
        "GET"
    }
  );
}


function rememberBootstrap(
  data,
  origin
) {
  bootstrapMemoryValue =
    data;

  bootstrapMemoryCacheUrl =
    bootstrapCacheUrl(
      origin
    );

  bootstrapMemoryExpiresAt =
    Date.now() +
    BOOTSTRAP_CACHE_TTL_SECONDS *
      1000;
}


function getRememberedBootstrap(
  origin
) {
  if (
    bootstrapMemoryValue &&
    bootstrapMemoryCacheUrl ===
      bootstrapCacheUrl(
        origin
      ) &&
    bootstrapMemoryExpiresAt >
      Date.now()
  ) {
    return bootstrapMemoryValue;
  }

  bootstrapMemoryValue =
    null;

  bootstrapMemoryExpiresAt =
    0;

  bootstrapMemoryCacheUrl =
    "";

  return null;
}


async function readBootstrapEdgeCache(
  origin
) {
  if (
    typeof caches ===
      "undefined" ||
    !caches.default
  ) {
    return null;
  }

  const cached =
    await caches.default
      .match(
        bootstrapCacheKey(
          origin
        )
      );

  if (!cached) {
    return null;
  }

  try {
    const data =
      await cached.json();

    rememberBootstrap(
      data,
      origin
    );

    return data;
  } catch (error) {
    return null;
  }
}


async function writeBootstrapEdgeCache(
  data,
  origin
) {
  if (
    typeof caches ===
      "undefined" ||
    !caches.default
  ) {
    return;
  }

  const response =
    new Response(
      JSON.stringify(
        data
      ),
      {
        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          "Cache-Control":
            `public, max-age=${BOOTSTRAP_CACHE_TTL_SECONDS}`
        }
      }
    );

  await caches.default.put(
    bootstrapCacheKey(
      origin
    ),
    response
  );
}


async function invalidateBootstrapCache(
  origin
) {
  bootstrapCacheGeneration +=
    1;

  bootstrapMemoryValue =
    null;

  bootstrapMemoryExpiresAt =
    0;

  bootstrapMemoryCacheUrl =
    "";

  bootstrapLoadPromise =
    null;

  if (
    typeof caches ===
      "undefined" ||
    !caches.default
  ) {
    return;
  }

  try {
    await caches.default
      .delete(
        bootstrapCacheKey(
          origin
        )
      );
  } catch (error) {
    // 설정 저장 자체는 캐시 삭제 실패 때문에 실패시키지 않습니다.
  }
}


async function loadBootstrapCached(
  env,
  origin
) {
  const remembered =
    getRememberedBootstrap(
      origin
    );

  if (remembered) {
    return remembered;
  }

  const edgeCached =
    await readBootstrapEdgeCache(
      origin
    );

  if (edgeCached) {
    return edgeCached;
  }

  if (!bootstrapLoadPromise) {
    const generation =
      bootstrapCacheGeneration;

    const promise =
      appsScriptGet(
        env,
        "bootstrap"
      )
        .then(
          async data => {
            if (
              data &&
              data.success !== false &&
              generation ===
                bootstrapCacheGeneration
            ) {
              rememberBootstrap(
                data,
                origin
              );

              await writeBootstrapEdgeCache(
                data,
                origin
              );
            }

            return data;
          }
        )
        .finally(
          () => {
            if (
              bootstrapLoadPromise ===
              promise
            ) {
              bootstrapLoadPromise =
                null;
            }
          }
        );

    bootstrapLoadPromise =
      promise;
  }

  return bootstrapLoadPromise;
}


async function prefetchBootstrap(
  env,
  origin
) {
  try {
    await loadBootstrapCached(
      env,
      origin
    );
  } catch (error) {
    // 프리페치 실패가 인증이나 화면 진입을 막지 않습니다.
  }
}


/**
 * 무거운 bootstrap 본문은 기존 캐시를 사용하되,
 * 부부 공통 입력 설정만 Apps Script에서 최신값을 다시 읽어 합칩니다.
 *
 * Cloudflare의 메모리/엣지 캐시는 실행 위치마다 따로 남을 수 있으므로
 * bootstrap에 들어 있던 설정값만 사용하면 다른 기기에서 최대 5분 동안
 * 이전 카테고리 순서를 볼 수 있습니다.
 */

async function mergeLatestInputPreferences(
  env,
  bootstrapPayload
) {
  if (
    !bootstrapPayload ||
    typeof bootstrapPayload !==
      "object" ||
    !bootstrapPayload.data ||
    typeof bootstrapPayload.data !==
      "object" ||
    Array.isArray(
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
      !latest ||
      latest.success !== true ||
      !latest.data ||
      typeof latest.data !==
        "object" ||
      Array.isArray(
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
  } catch (error) {
    // 최신 설정 조회 실패 때문에 기존 bootstrap까지 실패시키지 않습니다.
    return bootstrapPayload;
  }
}


async function prepareAppBackend(
  env,
  origin
) {
  try {
    await prefetchBootstrap(
      env,
      origin
    );

    await warmAppsScript(
      env
    );
  } catch (error) {
    // 준비 작업은 사용자 요청을 실패시키지 않습니다.
  }
}


/**
 * =========================================================
 * 현재월 대시보드 캐시
 * =========================================================
 */

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


function dashboardCacheUrl(
  origin,
  month
) {
  return `${origin}/__moneybook_internal/dashboard-v2/${encodeURIComponent(
    month
  )}`;
}


function dashboardCacheKey(
  origin,
  month
) {
  return new Request(
    dashboardCacheUrl(
      origin,
      month
    ),
    {
      method:
        "GET"
    }
  );
}


function rememberDashboard(
  data,
  month
) {
  dashboardMemoryValue =
    data;

  dashboardMemoryMonth =
    month;

  dashboardMemoryExpiresAt =
    Date.now() +
    DASHBOARD_CACHE_TTL_SECONDS *
      1000;
}


function getRememberedDashboard(
  month
) {
  if (
    dashboardMemoryValue &&
    dashboardMemoryMonth ===
      month &&
    dashboardMemoryExpiresAt >
      Date.now()
  ) {
    return dashboardMemoryValue;
  }

  dashboardMemoryValue =
    null;

  dashboardMemoryMonth =
    "";

  dashboardMemoryExpiresAt =
    0;

  return null;
}


async function readDashboardEdgeCache(
  origin,
  month
) {
  if (
    typeof caches ===
      "undefined" ||
    !caches.default
  ) {
    return null;
  }

  const cached =
    await caches.default
      .match(
        dashboardCacheKey(
          origin,
          month
        )
      );

  if (!cached) {
    return null;
  }

  try {
    const data =
      await cached.json();

    rememberDashboard(
      data,
      month
    );

    return data;
  } catch (error) {
    return null;
  }
}


async function writeDashboardEdgeCache(
  data,
  origin,
  month
) {
  if (
    typeof caches ===
      "undefined" ||
    !caches.default
  ) {
    return;
  }

  const response =
    new Response(
      JSON.stringify(
        data
      ),
      {
        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          "Cache-Control":
            `public, max-age=${DASHBOARD_CACHE_TTL_SECONDS}`
        }
      }
    );

  await caches.default.put(
    dashboardCacheKey(
      origin,
      month
    ),
    response
  );
}


async function invalidateCurrentDashboardCache(
  origin
) {
  const currentMonth =
    getCurrentMonthSeoul();

  dashboardCacheGeneration +=
    1;

  dashboardMemoryValue =
    null;

  dashboardMemoryMonth =
    "";

  dashboardMemoryExpiresAt =
    0;

  dashboardLoadPromise =
    null;

  if (
    typeof caches ===
      "undefined" ||
    !caches.default
  ) {
    return;
  }

  try {
    await caches.default
      .delete(
        dashboardCacheKey(
          origin,
          currentMonth
        )
      );
  } catch (error) {
    // 실제 거래 저장은 캐시 삭제 실패 때문에 실패시키지 않습니다.
  }
}


async function loadDashboardCached(
  env,
  origin,
  requestedMonth = "",
  forceRefresh = false
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

  if (!forceRefresh) {
    const remembered =
      getRememberedDashboard(
        month
      );

    if (remembered) {
      return remembered;
    }

    const edgeCached =
      await readDashboardEdgeCache(
        origin,
        month
      );

    if (edgeCached) {
      return edgeCached;
    }
  }

  if (forceRefresh) {
    await invalidateCurrentDashboardCache(
      origin
    );
  }

  if (!dashboardLoadPromise) {
    const generation =
      dashboardCacheGeneration;

    const promise =
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
              data &&
              data.success !== false &&
              generation ===
                dashboardCacheGeneration
            ) {
              rememberDashboard(
                data,
                month
              );

              await writeDashboardEdgeCache(
                data,
                origin,
                month
              );
            }

            return data;
          }
        )
        .finally(
          () => {
            if (
              dashboardLoadPromise ===
              promise
            ) {
              dashboardLoadPromise =
                null;
            }
          }
        );

    dashboardLoadPromise =
      promise;
  }

  return dashboardLoadPromise;
}


async function prefetchCurrentDashboard(
  env,
  origin
) {
  try {
    await loadDashboardCached(
      env,
      origin,
      getCurrentMonthSeoul(),
      false
    );
  } catch (error) {
    // 백그라운드 갱신 실패 시 다음 실제 조회가 다시 시도합니다.
  }
}


async function refreshDashboardAfterMutation(
  data,
  ctx,
  env,
  origin
) {
  if (
    !data ||
    data.success === false
  ) {
    return;
  }

  await invalidateCurrentDashboardCache(
    origin
  );

  if (
    ctx &&
    typeof ctx.waitUntil ===
      "function"
  ) {
    ctx.waitUntil(
      prefetchCurrentDashboard(
        env,
        origin
      )
    );
  }
}


/**
 * =========================================================
 * Worker
 * =========================================================
 */

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

    try {
      /**
       * Worker 확인
       */
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


      /**
       * Apps Script health
       */
      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/health"
      ) {
        const data =
          await appsScriptGet(
            env,
            "health",
            {},
            false
          );

        return jsonResponse(
          data
        );
      }


      /**
       * 로그인
       */
      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/login"
      ) {
        if (
          !isSameOrigin(
            request
          )
        ) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_ORIGIN",

                message:
                  "허용되지 않은 요청입니다."
              }
            },

            403
          );
        }

        let body;

        try {
          body =
            await request.json();
        } catch (error) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_JSON",

                message:
                  "로그인 요청 형식이 올바르지 않습니다."
              }
            },

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
          name.length >
            100 ||
          password.length >
            500
        ) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_LOGIN",

                message:
                  "이름 또는 비밀번호를 확인해주세요."
              }
            },

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

        const valid =
          stored &&
          (
            await safeEqual(
              password,
              stored
            )
          );

        if (!valid) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_LOGIN",

                message:
                  "이름 또는 비밀번호를 확인해주세요."
              }
            },

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
            prepareAppBackend(
              env,
              url.origin
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


      /**
       * 세션 확인 + 로그인 기간 자동 연장
       */
      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/auth/session"
      ) {
        const session =
          await getSession(
            request,
            env
          );

        if (!session) {
          return unauthorized();
        }

        const refreshedToken =
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
            prepareAppBackend(
              env,
              url.origin
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
                refreshedToken
              )
          }
        );
      }


      /**
       * 로그아웃
       */
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
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_ORIGIN",

                message:
                  "허용되지 않은 요청입니다."
              }
            },

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


      /**
       * 이하 API는 로그인 필수
       */
      if (
        url.pathname.startsWith(
          "/api/"
        )
      ) {
        const session =
          await getSession(
            request,
            env
          );

        if (!session) {
          return unauthorized();
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/backend-test"
        ) {
          const data =
            await appsScriptGet(
              env,
              "bootstrap"
            );

          if (!data.success) {
            return jsonResponse(
              {
                success:
                  false,

                backendAuthenticated:
                  false,

                error:
                  data.error ||
                  {
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
            data.data ||
            {};

          return jsonResponse({
            success: true,

            backendAuthenticated:
              true,

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
                  ? bootstrap
                      .accounts
                      .length
                  : 0,

              categories:
                Array.isArray(
                  bootstrap.categories
                )
                  ? bootstrap
                      .categories
                      .length
                  : 0,

              members:
                Array.isArray(
                  bootstrap.members
                )
                  ? bootstrap
                      .members
                      .length
                  : 0,

              spendingTargets:
                Array.isArray(
                  bootstrap.spendingTargets
                )
                  ? bootstrap
                      .spendingTargets
                      .length
                  : 0
            }
          });
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/bootstrap"
        ) {
          const cachedData =
            await loadBootstrapCached(
              env,
              url.origin
            );

          const data =
            await mergeLatestInputPreferences(
              env,
              cachedData
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
          const data =
            await loadDashboardCached(
              env,
              url.origin,

              url.searchParams.get(
                "month"
              ) || "",

              url.searchParams.get(
                "refresh"
              ) === "1"
            );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/transactions"
        ) {
          const data =
            await appsScriptGet(
              env,

              "transactions",

              {
                dateFrom:
                  url.searchParams.get(
                    "dateFrom"
                  ) || "",

                dateTo:
                  url.searchParams.get(
                    "dateTo"
                  ) || "",

                type:
                  url.searchParams.get(
                    "type"
                  ) || "",

                categoryId:
                  url.searchParams.get(
                    "categoryId"
                  ) || "",

                accountId:
                  url.searchParams.get(
                    "accountId"
                  ) || "",

                spendingTarget:
                  url.searchParams.get(
                    "spendingTarget"
                  ) || "",

                q:
                  url.searchParams.get(
                    "q"
                  ) || "",

                includeDeleted:
                  url.searchParams.get(
                    "includeDeleted"
                  ) || "",

                limit:
                  url.searchParams.get(
                    "limit"
                  ) || "",

                offset:
                  url.searchParams.get(
                    "offset"
                  ) || ""
              }
            );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/transactions"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "거래 입력 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          if (
            !body ||
            typeof body !==
              "object" ||
            Array.isArray(
              body
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_TRANSACTION",

                  message:
                    "거래 입력 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "createTransaction",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/transactions/update"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "거래 수정 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          if (
            !body ||
            typeof body !==
              "object" ||
            Array.isArray(
              body
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_TRANSACTION",

                  message:
                    "거래 수정 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "updateTransaction",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/transactions/delete"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "거래 삭제 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          if (
            !body ||
            typeof body !==
              "object" ||
            Array.isArray(
              body
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_TRANSACTION",

                  message:
                    "거래 삭제 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "deleteTransaction",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/transactions/restore"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "거래 복원 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          if (
            !body ||
            typeof body !==
              "object" ||
            Array.isArray(
              body
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_TRANSACTION",

                  message:
                    "거래 복원 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "restoreTransaction",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/settings/input-preferences"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "설정 저장 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          if (
            !body ||
            typeof body !==
              "object" ||
            Array.isArray(
              body
            ) ||
            !body.preferences ||
            typeof body.preferences !==
              "object" ||
            Array.isArray(
              body.preferences
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_INPUT_PREFERENCES",

                  message:
                    "입력 설정 형식이 올바르지 않습니다."
                }
              },

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
            data &&
            data.success !== false
          ) {
            await invalidateBootstrapCache(
              url.origin
            );

            if (
              ctx &&
              typeof ctx.waitUntil ===
                "function"
            ) {
              ctx.waitUntil(
                prefetchBootstrap(
                  env,
                  url.origin
                )
              );
            }
          }

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/investments/accounts"
        ) {
          const data =
            await appsScriptGet(
              env,
              "investmentAccounts"
            );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/investments/holdings"
        ) {
          const data =
            await appsScriptGet(
              env,

              "holdings",

              {
                accountId:
                  url.searchParams.get(
                    "accountId"
                  ) || "",

                market:
                  url.searchParams.get(
                    "market"
                  ) || "",

                quoteMode:
                  url.searchParams.get(
                    "quoteMode"
                  ) || "",

                includeDeleted:
                  url.searchParams.get(
                    "includeDeleted"
                  ) || ""
              }
            );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/investments/trades"
        ) {
          const data =
            await appsScriptGet(
              env,

              "investmentTrades",

              {
                accountId:
                  url.searchParams.get(
                    "accountId"
                  ) || "",

                holdingId:
                  url.searchParams.get(
                    "holdingId"
                  ) || "",

                tradeType:
                  url.searchParams.get(
                    "tradeType"
                  ) || "",

                includeDeleted:
                  url.searchParams.get(
                    "includeDeleted"
                  ) || ""
              }
            );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/investments/cash"
        ) {
          const data =
            await appsScriptGet(
              env,

              "investmentCash",

              {
                accountId:
                  url.searchParams.get(
                    "accountId"
                  ) || ""
              }
            );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/investments/cash-baseline"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "요청 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "setInvestmentCashBaseline",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/investments/trades"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "투자거래 입력 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          if (
            !body ||
            typeof body !==
              "object" ||
            Array.isArray(
              body
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_TRANSACTION",

                  message:
                    "투자거래 입력 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "createInvestmentTrade",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/investments/trades/update"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "투자거래 수정 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "updateInvestmentTrade",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/investments/trades/delete"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "요청 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "deleteInvestmentTrade",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        if (
          request.method ===
            "POST" &&
          url.pathname ===
            "/api/investments/trades/restore"
        ) {
          if (
            !isSameOrigin(
              request
            )
          ) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_ORIGIN",

                  message:
                    "허용되지 않은 요청입니다."
                }
              },

              403
            );
          }

          let body;

          try {
            body =
              await request.json();
          } catch (error) {
            return jsonResponse(
              {
                success:
                  false,

                error: {
                  code:
                    "INVALID_JSON",

                  message:
                    "요청 형식이 올바르지 않습니다."
                }
              },

              400
            );
          }

          const data =
            await appsScriptPost(
              env,

              "restoreInvestmentTrade",

              {
                ...body,

                actor:
                  session.name
              }
            );

          await refreshDashboardAfterMutation(
            data,
            ctx,
            env,
            url.origin
          );

          return jsonResponse(
            data
          );
        }


        return jsonResponse(
          {
            success:
              false,

            error: {
              code:
                "API_NOT_FOUND",

              message:
                "지원하지 않는 API입니다."
            }
          },

          404
        );
      }


      return jsonResponse(
        {
          success:
            false,

          error: {
            code:
              "NOT_FOUND",

            message:
              "페이지를 찾을 수 없습니다."
          }
        },

        404
      );
    } catch (error) {
      return jsonResponse(
        {
          success:
            false,

          error: {
            code:
              "WORKER_ERROR",

            message:
              error instanceof Error
                ? error.message
                : String(error)
          }
        },

        500
      );
    }
  }
};
