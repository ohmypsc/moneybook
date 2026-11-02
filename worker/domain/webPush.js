// Web Push(RFC 8030) 발송에 필요한 순수 로직입니다.
// - 메시지 암호화: RFC 8291 (aes128gcm, RFC 8188)
// - 발신자 인증: RFC 8292 (VAPID, ES256 JWT)
// 외부 라이브러리 없이 WebCrypto만 사용하므로 Cloudflare Worker와 Node 테스트에서 똑같이 동작합니다.

const encoder = new TextEncoder();

const RECORD_SIZE = 4096;
const MAX_PAYLOAD_BYTES = 3000;

// 구독 endpoint로 허용하는 푸시 서비스(브라우저 회사 서버)입니다.
// 로그인한 사용자만 등록할 수 있지만, 임의 주소로 서버가 요청을 보내지 않도록 제한합니다.
const ALLOWED_PUSH_HOST_SUFFIXES = [
  ".googleapis.com",
  ".mozilla.com",
  ".push.apple.com",
  ".notify.windows.com"
];

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value) {
  let text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  text += "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(text);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

export function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some(suffix => host.endsWith(suffix) || host === suffix.slice(1));
}

/**
 * 브라우저가 준 PushSubscription(JSON)을 검증해 저장할 값만 돌려줍니다.
 */
export function normalizePushSubscription(value) {
  const endpoint = String(value?.endpoint || "").trim();
  const p256dh = String(value?.keys?.p256dh || "").trim();
  const auth = String(value?.keys?.auth || "").trim();

  if (!endpoint || endpoint.length > 1000 || !isAllowedPushEndpoint(endpoint)) {
    return null;
  }

  try {
    if (base64UrlToBytes(p256dh).length !== 65 || base64UrlToBytes(auth).length !== 16) {
      return null;
    }
  } catch {
    return null;
  }

  return { endpoint, p256dh, auth };
}

/**
 * VAPID 키 쌍을 새로 만듭니다. 공개키는 브라우저 구독에, 개인키(JWK)는 서명에 씁니다.
 */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: bytesToBase64Url(publicRaw),
    privateJwk
  };
}

/**
 * 푸시 서비스에 보낼 VAPID Authorization 헤더 값을 만듭니다.
 */
export async function createVapidAuthorization({ endpoint, subject, publicKey, privateJwk, now = Date.now() }) {
  const audience = new URL(endpoint).origin;
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  // WebCrypto ECDSA 서명은 JWS(ES256)가 요구하는 r||s 64바이트 형식 그대로입니다.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned))
  );
  return `vapid t=${unsigned}.${bytesToBase64Url(signature)}, k=${publicKey}`;
}

/**
 * 알림 내용을 받는 기기만 풀 수 있게 암호화합니다(RFC 8291).
 * 돌려주는 값은 HTTP 요청 본문 그대로입니다.
 */
export async function encryptPushPayload({ payload, p256dh, auth, salt, localKeyPair }) {
  const plaintext = typeof payload === "string" ? encoder.encode(payload) : payload;
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error("푸시 알림 내용이 너무 깁니다.");
  }

  const receiverPublicRaw = base64UrlToBytes(p256dh);
  const authSecret = base64UrlToBytes(auth);
  const receiverPublic = await crypto.subtle.importKey(
    "raw",
    receiverPublicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const local = localKeyPair || await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const localPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverPublic }, local.privateKey, 256)
  );

  const keyInfo = concatBytes(encoder.encode("WebPush: info\0"), receiverPublicRaw, localPublicRaw);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const recordSalt = salt || crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(recordSalt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(recordSalt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  // 0x02 = 마지막 레코드 구분자(RFC 8188)
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded)
  );

  const header = new Uint8Array(16 + 4 + 1 + localPublicRaw.length);
  header.set(recordSalt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = localPublicRaw.length;
  header.set(localPublicRaw, 21);

  return concatBytes(header, ciphertext);
}

/**
 * 한 기기(구독)에 알림 하나를 보냅니다.
 * 결과의 gone=true는 구독이 만료·해지되어 지워야 한다는 뜻입니다.
 */
export async function sendWebPush({ subscription, payload, vapid, subject, fetchImpl = fetch, ttlSeconds = 24 * 60 * 60 }) {
  const body = await encryptPushPayload({
    payload: JSON.stringify(payload),
    p256dh: subscription.p256dh,
    auth: subscription.auth
  });
  const authorization = await createVapidAuthorization({
    endpoint: subscription.endpoint,
    subject,
    publicKey: vapid.publicKey,
    privateJwk: vapid.privateJwk
  });

  const response = await fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "normal"
    },
    body
  });

  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410
  };
}

function formatKrw(amount) {
  const value = Math.round(Number(amount) || 0);
  return `${value.toLocaleString("ko-KR")}원`;
}

/**
 * 배우자가 거래를 입력했을 때 보여줄 알림 문구를 만듭니다.
 */
export function buildTransactionNotification(transaction, actorName) {
  const type = String(transaction?.type || "");
  const verb = type === "수입" ? "수입을" : type === "이체" ? "이체를" : "지출을";
  const title = `${actorName}님이 ${verb} 입력했어요`;

  const name = String(transaction?.description || transaction?.category || type || "거래").trim();
  const parts = [name, formatKrw(transaction?.amount)];

  if (type === "지출") {
    if (transaction?.description && transaction?.category) parts.push(transaction.category);
    if (transaction?.paymentMethod) parts.push(transaction.paymentMethod);
  } else if (type === "수입") {
    if (transaction?.toAccount) parts.push(transaction.toAccount);
  } else if (type === "이체") {
    if (transaction?.fromAccount || transaction?.toAccount) {
      parts.push(`${transaction.fromAccount || "출금"} → ${transaction.toAccount || "입금"}`);
    }
  }

  return {
    title,
    body: parts.filter(Boolean).join(" · ").slice(0, 240),
    url: "/?shortcut=history",
    tag: `moneybook-tx-${String(transaction?.transactionId || Date.now())}`
  };
}
