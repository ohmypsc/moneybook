export const SETTLEMENT_EXPENSE_CATEGORY_NAME = "회식비";
export const SETTLEMENT_INCOME_CATEGORY_NAME = "정산받음";
export const BENEFIT_INCOME_CATEGORY_NAME = "캐시백/할인혜택";
export const CASHBACK_INCOME_CATEGORY_NAME = "캐시백";
export const SETTLEMENT_REQUEST_PREFIX = "SETTLEMENT_";

export const SYSTEM_CATEGORY_IDS = {
  settlementExpense: "CAT_SYSTEM_GROUP_MEAL",
  settlementIncome: "CAT_SYSTEM_SETTLEMENT_RECEIVED",
  benefitIncome: "CAT_SYSTEM_CASHBACK_BENEFIT"
};

export const DEFAULT_CATEGORY_IDS = {
  cashbackIncome: "CAT_DEFAULT_CASHBACK_INCOME"
};

export function systemCategoryRole(type, name, categoryId = "") {
  const cleanType = String(type || "");
  const cleanName = String(name || "").trim();
  const cleanId = String(categoryId || "").trim();

  if (
    cleanType === "수입" &&
    (cleanName === SETTLEMENT_INCOME_CATEGORY_NAME || cleanId === SYSTEM_CATEGORY_IDS.settlementIncome)
  ) return "settlement_income";

  if (
    cleanType === "수입" &&
    (cleanName === BENEFIT_INCOME_CATEGORY_NAME || cleanId === SYSTEM_CATEGORY_IDS.benefitIncome)
  ) return "benefit_income";

  return "";
}

/**
 * 정산받기는 모든 지출에서 쓸 수 있습니다(회식비·여행 경비·공동 구매 등).
 * 예전에는 '회식비' 카테고리에서만 가능해서 그 카테고리를 잠가 두었지만, 이제는 잠그지 않습니다.
 */
export function isSettlementEligibleCategory(type) {
  return String(type || "") === "지출";
}

export function isSettlementRequestId(value) {
  return String(value || "").startsWith(SETTLEMENT_REQUEST_PREFIX);
}

export function settlementRemaining(originalAmount, linkedAmounts = []) {
  const original = Math.max(0, Number(originalAmount) || 0);
  const settled = linkedAmounts.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  return Math.max(0, original - settled);
}
