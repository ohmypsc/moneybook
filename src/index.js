export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Cloudflare Worker 자체 동작 확인용
    if (url.pathname === "/api/ping") {
      return Response.json({
        success: true,
        message: "Cloudflare Worker is running."
      });
    }

    // 이후 Apps Script 연결용
    if (url.pathname === "/api/health") {
      if (!env.APPS_SCRIPT_URL) {
        return Response.json(
          {
            success: false,
            error: "APPS_SCRIPT_URL secret is not configured."
          },
          { status: 500 }
        );
      }

      const target =
        env.APPS_SCRIPT_URL +
        "?action=health";

      try {
        const response = await fetch(target, {
          method: "GET",
          redirect: "follow"
        });

        const text = await response.text();

        return new Response(text, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("Content-Type") ||
              "application/json; charset=utf-8"
          }
        });
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Apps Script connection failed.",
            message: error.message
          },
          { status: 502 }
        );
      }
    }

    return Response.json(
      {
        success: false,
        error: "API endpoint not found."
      },
      { status: 404 }
    );
  }
};
