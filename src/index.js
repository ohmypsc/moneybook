/**
 * 우리 가계부 - Cloudflare Worker
 * 단계 1: Apps Script 보안 연결 확인
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function checkEnvironment(env) {
  if (!env.APPS_SCRIPT_URL) {
    throw new Error("APPS_SCRIPT_URL Secret이 설정되지 않았습니다.");
  }

  if (!env.LEDGER_API_SECRET) {
    throw new Error("LEDGER_API_SECRET Secret이 설정되지 않았습니다.");
  }
}

async function appsScriptGet(env, action, params = {}, useSecret = true) {
  checkEnvironment(env);

  const target = new URL(env.APPS_SCRIPT_URL);

  target.searchParams.set("action", action);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  }

  if (useSecret) {
    target.searchParams.set("apiSecret", env.LEDGER_API_SECRET);
  }

  const response = await fetch(target.toString(), {
    method: "GET",
    redirect: "follow"
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Apps Script가 JSON이 아닌 응답을 반환했습니다."
    );
  }

  return data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      // 1. Cloudflare Worker 자체 테스트
      if (
        request.method === "GET" &&
        url.pathname === "/api/ping"
      ) {
        return jsonResponse({
          success: true,
          message: "Cloudflare Worker is running."
        });
      }

      // 2. Apps Script 연결 테스트
      // health는 Apps Script에서도 인증 제외
      if (
        request.method === "GET" &&
        url.pathname === "/api/health"
      ) {
        const data = await appsScriptGet(
          env,
          "health",
          {},
          false
        );

        return jsonResponse(data);
      }

      // 3. Cloudflare Secret → Apps Script 인증 테스트
      //
      // 실제 bootstrap 데이터 전체를 브라우저로 보내지 않고
      // 정상적으로 받아왔다는 사실과 개수만 반환
      if (
        request.method === "GET" &&
        url.pathname === "/api/backend-test"
      ) {
        const data = await appsScriptGet(
          env,
          "bootstrap",
          {},
          true
        );

        if (!data.success) {
          const unauthorized =
            data.error &&
            data.error.code === "UNAUTHORIZED";

          return jsonResponse(
            {
              success: false,
              backendAuthenticated: false,
              error: data.error || {
                code: "BACKEND_ERROR",
                message: "Apps Script 요청에 실패했습니다."
              }
            },
            unauthorized ? 401 : 502
          );
        }

        const bootstrap = data.data || {};

        return jsonResponse({
          success: true,
          backendAuthenticated: true,
          apiVersion: data.apiVersion,
          message: "Cloudflare → Apps Script 보안 연결 성공",
          counts: {
            accounts: Array.isArray(bootstrap.accounts)
              ? bootstrap.accounts.length
              : 0,

            categories: Array.isArray(bootstrap.categories)
              ? bootstrap.categories.length
              : 0,

            members: Array.isArray(bootstrap.members)
              ? bootstrap.members.length
              : 0,

            spendingTargets: Array.isArray(
              bootstrap.spendingTargets
            )
              ? bootstrap.spendingTargets.length
              : 0
          }
        });
      }

      // 아직 로그인 시스템을 만들기 전이므로
      // 실제 가계부 API는 열지 않음
      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(
          {
            success: false,
            error: {
              code: "API_NOT_AVAILABLE_YET",
              message:
                "로그인 시스템 구성 전에는 실제 가계부 API를 사용할 수 없습니다."
            }
          },
          404
        );
      }

      return jsonResponse(
        {
          success: false,
          error: "Not found"
        },
        404
      );

    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "WORKER_ERROR",
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
