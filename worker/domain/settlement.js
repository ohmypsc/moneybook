export const SETTLEMENT_EXPENSE_CATEGORY_NAME = "회식비";
export const SETTLEMENT_INCOME_CATEGORY_NAME = "정산받음";
export const SETTLEMENT_REQUEST_PREFIX = "SETTLEMENT_";

export function isSettlementEligibleCategory(type, name) {
  return String(type || "") === "지출" && String(name || "").trim() === SETTLEMENT_EXPENSE_CATEGORY_NAME;
}

export function isSettlementRequestId(value) {
  return String(value || "").startsWith(SETTLEMENT_REQUEST_PREFIX);
}

export function settlementRemaining(originalAmount, linkedAmounts = []) {
  const original = Math.max(0, Number(originalAmount) || 0);
  const settled = linkedAmounts.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  return Math.max(0, original - settled);
}
