import { apiRequest } from "./client";
import type {
  InvestmentAccountsResponse,
  HoldingsResponse,
  InvestmentCash,
  InvestmentTradesResponse,
  SetInvestmentCashBaselinePayload,
  CreateInvestmentTradePayload
} from "../types/investment";

export function getInvestmentAccounts() {
  return apiRequest<InvestmentAccountsResponse>(
    "/api/investments/accounts"
  );
}

export function getHoldings(
  params: {
    accountId?: string;
    market?: string;
    quoteMode?: string;
  } = {}
) {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set("accountId", params.accountId);
  }

  if (params.market) {
    searchParams.set("market", params.market);
  }

  if (params.quoteMode) {
    searchParams.set("quoteMode", params.quoteMode);
  }

  const query = searchParams.toString();

  const url = query
    ? `/api/investments/holdings?${query}`
    : "/api/investments/holdings";

  return apiRequest<HoldingsResponse>(url);
}

export function getInvestmentCash(accountId: string) {
  const query = accountId
    ? `?accountId=${encodeURIComponent(accountId)}`
    : "";

  return apiRequest<InvestmentCash | InvestmentCash[]>(
    `/api/investments/cash${query}`
  );
}

export function setInvestmentCashBaseline(
  payload: SetInvestmentCashBaselinePayload
) {
  return apiRequest("/api/investments/cash-baseline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function getInvestmentTrades(
  params: {
    accountId?: string;
    holdingId?: string;
    tradeType?: string;
  } = {}
) {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set("accountId", params.accountId);
  }

  if (params.holdingId) {
    searchParams.set("holdingId", params.holdingId);
  }

  if (params.tradeType) {
    searchParams.set("tradeType", params.tradeType);
  }

  const query = searchParams.toString();

  const url = query
    ? `/api/investments/trades?${query}`
    : "/api/investments/trades";

  return apiRequest<InvestmentTradesResponse>(url);
}

export function createInvestmentTrade(
  payload: CreateInvestmentTradePayload
) {
  return apiRequest("/api/investments/trades", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
