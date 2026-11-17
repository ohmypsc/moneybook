// 투자 종목 검색·조회 라우트 (외부 시세 검색, D1 미사용)
import { errorResponse, jsonResponse } from "./http.js";
import { lookupInvestmentSymbol, normalizeInvestmentLookupCode, normalizeInvestmentSearchQuery, searchInvestmentSymbols } from "./investmentSymbols.js";

export async function handleInvestmentSymbolLookup(url) {
  const code = normalizeInvestmentLookupCode(
    url.searchParams.get("code")
  );

  if (!code) {
    return errorResponse(
      "INVALID_STOCK_CODE",
      "종목코드 형식이 올바르지 않습니다.",
      400
    );
  }

  const data =
    await lookupInvestmentSymbol(code);

  return jsonResponse(
    {
      success: true,
      data
    },
    200,
    {
      "Cache-Control":
        data.found
          ? "private, max-age=86400"
          : "private, max-age=300"
    }
  );
}

export async function handleInvestmentSymbolSearch(url) {
  const query = normalizeInvestmentSearchQuery(
    url.searchParams.get("q")
  );

  if (!query) {
    return jsonResponse(
      {
        success: true,
        data: {
          query: "",
          items: []
        }
      },
      200,
      {
        "Cache-Control": "private, max-age=60"
      }
    );
  }

  const data = await searchInvestmentSymbols(query);

  return jsonResponse(
    {
      success: true,
      data
    },
    200,
    {
      "Cache-Control": "private, max-age=300"
    }
  );
}
