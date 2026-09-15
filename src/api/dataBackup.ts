import { apiRequest } from "./client";
import type { MoneybookBackupDocument } from "./dataBackupFormat";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export async function createMoneybookBackup() {
  const response = await apiRequest<ApiEnvelope<MoneybookBackupDocument>>(
    "/api/backup/export",
    { timeoutMs: 60_000 }
  );

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message ||
      "전체 백업을 만들지 못했습니다."
    );
  }

  return response.data;
}
