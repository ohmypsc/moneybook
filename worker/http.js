// Worker 공통 HTTP 응답·요청 본문 헬퍼

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });

  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers
  });
}

export function errorResponse(code, message, status) {
  return jsonResponse(
    {
      success: false,

      error: {
        code,
        message
      }
    },
    status
  );
}

export function unauthorized() {
  return jsonResponse(
    {
      success: false,
      loggedIn: false,

      error: {
        code: "LOGIN_REQUIRED",
        message: "로그인이 필요합니다."
      }
    },
    401
  );
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readJsonObject(request, options = {}) {
  if (options.allowEmptyBody) {
    const text = await request.text();

    if (!text.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(text);

      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  try {
    const parsed = await request.json();

    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
