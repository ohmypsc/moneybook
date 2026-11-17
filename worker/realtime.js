// 가구별 실시간 동기화·배우자 푸시 묶음 전송용 Durable Object
import { DurableObject } from "cloudflare:workers";
import { MB_D1_HOUSEHOLD_ID } from "./d1/core.js";
import { getLoginRateLimitStatus, recordLoginFailureState } from "./domain/loginRateLimit.js";
import { groupBatchedPush, scheduleBatchedPush } from "./domain/webPush.js";
import { notifyPartnersOfTransactions } from "./push.js";

export const MB_PUSH_PENDING_KEY = "push-pending:v1";

export class HouseholdRealtime extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/auth/rate-limit/")
    ) {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid request" }, { status: 400 });
      }

      const key = String(body?.key || "").trim().slice(0, 200);
      if (!key) {
        return Response.json({ error: "missing key" }, { status: 400 });
      }

      const storageKey = `login-rate:${key}`;
      const current = await this.ctx.storage.get(storageKey);
      const now = Date.now();

      if (url.pathname.endsWith("/check")) {
        const status = getLoginRateLimitStatus(current, now);
        if (!status.blocked && current) {
          if (status.record.failures.length > 0) {
            await this.ctx.storage.put(storageKey, status.record);
          } else {
            await this.ctx.storage.delete(storageKey);
          }
        }
        return Response.json({
          blocked: status.blocked,
          retryAfterSeconds: Math.max(0, Math.ceil(status.retryAfterMs / 1000))
        });
      }

      if (url.pathname.endsWith("/failure")) {
        const next = recordLoginFailureState(current, now);
        await this.ctx.storage.put(storageKey, next);
        return Response.json({ ok: true });
      }

      if (url.pathname.endsWith("/success")) {
        await this.ctx.storage.delete(storageKey);
        return Response.json({ ok: true });
      }

      return Response.json({ error: "unknown action" }, { status: 404 });
    }

    if (request.method === "POST" && url.pathname === "/push/enqueue") {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid request" }, { status: 400 });
      }
      if (!body?.actor || !body?.transaction) {
        return Response.json({ error: "missing fields" }, { status: 400 });
      }
      const current = (await this.ctx.storage.get(MB_PUSH_PENDING_KEY)) || [];
      const { pending, sendAt } = scheduleBatchedPush(current, {
        actor: String(body.actor),
        origin: String(body.origin || ""),
        transaction: body.transaction
      });
      await this.ctx.storage.put(MB_PUSH_PENDING_KEY, pending);
      await this.ctx.storage.setAlarm(sendAt);
      return Response.json({ queued: pending.length, sendAt });
    }

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

  async alarm() {
    const pending = (await this.ctx.storage.get(MB_PUSH_PENDING_KEY)) || [];
    // 보내기 전에 먼저 비워서, 발송 중 새로 들어온 입력은 다음 알림으로 넘어가게 합니다.
    await this.ctx.storage.delete(MB_PUSH_PENDING_KEY);
    if (!this.env?.DB) return;
    for (const group of groupBatchedPush(pending)) {
      try {
        await notifyPartnersOfTransactions(
          this.env,
          MB_D1_HOUSEHOLD_ID,
          group.actor,
          group.transactions,
          group.origin
        );
      } catch (error) {
        // 알람 재시도로 같은 알림이 두 번 가지 않도록 여기서 오류를 삼킵니다.
        console.warn("[moneybook push] batched notify failed", error);
      }
    }
  }

  webSocketError() {
  }
}
