import type { RealtimeChange } from "../../utils/realtimeSync";

export function changeDescription(change: RealtimeChange): string {
  const payload = change.payload && typeof change.payload === "object" ? change.payload as Record<string, unknown> : {};
  const labels: Record<string, string> = { transaction: "거래", account: "계좌", category: "카테고리", holding: "보유 종목", investment_trade: "투자 거래", real_estate: "부동산", backup_restore: "백업 복원" };
  const actions: Record<string, string> = { created: "추가", updated: "수정", deleted: "삭제", restored: "복구" };
  const label = typeof payload.description === "string" && payload.description ? payload.description : labels[change.entityType] || "가계부";
  const amount = typeof payload.amount === "number" && Number.isFinite(payload.amount) ? `${payload.amount.toLocaleString("ko-KR")}원` : "";
  const before = payload.before && typeof payload.before === "object" ? payload.before as Record<string, unknown> : null;
  const oldAmount = before?.amount;
  if (change.action === "updated" && typeof oldAmount === "number" && Number.isFinite(oldAmount) && amount && oldAmount !== payload.amount) {
    return `${label} ${oldAmount.toLocaleString("ko-KR")}원 → ${amount} 수정`;
  }
  return [label, amount, actions[change.action] || "변경"].filter(Boolean).join(" ");
}
