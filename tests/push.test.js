import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  deletePushSubscription,
  getPushConfig,
  notifyPartnersOfTransaction,
  savePushSubscription,
  sendTestPush
} from "../worker/push.js";
import { bytesToBase64Url } from "../worker/domain/webPush.js";

const HOUSEHOLD = "HH_1";

// Cloudflare D1과 같은 모양(prepare/bind/first/all/run/batch)의 작은 테스트용 래퍼입니다.
function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../migrations/0000_schema.sql", import.meta.url), "utf8"));
  db.exec("DROP TABLE push_subscriptions"); // Worker가 스스로 만드는지 확인하기 위해 지웁니다.

  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      db.prepare(sql).run(...args);
      return { success: true };
    }
  });

  return {
    raw: db,
    prepare: sql => statement(sql),
    batch: async statements => {
      db.exec("BEGIN");
      try {
        for (const item of statements) await item.run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

async function browserSubscription(endpoint) {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return {
    endpoint,
    keys: {
      p256dh: bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))),
      auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
    }
  };
}

function mockFetch(statusByEndpoint = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: statusByEndpoint[String(url)] ?? 201 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("VAPID keys are created once and reused", async () => {
  const env = { DB: createD1() };
  const first = await getPushConfig(env, HOUSEHOLD, { name: "미영" });
  const second = await getPushConfig(env, HOUSEHOLD, { name: "미영" });

  assert.equal(first.publicKey, second.publicKey);
  assert.equal(first.myDeviceCount, 0);
  const rows = env.DB.raw.prepare("SELECT key FROM schema_meta WHERE key='web_push_vapid_v1'").all();
  assert.equal(rows.length, 1);
});

test("a transaction entered by 승철 notifies only 미영's devices", async () => {
  const env = { DB: createD1() };
  const miyoung = await browserSubscription("https://web.push.apple.com/miyoung-phone");
  const seungcheol = await browserSubscription("https://fcm.googleapis.com/fcm/send/seungcheol-phone");
  await savePushSubscription(env, HOUSEHOLD, { name: "미영" }, { subscription: miyoung }, "iPhone");
  await savePushSubscription(env, HOUSEHOLD, { name: "승철" }, { subscription: seungcheol }, "Android");

  const fetchMock = mockFetch();
  try {
    const result = await notifyPartnersOfTransaction(
      env,
      HOUSEHOLD,
      "승철",
      { transactionId: "TX1", type: "지출", amount: 45200, description: "이마트" },
      "https://moneybook.example"
    );
    assert.deepEqual(result, { sent: 1, failed: 0, removed: 0 });
    assert.deepEqual(fetchMock.calls.map(call => call.url), ["https://web.push.apple.com/miyoung-phone"]);
  } finally {
    fetchMock.restore();
  }

  assert.equal((await getPushConfig(env, HOUSEHOLD, { name: "미영" })).myDeviceCount, 1);
});

test("expired subscriptions are removed after the push service says they are gone", async () => {
  const env = { DB: createD1() };
  const endpoint = "https://web.push.apple.com/old-phone";
  await savePushSubscription(env, HOUSEHOLD, { name: "미영" }, { subscription: await browserSubscription(endpoint) });

  const fetchMock = mockFetch({ [endpoint]: 410 });
  try {
    const result = await notifyPartnersOfTransaction(
      env, HOUSEHOLD, "승철", { transactionId: "TX2", type: "수입", amount: 1 }, "https://moneybook.example"
    );
    assert.deepEqual(result, { sent: 0, failed: 0, removed: 1 });
  } finally {
    fetchMock.restore();
  }
  assert.equal((await getPushConfig(env, HOUSEHOLD, { name: "미영" })).myDeviceCount, 0);
});

test("unsubscribe and test push only touch the caller's own devices", async () => {
  const env = { DB: createD1() };
  const endpoint = "https://web.push.apple.com/miyoung-phone";
  await savePushSubscription(env, HOUSEHOLD, { name: "미영" }, { subscription: await browserSubscription(endpoint) });

  await deletePushSubscription(env, HOUSEHOLD, { name: "승철" }, { endpoint });
  assert.equal((await getPushConfig(env, HOUSEHOLD, { name: "미영" })).myDeviceCount, 1);

  await assert.rejects(
    sendTestPush(env, HOUSEHOLD, { name: "승철" }, "https://moneybook.example"),
    { code: "PUSH_NOT_SUBSCRIBED" }
  );

  const fetchMock = mockFetch();
  try {
    const result = await sendTestPush(env, HOUSEHOLD, { name: "미영" }, "https://moneybook.example");
    assert.equal(result.sent, 1);
  } finally {
    fetchMock.restore();
  }

  await deletePushSubscription(env, HOUSEHOLD, { name: "미영" }, { endpoint });
  assert.equal((await getPushConfig(env, HOUSEHOLD, { name: "미영" })).myDeviceCount, 0);
});

test("subscriptions pointing anywhere other than a browser push service are rejected", async () => {
  const env = { DB: createD1() };
  const bad = await browserSubscription("https://evil.example/collect");
  await assert.rejects(
    savePushSubscription(env, HOUSEHOLD, { name: "미영" }, { subscription: bad }),
    { code: "INVALID_PUSH_SUBSCRIPTION" }
  );
});
