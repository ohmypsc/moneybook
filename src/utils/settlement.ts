export const SETTLEMENT_REQUEST_PREFIX = "SETTLEMENT_";
export const SETTLEMENT_INCOME_CATEGORY_NAME = "정산받음";
export const BENEFIT_INCOME_CATEGORY_NAME = "캐시백/할인혜택";

export function isSettlementTransaction(transaction: {
  requestId?: string | null;
}) {
  return Boolean(transaction.requestId?.startsWith(SETTLEMENT_REQUEST_PREFIX));
}

/**
 * 자동 생성되는 보조 수입 카테고리는 일반 입력/카테고리 관리에서 숨긴다.
 * 함수명은 기존 호출부 호환을 위해 유지한다.
 */
export function isSystemSettlementCategory(category: {
  type?: string | null;
  name?: string | null;
  systemRole?: string | null;
}) {
  if (category.systemRole === "settlement_income" || category.systemRole === "benefit_income") {
    return true;
  }
  return category.type === "수입" && (
    category.name === SETTLEMENT_INCOME_CATEGORY_NAME ||
    category.name === BENEFIT_INCOME_CATEGORY_NAME
  );
}
