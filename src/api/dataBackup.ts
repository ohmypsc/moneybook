import { getAssetSnapshots } from "./assetSnapshots";
import { getBootstrap } from "./bootstrap";
import { apiRequest } from "./client";
import { getTransactions, type Transaction } from "./transactions";
import type { BootstrapResponse } from "../types/bootstrap";
import { createBackupDocument } from "./dataBackupFormat";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

interface ListData<T> {
  total?: number;
  items: T[];
}

function unwrapData<T>(response: ApiEnvelope<T>, fallbackMessage: string): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || fallbackMessage);
  }

  return response.data;
}

async function getList<T>(url: string, fallbackMessage: string) {
  const response = await apiRequest<ApiEnvelope<ListData<T>>>(url);
  return unwrapData(response, fallbackMessage).items ?? [];
}

async function getAllTransactionsForBackup() {
  const items: Transaction[] = [];
  const limit = 1000;
  let offset = 0;
  let total = 0;

  do {
    const response = await getTransactions({
      includeDeleted: true,
      limit,
      offset
    });

    total = response.data.total;
    items.push(...response.data.items);
    offset += response.data.items.length;

    if (response.data.items.length === 0) {
      break;
    }
  } while (offset < total);

  return items;
}

export async function createMoneybookBackup() {
  const bootstrapResponse = await getBootstrap<BootstrapResponse>();
  const bootstrap = unwrapData(
    bootstrapResponse,
    "기본 설정을 백업하지 못했습니다."
  );

  const [
    categories,
    accounts,
    transactions,
    snapshots,
    investmentHoldings,
    investmentTrades,
    investmentCashResponse
  ] = await Promise.all([
    getList<unknown>(
      "/api/categories?includeDeleted=true",
      "카테고리를 백업하지 못했습니다."
    ),
    getList<unknown>(
      "/api/accounts?includeDeleted=true",
      "계좌를 백업하지 못했습니다."
    ),
    getAllTransactionsForBackup(),
    getAssetSnapshots(),
    getList<unknown>(
      "/api/investments/holdings?includeDeleted=true",
      "투자 보유종목을 백업하지 못했습니다."
    ),
    getList<unknown>(
      "/api/investments/trades?includeDeleted=true",
      "투자 거래를 백업하지 못했습니다."
    ),
    apiRequest<ApiEnvelope<unknown>>("/api/investments/cash")
  ]);

  return createBackupDocument({
    bootstrap,
    categories,
    accounts,
    transactions,
    assetSnapshots: snapshots.items,
    investmentHoldings,
    investmentTrades,
    investmentCash: unwrapData(
      investmentCashResponse,
      "투자 예수금 정보를 백업하지 못했습니다."
    )
  });
}
