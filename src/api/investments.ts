import { apiRequest } from "./client";
import type {
  InvestmentAccountsResponse,
  HoldingsResponse,
  InvestmentCash,
  InvestmentTradesResponse,
  SetInvestmentCashBaselinePayload,
  CreateInvestmentTradePayload
} from "../types/investment";
import { unwrapEnvelope } from "./envelope";
import type { ApiEnvelope } from "./envelope";

export async function getInvestmentAccounts() {
  const raw = await apiRequest<
    ApiEnvelope<InvestmentAccountsResponse>
    | InvestmentAccountsResponse
  >("/api/investments/accounts");

  return unwrapEnvelope<InvestmentAccountsResponse>(raw);
}

export async function getHoldings(
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

  const raw = await apiRequest<
    ApiEnvelope<HoldingsResponse> | HoldingsResponse
  >(url);

  return unwrapEnvelope<HoldingsResponse>(raw);
}

export async function getInvestmentCash(accountId: string) {
  const query = accountId
    ? `?accountId=${encodeURIComponent(accountId)}`
    : "";

  const raw = await apiRequest<
    | ApiEnvelope<InvestmentCash | InvestmentCash[]>
    | InvestmentCash
    | InvestmentCash[]
  >(`/api/investments/cash${query}`);

  return unwrapEnvelope<InvestmentCash | InvestmentCash[]>(raw);
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

export async function getInvestmentTrades(
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

  const raw = await apiRequest<
    ApiEnvelope<InvestmentTradesResponse>
    | InvestmentTradesResponse
  >(url);

  return unwrapEnvelope<InvestmentTradesResponse>(raw);
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
