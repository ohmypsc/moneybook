import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { apiRequest } from "../../api/client";
import {
  getBootstrapCacheGeneration,
  getCachedBootstrapPayload
} from "../../api/bootstrapCache";
import { createTransaction } from "../../api/transactions";
import { getDashboardSnapshot } from "../../api/dashboard";
import {
  applyAccountPreferences,
  applyCategoryPreferences,
  getInputPreferences,
  sortAccountsByPreferences
} from "../../utils/inputPreferences";
import {
  discardPendingTransaction,
  enqueuePendingTransaction,
  getLastPendingTransactionCompletion,
  getPendingTransactions,
  retryAllFailedPendingTransactions,
  retryPendingTransaction,
  subscribePendingTransactions
} from "../../utils/pendingTransactionQueue";
import type {
  PendingTransactionRecord
} from "../../utils/pendingTransactionQueue";
import { getSeoulDateString } from "../../utils/dateTime";
import styles from "./InputPage.module.css";

type TransactionType = "지출" | "수입" | "이체";
type InputMode = "expense" | "income" | "transfer";
type CreateTransactionPayload = Parameters<typeof createTransaction>[0];

interface Account {
  accountId: string;
  accountName?: string;
  displayName: string;
  accountType: string;
  subType: string;
  owner?: string;
  paymentAccountId?: string | null;
}

interface Category {
  categoryId: string;
  type: TransactionType;
  name: string;
}

interface BootstrapData {
  transactionTypes: TransactionType[];
  members: string[];
  spendingTargets: string[];
  accounts: Account[];
  categories: Category[];
}

interface BootstrapResponse {
  success: boolean;
  apiVersion?: string;
  data?: BootstrapData;
  error?: {
    code?: string;
    message?: string;
  };
}

interface ApiResult {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
}

interface RequestMemory {
  fingerprint: string;
  requestId: string;
}

interface InputDraft {
  mode: InputMode;
  date: string;
  amount: string;
  categoryId: string;
  paymentMethodId: string;
  spendingTarget: string;
  fromAccountId: string;
  toAccountId: string;
  billingMonth: string;
  memo: string;
}

const CARD_PAYMENT_CATEGORY = "카드정기결제";
const CARD_PREPAYMENT_CATEGORY = "카드선결제";
const INPUT_DRAFT_KEY_PREFIX =
  "moneybook:input-draft:v1:";

interface InputPageProps {
  userName: string;
  initialDate?: string | null;
}

type PickerKind =
  | "category"
  | "paymentMethod"
  | "spendingTarget"
  | "incomeAccount"
  | "fromAccount"
  | "toAccount"
  | "creditCard"
  | "cardSource";

interface PickerItem {
  value: string;
  label: string;
  meta?: string;
}

function prioritizeAccountsForUser(
  accounts: Account[],
  userName: string
) {
  return accounts
    .map((account, index) => ({
      account,
      index,
      rank:
        account.owner === userName
          ? 0
          : account.owner === "공동"
            ? 1
            : 2
    }))
    .sort(
      (first, second) =>
        first.rank - second.rank ||
        first.index - second.index
    )
    .map(item => item.account);
}

let bootstrapPromise: Promise<BootstrapData> | null = null;
let bootstrapPromiseGeneration = -1;
let bootstrapSnapshot: BootstrapData | null = null;
let bootstrapSnapshotGeneration = -1;

function getInitialBootstrapSnapshot() {
  const generation = getBootstrapCacheGeneration();

  if (
    bootstrapSnapshot &&
    bootstrapSnapshotGeneration === generation
  ) {
    return bootstrapSnapshot;
  }

  const cached =
    getCachedBootstrapPayload<BootstrapResponse>();

  if (cached?.success && cached.data) {
    bootstrapSnapshot = cached.data;
    bootstrapSnapshotGeneration = generation;
    return cached.data;
  }

  bootstrapSnapshot = null;
  bootstrapSnapshotGeneration = generation;
  return null;
}

async function loadBootstrap(): Promise<BootstrapData> {
  const generation = getBootstrapCacheGeneration();

  if (
    !bootstrapPromise ||
    bootstrapPromiseGeneration !== generation
  ) {
    bootstrapPromiseGeneration = generation;
    const requestGeneration = generation;

    bootstrapPromise = apiRequest<BootstrapResponse>("/api/bootstrap")
      .then(async response => {
        if (!response.success || !response.data) {
          throw new Error(
            response.error?.message || "입력 정보를 불러오지 못했습니다."
          );
        }

        if (getBootstrapCacheGeneration() !== requestGeneration) {
          bootstrapPromise = null;
          return loadBootstrap();
        }

        bootstrapSnapshot = response.data;
        bootstrapSnapshotGeneration = requestGeneration;
        return response.data;
      })
      .catch(error => {
        if (bootstrapPromiseGeneration === requestGeneration) {
          bootstrapPromise = null;
        }

        throw error;
      });
  }

  return bootstrapPromise;
}

function getToday() {
  return getSeoulDateString();
}


function createRequestId() {
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return [
    "REQ",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2)
  ].join("_");
}

function getErrorMessage(
  error: unknown
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "저장 중 오류가 발생했습니다.";
}

function getBackendType(
  mode: InputMode
): TransactionType {
  if (mode === "income") {
    return "수입";
  }

  if (mode === "transfer") {
    return "이체";
  }

  return "지출";
}

function getModeLabel(
  mode: InputMode
) {
  if (mode === "income") {
    return "수입";
  }

  if (mode === "transfer") {
    return "이체";
  }

  return "지출";
}

function getAccountLabel(
  account: Account
) {
  return (
    account.displayName ||
    account.accountName ||
    account.accountId
  );
}

function getCategoryLabel(
  category: Category
) {
  if (
    category.name ===
    CARD_PAYMENT_CATEGORY
  ) {
    return "카드값 결제";
  }

  if (
    category.name ===
    CARD_PREPAYMENT_CATEGORY
  ) {
    return "카드 선결제";
  }

  return category.name;
}

function isCardSettlementCategory(
  category: Category | null
) {
  return !!(
    category &&
    (
      category.name ===
        CARD_PAYMENT_CATEGORY ||
      category.name ===
        CARD_PREPAYMENT_CATEGORY
    )
  );
}

function readInputDraft(
  userName: string
): InputDraft | null {
  if (
    typeof window === "undefined" ||
    !userName
  ) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(
      `${INPUT_DRAFT_KEY_PREFIX}${userName}`
    );

    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as Partial<InputDraft>;

    if (
      value.mode !== "expense" &&
      value.mode !== "income" &&
      value.mode !== "transfer"
    ) {
      return null;
    }

    return {
      mode: value.mode,
      date: typeof value.date === "string" ? value.date : "",
      amount: typeof value.amount === "string" ? value.amount : "",
      categoryId:
        typeof value.categoryId === "string" ? value.categoryId : "",
      paymentMethodId:
        typeof value.paymentMethodId === "string" ? value.paymentMethodId : "",
      spendingTarget:
        typeof value.spendingTarget === "string" ? value.spendingTarget : "",
      fromAccountId:
        typeof value.fromAccountId === "string" ? value.fromAccountId : "",
      toAccountId:
        typeof value.toAccountId === "string" ? value.toAccountId : "",
      billingMonth:
        typeof value.billingMonth === "string" ? value.billingMonth : "",
      memo: typeof value.memo === "string" ? value.memo : ""
    };
  } catch {
    return null;
  }
}

function clearInputDraft(
  userName: string
) {
  if (
    typeof window === "undefined" ||
    !userName
  ) {
    return;
  }

  try {
    window.localStorage.removeItem(
      `${INPUT_DRAFT_KEY_PREFIX}${userName}`
    );
  } catch {
    // 임시저장 정리 실패가 실제 거래 저장을 막지는 않게 합니다.
  }
}


function saveInputDraft(
  userName: string,
  draft: InputDraft
) {
  if (
    typeof window === "undefined" ||
    !userName
  ) {
    return;
  }

  try {
    const hasMeaningfulInput = !!(
      draft.amount ||
      draft.categoryId ||
      draft.paymentMethodId ||
      draft.spendingTarget ||
      draft.fromAccountId ||
      draft.toAccountId ||
      draft.memo.trim()
    );

    if (!hasMeaningfulInput) {
      window.localStorage.removeItem(
        `${INPUT_DRAFT_KEY_PREFIX}${userName}`
      );
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

export default function InputPage({
  userName,
  initialDate = null
}: InputPageProps) {
  const today =
    getToday();

  const initialDraft =
    useMemo(
      () =>
        readInputDraft(
          userName
        ),
      [
        userName
      ]
    );

  const [
    bootstrap,
    setBootstrap
  ] =
    useState<BootstrapData | null>(
      () =>
        getInitialBootstrapSnapshot()
    );

  const [
    bootstrapLoading,
    setBootstrapLoading
  ] =
    useState(
      () =>
        getInitialBootstrapSnapshot() ===
        null
    );

  const [
    bootstrapError,
    setBootstrapError
  ] =
    useState("");

  const [
    mode,
    setMode
  ] =
    useState<InputMode>(
      initialDraft?.mode ||
      "expense"
    );

  const [
    date,
    setDate
  ] =
    useState(
      initialDate ||
      initialDraft?.date ||
      today
    );

  useEffect(
    () => {
      if (initialDate) {
        setDate(initialDate);
      }
    },
    [initialDate]
  );


  const [
    amount,
    setAmount
  ] =
    useState(
      initialDraft?.amount ||
      ""
    );

  const [
    categoryId,
    setCategoryId
  ] =
    useState(
      initialDraft?.categoryId ||
      ""
    );

  const [
    paymentMethodId,
    setPaymentMethodId
  ] =
    useState(
      initialDraft?.paymentMethodId ||
      ""
    );

  const [
    spendingTarget,
    setSpendingTarget
  ] =
    useState(
      initialDraft?.spendingTarget ||
      ""
    );

  const [
    fromAccountId,
    setFromAccountId
  ] =
    useState(
      initialDraft?.fromAccountId ||
      ""
    );

  const [
    toAccountId,
    setToAccountId
  ] =
    useState(
      initialDraft?.toAccountId ||
      ""
    );

  const [
    billingMonth,
    setBillingMonth
  ] =
    useState(
      initialDraft?.billingMonth ||
      (initialDate || initialDraft?.date || today).slice(
        0,
        7
      )
    );

  const [
    memo,
    setMemo
  ] =
    useState(
      initialDraft?.memo ||
      ""
    );

  const [
    submitting,
    setSubmitting
  ] =
    useState(false);

  const [
    error,
    setError
  ] =
    useState("");

  const [
    success,
    setSuccess
  ] =
    useState("");

  useEffect(
    () => {
      saveInputDraft(
        userName,
        {
          mode,
          date,
          amount,
          categoryId,
          paymentMethodId,
          spendingTarget,
          fromAccountId,
          toAccountId,
          billingMonth,
          memo
        }
      );
    },
    [
      userName,
      mode,
      date,
      amount,
      categoryId,
      paymentMethodId,
      spendingTarget,
      fromAccountId,
      toAccountId,
      billingMonth,
      memo
    ]
  );


  const [
    activePicker,
    setActivePicker
  ] =
    useState<PickerKind | null>(
      null
    );

  useEffect(
    () => {
      if (!activePicker) {
        return;
      }

      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setActivePicker(null);
        }
      }

      window.addEventListener("keydown", handleKeyDown);

      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener("keydown", handleKeyDown);
      };
    },
    [activePicker]
  );


  const [
    queueVersion,
    setQueueVersion
  ] =
    useState(0);

  const lastCompletionId =
    useRef("");

  const submitGuard =
    useRef(false);

  const requestMemory =
    useRef<RequestMemory | null>(
      null
    );

  const backendType =
    getBackendType(
      mode
    );

  useEffect(
    () => {
      let active =
        true;

      void loadBootstrap()
        .then(
          data => {
            if (!active) {
              return;
            }

            setBootstrap(
              data
            );

            setBootstrapError(
              ""
            );
          }
        )
        .catch(
          loadError => {
            if (!active) {
              return;
            }

            setBootstrapError(
              getErrorMessage(
                loadError
              )
            );
          }
        )
        .finally(
          () => {
            if (
              active
            ) {
              setBootstrapLoading(
                false
              );
            }
          }
        );

      return () => {
        active =
          false;
      };
    },
    []
  );

  useEffect(
    () => {
      const unsubscribe =
        subscribePendingTransactions(
          () => {
            setQueueVersion(
              value =>
                value + 1
            );
          }
        );

      return unsubscribe;
    },
    [
      userName
    ]
  );

  const pendingTransactions =
    useMemo(
      () =>
        getPendingTransactions(
          userName
        ),
      [
        userName,
        queueVersion
      ]
    );

  const savingCount =
    pendingTransactions.filter(
      item =>
        item.status === "pending" ||
        item.status === "saving"
    ).length;

  const failedTransactions =
    pendingTransactions.filter(
      item =>
        item.status === "failed"
    );

  useEffect(
    () => {
      const completion =
        getLastPendingTransactionCompletion(
          userName
        );

      if (
        !completion ||
        completion.id ===
          lastCompletionId.current
      ) {
        return;
      }

      lastCompletionId.current =
        completion.id;

      setSuccess(
        `${completion.label} 저장 완료 ✓`
      );
    },
    [
      userName,
      queueVersion
    ]
  );

  const preferences =
    useMemo(
      () => {
        if (
          !bootstrap
        ) {
          return null;
        }

        return getInputPreferences(
          bootstrap.categories,
          bootstrap.accounts
        );
      },
      [
        bootstrap
      ]
    );

  const categories =
    useMemo(
      () => {
        if (
          !bootstrap ||
          !preferences
        ) {
          return [];
        }

        return applyCategoryPreferences(
          bootstrap.categories,
          backendType,
          preferences
        );
      },
      [
        bootstrap,
        preferences,
        backendType
      ]
    );

  const selectedCategory =
    useMemo(
      () =>
        categories.find(
          category =>
            category.categoryId ===
            categoryId
        ) ??
        null,
      [
        categories,
        categoryId
      ]
    );

  const isCardTransfer =
    mode ===
      "transfer" &&
    isCardSettlementCategory(
      selectedCategory
    );

  const cardTransferLabel =
    selectedCategory?.name ===
      CARD_PREPAYMENT_CATEGORY
      ? "카드 선결제"
      : "카드값 결제";

  const allAccounts =
    bootstrap?.accounts ??
    [];

  const accounts =
    useMemo(
      () => {
        if (
          !preferences
        ) {
          return [];
        }

        return prioritizeAccountsForUser(
          applyAccountPreferences(
            allAccounts,
            preferences
          ),
          userName
        );
      },
      [
        allAccounts,
        preferences,
        userName
      ]
    );

  const visibleAccountIds =
    useMemo(
      () =>
        new Set(
          accounts.map(
            account =>
              account.accountId
          )
        ),
      [
        accounts
      ]
    );

  const creditCards =
    useMemo(
      () =>
        accounts.filter(
          account =>
            account.subType ===
            "신용카드"
        ),
      [
        accounts
      ]
    );

  const selectedCard =
    useMemo(
      () =>
        allAccounts.find(
          account =>
            account.accountId ===
            toAccountId
        ) ??
        null,
      [
        allAccounts,
        toAccountId
      ]
    );

  const cardSourceAccounts =
    useMemo(
      () => {
        if (
          !preferences
        ) {
          return [];
        }

        const linkedId =
          selectedCard
            ?.paymentAccountId ||
          "";

        const candidates =
          allAccounts.filter(
            account => {
              if (
                account.accountId ===
                toAccountId
              ) {
                return false;
              }

              if (
                account.accountId ===
                linkedId
              ) {
                return true;
              }

              if (
                !visibleAccountIds.has(
                  account.accountId
                )
              ) {
                return false;
              }

              return (
                account.accountType ===
                  "자산" &&
                account.subType !==
                  "주식"
              );
            }
          );

        return prioritizeAccountsForUser(
          sortAccountsByPreferences(
            candidates,
            preferences
          ),
          userName
        );
      },
      [
        allAccounts,
        preferences,
        selectedCard,
        toAccountId,
        visibleAccountIds,
        userName
      ]
    );

  const formattedAmount =
    amount
      ? Number(
          amount
        ).toLocaleString(
          "ko-KR"
        )
      : "";

  function clearFeedback() {
    setError("");
    setSuccess("");
  }

  function loadFailedTransactionForEdit(
    item: PendingTransactionRecord
  ) {
    const hasCurrentInput = !!(
      amount ||
      categoryId ||
      paymentMethodId ||
      spendingTarget ||
      fromAccountId ||
      toAccountId ||
      memo.trim()
    );

    if (
      hasCurrentInput &&
      !window.confirm(
        "현재 작성 중인 내용을 저장 실패 항목으로 바꿀까요? 작성 중인 내용은 덮어씁니다."
      )
    ) {
      return;
    }

    const payload = item.payload;
    const nextMode: InputMode =
      payload.type === "수입"
        ? "income"
        : payload.type === "이체"
          ? "transfer"
          : "expense";

    setActivePicker(null);
    setMode(nextMode);
    setDate(payload.date || today);
    setAmount(String(payload.amount || ""));
    setCategoryId(payload.categoryId || "");
    setPaymentMethodId(payload.paymentMethodId || "");
    setSpendingTarget(payload.spendingTarget || "");
    setFromAccountId(payload.fromAccountId || "");
    setToAccountId(payload.toAccountId || "");
    setBillingMonth(
      payload.billingMonth ||
      (payload.date || today).slice(0, 7)
    );
    setMemo(payload.memo || "");

    const fingerprint = JSON.stringify({
      date: payload.date,
      type: payload.type,
      categoryId: payload.categoryId,
      amount: Number(payload.amount),
      paymentMethodId:
        payload.type === "지출"
          ? payload.paymentMethodId
          : undefined,
      spendingTarget:
        payload.type === "지출"
          ? payload.spendingTarget
          : undefined,
      fromAccountId:
        payload.type === "이체"
          ? payload.fromAccountId
          : undefined,
      toAccountId:
        payload.type === "수입" || payload.type === "이체"
          ? payload.toAccountId
          : undefined,
      billingMonth: payload.billingMonth || undefined,
      memo: (payload.memo || "").trim()
    });

    requestMemory.current = {
      fingerprint,
      requestId: payload.requestId || item.id
    };

    discardPendingTransaction(
      userName,
      item.id
    );

    setError("");
    setSuccess("저장 실패 내용을 불러왔습니다. 확인 후 다시 저장하세요.");
  }

  function resetAccountSelections() {
    setPaymentMethodId("");
    setSpendingTarget("");
    setFromAccountId("");
    setToAccountId("");
  }

  function handleModeChange(
    nextMode: InputMode
  ) {
    setActivePicker(null);

    setMode(
      nextMode
    );

    setCategoryId("");

    resetAccountSelections();

    setBillingMonth(
      date.slice(
        0,
        7
      )
    );

    requestMemory.current =
      null;

    clearFeedback();
  }

  function handleDateChange(
    value: string
  ) {
    const previousMonth =
      date.slice(
        0,
        7
      );

    setDate(
      value
    );

    if (
      isCardTransfer &&
      (
        !billingMonth ||
        billingMonth ===
          previousMonth
      )
    ) {
      setBillingMonth(
        value.slice(
          0,
          7
        )
      );
    }

    requestMemory.current =
      null;

    clearFeedback();
  }

  function handleAmountChange(
    value: string
  ) {
    const digits =
      value.replace(
        /[^\d]/g,
        ""
      );

    const normalized =
      digits.replace(
        /^0+(?=\d)/,
        ""
      );

    setAmount(
      normalized
    );

    requestMemory.current =
      null;

    clearFeedback();
  }

  function handleCategoryChange(
    nextCategoryId: string
  ) {
    setCategoryId(
      nextCategoryId
    );

    if (
      mode ===
      "transfer"
    ) {
      setFromAccountId("");
      setToAccountId("");

      const nextCategory =
        categories.find(
          category =>
            category.categoryId ===
            nextCategoryId
        ) ??
        null;

      if (
        isCardSettlementCategory(
          nextCategory
        )
      ) {
        setBillingMonth(
          date.slice(
            0,
            7
          )
        );
      }
    }

    requestMemory.current =
      null;

    clearFeedback();
  }

  function handleCardChange(
    accountId: string
  ) {
    setToAccountId(
      accountId
    );

    const card =
      creditCards.find(
        account =>
          account.accountId ===
          accountId
      );

    setFromAccountId(
      card?.paymentAccountId ||
      ""
    );

    requestMemory.current =
      null;

    clearFeedback();
  }

  function getAccountValueLabel(
    accountId: string
  ) {
    if (!accountId) {
      return "선택하세요";
    }

    const account = allAccounts.find(
      item => item.accountId === accountId
    );

    return account
      ? getAccountLabel(account)
      : "선택하세요";
  }

  function getPickerItems(
    kind: PickerKind
  ): PickerItem[] {
    if (kind === "category") {
      return categories.map(
        category => ({
          value: category.categoryId,
          label: getCategoryLabel(category),
          meta: category.type
        })
      );
    }

    if (kind === "spendingTarget") {
      return (bootstrap?.spendingTargets ?? []).map(
        target => ({
          value: target,
          label: target
        })
      );
    }

    let source: Account[] = accounts;

    if (kind === "creditCard") {
      source = creditCards;
    } else if (kind === "cardSource") {
      source = cardSourceAccounts;
    }

    return source.map(
      account => ({
        value: account.accountId,
        label: getAccountLabel(account),
        meta: [account.subType, account.owner]
          .filter(Boolean)
          .join(" · ")
      })
    );
  }

  function getPickerTitle(
    kind: PickerKind
  ) {
    switch (kind) {
      case "category":
        return "카테고리 선택";
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
    }
  }

  function getPickerSelectedValue(
    kind: PickerKind
  ) {
    switch (kind) {
      case "category":
        return categoryId;
      case "paymentMethod":
        return paymentMethodId;
      case "spendingTarget":
        return spendingTarget;
      case "incomeAccount":
      case "toAccount":
      case "creditCard":
        return toAccountId;
      case "fromAccount":
      case "cardSource":
        return fromAccountId;
    }
  }

  function applyPickerValue(
    kind: PickerKind,
    value: string
  ) {
    if (kind === "category") {
      handleCategoryChange(value);
    } else if (kind === "paymentMethod") {
      setPaymentMethodId(value);
      requestMemory.current = null;
      clearFeedback();
    } else if (kind === "spendingTarget") {
      setSpendingTarget(value);
      requestMemory.current = null;
      clearFeedback();
    } else if (kind === "creditCard") {
      handleCardChange(value);
    } else if (kind === "fromAccount" || kind === "cardSource") {
      setFromAccountId(value);
      requestMemory.current = null;
      clearFeedback();
    } else {
      setToAccountId(value);
      requestMemory.current = null;
      clearFeedback();
    }

    setActivePicker(null);
  }

  function getCategoryValueLabel() {
    return selectedCategory
      ? getCategoryLabel(selectedCategory)
      : "선택하세요";
  }

  function validate():
    string | null {
    if (
      !bootstrap
    ) {
      return "입력 정보를 불러오지 못했습니다.";
    }

    if (
      !date
    ) {
      return "날짜를 선택해주세요.";
    }

    const numericAmount =
      Number(
        amount
      );

    if (
      !Number.isFinite(
        numericAmount
      ) ||
      numericAmount <=
        0
    ) {
      return "금액을 입력해주세요.";
    }

    if (
      !categoryId
    ) {
      return "카테고리를 선택해주세요.";
    }

    if (
      mode ===
      "expense"
    ) {
      if (
        !paymentMethodId
      ) {
        return "결제수단을 선택해주세요.";
      }

      if (
        !spendingTarget
      ) {
        return "지출대상을 선택해주세요.";
      }
    }

    if (
      mode ===
        "income" &&
      !toAccountId
    ) {
      return "입금수단을 선택해주세요.";
    }

    if (
      mode ===
      "transfer"
    ) {
      if (
        isCardTransfer
      ) {
        if (
          !toAccountId
        ) {
          return "결제할 카드를 선택해주세요.";
        }

        if (
          !fromAccountId
        ) {
          return "돈이 나갈 계좌를 선택해주세요.";
        }

        if (
          !billingMonth
        ) {
          return "대상 청구월을 선택해주세요.";
        }

        if (
          fromAccountId ===
          toAccountId
        ) {
          return "출금계좌와 카드는 같을 수 없습니다.";
        }

        return null;
      }

      if (
        !fromAccountId
      ) {
        return "보내는 수단을 선택해주세요.";
      }

      if (
        !toAccountId
      ) {
        return "받는 수단을 선택해주세요.";
      }

      if (
        fromAccountId ===
        toAccountId
      ) {
        return "보내는 수단과 받는 수단은 같을 수 없습니다.";
      }
    }

    return null;
  }

  function buildPayload(
    requestId: string
  ):
    CreateTransactionPayload {
    const base = {
      date,

      type:
        backendType,

      categoryId,

      amount:
        Number(
          amount
        ),

      memo:
        memo.trim(),

      requestId
    };

    if (
      mode ===
      "expense"
    ) {
      return {
        ...base,

        paymentMethodId,

        spendingTarget
      };
    }

    if (
      mode ===
      "income"
    ) {
      return {
        ...base,

        toAccountId
      };
    }

    return {
      ...base,

      fromAccountId,

      toAccountId,

      ...(
        isCardTransfer
          ? {
              billingMonth
            }
          : {}
      )
    };
  }

  function handleSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      submitGuard.current
    ) {
      return;
    }

    clearFeedback();

    const validationError =
      validate();

    if (
      validationError
    ) {
      setError(
        validationError
      );

      return;
    }

    if (
      !bootstrap
    ) {
      return;
    }

    const recentTransactions =
      getDashboardSnapshot()
        ?.recentTransactions ||
      [];

    const numericAmount =
      Number(
        amount
      );

    const possibleDuplicate =
      recentTransactions.find(
        transaction => {
          if (
            transaction.date !==
              date ||
            transaction.type !==
              backendType ||
            Math.abs(
              Number(transaction.amount) -
              numericAmount
            ) >
              0.000001
          ) {
            return false;
          }

          if (
            mode ===
            "expense"
          ) {
            return (
              !paymentMethodId ||
              transaction.paymentMethodId ===
                paymentMethodId
            );
          }

          if (
            mode ===
            "income"
          ) {
            return (
              !toAccountId ||
              transaction.toAccountId ===
                toAccountId
            );
          }

          return (
            transaction.fromAccountId ===
              fromAccountId &&
            transaction.toAccountId ===
              toAccountId
          );
        }
      );

    if (
      possibleDuplicate &&
      !window.confirm(
        `같은 날짜에 ${numericAmount.toLocaleString("ko-KR")}원 ${backendType} 내역이 이미 있습니다.\n\n중복이 아니라면 그대로 저장하세요.`
      )
    ) {
      return;
    }

    const fingerprint =
      JSON.stringify({
        date,

        type:
          backendType,

        categoryId,

        amount:
          Number(
            amount
          ),

        paymentMethodId:
          mode ===
            "expense"
            ? paymentMethodId
            : undefined,

        spendingTarget:
          mode ===
            "expense"
            ? spendingTarget
            : undefined,

        fromAccountId:
          mode ===
            "transfer"
            ? fromAccountId
            : undefined,

        toAccountId:
          mode ===
              "income" ||
          mode ===
              "transfer"
            ? toAccountId
            : undefined,

        billingMonth:
          isCardTransfer
            ? billingMonth
            : undefined,

        memo:
          memo.trim()
      });

    let requestId:
      string;

    if (
      requestMemory.current
        ?.fingerprint ===
      fingerprint
    ) {
      requestId =
        requestMemory.current
          .requestId;
    } else {
      requestId =
        createRequestId();

      requestMemory.current = {
        fingerprint,
        requestId
      };
    }

    const payload =
      buildPayload(
        requestId
      );

    const savedLabel =
      isCardTransfer
        ? cardTransferLabel
        : getModeLabel(
            mode
          );

    const categoryLabel =
      selectedCategory
        ? getCategoryLabel(
            selectedCategory
          )
        : "";

    const queueLabel =
      [
        savedLabel,
        `${Number(amount).toLocaleString("ko-KR")}원`,
        categoryLabel
      ]
        .filter(Boolean)
        .join(" · ");

    submitGuard.current =
      true;

    setSubmitting(
      true
    );

    try {
      /*
       * 폼을 비우기 전에 브라우저 저장소에 먼저 기록합니다.
       * 이 함수가 성공한 순간부터 앱을 닫아도 같은 requestId로
       * 다시 저장할 수 있습니다.
       */
      enqueuePendingTransaction({
        owner:
          userName,

        label:
          queueLabel,

        payload
      });

      /*
       * 이 시점부터는 동일 requestId의 거래가 큐에 안전하게 보관됩니다.
       * 앱이 바로 종료돼도 이미 큐에 들어간 거래가 초안으로 다시 나타나
       * 사용자가 같은 내용을 한 번 더 입력하지 않도록 초안은 즉시 지웁니다.
       */
      clearInputDraft(
        userName
      );

      setAmount("");
      setCategoryId("");

      resetAccountSelections();

      setBillingMonth(
        date.slice(
          0,
          7
        )
      );

      setMemo("");

      requestMemory.current =
        null;
    } catch (
      submitError
    ) {
      setError(
        getErrorMessage(
          submitError
        )
      );
    } finally {
      setSubmitting(
        false
      );

      window.setTimeout(
        () => {
          submitGuard.current =
            false;
        },
        250
      );
    }
  }

  if (
    bootstrapLoading
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.loading
          }
        >
          입력 항목을 준비하고 있습니다.
        </div>
      </main>
    );
  }

  if (
    !bootstrap
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <div
          className={
            styles.card
          }
        >
          <p
            className={
              styles.error
            }
          >
            {
              bootstrapError ||
              "입력 정보를 불러오지 못했습니다."
            }
          </p>

          <div
            className={
              styles.submitArea
            }
          >
            <button
              type="button"
              className={
                styles.submitButton
              }
              onClick={
                () =>
                  window.location.reload()
              }
            >
              다시 시도
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className={
        styles.page
      }
    >
      <header className={styles.header}>
        <h1 className={styles.title}>거래 입력</h1>
      </header>

      <div
        className={
          styles.typeTabs
        }
        aria-label="거래 유형"
      >
        {
          (
            [
              [
                "expense",
                "지출"
              ],
              [
                "income",
                "수입"
              ],
              [
                "transfer",
                "이체"
              ]
            ] as const
          ).map(
            ([
              value,
              label
            ]) => (
              <button
                type="button"
                key={
                  value
                }
                className={[
                  styles.typeButton,

                  mode ===
                    value
                    ? styles.typeButtonActive
                    : ""
                ].join(
                  " "
                )}
                aria-pressed={
                  mode ===
                  value
                }
                onClick={
                  () =>
                    handleModeChange(
                      value
                    )
                }
              >
                {label}
              </button>
            )
          )
        }
      </div>

      <form
        className={
          styles.form
        }
        onSubmit={
          handleSubmit
        }
      >
        <section
          className={
            styles.card
          }
        >
          <label
            className={
              styles.amountField
            }
          >
            <span
              className={
                styles.fieldLabel
              }
            >
              금액{" "}

              <span
                className={
                  styles.required
                }
              >
                *
              </span>
            </span>

            <div
              className={
                styles.amountWrap
              }
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={
                  styles.amountInput
                }
                placeholder="0"
                value={
                  formattedAmount
                }
                disabled={
                  submitting
                }
                onChange={
                  event =>
                    handleAmountChange(
                      event.target.value
                    )
                }
              />

              <span
                className={
                  styles.currency
                }
              >
                원
              </span>
            </div>
          </label>

          <label
            className={
              styles.field
            }
          >
            <span
              className={
                styles.fieldLabel
              }
            >
              날짜{" "}

              <span
                className={
                  styles.required
                }
              >
                *
              </span>
            </span>

            <input
              type="date"
              className={
                styles.input
              }
              value={
                date
              }
              disabled={
                submitting
              }
              onChange={
                event =>
                  handleDateChange(
                    event.target.value
                  )
              }
            />
          </label>

          <label
            className={
              styles.field
            }
          >
            <span
              className={
                styles.fieldLabel
              }
            >
              카테고리{" "}

              <span
                className={
                  styles.required
                }
              >
                *
              </span>
            </span>

            <button
              type="button"
              className={styles.pickerButton}
              disabled={submitting}
              onClick={() => setActivePicker("category")}
            >
              <span className={categoryId ? styles.pickerValue : styles.pickerPlaceholder}>
                {getCategoryValueLabel()}
              </span>
              <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
            </button>
          </label>

          {
            mode ===
              "expense" && (
              <div
                className={
                  styles.conditionalSection
                }
              >
                <h2
                  className={
                    styles.sectionTitle
                  }
                >
                  지출 정보
                </h2>

                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.fieldLabel
                    }
                  >
                    결제수단{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <button
                    type="button"
                    className={styles.pickerButton}
                    disabled={submitting}
                    onClick={() => setActivePicker("paymentMethod")}
                  >
                    <span className={paymentMethodId ? styles.pickerValue : styles.pickerPlaceholder}>
                      {getAccountValueLabel(paymentMethodId)}
                    </span>
                    <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                  </button>

                  <p
                    className={
                      styles.helper
                    }
                  >
                    체크카드는 연결된 통장에서 자동 출금됩니다.
                  </p>
                </label>

                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.fieldLabel
                    }
                  >
                    지출대상{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <button
                    type="button"
                    className={styles.pickerButton}
                    disabled={submitting}
                    onClick={() => setActivePicker("spendingTarget")}
                  >
                    <span className={spendingTarget ? styles.pickerValue : styles.pickerPlaceholder}>
                      {spendingTarget || "선택하세요"}
                    </span>
                    <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                  </button>
                </label>
              </div>
            )
          }

          {
            mode ===
              "income" && (
              <div
                className={
                  styles.conditionalSection
                }
              >
                <h2
                  className={
                    styles.sectionTitle
                  }
                >
                  수입 정보
                </h2>

                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.fieldLabel
                    }
                  >
                    입금수단{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <button
                    type="button"
                    className={styles.pickerButton}
                    disabled={submitting}
                    onClick={() => setActivePicker("incomeAccount")}
                  >
                    <span className={toAccountId ? styles.pickerValue : styles.pickerPlaceholder}>
                      {getAccountValueLabel(toAccountId)}
                    </span>
                    <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                  </button>
                </label>
              </div>
            )
          }

          {
            mode ===
              "transfer" &&
            !isCardTransfer && (
              <div
                className={
                  styles.conditionalSection
                }
              >
                <h2
                  className={
                    styles.sectionTitle
                  }
                >
                  이체 정보
                </h2>

                <div
                  className={
                    styles.fieldPair
                  }
                >
                  <label
                    className={
                      styles.field
                    }
                  >
                    <span
                      className={
                        styles.fieldLabel
                      }
                    >
                      보내는 수단{" "}

                      <span
                        className={
                          styles.required
                        }
                      >
                        *
                      </span>
                    </span>

                    <button
                      type="button"
                      className={styles.pickerButton}
                      disabled={submitting}
                      onClick={() => setActivePicker("fromAccount")}
                    >
                      <span className={fromAccountId ? styles.pickerValue : styles.pickerPlaceholder}>
                        {getAccountValueLabel(fromAccountId)}
                      </span>
                      <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                    </button>
                  </label>

                  <label
                    className={
                      styles.field
                    }
                  >
                    <span
                      className={
                        styles.fieldLabel
                      }
                    >
                      받는 수단{" "}

                      <span
                        className={
                          styles.required
                        }
                      >
                        *
                      </span>
                    </span>

                    <button
                      type="button"
                      className={styles.pickerButton}
                      disabled={submitting}
                      onClick={() => setActivePicker("toAccount")}
                    >
                      <span className={toAccountId ? styles.pickerValue : styles.pickerPlaceholder}>
                        {getAccountValueLabel(toAccountId)}
                      </span>
                      <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                    </button>
                  </label>
                </div>
              </div>
            )
          }

          {
            mode ===
              "transfer" &&
            isCardTransfer && (
              <div
                className={
                  styles.conditionalSection
                }
              >
                <h2
                  className={
                    styles.sectionTitle
                  }
                >
                  {cardTransferLabel}
                </h2>

                <div
                  className={
                    styles.cardPaymentNotice
                  }
                >
                  <span
                    className={
                      styles.cardPaymentNoticeIcon
                    }
                    aria-hidden="true"
                  >
                    💡
                  </span>

                  <p
                    className={
                      styles.cardPaymentNoticeText
                    }
                  >
                    <strong>
                      {cardTransferLabel}
                    </strong>
                    는 이체로 기록되어 카드 사용 지출과 중복 집계되지 않습니다.
                  </p>
                </div>

                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.fieldLabel
                    }
                  >
                    결제할 카드{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <button
                    type="button"
                    className={styles.pickerButton}
                    disabled={submitting}
                    onClick={() => setActivePicker("creditCard")}
                  >
                    <span className={toAccountId ? styles.pickerValue : styles.pickerPlaceholder}>
                      {getAccountValueLabel(toAccountId)}
                    </span>
                    <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                  </button>
                </label>

                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.fieldLabel
                    }
                  >
                    돈이 나갈 계좌{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <button
                    type="button"
                    className={styles.pickerButton}
                    disabled={submitting || !toAccountId}
                    onClick={() => setActivePicker("cardSource")}
                  >
                    <span className={fromAccountId ? styles.pickerValue : styles.pickerPlaceholder}>
                      {getAccountValueLabel(fromAccountId)}
                    </span>
                    <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
                  </button>

                  {
                    selectedCard
                      ?.paymentAccountId && (
                      <p
                        className={
                          styles.helper
                        }
                      >
                        카드에 등록된 결제계좌를 자동으로 선택했습니다. 실제 출금계좌가 다르면 변경할 수 있습니다.
                      </p>
                    )
                  }
                </label>

                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.fieldLabel
                    }
                  >
                    대상 청구월{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <input
                    type="month"
                    className={
                      styles.input
                    }
                    value={
                      billingMonth
                    }
                    disabled={
                      submitting
                    }
                    onChange={
                      event => {
                        setBillingMonth(
                          event.target.value
                        );

                        requestMemory.current =
                          null;

                        clearFeedback();
                      }
                    }
                  />

                  <p
                    className={
                      styles.helper
                    }
                  >
                    이 결제가 어느 달 카드대금에 해당하는지 선택합니다.
                  </p>
                </label>
              </div>
            )
          }

          <label
            className={
              styles.field
            }
          >
            <span
              className={
                styles.fieldLabel
              }
            >
              메모
            </span>

            <textarea
              className={
                styles.textarea
              }
              placeholder="필요한 내용을 적어주세요."
              value={
                memo
              }
              disabled={
                submitting
              }
              onChange={
                event => {
                  setMemo(
                    event.target.value
                  );

                  requestMemory.current =
                    null;

                  clearFeedback();
                }
              }
            />
          </label>

          {
            savingCount > 0 && (
              <div
                className={
                  styles.queueStatus
                }
                role="status"
              >
                <strong>
                  저장 중 · {savingCount}건
                </strong>

                <span>
                  입력은 계속할 수 있어요. 서버 확인 후 완료됩니다.
                </span>
              </div>
            )
          }

          {
            failedTransactions.length > 0 && (
              <div
                className={
                  styles.queueFailure
                }
                role="alert"
              >
                <div
                  className={
                    styles.queueFailureHeader
                  }
                >
                  <strong>
                    저장 실패 · {failedTransactions.length}건
                  </strong>

                  {
                    failedTransactions.length > 1 && (
                      <button
                        type="button"
                        className={
                          styles.queueRetryButton
                        }
                        onClick={
                          () =>
                            retryAllFailedPendingTransactions(
                              userName
                            )
                        }
                      >
                        모두 다시 시도
                      </button>
                    )
                  }
                </div>

                {
                  failedTransactions
                    .slice(0, 3)
                    .map(
                      item => (
                        <div
                          key={
                            item.id
                          }
                          className={
                            styles.queueFailureItem
                          }
                        >
                          <div>
                            <span
                              className={
                                styles.queueFailureLabel
                              }
                            >
                              {item.label}
                            </span>

                            <span
                              className={
                                styles.queueFailureMessage
                              }
                            >
                              {item.failureKind === "network"
                                ? "인터넷 연결이 돌아오면 자동으로 다시 저장합니다."
                                : item.error}
                            </span>
                          </div>

                          <div
                            className={
                              styles.queueFailureActions
                            }
                          >
                            {
                              item.failureKind !== "network" && (
                                <button
                                  type="button"
                                  className={
                                    styles.queueEditButton
                                  }
                                  onClick={
                                    () =>
                                      loadFailedTransactionForEdit(
                                        item
                                      )
                                  }
                                >
                                  수정
                                </button>
                              )
                            }
                            <button
                              type="button"
                              className={
                                styles.queueRetryButton
                              }
                              onClick={
                                () =>
                                  retryPendingTransaction(
                                    userName,
                                    item.id
                                  )
                              }
                            >
                              다시 시도
                            </button>
                            <button
                              type="button"
                              className={
                                styles.queueDiscardButton
                              }
                              onClick={
                                () => {
                                  if (
                                    window.confirm(
                                      "이 저장 실패 항목을 대기열에서 삭제할까요?"
                                    )
                                  ) {
                                    discardPendingTransaction(
                                      userName,
                                      item.id
                                    );
                                  }
                                }
                              }
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      )
                    )
                }
              </div>
            )
          }

          {
            error && (
              <p
                className={
                  styles.error
                }
                role="alert"
              >
                {error}
              </p>
            )
          }

          {
            success && (
              <p
                className={
                  styles.success
                }
                role="status"
              >
                {success}
              </p>
            )
          }

          <div
            className={
              styles.submitArea
            }
          >
            <button
              type="submit"
              className={
                styles.submitButton
              }
              disabled={
                submitting
              }
            >
              {
                `${
                  isCardTransfer
                    ? cardTransferLabel
                    : getModeLabel(
                        mode
                      )
                } 저장`
              }
            </button>
          </div>
        </section>
      </form>

      {activePicker && (
        <div
          className={styles.sheetBackdrop}
          role="presentation"
          onClick={() => setActivePicker(null)}
        >
          <section
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={getPickerTitle(activePicker)}
            onClick={event => event.stopPropagation()}
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <div className={styles.sheetHeader}>
              <h2>{getPickerTitle(activePicker)}</h2>
              <button
                type="button"
                className={styles.sheetClose}
                aria-label="닫기"
                onClick={() => setActivePicker(null)}
              >
                ×
              </button>
            </div>

            <div className={styles.sheetList}>
              {getPickerItems(activePicker).map(item => {
                const selected = getPickerSelectedValue(activePicker) === item.value;

                return (
                  <button
                    type="button"
                    key={item.value}
                    className={`${styles.sheetOption} ${selected ? styles.sheetOptionSelected : ""}`}
                    onClick={() => applyPickerValue(activePicker, item.value)}
                  >
                    <span className={styles.sheetOptionText}>
                      <strong>{item.label}</strong>
                      {item.meta && <span>{item.meta}</span>}
                    </span>
                    {selected && <span className={styles.sheetCheck} aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
