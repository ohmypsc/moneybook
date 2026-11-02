// 배우자 입력 알림(Web Push)의 D1 저장과 발송을 담당합니다.
// 암호화·서명 같은 순수 로직은 domain/webPush.js에 있습니다.

import {
  buildBatchNotification,
  generateVapidKeys,
  normalizePushSubscription,
  sendWebPush
} from "./domain/webPush.js";

const VAPID_META_KEY = "web_push_vapid_v1";

export class PushError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 같은 Worker 인스턴스에서는 테이블 확인을 한 번만 합니다(DB 바인딩별로 기억).
const schemaReadyFor = new WeakSet();

async function ensurePushSchema(env) {
  if (schemaReadyFor.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        member_name TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_success_at TEXT,
        last_failure_at TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0
      )`
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_household_member ON push_subscriptions(household_id, member_name)"
    )
  ]);
  schemaReadyFor.add(env.DB);
}

/**
 * VAPID 키는 처음 필요할 때 만들어 schema_meta에 보관합니다.
 * 그래서 Cloudflare에 비밀값을 따로 등록하지 않아도 알림이 동작합니다.
 */
async function getVapidKeys(env) {
  const read = async () => {
    const row = await env.DB.prepare("SELECT value FROM schema_meta WHERE key=?").bind(VAPID_META_KEY).first();
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value);
      return parsed?.publicKey && parsed?.privateJwk ? parsed : null;
    } catch {
      return null;
    }
  };

  const existing = await read();
  if (existing) return existing;

  const created = await generateVapidKeys();
  // 두 요청이 동시에 만들더라도 먼저 저장된 키 하나만 쓰도록 INSERT OR IGNORE 후 다시 읽습니다.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO schema_meta (key, value, updated_at) VALUES (?, ?, ?)"
  ).bind(VAPID_META_KEY, JSON.stringify(created), new Date().toISOString()).run();
  return (await read()) || created;
}

export async function getPushConfig(env, householdId, session) {
  await ensurePushSchema(env);
  const vapid = await getVapidKeys(env);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM push_subscriptions WHERE household_id=? AND member_name=?"
  ).bind(householdId, session.name).first();
  return {
    publicKey: vapid.publicKey,
    myDeviceCount: Number(row?.count || 0)
  };
}

export async function savePushSubscription(env, householdId, session, body, userAgent) {
  const subscription = normalizePushSubscription(body?.subscription);
  if (!subscription) {
    throw new PushError("INVALID_PUSH_SUBSCRIPTION", "알림 구독 정보가 올바르지 않습니다.");
  }
  await ensurePushSchema(env);
  const now = new Date().toISOString();
  // 같은 기기(endpoint)를 다른 사람이 쓰게 되면 마지막으로 등록한 사람 기준으로 바꿉니다.
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint,household_id,member_name,p256dh,auth,user_agent,created_at,updated_at,failure_count)
     VALUES (?,?,?,?,?,?,?,?,0)
     ON CONFLICT(endpoint) DO UPDATE SET
       household_id=excluded.household_id,
       member_name=excluded.member_name,
       p256dh=excluded.p256dh,
       auth=excluded.auth,
       user_agent=excluded.user_agent,
       updated_at=excluded.updated_at,
       failure_count=0`
  ).bind(
    subscription.endpoint,
    householdId,
    session.name,
    subscription.p256dh,
    subscription.auth,
    String(userAgent || "").slice(0, 300) || null,
    now,
    now
  ).run();
  return { subscribed: true };
}

export async function deletePushSubscription(env, householdId, session, body) {
  const endpoint = String(body?.endpoint || "").trim();
  if (!endpoint) {
    throw new PushError("PUSH_ENDPOINT_REQUIRED", "해지할 알림 정보가 없습니다.");
  }
  await ensurePushSchema(env);
  await env.DB.prepare(
    "DELETE FROM push_subscriptions WHERE household_id=? AND member_name=? AND endpoint=?"
  ).bind(householdId, session.name, endpoint).run();
  return { unsubscribed: true };
}

async function deliver(env, rows, payload, origin) {
  if (!rows.length) return { sent: 0, failed: 0, removed: 0 };
  const vapid = await getVapidKeys(env);
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const row of rows) {
    const now = new Date().toISOString();
    try {
      const result = await sendWebPush({
        subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
        vapid,
        subject: origin
      });
      if (result.ok) {
        sent += 1;
        await env.DB.prepare(
          "UPDATE push_subscriptions SET last_success_at=?, failure_count=0 WHERE endpoint=?"
        ).bind(now, row.endpoint).run();
      } else if (result.gone) {
        removed += 1;
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();
      } else {
        failed += 1;
        console.warn("[moneybook push] delivery failed", result.status);
        await env.DB.prepare(
          "UPDATE push_subscriptions SET last_failure_at=?, failure_count=failure_count+1 WHERE endpoint=?"
        ).bind(now, row.endpoint).run();
      }
    } catch (error) {
      failed += 1;
      console.warn("[moneybook push] delivery error", error);
    }
  }

  return { sent, failed, removed };
}

/**
 * 거래를 입력한 사람이 아닌, 다른 구성원의 기기에만 알림을 보냅니다.
 * 여러 건이면 알림 하나로 묶습니다. (알림은 각자 설정에서 켠 기기로만 갑니다.)
 */
export async function notifyPartnersOfTransactions(env, householdId, actorName, transactions, origin) {
  const list = (Array.isArray(transactions) ? transactions : []).filter(Boolean);
  if (!list.length || !actorName) return { sent: 0, failed: 0, removed: 0 };
  await ensurePushSchema(env);
  const result = await env.DB.prepare(
    "SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE household_id=? AND member_name<>?"
  ).bind(householdId, actorName).all();
  const rows = result.results || [];
  return deliver(env, rows, buildBatchNotification(list, actorName), origin);
}

export async function notifyPartnersOfTransaction(env, householdId, actorName, transaction, origin) {
  return notifyPartnersOfTransactions(env, householdId, actorName, transaction ? [transaction] : [], origin);
}

export async function sendTestPush(env, householdId, session, origin) {
  await ensurePushSchema(env);
  const result = await env.DB.prepare(
    "SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE household_id=? AND member_name=?"
  ).bind(householdId, session.name).all();
  const rows = result.results || [];
  if (!rows.length) {
    throw new PushError("PUSH_NOT_SUBSCRIBED", "이 계정으로 알림을 켠 기기가 없습니다.");
  }
  return deliver(env, rows, {
    title: "가계부 알림 테스트",
    body: "알림이 잘 도착했어요. 이제 배우자가 거래를 입력하면 이렇게 알려드려요.",
    url: "/?shortcut=history",
    tag: "moneybook-test"
  }, origin);
}
