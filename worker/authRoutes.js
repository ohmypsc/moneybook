// 로그인·세션 확인 라우트와 로그인 시도 제한
import { createCookie, createSessionToken, getLoginUsers, getSession, isSameOrigin, verifyStoredPassword } from "./auth.js";
import { getHouseholdRealtimeStub } from "./d1/core.js";
import { errorResponse, jsonResponse, readJsonObject, unauthorized } from "./http.js";

export function loginRateLimitKey(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function checkLoginRateLimit(request, env) {
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return { blocked: false, retryAfterSeconds: 0 };

    const response = await stub.fetch(
      "https://moneybook-realtime.internal/auth/rate-limit/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginRateLimitKey(request) })
      }
    );

    if (!response.ok) return { blocked: false, retryAfterSeconds: 0 };
    return await response.json();
  } catch {
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

export async function updateLoginRateLimit(request, env, action) {
  try {
    const stub = await getHouseholdRealtimeStub(env);
    if (!stub) return;

    await stub.fetch(
      `https://moneybook-realtime.internal/auth/rate-limit/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginRateLimitKey(request) })
      }
    );
  } catch {
    // rate limit storage failure should not make the household app unavailable
  }
}

export async function handleLogin(
  request,
  env,
  ctx,
  origin
) {
  if (
    !isSameOrigin(
      request
    )
  ) {
    return errorResponse(
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403
    );
  }

  const body =
    await readJsonObject(
      request
    );

  if (
    !body
  ) {
    return errorResponse(
      "INVALID_JSON",
      "로그인 요청 형식이 올바르지 않습니다.",
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
    name.length > 100 ||
    password.length > 500
  ) {
    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

  const rateLimit =
    await checkLoginRateLimit(
      request,
      env
    );

  if (rateLimit.blocked) {
    return errorResponse(
      "LOGIN_RATE_LIMITED",
      "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.",
      429
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

  if (
    !stored ||
    !(
      await verifyStoredPassword(
        password,
        stored
      )
    )
  ) {
    await updateLoginRateLimit(
      request,
      env,
      "failure"
    );

    return errorResponse(
      "INVALID_LOGIN",
      "이름 또는 비밀번호를 확인해주세요.",
      401
    );
  }

  await updateLoginRateLimit(
    request,
    env,
    "success"
  );

  const token =
    await createSessionToken(
      name,
      env
    );

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

export async function handleSession(
  request,
  env,
  ctx,
  origin
) {
  const session =
    await getSession(
      request,
      env
    );

  if (
    !session
  ) {
    return unauthorized();
  }

  const token =
    await createSessionToken(
      session.name,
      env
    );

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
          token
        )
    }
  );
}
