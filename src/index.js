/**
 * =========================================================
 * 우리 가계부 - Cloudflare Worker
 * 로그인 + 장기 세션 + Apps Script 보안 중계
 * =========================================================
 */

const COOKIE_NAME =
  "__Host-moneybook_session";

const SESSION_MAX_AGE =
  60 * 60 * 24 * 400; // 400일

const encoder =
  new TextEncoder();

const decoder =
  new TextDecoder();


/**
 * =========================================================
 * 공통 응답
 * =========================================================
 */

function jsonResponse(
  data,
  status = 200,
  extraHeaders = {}
) {
  const headers =
    new Headers({
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store",

      "X-Content-Type-Options":
        "nosniff"
    });

  Object.entries(
    extraHeaders
  ).forEach(
    ([key, value]) => {
      headers.set(
        key,
        value
      );
    }
  );

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers
    }
  );
}


/**
 * =========================================================
 * LOGIN_USERS
 * =========================================================
 */

function getLoginUsers(
  env
) {
  if (
    !env.LOGIN_USERS
  ) {
    throw new Error(
      "LOGIN_USERS Secret이 설정되지 않았습니다."
    );
  }

  let users;

  try {
    users =
      JSON.parse(
        env.LOGIN_USERS
      );

  } catch (error) {
    throw new Error(
      "LOGIN_USERS가 올바른 JSON 형식이 아닙니다."
    );
  }

  if (
    !users ||
    typeof users !==
      "object" ||
    Array.isArray(
      users
    )
  ) {
    throw new Error(
      "LOGIN_USERS 형식이 올바르지 않습니다."
    );
  }

  return users;
}


/**
 * =========================================================
 * 안전한 문자열 비교
 * =========================================================
 */

async function safeEqual(
  valueA,
  valueB
) {
  const a =
    encoder.encode(
      String(valueA)
    );

  const b =
    encoder.encode(
      String(valueB)
    );

  const [
    hashA,
    hashB
  ] =
    await Promise.all([
      crypto.subtle.digest(
        "SHA-256",
        a
      ),

      crypto.subtle.digest(
        "SHA-256",
        b
      )
    ]);

  const bytesA =
    new Uint8Array(
      hashA
    );

  const bytesB =
    new Uint8Array(
      hashB
    );

  let difference = 0;

  for (
    let i = 0;
    i < bytesA.length;
    i++
  ) {
    difference |=
      bytesA[i] ^
      bytesB[i];
  }

  return difference === 0;
}


/**
 * =========================================================
 * Base64 URL
 * =========================================================
 */

function bytesToBase64Url(
  bytes
) {
  let binary = "";

  for (
    const byte of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte
      );
  }

  return btoa(
    binary
  )
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}


function base64UrlToBytes(
  value
) {
  let text =
    value
      .replace(
        /-/g,
        "+"
      )
      .replace(
        /_/g,
        "/"
      );

  text +=
    "=".repeat(
      (
        4 -
        text.length % 4
      ) % 4
    );

  const binary =
    atob(
      text
    );

  return Uint8Array.from(
    binary,
    char =>
      char.charCodeAt(
        0
      )
  );
}


/**
 * =========================================================
 * 세션 서명
 * =========================================================
 */

async function getSessionKey(
  env
) {
  if (
    !env.SESSION_SECRET
  ) {
    throw new Error(
      "SESSION_SECRET Secret이 설정되지 않았습니다."
    );
  }

  return crypto.subtle
    .importKey(
      "raw",

      encoder.encode(
        env.SESSION_SECRET
      ),

      {
        name:
          "HMAC",

        hash:
          "SHA-256"
      },

      false,

      [
        "sign",
        "verify"
      ]
    );
}


async function createSessionToken(
  name,
  env
) {
  const now =
    Math.floor(
      Date.now() /
      1000
    );

  const payload = {
    v: 1,

    name,

    iat:
      now,

    exp:
      now +
      SESSION_MAX_AGE
  };

  const body =
    bytesToBase64Url(
      encoder.encode(
        JSON.stringify(
          payload
        )
      )
    );

  const key =
    await getSessionKey(
      env
    );

  const signature =
    await crypto.subtle
      .sign(
        "HMAC",
        key,
        encoder.encode(
          body
        )
      );

  const signatureText =
    bytesToBase64Url(
      new Uint8Array(
        signature
      )
    );

  return (
    body +
    "." +
    signatureText
  );
}


async function verifySessionToken(
  token,
  env
) {
  if (
    !token ||
    typeof token !==
      "string"
  ) {
    return null;
  }

  const parts =
    token.split(
      "."
    );

  if (
    parts.length !== 2
  ) {
    return null;
  }

  const [
    body,
    signature
  ] =
    parts;

  try {
    const key =
      await getSessionKey(
        env
      );

    const valid =
      await crypto.subtle
        .verify(
          "HMAC",

          key,

          base64UrlToBytes(
            signature
          ),

          encoder.encode(
            body
          )
        );

    if (!valid) {
      return null;
    }

    const payload =
      JSON.parse(
        decoder.decode(
          base64UrlToBytes(
            body
          )
        )
      );

    const now =
      Math.floor(
        Date.now() /
        1000
      );

    if (
      !payload ||
      payload.v !== 1 ||
      typeof payload.name !==
        "string" ||
      !Number.isFinite(
        payload.exp
      ) ||
      payload.exp <= now
    ) {
      return null;
    }

    return payload;

  } catch (error) {
    return null;
  }
}


/**
 * =========================================================
 * Cookie
 * =========================================================
 */

function getCookie(
  request,
  name
) {
  const raw =
    request.headers.get(
      "Cookie"
    );

  if (!raw) {
    return "";
  }

  const cookies =
    raw.split(
      ";"
    );

  for (
    const cookie of cookies
  ) {
    const part =
      cookie.trim();

    const index =
      part.indexOf(
        "="
      );

    if (
      index < 0
    ) {
      continue;
    }

    const key =
      part
        .slice(
          0,
          index
        )
        .trim();

    const value =
      part.slice(
        index + 1
      );

    if (
      key === name
    ) {
      return value;
    }
  }

  return "";
}


function createCookie(
  token
) {
  return [
    COOKIE_NAME +
      "=" +
      token,

    "Path=/",

    "Max-Age=" +
      SESSION_MAX_AGE,

    "HttpOnly",

    "Secure",

    "SameSite=Strict"
  ].join(
    "; "
  );
}


function clearCookie() {
  return [
    COOKIE_NAME +
      "=",

    "Path=/",

    "Max-Age=0",

    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",

    "HttpOnly",

    "Secure",

    "SameSite=Strict"
  ].join(
    "; "
  );
}


/**
 * =========================================================
 * 로그인 상태 확인
 * =========================================================
 */

async function getSession(
  request,
  env
) {
  const token =
    getCookie(
      request,
      COOKIE_NAME
    );

  const payload =
    await verifySessionToken(
      token,
      env
    );

  if (!payload) {
    return null;
  }

  const users =
    getLoginUsers(
      env
    );

  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        users,
        payload.name
      )
  ) {
    return null;
  }

  return payload;
}


function unauthorized() {
  return jsonResponse(
    {
      success: false,

      loggedIn: false,

      error: {
        code:
          "LOGIN_REQUIRED",

        message:
          "로그인이 필요합니다."
      }
    },

    401
  );
}


/**
 * =========================================================
 * 같은 사이트 POST 요청만 허용
 * =========================================================
 */

function isSameOrigin(
  request
) {
  const origin =
    request.headers.get(
      "Origin"
    );

  if (!origin) {
    return true;
  }

  return (
    origin ===
    new URL(
      request.url
    ).origin
  );
}


/**
 * =========================================================
 * Apps Script GET
 * =========================================================
 */

async function appsScriptGet(
  env,
  action,
  params = {},
  useSecret = true
) {
  if (
    !env.APPS_SCRIPT_URL
  ) {
    throw new Error(
      "APPS_SCRIPT_URL Secret이 설정되지 않았습니다."
    );
  }

  const target =
    new URL(
      env.APPS_SCRIPT_URL
    );

  target.searchParams
    .set(
      "action",
      action
    );

  Object.entries(
    params
  ).forEach(
    ([key, value]) => {
      if (
        value !==
          undefined &&
        value !==
          null &&
        value !==
          ""
      ) {
        target
          .searchParams
          .set(
            key,
            String(
              value
            )
          );
      }
    }
  );

  if (
    useSecret
  ) {
    if (
      !env.LEDGER_API_SECRET
    ) {
      throw new Error(
        "LEDGER_API_SECRET Secret이 설정되지 않았습니다."
      );
    }

    target
      .searchParams
      .set(
        "apiSecret",
        env.LEDGER_API_SECRET
      );
  }

  const response =
    await fetch(
      target.toString(),
      {
        method:
          "GET",

        redirect:
          "follow"
      }
    );

  const text =
    await response.text();

  try {
    return JSON.parse(
      text
    );

  } catch (error) {
    throw new Error(
      "Apps Script가 JSON이 아닌 응답을 반환했습니다."
    );
  }
}


/**
 * =========================================================
 * Worker
 * =========================================================
 */

export default {

  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );

    try {

      /**
       * Worker 확인
       */
      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/ping"
      ) {
        return jsonResponse({
          success: true,

          message:
            "Cloudflare Worker is running."
        });
      }


      /**
       * Apps Script health
       */
      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/health"
      ) {
        const data =
          await appsScriptGet(
            env,
            "health",
            {},
            false
          );

        return jsonResponse(
          data
        );
      }


      /**
       * 로그인
       */
      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/login"
      ) {
        if (
          !isSameOrigin(
            request
          )
        ) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_ORIGIN",

                message:
                  "허용되지 않은 요청입니다."
              }
            },
            403
          );
        }

        let body;

        try {
          body =
            await request.json();

        } catch (error) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_JSON",

                message:
                  "로그인 요청 형식이 올바르지 않습니다."
              }
            },
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
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_LOGIN",

                message:
                  "이름 또는 비밀번호를 확인해주세요."
              }
            },
            401
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

        const valid =
          stored &&
          await safeEqual(
            password,
            stored
          );

        if (!valid) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_LOGIN",

                message:
                  "이름 또는 비밀번호를 확인해주세요."
              }
            },
            401
          );
        }

        const token =
          await createSessionToken(
            name,
            env
          );

        return jsonResponse(
          {
            success:
              true,

            loggedIn:
              true,

            user: {
              name
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


      /**
       * 세션 확인
       */
     /**
 * 세션 확인 + 로그인 기간 자동 연장
 */
if (
  request.method === "GET" &&
  url.pathname === "/api/auth/session"
) {
  const session =
    await getSession(
      request,
      env
    );

  if (!session) {
    return unauthorized();
  }

  // 앱을 열 때마다 새로운 400일 세션을 발급
  const refreshedToken =
    await createSessionToken(
      session.name,
      env
    );

  return jsonResponse(
    {
      success: true,
      loggedIn: true,

      user: {
        name: session.name
      }
    },

    200,

    {
      "Set-Cookie":
        createCookie(
          refreshedToken
        )
    }
  );
}

      /**
       * 로그아웃
       */
      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/auth/logout"
      ) {
        if (
          !isSameOrigin(
            request
          )
        ) {
          return jsonResponse(
            {
              success:
                false,

              error: {
                code:
                  "INVALID_ORIGIN",

                message:
                  "허용되지 않은 요청입니다."
              }
            },

            403
          );
        }

        return jsonResponse(
          {
            success:
              true,

            loggedIn:
              false
          },

          200,

          {
            "Set-Cookie":
              clearCookie()
          }
        );
      }


      /**
       * 이하 API는 로그인 필수
       */
      if (
        url.pathname
          .startsWith(
            "/api/"
          )
      ) {
        const session =
          await getSession(
            request,
            env
          );

        if (!session) {
          return unauthorized();
        }


        /**
         * 보안 연결 테스트
         */
        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/backend-test"
        ) {
          const data =
            await appsScriptGet(
              env,
              "bootstrap"
            );

          if (
            !data.success
          ) {
            return jsonResponse(
              {
                success:
                  false,

                backendAuthenticated:
                  false,

                error:
                  data.error ||
                  {
                    code:
                      "BACKEND_ERROR",

                    message:
                      "Apps Script 요청에 실패했습니다."
                  }
              },

              502
            );
          }

          const bootstrap =
            data.data ||
            {};

          return jsonResponse({
            success:
              true,

            backendAuthenticated:
              true,

            apiVersion:
              data.apiVersion,

            user:
              session.name,

            message:
              "로그인 + Cloudflare + Apps Script 연결 성공",

            counts: {
              accounts:
                Array.isArray(
                  bootstrap.accounts
                )
                  ? bootstrap
                      .accounts
                      .length
                  : 0,

              categories:
                Array.isArray(
                  bootstrap.categories
                )
                  ? bootstrap
                      .categories
                      .length
                  : 0,

              members:
                Array.isArray(
                  bootstrap.members
                )
                  ? bootstrap
                      .members
                      .length
                  : 0,

              spendingTargets:
                Array.isArray(
                  bootstrap.spendingTargets
                )
                  ? bootstrap
                      .spendingTargets
                      .length
                  : 0
            }
          });
        }


        /**
         * 프론트엔드가 곧 사용할
         * Bootstrap API
         */
        if (
          request.method ===
            "GET" &&
          url.pathname ===
            "/api/bootstrap"
        ) {
          const data =
            await appsScriptGet(
              env,
              "bootstrap"
            );

          return jsonResponse(
            data
          );
        }


        return jsonResponse(
          {
            success:
              false,

            error: {
              code:
                "API_NOT_FOUND",

              message:
                "지원하지 않는 API입니다."
            }
          },

          404
        );
      }


      return jsonResponse(
        {
          success:
            false,

          error: {
            code:
              "NOT_FOUND",

            message:
              "페이지를 찾을 수 없습니다."
          }
        },

        404
      );

    } catch (
      error
    ) {
      return jsonResponse(
        {
          success:
            false,

          error: {
            code:
              "WORKER_ERROR",

            message:
              error instanceof Error
                ? error.message
                : String(
                    error
                  )
          }
        },

        500
      );
    }
  }
};
