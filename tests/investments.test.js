import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  mbD1HandleCashBaseline,
  mbD1HandleHoldingUpdate,
  mbD1HandleTradeMutation,
  mbD1HoldingNeedsQuoteRefresh,
  mbD1RefreshQuotes
} from "../worker/d1/investments.js";
import { mbD1Holdings, mbD1Trades } from "../worker/d1/records.js";
import { mbD1InvestmentStatusFromData } from "../worker/d1/dashboard.js";
import { mbD1MapAccountRow } from "../worker/d1/records.js";
import {
  estimateTradeCosts,
  guessForeignCurrency
} from "../src/components/investment/tradeCostEstimate.ts";
import {
  amountToTradeUnits,
  isAmountProductCode,
  makeAmountProductCode
} from "../src/components/investment/amountProduct.ts";

// 투자 처리를 실제 Worker 함수로 SQLite 위에서 실행합니다. 외부 시세 요청은 가짜 응답으로 대신합니다.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0000_schema.sql", import.meta.url), "utf8"));
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_request_id_unique_indexes.sql", import.meta.url),
      "utf8"
    )
  );
  sqlite.exec(`INSERT INTO households(household_id,name) VALUES ('HH_MAIN','Test');
    INSERT INTO members(member_id,household_id,display_name) VALUES ('MEM_A','HH_MAIN','A');
    INSERT INTO accounts(account_id,household_id,name,display_name,account_type,sub_type,balance_method)
    VALUES ('INV','HH_MAIN','증권','증권','자산','주식','평가입력');`);
  const DB = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          return { ...this, values };
        },
        async all() {
          return { results: sqlite.prepare(this.sql).all(...this.values) };
        },
        async first() {
          return sqlite.prepare(this.sql).get(...this.values) || null;
        },
        async run() {
          return { success: true, meta: sqlite.prepare(this.sql).run(...this.values) };
        }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(statement => ({
          success: true,
          results: sqlite.prepare(statement.sql).all(...statement.values)
        }));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { sqlite, DB };
}

const session = { name: "A" };

function mockQuotes({ stocks = {}, usdKrw = 1400, fx = {}, previousClose = {} } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("/v1/finance/search")) {
      const q = String(url.searchParams.get("q") || "").toUpperCase();
      const quotes = stocks[q]
        ? [{ symbol: q, longname: q, exchange: "NMS", quoteType: "EQUITY" }]
        : [];
      return new Response(JSON.stringify({ quotes }), { status: 200 });
    }
    if (url.pathname.includes("/v8/finance/chart/")) {
      const symbol = decodeURIComponent(url.pathname.split("/").pop());
      const fxCode = symbol.endsWith("KRW=X") ? symbol.slice(0, 3) : "";
      const price =
        symbol === "KRW=X" ? usdKrw : fxCode && fx[fxCode] ? fx[fxCode] : stocks[symbol];
      if (!price) return new Response("{}", { status: 404 });
      const currency = symbol.endsWith("=X") ? "KRW" : "USD";
      const meta = { regularMarketPrice: price, currency };
      if (previousClose[symbol]) meta.chartPreviousClose = previousClose[symbol];
      return new Response(JSON.stringify({ chart: { result: [{ meta }] } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function withCash(env, amount = 100_000_000) {
  await mbD1HandleCashBaseline({ accountId: "INV", cashBaselineKrw: amount }, session, env);
}

const buy = (env, body) =>
  mbD1HandleTradeMutation(
    "/api/investments/trades",
    { accountId: "INV", tradeType: "매수", ...body },
    session,
    env,
    null
  );

test("a new holding can be recorded with a past trade date", async () => {
  const restore = mockQuotes();
  try {
    const env = database();
    await withCash(env);
    const result = await buy(env, {
      stockCode: "AMT-PAST",
      stockName: "IMA 1년",
      market: "국내",
      quoteMode: "수동",
      manualPrice: 1,
      tradeDate: "2025-03-02",
      quantity: 5_000_000,
      unitPrice: 1
    });
    assert.equal(result.created, true);
    const [holding] = await mbD1Holdings(env);
    assert.equal(holding.valueKrw, 5_000_000);
  } finally {
    restore();
  }
});

test("a newly bought stock is valued right away instead of showing 0원", async () => {
  const restore = mockQuotes({ stocks: { AAPL: 200 }, usdKrw: 1400 });
  try {
    const env = database();
    await withCash(env);
    await buy(env, {
      stockCode: "AAPL",
      stockName: "Apple",
      market: "해외",
      tradeDate: "2026-11-20",
      quantity: 2,
      unitPrice: 190,
      currency: "USD",
      fxRate: 1380
    });
    const [holding] = await mbD1Holdings(env);
    assert.equal(holding.currentPrice, 200);
    assert.equal(holding.fx, 1400);
    assert.equal(holding.valueKrw, 2 * 200 * 1400);
    assert.equal(typeof holding.updatedAtMs, "number");
  } finally {
    restore();
  }
});

test("a dollar note keeps following the exchange rate while its value is manual", async () => {
  const restore = mockQuotes({ usdKrw: 1380 });
  try {
    const env = database();
    await withCash(env);
    await buy(env, {
      stockCode: "AMT-USDNOTE",
      stockName: "달러 발행어음",
      market: "해외",
      quoteMode: "수동",
      manualPrice: 1,
      tradeDate: "2026-11-20",
      quantity: 10_000,
      unitPrice: 1,
      currency: "USD",
      fxRate: 1380
    });
    let [holding] = await mbD1Holdings(env);
    assert.equal(holding.valueKrw, 13_800_000);
    assert.equal(mbD1HoldingNeedsQuoteRefresh(holding), true);

    restore();
    const restoreLater = mockQuotes({ usdKrw: 1450 });
    try {
      await mbD1RefreshQuotes(env, true);
      [holding] = await mbD1Holdings(env);
      assert.equal(holding.fx, 1450);
      assert.equal(holding.valueKrw, 14_500_000);

      // 이자가 붙어 평가금액이 10,120달러가 되면 평가단가 1.012로 저장합니다.
      await mbD1HandleHoldingUpdate(
        { holdingId: holding.holdingId, manualPrice: 1.012, lastUpdated: "2026-11-27" },
        session,
        env
      );
      [holding] = await mbD1Holdings(env);
      assert.equal(holding.valueKrw, Math.round(10_000 * 1.012 * 1450 * 100) / 100);
    } finally {
      restoreLater();
    }
  } finally {
    restore();
  }
});

test("an auto holding that never gets a quote can be switched to a manual price", async () => {
  const restore = mockQuotes();
  try {
    const env = database();
    await withCash(env);
    await buy(env, {
      stockCode: "PRIVATE1",
      stockName: "장외 상품",
      market: "국내",
      quoteMode: "자동",
      tradeDate: "2026-11-20",
      quantity: 10,
      unitPrice: 50_000
    });
    let [holding] = await mbD1Holdings(env);
    // 시세가 없어도 체결단가로 먼저 평가합니다.
    assert.equal(holding.valueKrw, 500_000);

    await mbD1HandleHoldingUpdate(
      { holdingId: holding.holdingId, quoteMode: "수동" },
      session,
      env
    );
    [holding] = await mbD1Holdings(env);
    assert.equal(holding.quoteMode, "수동");
    assert.equal(holding.manualPrice, 50_000);
    assert.equal(holding.valueKrw, 500_000);
  } finally {
    restore();
  }
});

test("closing an amount product records the interest as realized profit", async () => {
  const restore = mockQuotes();
  try {
    const env = database();
    await withCash(env);
    await buy(env, {
      stockCode: "AMT-KRWNOTE",
      stockName: "발행어음",
      market: "국내",
      quoteMode: "수동",
      manualPrice: 1,
      tradeDate: "2026-01-02",
      quantity: 1_000_000,
      unitPrice: 1
    });
    const [holding] = await mbD1Holdings(env);
    const units = amountToTradeUnits({
      tradeType: "매도",
      amount: 1_032_000,
      unitPrice: 1,
      heldQuantity: holding.quantity,
      closeAll: true
    });
    await mbD1HandleTradeMutation(
      "/api/investments/trades",
      {
        accountId: "INV",
        tradeType: "매도",
        stockCode: "AMT-KRWNOTE",
        tradeDate: "2026-11-27",
        ...units
      },
      session,
      env,
      null
    );
    const sell = (await mbD1Trades(env)).find(trade => trade.tradeType === "매도");
    assert.equal(sell.settlementKrw, 1_032_000);
    assert.equal(sell.realizedPnlKrw, 32_000);
    const [closed] = await mbD1Holdings(env);
    assert.equal(closed.quantity, 0);
  } finally {
    restore();
  }
});

test("amount products convert money into trade units", () => {
  assert.equal(isAmountProductCode(makeAmountProductCode(0, 0)), true);
  assert.equal(isAmountProductCode("005930"), false);
  assert.deepEqual(amountToTradeUnits({ tradeType: "매수", amount: 1012, unitPrice: 1.012 }), {
    quantity: 1000,
    unitPrice: 1.012
  });
  assert.deepEqual(
    amountToTradeUnits({ tradeType: "매도", amount: 506, unitPrice: 1.012, heldQuantity: 1000 }),
    { quantity: 500, unitPrice: 1.012 }
  );
  assert.equal(amountToTradeUnits({ tradeType: "매수", amount: 0, unitPrice: 1 }), null);
});

test("dividends add cash and realized profit without changing the position", async () => {
  const restore = mockQuotes({ stocks: { AAPL: 200 }, previousClose: { AAPL: 190 } });
  try {
    const env = database();
    await withCash(env, 1_000_000);
    await buy(env, {
      stockCode: "AAPL",
      stockName: "Apple",
      market: "해외",
      tradeDate: "2026-11-20",
      quantity: 2,
      unitPrice: 190,
      currency: "USD",
      fxRate: 1400
    });
    let [holding] = await mbD1Holdings(env);
    assert.ok(Math.abs(holding.dayChangeRate - (200 / 190 - 1)) < 1e-12);
    const before = { quantity: holding.quantity, bookCostKrw: holding.bookCostKrw };
    await buy(env, {
      tradeType: "배당",
      stockCode: "AAPL",
      tradeDate: "2026-11-25",
      quantity: 1,
      unitPrice: 0.5,
      currency: "USD",
      fxRate: 1400
    });
    [holding] = await mbD1Holdings(env);
    assert.deepEqual({ quantity: holding.quantity, bookCostKrw: holding.bookCostKrw }, before);
    const dividend = (await mbD1Trades(env)).find(trade => trade.tradeType === "배당");
    assert.equal(dividend.settlementKrw, 700);
    assert.equal(dividend.realizedPnlKrw, 700);

    const accounts = (await env.DB.prepare("SELECT * FROM accounts").all()).results.map(
      mbD1MapAccountRow
    );
    const status = mbD1InvestmentStatusFromData(
      accounts,
      [],
      await mbD1Trades(env),
      await mbD1Holdings(env)
    );
    assert.equal(status.accounts[0].currentCashKrw, 1_000_000 - 2 * 190 * 1400 + 700);
  } finally {
    restore();
  }
});

test("a manual yen holding follows the yen exchange rate, not the dollar", async () => {
  const restore = mockQuotes({ usdKrw: 1400, fx: { JPY: 9.5 } });
  try {
    const env = database();
    await withCash(env);
    await buy(env, {
      stockCode: "JPFUND",
      stockName: "일본 펀드",
      market: "해외",
      quoteMode: "수동",
      manualPrice: 1000,
      tradeDate: "2026-11-20",
      quantity: 100,
      unitPrice: 1000,
      currency: "JPY",
      fxRate: 9
    });
    await mbD1RefreshQuotes(env, true);
    const [holding] = await mbD1Holdings(env);
    assert.equal(holding.fx, 9.5);
    assert.equal(holding.valueKrw, 100 * 1000 * 9.5);
  } finally {
    restore();
  }
});

test("fees and taxes are estimated from this account's own recent trades", () => {
  const trade = overrides => ({
    investmentTradeId: Math.random().toString(36),
    date: "2026-11-01",
    tradeType: "매수",
    stockCode: "005930",
    market: "국내",
    quantity: 10,
    unitPrice: 100_000,
    fxRate: 1,
    feeKrw: 150,
    taxKrw: 0,
    isDeleted: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides
  });
  const trades = [
    trade({}),
    trade({ tradeType: "매도", taxKrw: 1500, date: "2026-11-02" }),
    trade({ market: "해외", feeKrw: 2500 })
  ];
  const sell = estimateTradeCosts(trades, {
    tradeType: "매도",
    market: "국내",
    stockCode: "005930",
    grossKrw: 2_000_000
  });
  assert.equal(sell.feeKrw, 300);
  assert.equal(sell.taxKrw, 3000);
  // 처음 파는 종목은 세금을 추측하지 않습니다.
  const other = estimateTradeCosts(trades, {
    tradeType: "매도",
    market: "국내",
    stockCode: "069500",
    grossKrw: 2_000_000
  });
  assert.equal(other.taxKrw, 0);
  assert.equal(guessForeignCurrency("7203.T"), "JPY");
  assert.equal(guessForeignCurrency("AAPL"), "USD");
});
