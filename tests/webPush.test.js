import assert from "node:assert/strict";
import test from "node:test";

import {
  PUSH_BATCH_MAX_WAIT_MS,
  PUSH_BATCH_QUIET_MS,
  base64UrlToBytes,
  buildBatchNotification,
  buildTransactionNotification,
  groupBatchedPush,
  scheduleBatchedPush,
  bytesToBase64Url,
  createVapidAuthorization,
  encryptPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  normalizePushSubscription,
  sendWebPush
} from "../worker/domain/webPush.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8)
  );
}

// 브라우저(받는 쪽)가 하는 복호화를 RFC 8291 그대로 따라 합니다.
async function decryptAsBrowser(body, receiverKeys, authSecret) {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLength = body[20];
  const senderPublicRaw = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);

  const senderPublic = await crypto.subtle.importKey(
    "raw", senderPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: senderPublic }, receiverKeys.privateKey, 256)
  );
  const receiverPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", receiverKeys.publicKey));
  const keyInfo = new Uint8Array([
    ...encoder.encode("WebPush: info\0"), ...receiverPublicRaw, ...senderPublicRaw
  ]);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));

  assert.equal(recordSize, 4096);
  assert.equal(padded[padded.length - 1], 2, "마지막 레코드 구분자가 있어야 합니다");
  return decoder.decode(padded.slice(0, -1));
}

async function makeReceiver() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  return { keys, auth, p256dh, authB64: bytesToBase64Url(auth) };
}

test("encrypted push payload decrypts to the original text on the receiving device", async () => {
  const receiver = await makeReceiver();
  const message = JSON.stringify({ title: "승철님이 지출을 입력했어요", body: "이마트 · 45,200원" });

  const body = await encryptPushPayload({ payload: message, p256dh: receiver.p256dh, auth: receiver.authB64 });

  assert.equal(await decryptAsBrowser(body, receiver.keys, receiver.auth), message);
});

test("VAPID authorization is a valid ES256 JWT for the push service origin", async () => {
  const vapid = await generateVapidKeys();
  const header = await createVapidAuthorization({
    endpoint: "https://web.push.apple.com/abc123",
    subject: "https://moneybook.example",
    publicKey: vapid.publicKey,
    privateJwk: vapid.privateJwk,
    now: Date.UTC(2026, 10, 2)
  });

  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(match);
  assert.equal(match[2], vapid.publicKey);

  const [h, c, s] = match[1].split(".");
  const claims = JSON.parse(decoder.decode(base64UrlToBytes(c)));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://moneybook.example");
  assert.equal(claims.exp, Date.UTC(2026, 10, 2) / 1000 + 12 * 60 * 60);

  const publicKey = await crypto.subtle.importKey(
    "raw", base64UrlToBytes(vapid.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey, base64UrlToBytes(s), encoder.encode(`${h}.${c}`)
  );
  assert.equal(valid, true);
});

test("sendWebPush posts an aes128gcm body and reports expired subscriptions", async () => {
  const receiver = await makeReceiver();
  const vapid = await generateVapidKeys();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 410 });
  };

  const result = await sendWebPush({
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", p256dh: receiver.p256dh, auth: receiver.authB64 },
    payload: { title: "t", body: "b" },
    vapid,
    subject: "https://moneybook.example",
    fetchImpl
  });

  assert.equal(result.gone, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["Content-Encoding"], "aes128gcm");
  assert.match(calls[0].init.headers.Authorization, /^vapid t=/);
  const decrypted = await decryptAsBrowser(calls[0].init.body, receiver.keys, receiver.auth);
  assert.deepEqual(JSON.parse(decrypted), { title: "t", body: "b" });
});

test("only real browser push services are accepted as subscription endpoints", async () => {
  const receiver = await makeReceiver();
  const keys = { p256dh: receiver.p256dh, auth: receiver.authB64 };

  assert.equal(isAllowedPushEndpoint("https://web.push.apple.com/QW"), true);
  assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/a"), true);
  assert.equal(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/a"), true);
  assert.equal(isAllowedPushEndpoint("http://fcm.googleapis.com/a"), false);
  assert.equal(isAllowedPushEndpoint("https://evil.example/a"), false);
  assert.equal(isAllowedPushEndpoint("https://googleapis.com.evil.example/a"), false);

  assert.deepEqual(
    normalizePushSubscription({ endpoint: "https://web.push.apple.com/QW", keys }),
    { endpoint: "https://web.push.apple.com/QW", ...keys }
  );
  assert.equal(normalizePushSubscription({ endpoint: "https://evil.example/a", keys }), null);
  assert.equal(normalizePushSubscription({ endpoint: "https://web.push.apple.com/QW", keys: { p256dh: "abc", auth: keys.auth } }), null);
});

test("transaction notifications name who entered it and what it was", () => {
  assert.deepEqual(
    buildTransactionNotification(
      { transactionId: "TX1", type: "지출", amount: 45200, description: "이마트", category: "장보기", paymentMethod: "신한카드" },
      "승철"
    ),
    {
      title: "승철님이 지출을 입력했어요",
      body: "이마트 · 45,200원 · 장보기 · 신한카드",
      url: "/?shortcut=history",
      tag: "moneybook-tx-TX1"
    }
  );

  assert.equal(
    buildTransactionNotification(
      { transactionId: "TX2", type: "이체", amount: 500000, description: "생활비", fromAccount: "토스", toAccount: "CMA" },
      "승철"
    ).body,
    "생활비 · 500,000원 · 토스 → CMA"
  );
});

test("matches the RFC 8291 section 5 example byte for byte", async () => {
  const senderPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const raw = base64UrlToBytes(senderPublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(raw.slice(1, 33)),
    y: bytesToBase64Url(raw.slice(33, 65)),
    d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    ext: true
  };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);

  const body = await encryptPushPayload({
    payload: "When I grow up, I want to be a watermelon",
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    salt: base64UrlToBytes("DGv6ra1nlYgDCS1FRnbzlw"),
    localKeyPair: { privateKey, publicKey }
  });

  assert.equal(
    bytesToBase64Url(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
  );
});


test("batched pushes wait for a quiet gap but never longer than the max wait", () => {
  const t0 = 1_000_000;
  let state = scheduleBatchedPush([], { actor: "승철", transaction: { transactionId: "1" } }, t0);
  assert.equal(state.sendAt, t0 + PUSH_BATCH_QUIET_MS);

  // 1.5초 뒤 한 건 더(아직 안 보낸 상태) → 그때부터 다시 조용한 시간을 기다림
  state = scheduleBatchedPush(state.pending, { actor: "승철", transaction: { transactionId: "2" } }, t0 + 1_500);
  assert.equal(state.sendAt, t0 + 1_500 + PUSH_BATCH_QUIET_MS);
  assert.equal(state.pending.length, 2);

  // 계속 들어와도 첫 입력 후 최대 대기시간에는 보냄
  state = scheduleBatchedPush(state.pending, { actor: "승철", transaction: { transactionId: "3" } }, t0 + 28_000);
  assert.equal(state.sendAt, t0 + PUSH_BATCH_MAX_WAIT_MS);
});

test("batched pushes are grouped by who entered them", () => {
  const groups = groupBatchedPush([
    { actor: "승철", origin: "https://a", transaction: { transactionId: "1" } },
    { actor: "미영", origin: "https://a", transaction: { transactionId: "2" } },
    { actor: "승철", origin: "https://a", transaction: { transactionId: "3" } },
    { actor: "", transaction: { transactionId: "x" } }
  ]);
  assert.deepEqual(groups.map(group => [group.actor, group.transactions.map(tx => tx.transactionId)]), [
    ["승철", ["1", "3"]],
    ["미영", ["2"]]
  ]);
});

test("several transactions become one notification with totals", () => {
  const notification = buildBatchNotification([
    { transactionId: "1", type: "지출", amount: 45200, description: "이마트" },
    { transactionId: "2", type: "지출", amount: 38000, description: "쿠팡" },
    { transactionId: "3", type: "지출", amount: 12800, description: "스타벅스" },
    { transactionId: "4", type: "지출", amount: 4000, description: "편의점" },
    { transactionId: "5", type: "수입", amount: 10000, description: "환급" }
  ], "승철");

  assert.equal(notification.title, "승철님이 거래 5건을 입력했어요");
  assert.equal(
    notification.body,
    "이마트 45,200원, 쿠팡 38,000원, 스타벅스 12,800원 외 2건 · 지출 100,000원 · 수입 10,000원"
  );
  assert.equal(notification.url, "/?shortcut=history");

  // 한 건이면 기존 한 건 알림과 똑같습니다.
  const single = { transactionId: "9", type: "지출", amount: 1000, description: "커피" };
  assert.deepEqual(buildBatchNotification([single], "승철"), buildTransactionNotification(single, "승철"));
});
