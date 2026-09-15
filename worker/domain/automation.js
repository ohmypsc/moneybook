import { monthOnly } from "./date.js";

export function recurringOccurrenceDate(rule, month) {
  if (!monthOnly(month)) return "";

  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dayOfMonth = Math.max(1, Math.min(31, Math.floor(Number(rule?.dayOfMonth) || 1)));

  return `${month}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, "0")}`;
}

export function recurringRuleActiveForMonth(rule, month) {
  if (!rule?.enabled || !monthOnly(month)) return false;
  if (rule.startMonth && month < rule.startMonth) return false;
  if (rule.endMonth && month > rule.endMonth) return false;
  return true;
}

export function recurringPayload(rule, date, requestId) {
  const base = {
    date,
    type: rule.type,
    amount: rule.amount,
    categoryId: rule.categoryId,
    description: rule.description || rule.name,
    memo: rule.memo,
    requestId
  };

  if (rule.type === "지출") {
    return {
      ...base,
      paymentMethodId: rule.paymentMethodId,
      spendingTarget: rule.spendingTarget
    };
  }

  if (rule.type === "수입") {
    return {
      ...base,
      toAccountId: rule.toAccountId
    };
  }

  return {
    ...base,
    fromAccountId: rule.fromAccountId,
    toAccountId: rule.toAccountId
  };
}
