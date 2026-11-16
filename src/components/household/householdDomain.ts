import type { BootstrapData } from "../../types/bootstrap";
import type { QuickEntry } from "../../utils/inputPreferences";
import type { DashboardAccount, DashboardData } from "../../types/dashboard";

export function validateQuickEntry(entry: QuickEntry, bootstrap: BootstrapData): string | null {
  const type = { expense: "지출", income: "수입", transfer: "이체" }[entry.mode];
  if (!bootstrap.categories.some(item => item.categoryId === entry.categoryId && item.type === type && item.active && !item.isDeleted)) return "사용 가능한 카테고리를 먼저 선택해주세요.";
  const ids = entry.mode === "expense" ? [entry.paymentMethodId] : entry.mode === "income" ? [entry.toAccountId] : [entry.fromAccountId, entry.toAccountId];
  if (ids.some(id => !bootstrap.accounts.some(item => item.accountId === id && item.active && !item.isDeleted))) return "사용 가능한 결제수단·계좌를 먼저 선택해주세요.";
  if (entry.mode === "expense" && !bootstrap.spendingTargets.includes(entry.spendingTarget)) return "지출대상을 먼저 선택해주세요.";
  if (entry.mode === "transfer" && entry.fromAccountId === entry.toAccountId) return "보내는 계좌와 받는 계좌를 다르게 선택해주세요.";
  return null;
}

export function isLivingAccount(account: DashboardAccount) {
  return account.active && !account.isDeleted && account.accountType === "자산" && !["신용카드", "체크카드", "주식"].includes(account.subType);
}

export function livingSummary(dashboard: DashboardData, selectedIds: string[] | null) {
  const accounts = dashboard.accounts.filter(isLivingAccount).filter(account => selectedIds === null ? account.owner === "공동" : selectedIds.includes(account.accountId));
  return {
    accounts,
    balance: accounts.reduce((sum, account) => sum + Number(account.currentBalance || 0), 0),
    expense: Number(dashboard.spendingTargetExpense.find(item => item.name === "공동")?.amount || 0)
  };
}
