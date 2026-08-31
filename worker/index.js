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
function jsonResponse(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  Object.entries(extraHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers
  });
}

/**
 * =========================================================
 * LOGIN_USERS
 * =========================================================
 */
function getLoginUsers(env) {
  if (!env.LOGIN_USERS) {
    throw new Error("LOGIN_USERS Secret이 설정되지 않았습니다.");
  }

  let users;
  try {
    users = JSON.parse(env.LOGIN_USERS);
  } catch (error) {
    throw new Error("LOGIN_USERS가 올바른 JSON 형식이 아닙니다.");
  }

  if (!users || typeof users !== "object" || Array.isArray(users)) {
    throw new Error("LOGIN_USERS 형식이 올바르지 않습니다.");
  }

  return users;
}

/**
 * =========================================================
 * 안전한 문자열 비교
 * =========================================================
 */
async function safeEqual(valueA, valueB) {
  const a = encoder.encode(String(valueA));
  const b = encoder.encode(String(valueB));

  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", a),
    crypto.subtle.digest("SHA-256", b)
  ]);

  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);

  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) {
    difference |= bytesA[i] ^ bytesB[i];
  }

  return difference === 0;
}

/**
 * =========================================================
 * Base64 URL
 * =========================================================
 */
function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  let text = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  text += "=".repeat(
    (4 - (text.length % 4)) % 4
  );

  const binary = atob(text);

  return Uint8Array
