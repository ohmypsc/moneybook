import { apiRequest } from "./client";
import type {
  InvestmentTradesResponse,
  SetInvestmentCashBaselinePayload,
  CreateInvestmentTradePayload
} from "../types/investment";

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
