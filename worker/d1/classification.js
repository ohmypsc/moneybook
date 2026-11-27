// 할부 스키마 보장
import { mbD1All } from "./core.js";

// 할부 개월 수 칸(installment_months)이 없던 기존 DB에 한 번만 추가합니다.
export const mbD1InstallmentSchemaReadyFor = new WeakSet();

export async function mbD1EnsureInstallmentSchema(env) {
  if (!env.DB || mbD1InstallmentSchemaReadyFor.has(env.DB)) return;
  const columns = await mbD1All(env, "PRAGMA table_info(transactions)", []);
  if (!columns.some(column => column.name === "installment_months")) {
    try {
      await env.DB.prepare("ALTER TABLE transactions ADD COLUMN installment_months INTEGER").run();
    } catch (error) {
      // 다른 요청이 동시에 먼저 추가한 경우만 무시합니다.
      if (!/duplicate column/i.test(String(error?.message || error))) throw error;
    }
  }
  // 보유종목 전일 종가(오늘 등락 표시용)
  const holdingColumns = await mbD1All(env, "PRAGMA table_info(holdings)", []);
  if (holdingColumns.length && !holdingColumns.some(column => column.name === "previous_close")) {
    try {
      await env.DB.prepare("ALTER TABLE holdings ADD COLUMN previous_close REAL").run();
    } catch (error) {
      if (!/duplicate column/i.test(String(error?.message || error))) throw error;
    }
  }
  mbD1InstallmentSchemaReadyFor.add(env.DB);
}
