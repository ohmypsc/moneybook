import { apiRequest } from "./client";
import type { MoneybookBackupDocument } from "./dataBackupFormat";
export { parseMoneybookBackupText } from "./dataBackupFormat";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface BackupRestoreCounts {
  members: number;
  categories: number;
  accounts: number;
  transactions: number;
  assetSnapshots: number;
  investmentHoldings: number;
  investmentTrades: number;
  benefitRewardUsage: number;
  realEstateAssets: number;
  totalRecords: number;
}

export interface BackupRestorePreview {
  mode: "merge";
  version: 1 | 2 | 3;
  exportedAt: string | null;
  summary: BackupRestoreCounts;
  existing: Record<string, number>;
  additions: Record<string, number>;
  warnings: string[];
  notes: string[];
}

export interface BackupRestoreResult {
  restored: true;
  mode: "merge";
  version: 1 | 2 | 3;
  exportedAt: string | null;
  summary: BackupRestoreCounts;
  warnings: string[];
  restoredAt: string;
  restoredBy: string;
}

function unwrap<T>(response: ApiEnvelope<T>, fallback: string): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || fallback);
  }
  return response.data;
}

export async function previewMoneybookBackup(
  backup: MoneybookBackupDocument
) {
  const response = await apiRequest<ApiEnvelope<BackupRestorePreview>>(
    "/api/backup/preview",
    {
      method: "POST",
      body: JSON.stringify({ backup }),
      timeoutMs: 60_000
    }
  );
  return unwrap(response, "백업 파일을 검증하지 못했습니다.");
}

export async function restoreMoneybookBackup(
  backup: MoneybookBackupDocument
) {
  const response = await apiRequest<ApiEnvelope<BackupRestoreResult>>(
    "/api/backup/restore",
    {
      method: "POST",
      body: JSON.stringify({
        backup,
        confirm: "RESTORE_MERGE"
      }),
      timeoutMs: 120_000
    }
  );
  return unwrap(response, "백업을 복원하지 못했습니다.");
}
