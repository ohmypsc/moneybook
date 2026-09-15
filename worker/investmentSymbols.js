const SYMBOL_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const SYMBOL_LOOKUP_MAX_ENTRIES = 200;
const SYMBOL_SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const SYMBOL_SEARCH_MAX_ENTRIES = 120;

const symbolLookupMemory = new Map();
const symbolSearchMemory = new Map();

export function normalizeInvestmentLookupCode(value) {
  const code = String(value || "").trim().toUpperCase();

  if (!code || !/^[A-Z0-9.^_-]{1,24}$/.test(code)) {
    return "";
  }

  return code;
}

function inferInvestmentMarket(code) {
  return /^\d+$/.test(code) ? "국내" : "해외";
}

function normalizeYahooSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function yahooBaseSymbol(symbol) {
  return normalizeYahooSymbol(symbol).replace(/\.(KS|KQ)$/i, "");
}

function yahooQuoteName(quote) {
  return String(
    quote?.longname || quote?.shortname || quote?.displayName || ""
  ).trim();
}

function scoreYahooQuote(quote, code) {
  const symbol = normalizeYahooSymbol(quote?.symbol);
  const base = yahooBaseSymbol(symbol);
  const exchange = String(quote?.exchange || "").toUpperCase();
  const quoteType = String(quote?.quoteType || "").toUpperCase();

  let score = 0;
  if (symbol === code) score += 100;
  if (base === code) score += 90;

  if (
    /^\d+$/.test(code) &&
    (exchange === "KSC" || exchange === "KOE" || /\.(KS|KQ)$/.test(symbol))
  ) {
    score += 30;
  }

  if (["EQUITY", "ETF", "MUTUALFUND", "FUND"].includes(quoteType)) {
    score += 15;
  }

  if (yahooQuoteName(quote)) score += 5;
  return score;
}

function chooseYahooQuote(quotes, code) {
  return (Array.isArray(quotes) ? quotes : [])
    .filter(quote => yahooQuoteName(quote))
    .map(quote => ({ quote, score: scoreYahooQuote(quote, code) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.quote || null;
}

async function fetchYahooSymbolSearch(query) {
  const endpoint = new URL(
    "https://query1.finance.yahoo.com/v1/finance/search"
  );

  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("quotesCount", "8");
  endpoint.searchParams.set("newsCount", "0");
  endpoint.searchParams.set("listsCount", "0");
  endpoint.searchParams.set("lang", "ko-KR");
  endpoint.searchParams.set("region", "KR");
  endpoint.searchParams.set("enableFuzzyQuery", "false");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  let response;
  try {
    response = await fetch(endpoint.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 moneybook-symbol-lookup"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return [];

  const data = await response.json();
  return Array.isArray(data?.quotes) ? data.quotes : [];
}

function rememberSymbolLookup(code, data) {
  symbolLookupMemory.set(code, {
    data,
    expiresAt: Date.now() + SYMBOL_LOOKUP_TTL_MS
  });

  if (symbolLookupMemory.size > SYMBOL_LOOKUP_MAX_ENTRIES) {
    const oldestKey = symbolLookupMemory.keys().next().value;
    if (oldestKey) symbolLookupMemory.delete(oldestKey);
  }
}

export async function lookupInvestmentSymbol(code) {
  const cached = symbolLookupMemory.get(code);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const inferredMarket = inferInvestmentMarket(code);

  try {
    const quotes = await fetchYahooSymbolSearch(code);
    let match = chooseYahooQuote(quotes, code);

    if (!match && inferredMarket === "국내") {
      const fallbackResults = await Promise.all([
        fetchYahooSymbolSearch(`${code}.KS`),
        fetchYahooSymbolSearch(`${code}.KQ`)
      ]);
      match = chooseYahooQuote(fallbackResults.flat(), code);
    }

    if (match) {
      const symbol = normalizeYahooSymbol(match.symbol);
      const exchange = String(match.exchange || match.exchDisp || "").trim();
      const domestic =
        /^\d+$/.test(code) ||
        /\.(KS|KQ)$/.test(symbol) ||
        ["KSC", "KOE"].includes(String(match.exchange || "").toUpperCase());

      const result = {
        found: true,
        stockCode: code,
        stockName: yahooQuoteName(match),
        market: domestic ? "국내" : "해외",
        symbol,
        exchange,
        source: "yahoo-finance"
      };

      rememberSymbolLookup(code, result);
      return result;
    }
  } catch {
    // 외부 조회 실패는 매매 기록 자체를 막지 않는다.
  }

  const result = {
    found: false,
    stockCode: code,
    stockName: "",
    market: inferredMarket,
    source: "fallback"
  };

  symbolLookupMemory.set(code, {
    data: result,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  return result;
}

export function normalizeInvestmentSearchQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 60);
}

export function applyKoreanFundAliases(value) {
  let query = String(value || "");

  const replacements = [
    [/코덱스/gi, "KODEX"],
    [/타이거/gi, "TIGER"],
    [/에이스/gi, "ACE"],
    [/라이즈/gi, "RISE"],
    [/솔/gi, "SOL"],
    [/플러스/gi, "PLUS"],
    [/타임폴리오/gi, "TIMEFOLIO"]
  ];

  for (const [pattern, replacement] of replacements) {
    query = query.replace(pattern, replacement);
  }

  return query;
}

function compactInvestmentSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeKrxShortCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  return /^A[0-9A-Z]{6}$/.test(raw) ? raw.slice(1) : raw;
}

function krxFinderRows(data) {
  if (Array.isArray(data?.block1)) return data.block1;
  if (Array.isArray(data?.output)) return data.output;
  return [];
}

async function fetchKrxFinder(query, bld, assetType) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  const body = new URLSearchParams();
  body.set("locale", "ko_KR");
  body.set("mktsel", "ALL");
  body.set("typeNo", "0");
  body.set("searchText", query);
  body.set("bld", bld);

  let response;
  try {
    response = await fetch(
      "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "https://data.krx.co.kr/",
          "User-Agent": "Mozilla/5.0 moneybook-krx-symbol-search"
        },
        body: body.toString(),
        signal: controller.signal
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return [];

  let data;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  return krxFinderRows(data)
    .map(row => {
      const stockCode = normalizeKrxShortCode(
        row?.short_code || row?.shortCode || row?.ISU_SRT_CD || row?.isuSrtCd || ""
      );
      const stockName = String(
        row?.codeName || row?.isuNm || row?.ISU_NM || row?.ISU_ABBRV || ""
      ).trim();

      if (!stockCode || !stockName) return null;

      return {
        stockCode,
        stockName,
        market: "국내",
        symbol: stockCode,
        exchange: String(
          row?.marketName || row?.marketEngName || row?.MKT_NM || "KRX"
        ).trim(),
        assetType,
        source: "krx"
      };
    })
    .filter(Boolean);
}

function krxGoldSpotSearchItem() {
  return {
    stockCode: "04020000",
    stockName: "금 현물 99.99_1Kg",
    market: "국내",
    symbol: "04020000",
    exchange: "KRX 금시장",
    assetType: "금현물",
    source: "krx-gold"
  };
}

function yahooSearchItem(quote) {
  const symbol = normalizeYahooSymbol(quote?.symbol);
  const stockName = yahooQuoteName(quote);
  const exchangeCode = String(quote?.exchange || "").toUpperCase();
  const exchange = String(quote?.exchDisp || quote?.exchange || "").trim();
  const quoteType = String(quote?.quoteType || "").toUpperCase();

  if (!symbol || !stockName) return null;
  if (!["EQUITY", "ETF", "MUTUALFUND", "FUND"].includes(quoteType)) {
    return null;
  }

  const domestic =
    /\.(KS|KQ)$/.test(symbol) || ["KSC", "KOE"].includes(exchangeCode);
  const stockCode = domestic ? yahooBaseSymbol(symbol) : symbol;

  return {
    stockCode,
    stockName,
    market: domestic ? "국내" : "해외",
    symbol,
    exchange,
    assetType:
      quoteType === "ETF" ? "ETF" : quoteType === "EQUITY" ? "주식" : "펀드",
    source: "yahoo-finance"
  };
}

export function scoreInvestmentSearchItem(item, query) {
  const rawQuery = compactInvestmentSearchText(query);
  const aliasedText = applyKoreanFundAliases(query);
  const aliasQuery = compactInvestmentSearchText(aliasedText);
  const name = compactInvestmentSearchText(item.stockName);
  const code = compactInvestmentSearchText(item.stockCode);
  const haystack = `${name}${code}${compactInvestmentSearchText(item.exchange || "")}${compactInvestmentSearchText(item.assetType || "")}`;
  const tokenTerms = aliasedText
    .split(/\s+/)
    .map(compactInvestmentSearchText)
    .filter(Boolean);

  let score = 0;

  for (const term of new Set([rawQuery, aliasQuery])) {
    if (!term) continue;
    if (code === term) score = Math.max(score, 220);
    if (name === term) score = Math.max(score, 210);
    if (name.startsWith(term)) score = Math.max(score, 180);
    if (name.includes(term)) score = Math.max(score, 150);
    if (code.startsWith(term)) score = Math.max(score, 140);
    if (code.includes(term)) score = Math.max(score, 120);
  }

  if (tokenTerms.length > 1 && tokenTerms.every(term => haystack.includes(term))) {
    score = Math.max(score, 170);
  }

  if (score > 0 && (item.source === "krx" || item.source === "krx-gold")) {
    score += 25;
  }

  return score;
}

function buildKrxSearchQueries(query) {
  const full = applyKoreanFundAliases(query).trim();
  const knownBrands = new Set([
    "KODEX", "TIGER", "ACE", "RISE", "SOL", "PLUS", "TIMEFOLIO"
  ]);
  const tokens = full.split(/\s+/).map(token => token.trim()).filter(Boolean);
  const fallbackToken = tokens
    .filter(token => !knownBrands.has(token.toUpperCase()))
    .sort((a, b) => b.length - a.length)[0];

  return Array.from(new Set([full, fallbackToken].filter(Boolean))).slice(0, 2);
}

function dedupeInvestmentSearchItems(items, query) {
  const byKey = new Map();

  for (const item of items) {
    if (!item?.stockCode || !item?.stockName) continue;

    const key = `${item.market}:${String(item.stockCode).toUpperCase()}`;
    const existing = byKey.get(key);

    if (!existing || (existing.source !== "krx" && item.source === "krx")) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values())
    .map(item => ({ item, score: scoreInvestmentSearchItem(item, query) }))
    .filter(entry => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.item.stockName.localeCompare(b.item.stockName, "ko")
    )
    .slice(0, 40)
    .map(entry => entry.item);
}

function rememberSymbolSearch(key, data) {
  symbolSearchMemory.set(key, {
    data,
    expiresAt: Date.now() + SYMBOL_SEARCH_TTL_MS
  });

  if (symbolSearchMemory.size > SYMBOL_SEARCH_MAX_ENTRIES) {
    const oldestKey = symbolSearchMemory.keys().next().value;
    if (oldestKey) symbolSearchMemory.delete(oldestKey);
  }
}

export async function searchInvestmentSymbols(query) {
  const normalized = normalizeInvestmentSearchQuery(query);
  if (!normalized) return { query: "", items: [] };

  const cacheKey = normalized.toLocaleLowerCase("ko");
  const cached = symbolSearchMemory.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const domesticQuery = applyKoreanFundAliases(normalized);
  const krxQueries = buildKrxSearchQueries(normalized);
  const tasks = [
    ...krxQueries.flatMap(krxQuery => [
      fetchKrxFinder(krxQuery, "dbms/comm/finder/finder_stkisu", "주식"),
      fetchKrxFinder(krxQuery, "dbms/comm/finder/finder_secuprodisu", "ETF·ETN")
    ]),
    fetchYahooSymbolSearch(domesticQuery).then(quotes =>
      quotes.map(yahooSearchItem).filter(Boolean)
    )
  ];

  const settled = await Promise.allSettled(tasks);
  const fulfilledExternalItems = settled.flatMap(result =>
    result.status === "fulfilled" ? result.value : []
  );
  const externalProviderSucceeded = settled.some(result => result.status === "fulfilled");
  const combined = [krxGoldSpotSearchItem(), ...fulfilledExternalItems];
  const data = {
    query: normalized,
    items: dedupeInvestmentSearchItems(combined, normalized)
  };

  if (!externalProviderSucceeded) {
    symbolSearchMemory.set(cacheKey, {
      data,
      expiresAt: Date.now() + 2 * 60 * 1000
    });
  } else {
    rememberSymbolSearch(cacheKey, data);
  }

  return data;
}
