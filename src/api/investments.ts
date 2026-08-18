// src/api/transactions.ts와 동일한 apiRequest 헬퍼를 재사용합니다.
import { apiRequest } from "./client";

export type TradeType = "매수" | "매도";

export interface InvestmentAccount {
  accountId: string;
  accountName: string;
  owner: string;
  accountType: string;
  subType: string;
  cashBaselineConfigured: boolean;
  cashBaselineKrw: number | null;
  cashBaselineAt: string | null;
}

export interface InvestmentCashStatus {
  accountId: string;
  accountName: string;
  owner: string;
  cashBaselineConfigured: boolean;
  cashBaselineKrw: number | null;
  cashBaselineAt: string | null;
  currentCashKrw: number | null;
  holdingValueKrw: number;
  accountValueKrw: number;
  realizedPnlKrw: number;
}

export interface InvestmentTrade {
  investmentTradeId: string;
  date: string;
  tradeType: TradeType;
  accountId: string;
  accountName: string;
  holdingId: string;
  stockCode: string;
  stockName: string;
  market: "국내" | "해외";
  quantity: number;
  unitPrice: number;
  currency: string;
  fxRate: number;
  feeKrw: number;
  taxKrw: number;
  settlementKrw: number;
  realizedPnlKrw: number;
  memo: string;
  isDeleted: boolean;
}

export interface HoldingState {
  holdingId: string;
  accountId: string;
  stockCode: string;
  stockName: string;
  quantity: number;
  avgBuyPrice: number;
  bookCostKrw: number;
  activeTradeCount?: number;
}

export interface CreateTradeInput {
  accountId: string;
  tradeType: TradeType;
  date: string;
  stockCode: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
  fxRate?: number;
  feeKrw?: number;
  taxKrw?: number;
  memo?: string;
  requestId?: string;
  // 해당 계좌에 그 종목이 처음 등록될 때만 필요
  stockName?: string;
  market?: "국내" | "해외";
  quoteMode?: "자동" | "수동";
  manualPrice?: number;
}

export interface CreateTradeResponse {
  created: boolean;
  duplicate: boolean;
  newHoldingCreated?: boolean;
  investmentTradeId: string;
  requestId: string;
  trade: InvestmentTrade;
  holding: HoldingState;
}

export function getInvestmentAccounts() {
  return apiRequest<{ items: InvestmentAccount[] }>(
    "/api/investments/accounts"
  );
}

export function getInvestmentCash(accountId?: string) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return apiRequest<{ accounts: InvestmentCashStatus[] }>(
    `/api/investments/cash${query}`
  );
}

export function getInvestmentTrades(params: {
  accountId?: string;
  holdingId?: string;
  tradeType?: TradeType;
} = {}) {
  const searchParams = new URLSearchParams();
  if (params.accountId) searchParams.set("accountId", params.accountId);
  if (params.holdingId) searchParams.set("holdingId", params.holdingId);
  if (params.tradeType) searchParams.set("tradeType", params.tradeType);
  const query = searchParams.toString();
  return apiRequest<{ total: number; items: InvestmentTrade[] }>(
    query ? `/api/investments/trades?${query}` : "/api/investments/trades"
  );
}

export function setInvestmentCashBaseline(input: {
  accountId: string;
  amount: number;
  force?: boolean;
}) {
  return apiRequest<{
    updated: boolean;
    accountId: string;
    accountName: string;
    cashBaselineKrw: number;
    cashBaselineAt: string;
  }>("/api/investments/cash", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createInvestmentTrade(input: CreateTradeInput) {
  const requestId = input.requestId || crypto.randomUUID();
  return apiRequest<CreateTradeResponse>("/api/investments/trades", {
    method: "POST",
    body: JSON.stringify({ ...input, requestId })
  });
}

export function updateInvestmentTrade(input: {
  investmentTradeId: string;
  date?: string;
  quantity?: number;
  unitPrice?: number;
  feeKrw?: number;
  taxKrw?: number;
  memo?: string;
}) {
  return apiRequest<{
    updated: boolean;
    investmentTradeId: string;
    trade: InvestmentTrade;
    holding: HoldingState;
  }>(`/api/investments/trades/${input.investmentTradeId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteInvestmentTrade(investmentTradeId: string) {
  return apiRequest<{ deleted: boolean; investmentTradeId: string; holding: HoldingState }>(
    `/api/investments/trades/${investmentTradeId}`,
    { method: "DELETE" }
  );
}
