import type { InvestmentTrade } from "../../types/investment";

import { isAmountProductCode } from "./amountProduct.ts";

/*
 * 수수료·세금 추정
 *
 * 증권사·종목마다 요율이 달라 고정 요율을 쓰지 않고, 이 계좌의 최근 거래에서 실제로 낸
 * 비율을 그대로 따릅니다.
 * - 수수료: 같은 시장(국내/해외)의 최근 매수·매도 10건 중 수수료가 있던 거래의 중앙값
 * - 세금: 같은 종목을 전에 판 기록이 있을 때만 그 비율(ETF처럼 0원이면 0원)
 */

export type TradeCostEstimate = {
  feeKrw: number;
  taxKrw: number;
  feeRate: number | null;
  taxRate: number | null;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function grossOf(trade: InvestmentTrade) {
  return Number(trade.quantity) * Number(trade.unitPrice) * (Number(trade.fxRate) || 1);
}

function newestFirst(a: InvestmentTrade, b: InvestmentTrade) {
  return (
    (b.date || "").localeCompare(a.date || "") ||
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );
}

export function estimateTradeCosts(
  trades: InvestmentTrade[],
  input: {
    tradeType: "매수" | "매도";
    market: string;
    stockCode: string;
    grossKrw: number;
  }
): TradeCostEstimate {
  const empty = { feeKrw: 0, taxKrw: 0, feeRate: null, taxRate: null };

  if (!(input.grossKrw > 0) || isAmountProductCode(input.stockCode)) return empty;

  const usable = trades.filter(
    trade =>
      !trade.isDeleted &&
      (trade.tradeType === "매수" || trade.tradeType === "매도") &&
      !isAmountProductCode(trade.stockCode) &&
      grossOf(trade) > 0
  );

  const feeRate = median(
    usable
      .filter(trade => trade.market === input.market && Number(trade.feeKrw) > 0)
      .sort(newestFirst)
      .slice(0, 10)
      .map(trade => Number(trade.feeKrw) / grossOf(trade))
  );

  const code = input.stockCode.trim().toUpperCase();
  const taxRate =
    input.tradeType === "매도"
      ? median(
          usable
            .filter(trade => trade.tradeType === "매도" && trade.stockCode.toUpperCase() === code)
            .sort(newestFirst)
            .slice(0, 5)
            .map(trade => Number(trade.taxKrw) / grossOf(trade))
        )
      : null;

  return {
    feeKrw: feeRate === null ? 0 : Math.round(input.grossKrw * feeRate),
    taxKrw: taxRate === null ? 0 : Math.round(input.grossKrw * taxRate),
    feeRate,
    taxRate
  };
}

/* 해외 종목 코드(야후 심볼)로 거래통화를 추정합니다. 모르면 USD. */
export function guessForeignCurrency(symbol: string | null | undefined) {
  const code = String(symbol || "").toUpperCase();
  const suffix = code.includes(".") ? code.slice(code.lastIndexOf(".") + 1) : "";
  const map: Record<string, string> = {
    T: "JPY",
    HK: "HKD",
    SS: "CNY",
    SZ: "CNY",
    DE: "EUR",
    F: "EUR",
    PA: "EUR",
    AS: "EUR",
    MI: "EUR",
    TW: "TWD",
    SI: "SGD",
    AX: "AUD",
    TO: "CAD",
    V: "CAD"
  };
  return map[suffix] || "USD";
}

export const FOREIGN_CURRENCIES = ["USD", "JPY", "HKD", "CNY", "EUR", "TWD", "SGD", "AUD", "CAD"];
