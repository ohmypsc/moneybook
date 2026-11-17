import { apiRequest } from "./client";
import { unwrapEnvelope } from "./envelope";
import type { ApiEnvelope } from "./envelope";
export type { ClassificationRule } from "../../shared/classification.js";
import type { ClassificationRule } from "../../shared/classification.js";
export interface ClassificationSettings {
  rules: ClassificationRule[];
  version: number;
}
export interface ClassificationPreviewItem {
  transactionId: string;
  date: string;
  description: string;
  amount: number;
  beforeCategory: string;
  afterCategory: string;
  beforeTags: string[];
  afterTags: string[];
  matchedNames: string[];
  token: string;
}
export interface ClassificationPreview {
  items: ClassificationPreviewItem[];
  version: number;
  offset: number;
  total: number;
  nextOffset: number | null;
}
async function request<T>(path: string, body?: unknown) {
  return unwrapEnvelope<T>(
    await apiRequest<ApiEnvelope<T>>(
      path,
      body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }
    )
  );
}
export const getClassificationSettings = () =>
  request<ClassificationSettings>("/api/settings/classification");
export const saveClassificationSettings = (settings: ClassificationSettings) =>
  request<ClassificationSettings>("/api/settings/classification", settings);
export const previewClassification = (dateFrom: string, dateTo: string, offset = 0) =>
  request<ClassificationPreview>("/api/classification/preview", { dateFrom, dateTo, offset });
export async function applyClassification(preview: ClassificationPreview, ids: string[]) {
  const selected = preview.items.filter(i => ids.includes(i.transactionId));
  const results: { transactionId: string; applied: boolean; error?: string }[] = [];
  // Small requests keep per-invocation DB query use bounded; preserve partial results.
  for (let offset = 0; offset < selected.length; offset += 2) {
    try {
      const batch = await request<{ results: typeof results }>("/api/classification/apply", {
        version: preview.version,
        items: selected
          .slice(offset, offset + 2)
          .map(({ transactionId, token }) => ({ transactionId, token })),
        confirm: "APPLY_RULES"
      });
      results.push(...batch.results);
    } catch (error) {
      for (const item of selected.slice(offset))
        results.push({
          transactionId: item.transactionId,
          applied: false,
          error: `저장 상태 재확인 필요: ${error instanceof Error ? error.message : "통신 오류"}`
        });
      break;
    }
  }
  return { results };
}
