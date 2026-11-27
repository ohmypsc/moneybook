// 원화 환율 조회 (투자 입력 화면의 체결 환율 자동 채우기)
// - 오늘(한국시간) 이후 날짜: 현재 환율
// - 지난 날짜: 그날(휴장일이면 직전 영업일) 종가
const FX_CACHE_MAX_ENTRIES = 200;
const FX_TODAY_TTL_MS = 5 * 60 * 1000;
const FX_PAST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const fxMemory = new Map();

export function normalizeFxCurrency(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) && code !== "KRW" ? code : "";
}

export function normalizeFxDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  return Number.isFinite(Date.parse(`${text}T00:00:00+09:00`)) ? text : "";
}

export function seoulToday(now = Date.now()) {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function yahooFxSymbol(currency) {
  return currency === "USD" ? "KRW=X" : `${currency}KRW=X`;
}

// 일봉 응답에서 그날(한국시간) 끝 이전의 마지막 종가를 고릅니다.
export function pickFxCloseForDate(chart, date) {
  const result = chart?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const endMs = Date.parse(`${date}T00:00:00+09:00`) + DAY_MS;
  let picked = null;
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = Number(closes[index]);
    if (timestamps[index] * 1000 >= endMs || !Number.isFinite(close) || close <= 0) continue;
    picked = { rate: close, date: seoulToday(timestamps[index] * 1000) };
  }
  return picked;
}

async function fetchChart(symbol, params, fetchImpl) {
  const endpoint = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
  );
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetchImpl(endpoint.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 moneybook-fx" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupFxRate(currency, date, { now = Date.now(), fetchImpl = fetch } = {}) {
  const today = seoulToday(now);
  const target = !date || date > today ? today : date;
  const isToday = target === today;
  const key = `${currency}:${target}`;
  const cached = fxMemory.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const symbol = yahooFxSymbol(currency);
  let data = null;

  if (isToday) {
    const chart = await fetchChart(symbol, { range: "1d", interval: "1d" }, fetchImpl);
    const rate = Number(chart?.chart?.result?.[0]?.meta?.regularMarketPrice);
    if (Number.isFinite(rate) && rate > 0) {
      data = { currency, requestedDate: target, rateDate: target, rate, live: true };
    }
  } else {
    const endSec = Math.floor((Date.parse(`${target}T00:00:00+09:00`) + DAY_MS) / 1000);
    const chart = await fetchChart(
      symbol,
      { period1: endSec - 10 * 86400, period2: endSec, interval: "1d" },
      fetchImpl
    );
    const picked = pickFxCloseForDate(chart, target);
    if (picked) {
      data = {
        currency,
        requestedDate: target,
        rateDate: picked.date,
        rate: picked.rate,
        live: false
      };
    }
  }

  if (data) {
    fxMemory.set(key, { data, expiresAt: now + (isToday ? FX_TODAY_TTL_MS : FX_PAST_TTL_MS) });
    if (fxMemory.size > FX_CACHE_MAX_ENTRIES) {
      const oldest = fxMemory.keys().next().value;
      if (oldest) fxMemory.delete(oldest);
    }
  }
  return data;
}
