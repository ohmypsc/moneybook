import type { InputMode } from "./inputDomain";

const INPUT_DRAFT_KEY_PREFIX = "moneybook:input-draft:v1:";

export interface InputDraft {
  mode: InputMode;
  date: string;
  amount: string;
  description: string;
  categoryId: string;
  paymentMethodId: string;
  spendingTarget: string;
  fromAccountId: string;
  toAccountId: string;
  billingMonth: string;
  memo: string;
  benefitRewardUsedAmount: string;
  loanPrincipalAmount: string;
  loanInterestAmount: string;
}

export function parseInputDraft(value: unknown): InputDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const draft = value as Partial<InputDraft>;

  if (
    draft.mode !== "expense" &&
    draft.mode !== "income" &&
    draft.mode !== "transfer" &&
    draft.mode !== "investment"
  ) {
    return null;
  }

  const text = (candidate: unknown) =>
    typeof candidate === "string" ? candidate : "";

  return {
    mode: draft.mode,
    date: text(draft.date),
    amount: text(draft.amount),
    description: text(draft.description),
    categoryId: text(draft.categoryId),
    paymentMethodId: text(draft.paymentMethodId),
    spendingTarget: text(draft.spendingTarget),
    fromAccountId: text(draft.fromAccountId),
    toAccountId: text(draft.toAccountId),
    billingMonth: text(draft.billingMonth),
    memo: text(draft.memo),
    benefitRewardUsedAmount: text(draft.benefitRewardUsedAmount),
    loanPrincipalAmount: text(draft.loanPrincipalAmount),
    loanInterestAmount: text(draft.loanInterestAmount)
  };
}

export function hasMeaningfulInputDraft(draft: InputDraft) {
  return Boolean(
    draft.amount ||
      draft.categoryId ||
      draft.paymentMethodId ||
      draft.spendingTarget ||
      draft.fromAccountId ||
      draft.toAccountId ||
      draft.description.trim() ||
      draft.memo.trim() ||
      draft.benefitRewardUsedAmount ||
      draft.loanPrincipalAmount ||
      draft.loanInterestAmount
  );
}

export function readInputDraft(userName: string): InputDraft | null {
  if (typeof window === "undefined" || !userName) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(`${INPUT_DRAFT_KEY_PREFIX}${userName}`);
    return raw ? parseInputDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearInputDraft(userName: string) {
  if (typeof window === "undefined" || !userName) {
    return;
  }

  try {
    window.localStorage.removeItem(`${INPUT_DRAFT_KEY_PREFIX}${userName}`);
  } catch {
    // 임시저장 정리 실패가 실제 거래 저장을 막지는 않게 합니다.
  }
}

export function saveInputDraft(userName: string, draft: InputDraft) {
  if (typeof window === "undefined" || !userName) {
    return;
  }

  try {
    if (!hasMeaningfulInputDraft(draft)) {
      window.localStorage.removeItem(`${INPUT_DRAFT_KEY_PREFIX}${userName}`);
      return;
    }

    window.localStorage.setItem(
      `${INPUT_DRAFT_KEY_PREFIX}${userName}`,
      JSON.stringify(draft)
    );
  } catch {
    // 임시저장 실패가 실제 거래 입력을 막지는 않게 합니다.
  }
}
