import type { DashboardAccount, DashboardData } from "../../types/dashboard";

export function isLivingAccount(account: DashboardAccount) {
  return (
    account.active &&
    !account.isDeleted &&
    account.accountType === "자산" &&
    !["신용카드", "체크카드", "주식"].includes(account.subType)
  );
}

export function livingSummary(dashboard: DashboardData, selectedIds: string[] | null) {
  const accounts = dashboard.accounts
    .filter(isLivingAccount)
    .filter(account =>
      selectedIds === null ? account.owner === "공동" : selectedIds.includes(account.accountId)
    );
  return {
    accounts,
    balance: accounts.reduce((sum, account) => sum + Number(account.currentBalance || 0), 0),
    expense: Number(dashboard.spendingTargetExpense.find(item => item.name === "공동")?.amount || 0)
  };
}
