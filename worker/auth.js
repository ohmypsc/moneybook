const COOKIE_NAME = "__Host-moneybook_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 400;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export function getLoginUsers(env) {
  if (!env.LOGIN_USERS) {
    throw new Error("LOGIN_USERS Secret이 설정되지 않았습니다.");
  }

  let users;

  try {
    users = JSON.parse(env.LOGIN_USERS);
  } catch {
    throw new Error("LOGIN_USERS가 올바른 JSON 형식이 아닙니다.");
  }

  if (!isObject(users)) {
    throw new Error("LOGIN_USERS 형식이 올바르지 않습니다.");
  }

  return users;
}

export async function safeEqual(valueA, valueB) {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(valueA))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(valueB)))
  ]);

  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let difference = 0;

  for (let index = 0; index < bytesA.length; index += 1) {
    difference |= bytesA[index] ^ bytesB[index];
  }

  return difference === 0;
}

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
  let text = String(value)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  text += "=".repeat((4 - (text.length % 4)) % 4);

  const binary = atob(text);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function getSessionKey(env) {
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET Secret이 설정되지 않았습니다.");
  }

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(name, env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    name,
    iat: now,
    exp: now + SESSION_MAX_AGE
  };

  const body = bytesToBase64Url(
    encoder.encode(JSON.stringify(payload))
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSessionKey(env),
    encoder.encode(body)
  );

  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token, env) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [body, signature] = parts;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getSessionKey(env),
      base64UrlToBytes(signature),
      encoder.encode(body)
    );

    if (!valid) {
      return null;
    }

    const payload = JSON.parse(
      decoder.decode(base64UrlToBytes(body))
    );

    if (
      !isObject(payload) ||
      payload.v !== 1 ||
      typeof payload.name !== "string" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const raw = request.headers.get("Cookie");
  if (!raw) {
    return "";
  }

  for (const cookie of raw.split(";")) {
    const part = cookie.trim();
    const index = part.indexOf("=");

    if (index > -1 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1);
    }
  }

  return "";
}

export function createCookie(token) {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export function clearCookie() {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export async function getSession(request, env) {
  const payload = await verifySessionToken(
    getCookie(request, COOKIE_NAME),
    env
  );

  if (!payload) {
    return null;
  }

  const users = getLoginUsers(env);
  return Object.prototype.hasOwnProperty.call(users, payload.name)
    ? payload
    : null;
}
