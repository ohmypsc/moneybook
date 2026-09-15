import type { Transaction } from "./transactions";
import type { BootstrapData } from "../types/bootstrap";

export interface MoneybookBackupPayload {
  bootstrap: BootstrapData;
  categories: unknown[];
  accounts: unknown[];
  transactions: Transaction[];
  assetSnapshots: unknown[];
  investmentHoldings: unknown[];
  investmentTrades: unknown[];
  investmentCash: unknown;
}

export interface MoneybookBackupDocument {
  format: "moneybook-backup";
  version: 1;
  exportedAt: string;
  payload: MoneybookBackupPayload;
}

export function createBackupDocument(
  payload: MoneybookBackupPayload,
  exportedAt = new Date().toISOString()
): MoneybookBackupDocument {
  return {
    format: "moneybook-backup",
    version: 1,
    exportedAt,
    payload
  };
}
