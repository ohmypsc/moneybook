import test from "node:test";
import assert from "node:assert/strict";

import {
  lookupFxRate,
  normalizeFxCurrency,
  normalizeFxDate,
  pickFxCloseForDate
} from "../worker/fxRates.js";

const kst = date => Date.parse(`${date}T09:00:00+09:00`) / 1000;

test("a past date uses that day's close, or the last business day before it", () => {
  const chart = {
    chart: {
      result: [
        {
          timestamp: [kst("2026-11-19"), kst("2026-11-20"), kst("2026-11-23")],
          indicators: { quote: [{ close: [1390, 1401.5, 1410] }] }
        }
      ]
    }
  };
  assert.deepEqual(pickFxCloseForDate(chart, "2026-11-20"), { rate: 1401.5, date: "2026-11-20" });
  // 토요일 거래는 금요일 종가
  assert.deepEqual(pickFxCloseForDate(chart, "2026-11-21"), { rate: 1401.5, date: "2026-11-20" });
  assert.equal(pickFxCloseForDate(chart, "2026-11-18"), null);
});

test("today and future dates use the live rate; past dates ask for history", async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(String(url));
    const parsed = new URL(String(url));
    const body = parsed.searchParams.get("range")
      ? { chart: { result: [{ meta: { regularMarketPrice: 9.41 } }] } }
      : {
          chart: {
            result: [{ timestamp: [kst("2026-11-02")], indicators: { quote: [{ close: [9.2] }] } }]
          }
        };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const now = Date.parse("2026-11-27T12:00:00+09:00");
  const live = await lookupFxRate("JPY", "2026-12-01", { now, fetchImpl });
  assert.equal(live.rate, 9.41);
  assert.equal(live.live, true);
  assert.match(urls[0], /JPYKRW%3DX|JPYKRW=X/);

  const past = await lookupFxRate("JPY", "2026-11-02", { now, fetchImpl });
  assert.deepEqual(
    { rate: past.rate, rateDate: past.rateDate, live: past.live },
    { rate: 9.2, rateDate: "2026-11-02", live: false }
  );
  assert.match(urls[1], /period1=/);
});

test("fx inputs are validated", () => {
  assert.equal(normalizeFxCurrency("usd"), "USD");
  assert.equal(normalizeFxCurrency("KRW"), "");
  assert.equal(normalizeFxCurrency("US"), "");
  assert.equal(normalizeFxDate("2026-11-20"), "2026-11-20");
  assert.equal(normalizeFxDate("11/20"), "");
});
