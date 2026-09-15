import test from "node:test";
import assert from "node:assert/strict";

import {
  applyKoreanFundAliases,
  normalizeInvestmentLookupCode,
  normalizeInvestmentSearchQuery,
  scoreInvestmentSearchItem
} from "../worker/investmentSymbols.js";

test("investment lookup code normalization rejects unsafe or overlong codes", () => {
  assert.equal(normalizeInvestmentLookupCode(" aapl "), "AAPL");
  assert.equal(normalizeInvestmentLookupCode("005930"), "005930");
  assert.equal(normalizeInvestmentLookupCode("AAPL<script>"), "");
});

test("investment search query removes control characters and limits length", () => {
  assert.equal(normalizeInvestmentSearchQuery("  타이거\u0000 미국S&P  "), "타이거 미국S&P");
  assert.equal(normalizeInvestmentSearchQuery("가".repeat(80)).length, 60);
});

test("Korean ETF brand aliases improve matching with official English names", () => {
  assert.equal(applyKoreanFundAliases("타이거 미국S&P"), "TIGER 미국S&P");

  const item = {
    stockCode: "360750",
    stockName: "TIGER 미국S&P500",
    market: "국내",
    exchange: "KRX",
    assetType: "ETF",
    source: "krx"
  };

  assert.ok(scoreInvestmentSearchItem(item, "타이거 미국S&P") > 0);
});
