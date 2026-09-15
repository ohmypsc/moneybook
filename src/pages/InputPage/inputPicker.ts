import {
  CARD_PAYMENT_CATEGORY,
  CARD_PREPAYMENT_CATEGORY,
  LOAN_INTEREST_CATEGORY_NAME,
  LOAN_PRINCIPAL_CATEGORY_NAME,
  LOAN_REPAYMENT_PICKER_ID,
  getAccountLabel,
  getAccountOwner,
  getCategoryLabel,
  isCardSettlementCategory,
  isLoanAccount,
  isLoanSourceAccount,
  isOtherOwnerAccount,
  isTransferAssetAccount,
  uniqueAccounts,
  type Account,
  type Category,
  type InputMode,
  type PickerKind
} from "./inputDomain.ts";

export interface PickerItem {
  value: string;
  label: string;
  meta?: string;
}

export interface AccountPickerContext {
  userName: string;
  orderedAllAccounts: Account[];
  visibleAccounts: Account[];
  creditCards: Account[];
  cardSourceAccounts: Account[];
  visibleAccountIds: Set<string>;
  investmentAccountIds: Set<string>;
  selectedCardAccountId: string;
}

export interface PickerItemsContext extends AccountPickerContext {
  mode: InputMode;
  categories: Category[];
  spendingTargets: string[];
}

export interface PickerSelection {
  categoryId: string;
  paymentMethodId: string;
  spendingTarget: string;
  fromAccountId: string;
  toAccountId: string;
  investmentAccountId: string;
}

export function getPickerTitle(kind: PickerKind, mode: InputMode) {
  switch (kind) {
    case "category":
      return mode === "transfer" ? "이체 분류 선택" : "카테고리 선택";
    case "paymentMethod":
      return "결제수단 선택";
    case "spendingTarget":
      return "지출대상 선택";
    case "incomeAccount":
      return "입금수단 선택";
    case "fromAccount":
      return "보내는 수단 선택";
    case "toAccount":
      return "받는 수단 선택";
    case "creditCard":
      return "결제할 카드 선택";
    case "cardSource":
      return "출금계좌 선택";
    case "loanSource":
      return "상환 출금계좌 선택";
    case "loanAccount":
      return "대출계좌 선택";
    case "investmentAccount":
      return "투자계좌 선택";
  }
}

export function getPickerSelectedValue(
  kind: PickerKind,
  selection: PickerSelection
) {
  switch (kind) {
    case "category":
      return selection.categoryId;
    case "paymentMethod":
      return selection.paymentMethodId;
    case "spendingTarget":
      return selection.spendingTarget;
    case "incomeAccount":
    case "toAccount":
    case "creditCard":
    case "loanAccount":
      return selection.toAccountId;
    case "investmentAccount":
      return selection.investmentAccountId;
    case "fromAccount":
    case "cardSource":
    case "loanSource":
      return selection.fromAccountId;
  }
}

export function getAccountPickerSource(
  kind: Exclude<PickerKind, "category" | "spendingTarget">,
  context: AccountPickerContext
) {
  const otherOwnerAccounts = context.orderedAllAccounts.filter(account =>
    isOtherOwnerAccount(account, context.userName)
  );

  if (kind === "investmentAccount") {
    return uniqueAccounts(
      context.orderedAllAccounts.filter(account =>
        context.investmentAccountIds.has(account.accountId)
      )
    );
  }

  if (kind === "loanSource") {
    return uniqueAccounts(
      context.orderedAllAccounts.filter(isLoanSourceAccount)
    );
  }

  if (kind === "loanAccount") {
    return uniqueAccounts(
      context.orderedAllAccounts.filter(isLoanAccount)
    );
  }

  if (
    kind === "incomeAccount" ||
    kind === "fromAccount" ||
    kind === "toAccount"
  ) {
    return uniqueAccounts(
      context.orderedAllAccounts.filter(isTransferAssetAccount)
    );
  }

  if (kind === "paymentMethod") {
    return uniqueAccounts([
      ...context.visibleAccounts,
      ...otherOwnerAccounts.filter(
        account =>
          context.visibleAccountIds.has(account.accountId) ||
          account.subType === "신용카드" ||
          account.subType === "체크카드"
      )
    ]);
  }

  if (kind === "creditCard") {
    return uniqueAccounts([
      ...context.creditCards,
      ...otherOwnerAccounts.filter(account => account.subType === "신용카드")
    ]);
  }

  if (kind === "cardSource") {
    return uniqueAccounts([
      ...context.cardSourceAccounts,
      ...otherOwnerAccounts.filter(
        account =>
          account.accountId !== context.selectedCardAccountId &&
          account.accountType === "자산" &&
          account.subType !== "주식"
      )
    ]);
  }

  return uniqueAccounts([
    ...context.visibleAccounts,
    ...otherOwnerAccounts
  ]);
}

export function getAccountPickerGroups(
  kind: Exclude<PickerKind, "category" | "spendingTarget">,
  context: AccountPickerContext
) {
  const source = getAccountPickerSource(kind, context);

  return {
    primary: source.filter(
      account => !isOtherOwnerAccount(account, context.userName)
    ),
    other: source.filter(account =>
      isOtherOwnerAccount(account, context.userName)
    )
  };
}

export function getOtherOwnerPickerLabel(
  kind: Exclude<PickerKind, "category" | "spendingTarget">
) {
  switch (kind) {
    case "paymentMethod":
      return "다른 명의 결제수단";
    case "incomeAccount":
      return "다른 명의 입금계좌";
    case "fromAccount":
      return "다른 명의 보내는 계좌";
    case "toAccount":
      return "다른 명의 받는 계좌";
    case "creditCard":
      return "다른 명의 카드";
    case "cardSource":
    case "loanSource":
      return "다른 명의 출금계좌";
    case "loanAccount":
      return "다른 명의 대출계좌";
    case "investmentAccount":
      return "다른 명의 투자계좌";
  }
}

export function getAccountPickerItem(account: Account): PickerItem {
  return {
    value: account.accountId,
    label: getAccountLabel(account),
    meta: [account.subType, getAccountOwner(account)]
      .filter(Boolean)
      .join(" · ")
  };
}

export function getPickerItems(
  kind: PickerKind,
  context: PickerItemsContext
): PickerItem[] {
  if (kind === "category") {
    const inputCategories = context.categories.filter(
      category =>
        category.name !== LOAN_PRINCIPAL_CATEGORY_NAME &&
        category.name !== LOAN_INTEREST_CATEGORY_NAME
    );

    const visibleCategories = context.mode === "transfer"
      ? [
          ...inputCategories.filter(
            category => category.name === CARD_PAYMENT_CATEGORY
          ),
          ...inputCategories.filter(
            category => category.name === CARD_PREPAYMENT_CATEGORY
          ),
          ...inputCategories.filter(
            category => !isCardSettlementCategory(category)
          )
        ]
      : inputCategories;

    const items = visibleCategories.map(category => ({
      value: category.categoryId,
      label: getCategoryLabel(category),
      meta: category.type
    }));

    if (context.mode === "transfer") {
      return [
        {
          value: LOAN_REPAYMENT_PICKER_ID,
          label: "대출 상환",
          meta: "이체"
        },
        ...items
      ];
    }

    return items;
  }

  if (kind === "spendingTarget") {
    return context.spendingTargets
      .slice()
      .sort((first, second) => {
        if (first === "공동") return -1;
        if (second === "공동") return 1;
        return first.localeCompare(second, "ko");
      })
      .map(target => ({
        value: target,
        label: target
      }));
  }

  return getAccountPickerSource(kind, context).map(getAccountPickerItem);
}
