import type { BenefitRule } from "../../api/automation";

export type TransactionType = "지출" | "수입" | "이체";
export type InputMode = "expense" | "income" | "transfer" | "investment";

export const INPUT_MODE_OPTIONS: ReadonlyArray<{
  value: InputMode;
  label: string;
}> = [
  { value: "expense", label: "지출" },
  { value: "income", label: "수입" },
  { value: "transfer", label: "이체" },
  { value: "investment", label: "투자" }
];

export interface Account {
  accountId: string;
  accountName?: string;
  displayName: string;
  accountType: string;
  subType: string;
  owner?: string;
  paymentAccountId?: string | null;
}

export interface Category {
  categoryId: string;
  type: TransactionType;
  name: string;
}

export type PickerKind =
  | "category"
  | "paymentMethod"
  | "spendingTarget"
  | "incomeAccount"
  | "fromAccount"
  | "toAccount"
  | "creditCard"
  | "cardSource"
  | "loanSource"
  | "loanAccount"
  | "investmentAccount";

export const CARD_PAYMENT_CATEGORY = "카드정기결제";
export const CARD_PREPAYMENT_CATEGORY = "카드선결제";
export const LOAN_REPAYMENT_PICKER_ID = "__moneybook_loan_repayment__";
export const LOAN_PRINCIPAL_CATEGORY_NAME = "대출원금상환";
export const LOAN_INTEREST_CATEGORY_NAME = "대출이자";

export function ownerMatchesUser(owner: string, userName: string) {
  const normalizedOwner = String(owner || "").trim();
  const normalizedUser = String(userName || "").trim();

  if (!normalizedOwner || !normalizedUser) {
    return false;
  }

  return (
    normalizedOwner === normalizedUser ||
    (normalizedOwner.length >= 2 && normalizedUser.endsWith(normalizedOwner)) ||
    (normalizedUser.length >= 2 && normalizedOwner.endsWith(normalizedUser))
  );
}

export function isLoanAccount(account: Account) {
  return (
    account.accountType === "부채" &&
    (account.subType || "").includes("대출")
  );
}

export function isLoanSourceAccount(account: Account) {
  return account.accountType === "자산" && account.subType !== "주식";
}

export function isTransferAssetAccount(account: Account) {
  return account.accountType === "자산";
}

export function getAccountLabel(account: Account) {
  return account.displayName || account.accountName || account.accountId;
}

export function getAccountOwner(account: Account) {
  const explicitOwner = String(account.owner || "").trim();

  if (explicitOwner) {
    return explicitOwner;
  }

  const ownerMatch = getAccountLabel(account).match(/\(([^()]+)\)\s*$/);
  return ownerMatch?.[1]?.trim() || "";
}

export function prioritizeAccountsForUser(accounts: Account[], userName: string) {
  return accounts
    .map((account, index) => ({
      account,
      index,
      rank: ownerMatchesUser(getAccountOwner(account), userName)
        ? 0
        : getAccountOwner(account) === "공동"
          ? 1
          : 2
    }))
    .sort(
      (first, second) =>
        first.rank - second.rank || first.index - second.index
    )
    .map(item => item.account);
}

export function getBackendType(mode: InputMode): TransactionType {
  if (mode === "income") {
    return "수입";
  }

  if (mode === "transfer") {
    return "이체";
  }

  return "지출";
}

export function getModeLabel(mode: InputMode) {
  if (mode === "income") {
    return "수입";
  }

  if (mode === "transfer") {
    return "이체";
  }

  if (mode === "investment") {
    return "투자";
  }

  return "지출";
}

export function isOtherOwnerAccount(account: Account, userName: string) {
  const owner = getAccountOwner(account);

  return Boolean(
    owner && !ownerMatchesUser(owner, userName) && owner !== "공동"
  );
}

export function uniqueAccounts(accounts: Account[]) {
  const seen = new Set<string>();

  return accounts.filter(account => {
    if (seen.has(account.accountId)) {
      return false;
    }

    seen.add(account.accountId);
    return true;
  });
}

export function isAccountPickerKind(
  kind: PickerKind
): kind is Exclude<PickerKind, "category" | "spendingTarget"> {
  return kind !== "category" && kind !== "spendingTarget";
}

export function getCategoryLabel(category: Category) {
  if (category.name === CARD_PAYMENT_CATEGORY) {
    return "카드값 결제";
  }

  if (category.name === CARD_PREPAYMENT_CATEGORY) {
    return "카드 선결제";
  }

  return category.name;
}

export function isCardSettlementCategory(category: Category | null) {
  return Boolean(
    category &&
      (category.name === CARD_PAYMENT_CATEGORY ||
        category.name === CARD_PREPAYMENT_CATEGORY)
  );
}

export function isBenefitRuleActive(rule: BenefitRule, date: string) {
  if (!rule.enabled || rule.kind === "none" || rule.ratePercent <= 0) {
    return false;
  }

  if (rule.validFrom && date < rule.validFrom) {
    return false;
  }

  if (rule.validTo && date > rule.validTo) {
    return false;
  }

  return true;
}
