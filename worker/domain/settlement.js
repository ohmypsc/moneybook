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
    cleanType === "지출" &&
    (cleanName === SETTLEMENT_EXPENSE_CATEGORY_NAME || cleanId === SYSTEM_CATEGORY_IDS.settlementExpense)
  ) return "settlement_expense";

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

export function isSettlementEligibleCategory(type, name, categoryId = "") {
  return systemCategoryRole(type, name, categoryId) === "settlement_expense";
}

export function isSettlementRequestId(value) {
  return String(value || "").startsWith(SETTLEMENT_REQUEST_PREFIX);
}

export function settlementRemaining(originalAmount, linkedAmounts = []) {
  const original = Math.max(0, Number(originalAmount) || 0);
  const settled = linkedAmounts.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  return Math.max(0, original - settled);
}
