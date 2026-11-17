// 투자: 보유종목·투자거래 처리와 시세·환율 갱신
import { dateOnly as mbD1DateOnly } from "../domain/date.js";
import { lookupInvestmentSymbol } from "../investmentSymbols.js";
import {
  MB_D1_HOUSEHOLD_ID,
  mbD1Bool,
  mbD1CurrentDateSeoul,
  mbD1Fail,
  mbD1First,
  mbD1Has,
  mbD1Id,
  mbD1InsertChange,
  mbD1IsInvestmentAccount,
  mbD1Now,
  mbD1Number,
  mbD1Round,
  mbD1Text,
  mbD1TimestampMs
} from "./core.js";
import { mbD1TransactionAfterBaseline } from "./dashboard.js";
import {
  mbD1AccountById,
  mbD1AllTransactions,
  mbD1Holdings,
  mbD1MapHoldingRow,
  mbD1Trades
} from "./records.js";
import { mbD1LooksLikeRequestIdUniqueConflict } from "./transactions.js";

export const MB_D1_QUOTE_REFRESH_MS = 5 * 60 * 1000;
export let mbD1LastQuoteRefreshAt = 0;
export let mbD1QuoteRefreshPromise = null;

export async function mbD1HoldingById(env, id, includeDeleted = true) {
  const row = await mbD1First(
    env,
    `SELECT h.*,a.display_name AS account_name FROM holdings h LEFT JOIN accounts a ON a.account_id=h.account_id
     WHERE h.household_id=? AND h.holding_id=? ${includeDeleted ? "" : "AND h.deleted_at IS NULL"} LIMIT 1`,
    [MB_D1_HOUSEHOLD_ID, id]
  );
  return row ? mbD1MapHoldingRow(row) : null;
}

export async function mbD1HandleCashBaseline(body, session, env) {
  const accountId = mbD1Text(body.accountId);
  if (!accountId) mbD1Fail("INVESTMENT_ACCOUNT_ID_REQUIRED", "투자계좌 accountId가 필요합니다.");
  const amountRaw = mbD1Has(body, "amount") ? body.amount : body.cashBaselineKrw;
  if (amountRaw === null || amountRaw === undefined || amountRaw === "")
    mbD1Fail("INVESTMENT_CASH_AMOUNT_REQUIRED", "현재 예수금 금액이 필요합니다.");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) mbD1Fail("INVALID_NUMBER", "예수금은 숫자여야 합니다.");
  const account = await mbD1AccountById(env, accountId, false);
  if (!account || !account.active || !mbD1IsInvestmentAccount(account))
    mbD1Fail("INVESTMENT_ACCOUNT_NOT_FOUND", "사용 가능한 투자계좌를 찾을 수 없습니다.");
  const hasTrades = await mbD1First(
    env,
    "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND account_id=? AND deleted_at IS NULL LIMIT 1",
    [MB_D1_HOUSEHOLD_ID, accountId]
  );
  if (account.cashBaselineAt && hasTrades && !mbD1Bool(body.force))
    mbD1Fail(
      "INVESTMENT_CASH_BASELINE_LOCKED",
      "이미 투자거래가 있는 계좌입니다. 새 기준점으로 강제 재설정하려면 force가 필요합니다."
    );
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE accounts SET investment_cash_baseline_krw=?,investment_cash_baseline_at=?,updated_at=?,updated_by=? WHERE household_id=? AND account_id=?"
  ).bind(amount, now, now, session.name, MB_D1_HOUSEHOLD_ID, accountId);
  const change = await mbD1InsertChange(env, "account", accountId, "updated", null, session, {
    cashBaselineKrw: amount
  });
  await env.DB.batch([update, change]);
  return {
    updated: true,
    accountId,
    accountName: account.displayName,
    cashBaselineKrw: amount,
    cashBaselineAt: now
  };
}

export async function mbD1HandleHoldingUpdate(body, session, env) {
  const holdingId = mbD1Text(body.holdingId);
  if (!holdingId) mbD1Fail("HOLDING_ID_REQUIRED", "holdingId가 필요합니다.");
  const holding = await mbD1HoldingById(env, holdingId, false);
  if (!holding) mbD1Fail("HOLDING_NOT_FOUND", "수정할 보유종목을 찾을 수 없습니다.", 404);
  const manualPrice = Number(body.manualPrice);
  if (!Number.isFinite(manualPrice) || manualPrice < 0)
    mbD1Fail("INVALID_NUMBER", "수동입력가는 0 이상의 숫자여야 합니다.");
  const lastUpdated = mbD1DateOnly(body.lastUpdated) || mbD1CurrentDateSeoul();
  const fx = holding.market === "국내" ? 1 : holding.fx || 0;
  const valueKrw = mbD1Round(holding.quantity * manualPrice * fx, 2);
  const returnRate =
    holding.bookCostKrw > 0 ? (valueKrw - holding.bookCostKrw) / holding.bookCostKrw : null;
  const now = mbD1Now();
  const update = env.DB.prepare(
    "UPDATE holdings SET manual_price=?,current_price=?,value_krw=?,return_rate=?,last_updated=?,elapsed_days=0,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND holding_id=?"
  ).bind(
    manualPrice,
    manualPrice,
    valueKrw,
    returnRate,
    lastUpdated,
    now,
    session.name,
    MB_D1_HOUSEHOLD_ID,
    holdingId
  );
  const change = await mbD1InsertChange(env, "holding", holdingId, "updated", null, session, {
    manualPrice,
    lastUpdated
  });
  await env.DB.batch([update, change]);
  return { updated: true, holding: await mbD1HoldingById(env, holdingId, true) };
}

export function mbD1ValidatePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    mbD1Fail("INVALID_NUMBER", `${label}은 0보다 큰 숫자여야 합니다.`);
  return number;
}

export function mbD1ValidateNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0)
    mbD1Fail("INVALID_NUMBER", `${label}은 0 이상의 숫자여야 합니다.`);
  return number;
}

export function mbD1TradeModel(payload, current, account, holding, requestId) {
  const source = current || {};
  const tradeType = mbD1Text(
    mbD1Has(payload, "tradeType") || mbD1Has(payload, "type")
      ? payload.tradeType || payload.type
      : source.tradeType
  );
  if (!["매수", "매도"].includes(tradeType))
    mbD1Fail("INVALID_INVESTMENT_TRADE_TYPE", "투자거래 구분은 매수/매도 중 하나여야 합니다.");
  const date = mbD1DateOnly(
    mbD1Has(payload, "date") || mbD1Has(payload, "tradeDate")
      ? payload.date || payload.tradeDate
      : source.date || source.tradeDate
  );
  if (!date)
    mbD1Fail("INVALID_INVESTMENT_TRADE_DATE", "투자거래일은 YYYY-MM-DD 형식이어야 합니다.");
  const quantity = mbD1ValidatePositive(
    mbD1Has(payload, "quantity") ? payload.quantity : source.quantity,
    "수량"
  );
  const unitPrice = mbD1ValidatePositive(
    mbD1Has(payload, "unitPrice")
      ? payload.unitPrice
      : mbD1Has(payload, "price")
        ? payload.price
        : source.unitPrice,
    "체결단가"
  );
  let currency = mbD1Text(
    mbD1Has(payload, "currency") ? payload.currency : source.currency
  ).toUpperCase();
  if (!currency) currency = holding.market === "국내" ? "KRW" : "USD";
  if (!/^[A-Z]{3}$/.test(currency))
    mbD1Fail("INVALID_INVESTMENT_CURRENCY", "통화는 KRW, USD처럼 3자리 코드로 입력해야 합니다.");
  if (holding.market === "국내" && currency !== "KRW")
    mbD1Fail("DOMESTIC_CURRENCY_MUST_BE_KRW", "국내 종목의 체결통화는 KRW여야 합니다.");
  const fxRate =
    currency === "KRW"
      ? 1
      : mbD1ValidatePositive(
          mbD1Has(payload, "fxRate") ? payload.fxRate : source.fxRate,
          "체결환율"
        );
  const feeKrw = mbD1ValidateNonNegative(
    mbD1Has(payload, "feeKrw") ? payload.feeKrw : source.feeKrw,
    "수수료"
  );
  const taxKrw = mbD1ValidateNonNegative(
    mbD1Has(payload, "taxKrw") ? payload.taxKrw : source.taxKrw,
    "세금"
  );
  const financeChanged =
    !source.investmentTradeId ||
    [
      "tradeType",
      "type",
      "quantity",
      "unitPrice",
      "price",
      "currency",
      "fxRate",
      "feeKrw",
      "taxKrw"
    ].some(key => mbD1Has(payload, key));
  let settlementKrw;
  if (mbD1Has(payload, "settlementKrw")) {
    settlementKrw = mbD1ValidatePositive(payload.settlementKrw, "원화결제금액");
  } else if (!financeChanged && mbD1Number(source.settlementKrw) > 0) {
    settlementKrw = mbD1Number(source.settlementKrw);
  } else {
    const gross = quantity * unitPrice * fxRate;
    settlementKrw = tradeType === "매수" ? gross + feeKrw + taxKrw : gross - feeKrw - taxKrw;
    if (!Number.isFinite(settlementKrw) || settlementKrw <= 0)
      mbD1Fail("INVALID_INVESTMENT_SETTLEMENT", "원화결제금액 계산 결과가 0보다 커야 합니다.");
  }
  return {
    date,
    tradeType,
    accountId: account.accountId,
    accountName: account.displayName,
    holdingId: holding.holdingId,
    stockCode: holding.stockCode,
    stockName: holding.stockName,
    market: holding.market,
    quantity,
    unitPrice,
    currency,
    fxRate,
    feeKrw,
    taxKrw,
    settlementKrw: mbD1Round(settlementKrw, 2),
    memo: mbD1Has(payload, "memo") ? mbD1Text(payload.memo) : mbD1Text(source.memo),
    requestId
  };
}

export function mbD1SimulateHolding(holding, trades) {
  let quantity = mbD1Number(holding.baselineQuantity);
  let avgPrice = mbD1Number(holding.baselineAvgPrice);
  let bookCost = mbD1Number(holding.baselineBookCostKrw);
  const realized = new Map();
  const sorted = trades
    .slice()
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        (a.createdAt || "").localeCompare(b.createdAt || "") ||
        a.investmentTradeId.localeCompare(b.investmentTradeId)
    );
  for (const trade of sorted) {
    if (trade.tradeType === "매수") {
      const nativeBefore = quantity * avgPrice;
      const nativeBuy = trade.quantity * trade.unitPrice;
      const nextQty = quantity + trade.quantity;
      avgPrice = nextQty > 0 ? (nativeBefore + nativeBuy) / nextQty : 0;
      quantity = nextQty;
      bookCost += trade.settlementKrw;
      realized.set(trade.investmentTradeId, 0);
      continue;
    }
    if (trade.quantity > quantity + 1e-9)
      mbD1Fail(
        "SELL_QUANTITY_EXCEEDS_HOLDING",
        `${trade.date} 매도수량 ${trade.quantity}주가 당시 보유수량 ${mbD1Round(quantity, 8)}주를 초과합니다.`
      );
    if (quantity <= 0)
      mbD1Fail("SELL_WITHOUT_HOLDING", `${trade.date} 매도 시점에 보유수량이 없습니다.`);
    const removedBook = bookCost * (trade.quantity / quantity);
    const pnl = trade.settlementKrw - removedBook;
    quantity -= trade.quantity;
    bookCost -= removedBook;
    if (Math.abs(quantity) < 1e-9) {
      quantity = 0;
      avgPrice = 0;
      bookCost = 0;
    }
    if (Math.abs(bookCost) < 0.000001) bookCost = 0;
    realized.set(trade.investmentTradeId, mbD1Round(pnl, 2));
  }
  return {
    quantity: mbD1Round(quantity, 8),
    avgBuyPrice: mbD1Round(avgPrice, 8),
    bookCostKrw: mbD1Round(bookCost, 2),
    realized
  };
}

export async function mbD1CashForAccountWithTrades(env, account, proposedTrades) {
  if (!account.cashBaselineAt) return null;
  const transactions = await mbD1AllTransactions(env, false);
  let ledgerDelta = 0;
  for (const tx of transactions) {
    if (!mbD1TransactionAfterBaseline(tx, account.cashBaselineAt)) continue;
    if (tx.fromAccountId === account.accountId) ledgerDelta -= tx.amount;
    if (tx.toAccountId === account.accountId) ledgerDelta += tx.amount;
  }
  const baselineMs = mbD1TimestampMs(account.cashBaselineAt);
  let tradeDelta = 0;
  for (const trade of proposedTrades) {
    const createdMs = mbD1TimestampMs(trade.createdAt);
    if (baselineMs !== null && createdMs !== null && createdMs < baselineMs) continue;
    tradeDelta += trade.tradeType === "매수" ? -trade.settlementKrw : trade.settlementKrw;
  }
  return mbD1Round(mbD1Number(account.cashBaselineKrw) + ledgerDelta + tradeDelta, 2);
}

export async function mbD1HandleTradeMutation(path, body, session, env, ctx) {
  const actor = session.name;
  if (path === "/api/investments/trades") {
    const requestId = mbD1Text(body.requestId) || mbD1Id("IREQ");
    const dup = await mbD1First(
      env,
      "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND request_id=? LIMIT 1",
      [MB_D1_HOUSEHOLD_ID, requestId]
    );
    if (dup?.investment_trade_id) {
      const trade =
        (await mbD1Trades(env, true)).find(
          item => item.investmentTradeId === dup.investment_trade_id
        ) || null;
      return {
        created: false,
        duplicate: true,
        investmentTradeId: dup.investment_trade_id,
        requestId,
        trade
      };
    }
    const accountId = mbD1Text(body.accountId);
    const account = await mbD1AccountById(env, accountId, false);
    if (!account || !account.active || !mbD1IsInvestmentAccount(account))
      mbD1Fail("INVESTMENT_ACCOUNT_NOT_FOUND", "사용 가능한 투자계좌를 찾을 수 없습니다.");
    if (!account.cashBaselineAt)
      mbD1Fail(
        "INVESTMENT_CASH_BASELINE_REQUIRED",
        "먼저 이 투자계좌의 현재 예수금 기준값을 설정해야 합니다."
      );
    const type = mbD1Text(body.tradeType || body.type);
    if (!["매수", "매도"].includes(type))
      mbD1Fail("INVALID_INVESTMENT_TRADE_TYPE", "투자거래 구분은 매수/매도 중 하나여야 합니다.");
    const stockCode = mbD1Text(body.stockCode).toUpperCase();
    if (!stockCode) mbD1Fail("STOCK_CODE_REQUIRED", "종목코드가 필요합니다.");
    let holding =
      (await mbD1Holdings(env, false)).find(
        item => item.accountId === accountId && item.stockCode.toUpperCase() === stockCode
      ) || null;
    let newHolding = false;
    const now = mbD1Now();
    const statements = [];
    if (!holding) {
      if (type === "매도")
        mbD1Fail("SELL_HOLDING_NOT_FOUND", "매도할 보유종목을 찾을 수 없습니다.");
      const market = mbD1Text(body.market);
      if (!["국내", "해외"].includes(market))
        mbD1Fail("INVALID_MARKET", "신규 종목의 시장은 국내/해외 중 하나여야 합니다.");
      const quoteMode = mbD1Text(body.quoteMode) || "자동";
      if (!["자동", "수동"].includes(quoteMode))
        mbD1Fail("INVALID_QUOTE_MODE", "시세조회방식은 자동/수동이어야 합니다.");
      let manualPrice = null;
      if (quoteMode === "수동") manualPrice = mbD1ValidatePositive(body.manualPrice, "수동입력가");
      else if (mbD1Has(body, "manualPrice") && body.manualPrice !== "" && body.manualPrice !== null)
        manualPrice = mbD1ValidateNonNegative(body.manualPrice, "수동입력가");
      const holdingId = mbD1Id("STK");
      holding = {
        holdingId,
        accountId,
        accountName: account.displayName,
        stockCode,
        stockName: mbD1Text(body.stockName),
        market,
        quantity: 0,
        avgBuyPrice: 0,
        quoteMode,
        manualPrice,
        currentPrice: manualPrice || 0,
        fx: market === "국내" ? 1 : 0,
        valueKrw: 0,
        bookCostKrw: 0,
        returnRate: null,
        owner: account.owner,
        lastUpdated: quoteMode === "수동" ? mbD1CurrentDateSeoul() : null,
        elapsedDays: 0,
        baselineQuantity: 0,
        baselineAvgPrice: 0,
        baselineBookCostKrw: 0,
        baselineAt: now,
        managedByTradesV22: true,
        isDeleted: false
      };
      statements.push(
        env.DB.prepare(
          `INSERT INTO holdings (holding_id,household_id,account_id,stock_code,stock_name,market,quantity,avg_buy_price,quote_mode,manual_price,current_price,fx_rate,value_krw,book_cost_krw,return_rate,owner_label,last_updated,elapsed_days,baseline_quantity,baseline_avg_price,baseline_book_cost_krw,baseline_at,managed_by_trades,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          holdingId,
          MB_D1_HOUSEHOLD_ID,
          accountId,
          stockCode,
          holding.stockName || null,
          market,
          0,
          0,
          quoteMode,
          manualPrice,
          manualPrice,
          market === "국내" ? 1 : null,
          0,
          0,
          null,
          account.owner,
          holding.lastUpdated,
          0,
          0,
          0,
          0,
          now,
          1,
          1,
          now,
          now,
          actor,
          actor,
          null,
          null,
          null
        )
      );
      newHolding = true;
    } else if (!holding.baselineAt) {
      const baselineBook =
        holding.bookCostKrw || holding.quantity * holding.avgBuyPrice * (holding.fx || 1);
      holding.baselineQuantity = holding.quantity;
      holding.baselineAvgPrice = holding.avgBuyPrice;
      holding.baselineBookCostKrw = baselineBook;
      holding.baselineAt = now;
      holding.managedByTradesV22 = true;
      statements.push(
        env.DB.prepare(
          "UPDATE holdings SET baseline_quantity=?,baseline_avg_price=?,baseline_book_cost_krw=?,baseline_at=?,book_cost_krw=?,managed_by_trades=1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
        ).bind(
          holding.baselineQuantity,
          holding.baselineAvgPrice,
          holding.baselineBookCostKrw,
          holding.baselineAt,
          holding.baselineBookCostKrw,
          now,
          actor,
          MB_D1_HOUSEHOLD_ID,
          holding.holdingId
        )
      );
    }
    const tradeDate = mbD1DateOnly(body.tradeDate || body.date);
    if (holding.baselineAt && tradeDate) {
      const baselineDate = new Date(mbD1TimestampMs(holding.baselineAt)).toLocaleDateString(
        "en-CA",
        { timeZone: "Asia/Seoul" }
      );
      if (tradeDate < baselineDate)
        mbD1Fail(
          "INVESTMENT_TRADE_BEFORE_BASELINE",
          `기준일 ${baselineDate}보다 이전의 매매는 등록할 수 없습니다.`
        );
    }
    const model = mbD1TradeModel(body, null, account, holding, requestId);
    const tradeId = mbD1Id("ITX");
    const existingTrades = (await mbD1Trades(env, false)).filter(
      item => item.holdingId === holding.holdingId
    );
    const proposedTrade = {
      investmentTradeId: tradeId,
      ...model,
      createdAt: now,
      updatedAt: now,
      isDeleted: false
    };
    const proposedTrades = [...existingTrades, proposedTrade];
    const state = mbD1SimulateHolding(holding, proposedTrades);
    const allAccountTrades = (await mbD1Trades(env, false)).filter(
      item => item.accountId === accountId
    );
    const cashBefore = await mbD1CashForAccountWithTrades(env, account, allAccountTrades);
    if (type === "매수" && (cashBefore === null || cashBefore + 0.000001 < model.settlementKrw)) {
      mbD1Fail(
        "INSUFFICIENT_INVESTMENT_CASH",
        `예수금이 부족합니다. 현재 ${cashBefore ?? 0}원 / 필요 ${model.settlementKrw}원`
      );
    }
    const cashAfter = await mbD1CashForAccountWithTrades(env, account, [
      ...allAccountTrades,
      proposedTrade
    ]);
    if (cashAfter !== null && cashAfter < -0.000001)
      mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", "거래 후 예수금이 음수가 됩니다.");
    statements.push(
      env.DB.prepare(
        `INSERT INTO investment_trades (investment_trade_id,household_id,request_id,trade_date,trade_type,account_id,holding_id,stock_code,stock_name,market,quantity,unit_price,currency,fx_rate,fee_krw,tax_krw,settlement_krw,realized_pnl_krw,memo,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by,source_row)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        tradeId,
        MB_D1_HOUSEHOLD_ID,
        requestId,
        model.date,
        model.tradeType,
        accountId,
        holding.holdingId,
        holding.stockCode,
        holding.stockName || null,
        holding.market,
        model.quantity,
        model.unitPrice,
        model.currency,
        model.fxRate,
        model.feeKrw,
        model.taxKrw,
        model.settlementKrw,
        state.realized.get(tradeId) || 0,
        model.memo || null,
        1,
        now,
        now,
        actor,
        actor,
        null,
        null,
        null
      )
    );
    for (const [id, pnl] of state.realized.entries()) {
      if (id === tradeId) continue;
      statements.push(
        env.DB.prepare(
          "UPDATE investment_trades SET realized_pnl_krw=? WHERE household_id=? AND investment_trade_id=?"
        ).bind(pnl, MB_D1_HOUSEHOLD_ID, id)
      );
    }
    const currentPrice =
      holding.quoteMode === "수동" ? holding.manualPrice || 0 : holding.currentPrice || 0;
    const fx = holding.market === "국내" ? 1 : holding.fx || model.fxRate || 0;
    const valueKrw = mbD1Round(state.quantity * currentPrice * fx, 2);
    const returnRate =
      state.bookCostKrw > 0 ? (valueKrw - state.bookCostKrw) / state.bookCostKrw : null;
    statements.push(
      env.DB.prepare(
        "UPDATE holdings SET quantity=?,avg_buy_price=?,book_cost_krw=?,value_krw=?,return_rate=?,managed_by_trades=1,version=version+1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
      ).bind(
        state.quantity,
        state.avgBuyPrice,
        state.bookCostKrw,
        valueKrw,
        returnRate,
        now,
        actor,
        MB_D1_HOUSEHOLD_ID,
        holding.holdingId
      )
    );
    statements.push(
      await mbD1InsertChange(env, "investment_trade", tradeId, "created", 1, session, {
        accountId,
        holdingId: holding.holdingId,
        tradeType: model.tradeType
      })
    );
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (mbD1LooksLikeRequestIdUniqueConflict(error, "investment_trades")) {
        const duplicate = await mbD1First(
          env,
          "SELECT investment_trade_id FROM investment_trades WHERE household_id=? AND request_id=? LIMIT 1",
          [MB_D1_HOUSEHOLD_ID, requestId]
        );
        if (duplicate?.investment_trade_id) {
          const trade =
            (await mbD1Trades(env, true)).find(
              item => item.investmentTradeId === duplicate.investment_trade_id
            ) || null;
          return {
            created: false,
            duplicate: true,
            investmentTradeId: duplicate.investment_trade_id,
            requestId,
            trade
          };
        }
      }
      throw error;
    }
    if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, true));
    const trade =
      (await mbD1Trades(env, true)).find(item => item.investmentTradeId === tradeId) || null;
    return {
      created: true,
      duplicate: false,
      newHoldingCreated: newHolding,
      investmentTradeId: tradeId,
      requestId,
      trade,
      holding: {
        holdingId: holding.holdingId,
        accountId,
        stockCode: holding.stockCode,
        stockName: holding.stockName,
        quantity: state.quantity,
        avgBuyPrice: state.avgBuyPrice,
        bookCostKrw: state.bookCostKrw,
        activeTradeCount: proposedTrades.length
      }
    };
  }

  const id = mbD1Text(body.investmentTradeId);
  if (!id) mbD1Fail("INVESTMENT_TRADE_ID_REQUIRED", "investmentTradeId가 필요합니다.");
  const allTrades = await mbD1Trades(env, true);
  const current = allTrades.find(item => item.investmentTradeId === id) || null;
  if (!current) mbD1Fail("INVESTMENT_TRADE_NOT_FOUND", "투자거래를 찾을 수 없습니다.", 404);
  const account = await mbD1AccountById(env, current.accountId, false);
  const holding = await mbD1HoldingById(env, current.holdingId, false);
  if (!account || !holding)
    mbD1Fail("INVESTMENT_LINK_BROKEN", "연결된 투자계좌 또는 보유종목을 찾을 수 없습니다.");

  const recomputeAndWrite = async (nextTrade, action) => {
    const activeHoldingTrades = (await mbD1Trades(env, false)).filter(
      item => item.holdingId === holding.holdingId && item.investmentTradeId !== id
    );
    if (nextTrade && !nextTrade.isDeleted) activeHoldingTrades.push(nextTrade);
    const state = mbD1SimulateHolding(holding, activeHoldingTrades);
    const activeAccountTrades = (await mbD1Trades(env, false)).filter(
      item => item.accountId === account.accountId && item.investmentTradeId !== id
    );
    if (nextTrade && !nextTrade.isDeleted) activeAccountTrades.push(nextTrade);
    const cash = await mbD1CashForAccountWithTrades(env, account, activeAccountTrades);
    if (cash !== null && cash < -0.000001)
      mbD1Fail("INSUFFICIENT_INVESTMENT_CASH", "변경 결과 예수금이 음수가 됩니다.");
    const now = mbD1Now();
    const statements = [];
    if (action === "updated") {
      statements.push(
        env.DB.prepare(
          `UPDATE investment_trades SET trade_date=?,trade_type=?,quantity=?,unit_price=?,currency=?,fx_rate=?,fee_krw=?,tax_krw=?,settlement_krw=?,memo=?,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?`
        ).bind(
          nextTrade.date,
          nextTrade.tradeType,
          nextTrade.quantity,
          nextTrade.unitPrice,
          nextTrade.currency,
          nextTrade.fxRate,
          nextTrade.feeKrw,
          nextTrade.taxKrw,
          nextTrade.settlementKrw,
          nextTrade.memo || null,
          now,
          actor,
          MB_D1_HOUSEHOLD_ID,
          id
        )
      );
    } else if (action === "deleted") {
      statements.push(
        env.DB.prepare(
          "UPDATE investment_trades SET deleted_at=?,deleted_by=?,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?"
        ).bind(now, actor, now, actor, MB_D1_HOUSEHOLD_ID, id)
      );
    } else if (action === "restored") {
      statements.push(
        env.DB.prepare(
          "UPDATE investment_trades SET deleted_at=NULL,deleted_by=NULL,updated_at=?,updated_by=?,version=version+1 WHERE household_id=? AND investment_trade_id=?"
        ).bind(now, actor, MB_D1_HOUSEHOLD_ID, id)
      );
    }
    for (const trade of activeHoldingTrades) {
      statements.push(
        env.DB.prepare(
          "UPDATE investment_trades SET realized_pnl_krw=? WHERE household_id=? AND investment_trade_id=?"
        ).bind(
          state.realized.get(trade.investmentTradeId) || 0,
          MB_D1_HOUSEHOLD_ID,
          trade.investmentTradeId
        )
      );
    }
    const currentPrice =
      holding.quoteMode === "수동" ? holding.manualPrice || 0 : holding.currentPrice || 0;
    const fx = holding.market === "국내" ? 1 : holding.fx || 0;
    const valueKrw = mbD1Round(state.quantity * currentPrice * fx, 2);
    const returnRate =
      state.bookCostKrw > 0 ? (valueKrw - state.bookCostKrw) / state.bookCostKrw : null;
    statements.push(
      env.DB.prepare(
        "UPDATE holdings SET quantity=?,avg_buy_price=?,book_cost_krw=?,value_krw=?,return_rate=?,version=version+1,updated_at=?,updated_by=? WHERE household_id=? AND holding_id=?"
      ).bind(
        state.quantity,
        state.avgBuyPrice,
        state.bookCostKrw,
        valueKrw,
        returnRate,
        now,
        actor,
        MB_D1_HOUSEHOLD_ID,
        holding.holdingId
      )
    );
    statements.push(await mbD1InsertChange(env, "investment_trade", id, action, null, session));
    await env.DB.batch(statements);
    return state;
  };

  if (path === "/api/investments/trades/update") {
    if (current.isDeleted)
      mbD1Fail("INVESTMENT_TRADE_NOT_FOUND", "수정할 투자거래를 찾을 수 없습니다.", 404);
    if (!mbD1Has(body, "expectedUpdatedAtMs"))
      mbD1Fail(
        "UPDATE_VERSION_REQUIRED",
        "투자거래의 최신 버전 정보가 필요합니다. 화면을 새로고침한 뒤 다시 시도하세요.",
        409
      );
    const expected =
      body.expectedUpdatedAtMs === null || body.expectedUpdatedAtMs === ""
        ? null
        : Number(body.expectedUpdatedAtMs);
    if (expected !== current.updatedAtMs)
      mbD1Fail(
        "CONCURRENT_MODIFICATION",
        "투자거래가 다른 기기에서 먼저 수정되었습니다. 최신 내용을 다시 불러온 뒤 수정하세요.",
        409
      );
    for (const [key, oldValue, label] of [
      ["accountId", current.accountId, "투자계좌"],
      ["holdingId", current.holdingId, "보유종목"],
      ["stockCode", current.stockCode, "종목코드"]
    ]) {
      if (
        mbD1Has(body, key) &&
        mbD1Text(body[key]).toUpperCase() !== mbD1Text(oldValue).toUpperCase()
      )
        mbD1Fail(
          "INVESTMENT_LINK_CHANGE_NOT_ALLOWED",
          `${label} 변경은 기존 거래를 삭제한 뒤 새 거래로 등록해야 합니다.`
        );
    }
    const model = mbD1TradeModel(body, current, account, holding, current.requestId);
    if (holding.baselineAt) {
      const baselineDate = new Date(mbD1TimestampMs(holding.baselineAt)).toLocaleDateString(
        "en-CA",
        { timeZone: "Asia/Seoul" }
      );
      if (model.date < baselineDate)
        mbD1Fail(
          "INVESTMENT_TRADE_BEFORE_BASELINE",
          `기준일 ${baselineDate}보다 이전의 매매는 등록할 수 없습니다.`
        );
    }
    const nextTrade = {
      ...current,
      ...model,
      investmentTradeId: id,
      createdAt: current.createdAt,
      updatedAt: mbD1Now(),
      isDeleted: false
    };
    const state = await recomputeAndWrite(nextTrade, "updated");
    const trade = (await mbD1Trades(env, true)).find(item => item.investmentTradeId === id) || null;
    return {
      updated: true,
      investmentTradeId: id,
      trade,
      holding: {
        holdingId: holding.holdingId,
        accountId: holding.accountId,
        stockCode: holding.stockCode,
        stockName: holding.stockName,
        quantity: state.quantity,
        avgBuyPrice: state.avgBuyPrice,
        bookCostKrw: state.bookCostKrw,
        activeTradeCount: state.realized.size
      }
    };
  }

  if (path === "/api/investments/trades/delete") {
    if (current.isDeleted) return { deleted: true, alreadyDeleted: true, investmentTradeId: id };
    const state = await recomputeAndWrite(null, "deleted");
    return {
      deleted: true,
      investmentTradeId: id,
      holding: {
        holdingId: holding.holdingId,
        accountId: holding.accountId,
        stockCode: holding.stockCode,
        stockName: holding.stockName,
        quantity: state.quantity,
        avgBuyPrice: state.avgBuyPrice,
        bookCostKrw: state.bookCostKrw,
        activeTradeCount: state.realized.size
      }
    };
  }

  if (path === "/api/investments/trades/restore") {
    if (!current.isDeleted) return { restored: true, alreadyActive: true, investmentTradeId: id };
    const nextTrade = { ...current, isDeleted: false };
    const state = await recomputeAndWrite(nextTrade, "restored");
    const trade = (await mbD1Trades(env, true)).find(item => item.investmentTradeId === id) || null;
    return {
      restored: true,
      investmentTradeId: id,
      trade,
      holding: {
        holdingId: holding.holdingId,
        accountId: holding.accountId,
        stockCode: holding.stockCode,
        stockName: holding.stockName,
        quantity: state.quantity,
        avgBuyPrice: state.avgBuyPrice,
        bookCostKrw: state.bookCostKrw,
        activeTradeCount: state.realized.size
      }
    };
  }

  mbD1Fail("UNSUPPORTED_INVESTMENT_ACTION", "지원하지 않는 투자거래 작업입니다.");
}

export async function mbD1FetchYahooChart(symbol) {
  const clean = mbD1Text(symbol);
  if (!clean) return null;
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?range=1d&interval=1d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 moneybook-price" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, currency: mbD1Text(meta?.currency).toUpperCase(), symbol: clean };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Cloudflare 무료 플랜은 Worker 호출 한 번당 외부 요청 수가 50개로 제한됩니다.
// 시세 갱신은 그보다 넉넉히 적은 예산 안에서만 외부 요청을 보냅니다.
export const MB_D1_QUOTE_SUBREQUEST_BUDGET = 30;
// 종목 코드 조회(lookupInvestmentSymbol)는 캐시가 없으면 최대 3번 외부 요청을 보냅니다.
export const MB_D1_QUOTE_LOOKUP_COST = 3;

export function mbD1CreateQuoteContext() {
  return { remaining: MB_D1_QUOTE_SUBREQUEST_BUDGET, fx: new Map() };
}

export function mbD1SpendQuoteBudget(context, cost = 1) {
  if (context.remaining < cost) return false;
  context.remaining -= cost;
  return true;
}

export async function mbD1FxRate(currency, context) {
  const code = mbD1Text(currency).toUpperCase();
  if (!code || code === "KRW") return 1;
  if (context.fx.has(code)) return context.fx.get(code);
  const candidates = code === "USD" ? ["KRW=X", "USDKRW=X"] : [`${code}KRW=X`];
  let rate = null;
  for (const symbol of candidates) {
    if (!mbD1SpendQuoteBudget(context)) return null;
    const quote = await mbD1FetchYahooChart(symbol);
    if (quote) {
      rate = quote.price;
      break;
    }
  }
  context.fx.set(code, rate);
  return rate;
}

export async function mbD1QuoteForHolding(holding, context) {
  const code = mbD1Text(holding.stockCode).toUpperCase();
  const candidates = [];
  if (mbD1SpendQuoteBudget(context, MB_D1_QUOTE_LOOKUP_COST)) {
    try {
      const lookup = await lookupInvestmentSymbol(code);
      if (lookup?.found && lookup.symbol) candidates.push(lookup.symbol);
    } catch {}
  }
  if (holding.market === "국내" && /^\d{6}$/.test(code)) {
    candidates.push(`${code}.KS`, `${code}.KQ`);
  } else {
    candidates.push(code);
  }
  const unique = Array.from(new Set(candidates.filter(Boolean)));
  for (const symbol of unique) {
    if (!mbD1SpendQuoteBudget(context)) return null;
    const quote = await mbD1FetchYahooChart(symbol);
    if (!quote) continue;
    const fx = holding.market === "국내" ? 1 : await mbD1FxRate(quote.currency || "USD", context);
    if (fx === null) continue;
    return { price: quote.price, fx };
  }
  return null;
}

export async function mbD1RefreshQuotes(env, force = false) {
  if (!env.DB) return;
  if (!force && Date.now() - mbD1LastQuoteRefreshAt < MB_D1_QUOTE_REFRESH_MS) return;
  if (mbD1QuoteRefreshPromise) return mbD1QuoteRefreshPromise;

  mbD1QuoteRefreshPromise = (async () => {
    // 갱신이 오래된 종목부터 처리해 외부 요청 예산이 모자라도 다음 호출에서 나머지가 갱신되게 합니다.
    const holdings = (await mbD1Holdings(env, false))
      .filter(holding => holding.quoteMode === "자동")
      .sort((a, b) => (a.updatedAtMs || 0) - (b.updatedAtMs || 0));
    if (!holdings.length) {
      mbD1LastQuoteRefreshAt = Date.now();
      return;
    }

    // Worker 인스턴스가 바뀌어도 5분 간격이 지켜지도록 DB에 저장된 갱신 시각도 확인합니다.
    const oldestUpdatedAtMs = holdings[0].updatedAtMs || 0;
    if (!force && Date.now() - oldestUpdatedAtMs < MB_D1_QUOTE_REFRESH_MS) {
      mbD1LastQuoteRefreshAt = Date.now();
      return;
    }

    const context = mbD1CreateQuoteContext();
    for (const holding of holdings) {
      if (context.remaining <= 0) break;
      const quote = await mbD1QuoteForHolding(holding, context);
      if (!quote) continue;
      const valueKrw = mbD1Round(holding.quantity * quote.price * quote.fx, 2);
      const returnRate =
        holding.bookCostKrw > 0 ? (valueKrw - holding.bookCostKrw) / holding.bookCostKrw : null;
      await env.DB.prepare(
        "UPDATE holdings SET current_price=?,fx_rate=?,value_krw=?,return_rate=?,updated_at=? WHERE household_id=? AND holding_id=?"
      )
        .bind(
          quote.price,
          quote.fx,
          valueKrw,
          returnRate,
          mbD1Now(),
          MB_D1_HOUSEHOLD_ID,
          holding.holdingId
        )
        .run();
    }

    mbD1LastQuoteRefreshAt = Date.now();
  })().finally(() => {
    mbD1QuoteRefreshPromise = null;
  });
  return mbD1QuoteRefreshPromise;
}
