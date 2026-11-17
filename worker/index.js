/**
 * 우리 가계부 Cloudflare Worker 진입점
 * - fetch: 인증·실시간·D1 라우트 분기
 * - scheduled: 매일 정기 거래 생성과 부동산 시세 갱신
 * 도메인 처리는 worker/d1/*, 순수 로직은 worker/domain/* 에 있습니다.
 */
import { clearCookie, getSession, isSameOrigin } from "./auth.js";
import { handleLogin, handleSession } from "./authRoutes.js";
import { mbD1ProcessRecurring } from "./d1/automation.js";
import {
  getHouseholdRealtimeStub,
  MB_D1_HOUSEHOLD_ID,
  mbD1CurrentDateSeoul,
  mbD1Envelope,
  mbD1Now,
  mbD1RealtimePoke
} from "./d1/core.js";
import { mbD1GetChangesData } from "./d1/queries.js";
import { mbD1ProductionRoute } from "./d1/router.js";
import { errorResponse, jsonResponse, unauthorized } from "./http.js";
import { refreshAllRealEstateAssets } from "./realEstate.js";
import { handleInvestmentSymbolLookup, handleInvestmentSymbolSearch } from "./symbolRoutes.js";

export { HouseholdRealtime } from "./realtime.js";

export default {
  async scheduled(_controller, env, ctx) {
    if (!env.DB) {
      console.error("[moneybook cron] D1 binding is missing.");
      return;
    }

    const automationSession = {
      name: "자동화"
    };
    const cronErrors = [];

    try {
      const result = await mbD1ProcessRecurring(env, automationSession, {});

      if (result.created.length > 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(
            mbD1RealtimePoke(env, {
              path: "/cron/automations/recurring",
              changedBy: automationSession.name
            })
          );
        }

        console.log(`[moneybook cron] recurring transactions created: ${result.created.length}`);
      }
    } catch (error) {
      cronErrors.push(error);
      console.error("[moneybook cron] recurring transaction processing failed", error);
    }

    try {
      const refreshedHomes = await refreshAllRealEstateAssets(
        env,
        MB_D1_HOUSEHOLD_ID,
        automationSession.name,
        mbD1Now(),
        mbD1CurrentDateSeoul()
      );
      if (refreshedHomes.length > 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(
            mbD1RealtimePoke(env, {
              path: "/cron/real-estate/refresh",
              changedBy: automationSession.name
            })
          );
        }
        console.log(`[moneybook cron] real estate refreshed: ${refreshedHomes.length}`);
      }
    } catch (error) {
      cronErrors.push(error);
      console.error("[moneybook cron] real estate refresh failed", error);
    }

    if (cronErrors.length > 0) {
      throw new AggregateError(cronErrors, "One or more Moneybook cron jobs failed.");
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const origin = url.origin;

    const normalizedPath =
      url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

    try {
      if (request.method === "GET" && url.pathname === "/api/ping") {
        return jsonResponse({
          success: true,
          message: "Cloudflare Worker is running."
        });
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return jsonResponse({
          success: true,
          backend: "d1",
          database: Boolean(env.DB)
        });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        return handleLogin(request, env, ctx, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        return handleSession(request, env, ctx, origin);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        if (!isSameOrigin(request)) {
          return errorResponse("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
        }

        return jsonResponse(
          {
            success: true,
            loggedIn: false
          },
          200,
          {
            "Set-Cookie": clearCookie()
          }
        );
      }

      if (!url.pathname.startsWith("/api/")) {
        return errorResponse("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);
      }

      const session = await getSession(request, env);

      if (!session) {
        return unauthorized();
      }

      if (request.method === "GET" && normalizedPath === "/api/changes") {
        if (!env.DB) {
          return errorResponse("D1_NOT_BOUND", "D1 바인딩 DB를 찾을 수 없습니다.", 500);
        }
        return mbD1Envelope(await mbD1GetChangesData(env, url));
      }

      if (request.method === "GET" && normalizedPath === "/api/realtime") {
        if (request.headers.get("Upgrade") !== "websocket") {
          return errorResponse("WEBSOCKET_REQUIRED", "WebSocket 연결이 필요합니다.", 426);
        }
        if (!env.HOUSEHOLD_REALTIME) {
          return errorResponse(
            "REALTIME_BINDING_UNAVAILABLE",
            "실시간 WebSocket 바인딩이 아직 활성화되지 않았습니다.",
            503
          );
        }
        const stub = await getHouseholdRealtimeStub(env);
        return stub.fetch(request);
      }

      const d1ProductionResponse = await mbD1ProductionRoute(request, url, session, env, ctx);

      if (d1ProductionResponse) {
        return d1ProductionResponse;
      }

      if (request.method === "GET" && url.pathname === "/api/investments/symbol-search") {
        return handleInvestmentSymbolSearch(url);
      }

      if (request.method === "GET" && url.pathname === "/api/investments/symbol-lookup") {
        return handleInvestmentSymbolLookup(url);
      }

      return errorResponse("API_NOT_FOUND", "지원하지 않는 API입니다.", 404);
    } catch (error) {
      console.error("[moneybook worker] unhandled error", error);

      return errorResponse("WORKER_ERROR", "서버 처리 중 오류가 발생했습니다.", 500);
    }
  }
};
