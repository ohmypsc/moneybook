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
  benefitRewardUsage?: unknown[];
  realEstateAssets?: unknown[];
}

export interface MoneybookBackupDocument {
  format: "moneybook-backup";
  version: 1 | 2 | 3;
  exportedAt: string;
  payload: MoneybookBackupPayload;
}

export function createBackupDocument(
  payload: MoneybookBackupPayload,
  exportedAt = new Date().toISOString(),
  version: 1 | 2 | 3 = 3
): MoneybookBackupDocument {
  return {
    format: "moneybook-backup",
    version,
    exportedAt,
    payload
  };
}

export function parseMoneybookBackupText(text: string): MoneybookBackupDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일을 읽을 수 없습니다.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("백업 파일 형식이 올바르지 않습니다.");
  }

  const candidate = parsed as Partial<MoneybookBackupDocument>;
  if (candidate.format !== "moneybook-backup") {
    throw new Error("Moneybook 백업 파일이 아닙니다.");
  }
  if (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3) {
    throw new Error(`지원하지 않는 백업 버전입니다: ${String(candidate.version ?? "")}`);
  }
  if (!candidate.payload || typeof candidate.payload !== "object") {
    throw new Error("백업 데이터가 없습니다.");
  }

  return candidate as MoneybookBackupDocument;
}
