export const SETTLEMENT_REQUEST_PREFIX = "SETTLEMENT_";
export const SETTLEMENT_INCOME_CATEGORY_NAME = "정산받음";

export function isSettlementTransaction(transaction: {
  requestId?: string | null;
}) {
  return Boolean(transaction.requestId?.startsWith(SETTLEMENT_REQUEST_PREFIX));
}

export function isSystemSettlementCategory(category: {
  type?: string | null;
  name?: string | null;
}) {
  return category.type === "수입" && category.name === SETTLEMENT_INCOME_CATEGORY_NAME;
}
