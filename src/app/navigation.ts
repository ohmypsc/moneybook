import type { Transaction } from "../api/transactions";
import type { NavigationKey } from "../components/layout/BottomNav/BottomNav";

/** 거래 입력 화면을 열 때 미리 채워 둘 값 */
export type InputLaunchPreset = {
  mode: "expense" | "income" | "transfer";
  amount?: number | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  categoryId?: string | null;
  paymentMethodId?: string | null;
  spendingTarget?: string | null;
  description?: string | null;
  memo?: string | null;
};

/** 브라우저 history에 저장하는 화면 상태 (뒤로가기 복원용) */
export type AppHistoryState = {
  moneybook?: boolean;
  navigation?: NavigationKey;
  inputInitialDate?: string | null;
  inputPreset?: InputLaunchPreset | null;
  moneybookSettingsView?: string;
};

const PRIMARY_NAVIGATION_KEYS = new Set<NavigationKey>([
  "home",
  "calendar",
  "input",
  "assets",
  "settings"
]);

export function isPrimaryNavigation(value: unknown): value is NavigationKey {
  return (
    typeof value === "string" &&
    PRIMARY_NAVIGATION_KEYS.has(value as NavigationKey)
  );
}

/** 기존 거래를 복사해 새 거래 입력 화면을 열 때 쓰는 프리셋 */
export function createInputPresetFromTransaction(
  transaction: Transaction
): InputLaunchPreset {
  const mode: InputLaunchPreset["mode"] =
    transaction.type === "수입"
      ? "income"
      : transaction.type === "이체"
        ? "transfer"
        : "expense";

  return {
    mode,
    amount: transaction.amount,
    categoryId: transaction.categoryId,
    fromAccountId: transaction.fromAccountId,
    toAccountId: transaction.toAccountId,
    paymentMethodId: transaction.paymentMethodId,
    spendingTarget: transaction.spendingTarget,
    description: transaction.description,
    memo: transaction.memo
  };
}

/** 입력 화면이 아니면 날짜·프리셋은 저장하지 않습니다. */
export function createHistoryState(
  navigation: NavigationKey,
  inputInitialDate: string | null = null,
  inputPreset: InputLaunchPreset | null = null
): AppHistoryState {
  return {
    moneybook: true,
    navigation,
    inputInitialDate: navigation === "input" ? inputInitialDate : null,
    inputPreset: navigation === "input" ? inputPreset : null
  };
}

/** 현재 history 항목이 이동하려는 화면과 같으면 pushState를 생략합니다. */
export function isSameHistoryDestination(
  currentState: AppHistoryState | null,
  navigation: NavigationKey,
  inputInitialDate: string | null,
  inputPreset: InputLaunchPreset | null
) {
  return (
    currentState?.moneybook === true &&
    currentState.navigation === navigation &&
    (
      navigation !== "input" ||
      (
        (currentState.inputInitialDate ?? null) === inputInitialDate &&
        JSON.stringify(currentState.inputPreset ?? null) ===
          JSON.stringify(inputPreset)
      )
    )
  );
}

export function scrollToPageTop() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}
