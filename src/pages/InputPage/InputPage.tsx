import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { apiRequest } from "../../api/client";
import { getBootstrap } from "../../api/bootstrap";
import { previewBenefit } from "../../api/automation";
import type {
  AutomationSettings,
  BenefitPreview
} from "../../api/automation";
import {
  getBootstrapCacheGeneration,
  getCachedBootstrapPayload
} from "../../api/bootstrapCache";
import { createTransaction } from "../../api/transactions";
import { getDashboard, getDashboardSnapshot } from "../../api/dashboard";
import { Button } from "../../components/common/Button/Button";
import { PendingTransactionPanel } from "./PendingTransactionPanel";
import { InputPickerSheet } from "./InputPickerSheet";
import { InputModeTabs } from "./InputModeTabs";
import { PickerFieldButton } from "./PickerFieldButton";
import { InvestmentInputSection } from "./InvestmentInputSection";
import { TransactionImportSheet } from "../../features/importTransactions/TransactionImportSheet";
import { Money, formatMoney } from "../../components/common/Money/Money";
import type {
  DashboardData,
  InvestmentAccountSummary
} from "../../types/dashboard";
import type { BootstrapData, BootstrapResponse } from "../../types/bootstrap";
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
  subscribePendingTransactions
} from "../../utils/pendingTransactionQueue";
import type {
  PendingTransactionRecord
} from "../../utils/pendingTransactionQueue";
import { getSeoulDateString } from "../../utils/dateTime";
import { subscribeLedgerChanges } from "../../utils/ledgerEvents";
import { confirmAction } from "../../utils/confirmAction";
import {
  CARD_PAYMENT_CATEGORY,
  CARD_PREPAYMENT_CATEGORY,
  LOAN_INTEREST_CATEGORY_NAME,
  LOAN_PRINCIPAL_CATEGORY_NAME,
  LOAN_REPAYMENT_PICKER_ID,
  getAccountLabel,
  getBackendType,
  getCategoryLabel,
  getModeLabel,
  isBenefitRuleActive,
  isCardSettlementCategory,
  isLoanAccount,
  isLoanSourceAccount,
  isTransferAssetAccount,
  ownerMatchesUser,
  prioritizeAccountsForUser,
  type Account,
  type Category,
  type InputMode,
  type PickerKind,
  type TransactionType
} from "./inputDomain";
import {
  clearInputDraft,
  readInputDraft,
  saveInputDraft
} from "./inputDraft";
import styles from "./InputPage.module.css";

type CreateTransactionPayload = Parameters<typeof createTransaction>[0];

interface ApiResult {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
}

interface AccountsResponse {
  success: boolean;
  data?: {
    total: number;
    items: Account[];
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface CategoriesResponse {
  success: boolean;
  data?: {
    total: number;
    items: Category[];
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface CategoryMutationResponse {
  success: boolean;
  data?: {
    created?: boolean;
    category?: Category;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface RequestMemory {
  fingerprint: string;
  requestId: string;
}

interface CardBillingInfo {
  usage: number;
  payments: number;
  estimatedRemaining: number;
}


const DEFAULT_EQUAL_PRINCIPAL_REPAYMENT_KRW = 791666;

interface InputPageProps {
  userName: string;
  initialDate?: string | null;
  initialMode?: InputMode | null;
  initialFromAccountId?: string | null;
  initialToAccountId?: string | null;
  initialCategoryId?: string | null;
  initialAmount?: number | null;
  initialPaymentMethodId?: string | null;
  initialSpendingTarget?: string | null;
  initialDescription?: string | null;
  initialMemo?: string | null;
}

interface InputHistoryState {
  inputInitialDate?: string | null;
  inputPreset?: {
    mode?: InputMode | null;
    fromAccountId?: string | null;
    toAccountId?: string | null;
    categoryId?: string | null;
    amount?: number | null;
    paymentMethodId?: string | null;
    spendingTarget?: string | null;
    description?: string | null;
    memo?: string | null;
  } | null;
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

    bootstrapPromise = getBootstrap<BootstrapResponse>()
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

export default function InputPage({
  userName,
  initialDate = null,
  initialMode = null,
  initialFromAccountId = null,
  initialToAccountId = null,
  initialCategoryId = null,
  initialAmount = null,
  initialPaymentMethodId = null,
  initialSpendingTarget = null,
  initialDescription = null,
  initialMemo = null
}: InputPageProps) {
  const today =
    getSeoulDateString();

  const historyLaunchState =
    (typeof window !== "undefined"
      ? window.history.state
      : null) as InputHistoryState | null;

  const historyPreset =
    historyLaunchState?.inputPreset ?? null;

  const launchDate =
    initialDate ??
    historyLaunchState?.inputInitialDate ??
    null;

  const launchMode =
    initialMode ?? historyPreset?.mode ?? null;

  const launchFromAccountId =
    initialFromAccountId ??
    historyPreset?.fromAccountId ??
    null;

  const launchToAccountId =
    initialToAccountId ??
    historyPreset?.toAccountId ??
    null;

  const launchCategoryId =
    initialCategoryId ??
    historyPreset?.categoryId ??
    null;

  const launchAmount =
    initialAmount ??
    historyPreset?.amount ??
    null;

  const launchPaymentMethodId =
    initialPaymentMethodId ??
    historyPreset?.paymentMethodId ??
    null;

  const launchSpendingTarget =
    initialSpendingTarget ??
    historyPreset?.spendingTarget ??
    null;

  const launchDescription =
    initialDescription ??
    historyPreset?.description ??
    null;

  const launchMemo =
    initialMemo ??
    historyPreset?.memo ??
    null;

  const hasLaunchPreset = Boolean(
    launchMode ||
    launchFromAccountId ||
    launchToAccountId ||
    launchCategoryId ||
    launchAmount !== null ||
    launchPaymentMethodId ||
    launchSpendingTarget ||
    launchDescription ||
    launchMemo
  );

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
    freshHouseholdAccounts,
    setFreshHouseholdAccounts
  ] = useState<Account[]>([]);

  const [
    mode,
    setMode
  ] =
    useState<InputMode>(
      launchMode ||
      initialDraft?.mode ||
      "expense"
    );

  const [showTransactionImport, setShowTransactionImport] = useState(false);

  const [
    date,
    setDate
  ] =
    useState(
      launchDate ||
      (hasLaunchPreset ? null : initialDraft?.date) ||
      today
    );

  useEffect(
    () => {
      if (launchDate) {
        setDate(launchDate);
      }
    },
    [launchDate]
  );


  const [
    amount,
    setAmount
  ] =
    useState(
      launchAmount !== null
        ? String(launchAmount)
        : hasLaunchPreset
          ? ""
          : initialDraft?.amount || ""
    );

  const [
    categoryId,
    setCategoryId
  ] =
    useState(
      launchCategoryId ||
      (hasLaunchPreset ? "" : initialDraft?.categoryId || "")
    );

  const [
    paymentMethodId,
    setPaymentMethodId
  ] =
    useState(
      launchPaymentMethodId ||
      (hasLaunchPreset
        ? ""
        : initialDraft?.paymentMethodId || "")
    );

  const [
    spendingTarget,
    setSpendingTarget
  ] =
    useState(
      launchSpendingTarget ||
      (hasLaunchPreset
        ? ""
        : initialDraft?.spendingTarget || "")
    );

  const [
    fromAccountId,
    setFromAccountId
  ] =
    useState(
      launchFromAccountId ||
      (hasLaunchPreset ? "" : initialDraft?.fromAccountId || "")
    );

  const [
    toAccountId,
    setToAccountId
  ] =
    useState(
      launchToAccountId ||
      (hasLaunchPreset ? "" : initialDraft?.toAccountId || "")
    );

  useEffect(
    () => {
      if (!hasLaunchPreset) {
        return;
      }

      if (launchMode) {
        setMode(launchMode);
      }

      if (launchFromAccountId) {
        setFromAccountId(launchFromAccountId);
      }

      if (launchToAccountId) {
        setToAccountId(launchToAccountId);
      }

      if (launchCategoryId) {
        setCategoryId(launchCategoryId);
      }

      if (launchAmount !== null) {
        setAmount(String(launchAmount));
      }

      if (launchPaymentMethodId) {
        setPaymentMethodId(launchPaymentMethodId);
      }

      if (launchSpendingTarget) {
        setSpendingTarget(launchSpendingTarget);
      }

      if (launchDescription !== null) {
        setDescription(launchDescription);
      }

      if (launchMemo !== null) {
        setMemo(launchMemo);
      }
    },
    [
      hasLaunchPreset,
      launchMode,
      launchFromAccountId,
      launchToAccountId,
      launchCategoryId,
      launchAmount,
      launchPaymentMethodId,
      launchSpendingTarget,
      launchDescription,
      launchMemo
    ]
  );

  const [
    billingMonth,
    setBillingMonth
  ] =
    useState(
      hasLaunchPreset
        ? (launchDate || today).slice(0, 7)
        : initialDraft?.billingMonth ||
          (launchDate || initialDraft?.date || today).slice(
            0,
            7
          )
    );

  const [
    description,
    setDescription
  ] =
    useState(
      launchDescription !== null
        ? launchDescription
        : hasLaunchPreset
          ? ""
          : initialDraft?.description || ""
    );

  const [
    memo,
    setMemo
  ] =
    useState(
      launchMemo !== null
        ? launchMemo
        : hasLaunchPreset
          ? ""
          : initialDraft?.memo || ""
    );

  const [
    cardBillingInfo,
    setCardBillingInfo
  ] = useState<CardBillingInfo | null>(null);

  const [
    cardBillingLoading,
    setCardBillingLoading
  ] = useState(false);

  const [
    cardBillingError,
    setCardBillingError
  ] = useState("");

  const [
    benefitEnabled,
    setBenefitEnabled
  ] = useState(true);

  const [
    benefitRewardUsedAmount,
    setBenefitRewardUsedAmount
  ] = useState(
    hasLaunchPreset
      ? ""
      : initialDraft?.benefitRewardUsedAmount || ""
  );

  const [
    loanPrincipalAmount,
    setLoanPrincipalAmount
  ] = useState(
    initialCategoryId === LOAN_REPAYMENT_PICKER_ID
      ? String(DEFAULT_EQUAL_PRINCIPAL_REPAYMENT_KRW)
      : hasLaunchPreset
        ? ""
        : initialDraft?.loanPrincipalAmount || ""
  );

  const [
    loanInterestAmount,
    setLoanInterestAmount
  ] = useState(
    hasLaunchPreset
      ? ""
      : initialDraft?.loanInterestAmount || ""
  );

  const [
    benefitPreview,
    setBenefitPreview
  ] = useState<BenefitPreview | null>(null);

  const [
    benefitPreviewLoading,
    setBenefitPreviewLoading
  ] = useState(false);

  const [
    benefitPreviewError,
    setBenefitPreviewError
  ] = useState("");

  const cardAmountEditedRef = useRef(false);
  const cardBillingRequestKeyRef = useRef("");

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


  const [
    investmentDashboard,
    setInvestmentDashboard
  ] = useState<DashboardData | null>(
    () => getDashboardSnapshot()
  );

  const [
    investmentLoading,
    setInvestmentLoading
  ] = useState(false);

  const [
    investmentError,
    setInvestmentError
  ] = useState("");

  const [
    selectedInvestmentAccountId,
    setSelectedInvestmentAccountId
  ] = useState("");

  const [
    investmentTradeHistoryRefreshKey,
    setInvestmentTradeHistoryRefreshKey
  ] = useState(0);

  useEffect(
    () => {
      if (!success) {
        return;
      }

      const timer = window.setTimeout(
        () => {
          setSuccess("");
        },
        3500
      );

      return () => {
        window.clearTimeout(timer);
      };
    },
    [success]
  );

  useEffect(
    () => {
      if (mode === "investment") {
        return;
      }

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
          description,
          memo,
          benefitRewardUsedAmount,
          loanPrincipalAmount,
          loanInterestAmount
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
      description,
      memo,
      benefitRewardUsedAmount,
      loanPrincipalAmount,
      loanInterestAmount
    ]
  );


  useEffect(
    () => {
      if (mode !== "investment") {
        return;
      }

      let active = true;
      const snapshot = getDashboardSnapshot();

      if (snapshot) {
        setInvestmentDashboard(snapshot);
      }

      setInvestmentLoading(!snapshot);
      setInvestmentError("");

      void getDashboard(undefined, { forceRefresh: true })
        .then(data => {
          if (!active) {
            return;
          }

          setInvestmentDashboard(data);
          setInvestmentError("");
        })
        .catch(loadError => {
          if (!active) {
            return;
          }

          if (!snapshot) {
            setInvestmentError(
              loadError instanceof Error
                ? loadError.message
                : "투자계좌 정보를 불러오지 못했습니다."
            );
          }
        })
        .finally(() => {
          if (active) {
            setInvestmentLoading(false);
          }
        });

      return () => {
        active = false;
      };
    },
    [mode]
  );


  const [
    activePicker,
    setActivePicker
  ] =
    useState<PickerKind | null>(
      null
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
      let active = true;

      const unsubscribe = subscribeLedgerChanges(
        () => {
          const generation = getBootstrapCacheGeneration();

          if (bootstrapSnapshotGeneration === generation) {
            return;
          }

          void loadBootstrap()
            .then(data => {
              if (!active) return null;

              setBootstrap(data);
              setBootstrapError("");

              return apiRequest<AccountsResponse>(
                `/api/accounts?includeDeleted=false&_=${Date.now()}`,
                { cache: "no-store" }
              );
            })
            .then(response => {
              if (
                active &&
                response?.success &&
                response.data
              ) {
                setFreshHouseholdAccounts(response.data.items || []);
              }
            })
            .catch(loadError => {
              if (active) {
                setBootstrapError(getErrorMessage(loadError));
              }
            });
        }
      );

      return () => {
        active = false;
        unsubscribe();
      };
    },
    []
  );

  useEffect(
    () => {
      let active = true;

      void apiRequest<AccountsResponse>(
        `/api/accounts?includeDeleted=false&_=${Date.now()}`,
        { cache: "no-store" }
      )
        .then(response => {
          if (!active || !response.success || !response.data) {
            return;
          }

          setFreshHouseholdAccounts(response.data.items || []);
        })
        .catch(() => {
          // bootstrap 계좌 목록으로 계속 동작합니다.
        });

      return () => {
        active = false;
      };
    },
    [userName]
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

  const isLoanRepayment =
    mode === "transfer" &&
    categoryId === LOAN_REPAYMENT_PICKER_ID;

  const loanRepaymentTotal =
    Math.max(0, Number(amount || 0));

  const loanRepaymentPrincipal =
    Math.max(
      0,
      Number(
        loanPrincipalAmount ||
        DEFAULT_EQUAL_PRINCIPAL_REPAYMENT_KRW
      )
    );

  const loanRepaymentInterest =
    Math.max(
      0,
      loanRepaymentTotal - loanRepaymentPrincipal
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
    useMemo(
      () => {
        const merged = new Map<string, Account>();

        (bootstrap?.accounts ?? []).forEach(account => {
          merged.set(account.accountId, account);
        });

        freshHouseholdAccounts.forEach(account => {
          merged.set(account.accountId, account);
        });

        return Array.from(merged.values());
      },
      [
        bootstrap,
        freshHouseholdAccounts
      ]
    );

  const investmentAccounts =
    useMemo(
      () =>
        (investmentDashboard?.investments.accounts ?? [])
          .slice()
          .sort((first, second) => {
            const firstRank = ownerMatchesUser(first.owner, userName)
              ? 0
              : first.owner === "공동"
                ? 1
                : 2;
            const secondRank = ownerMatchesUser(second.owner, userName)
              ? 0
              : second.owner === "공동"
                ? 1
                : 2;

            return (
              firstRank - secondRank ||
              first.owner.localeCompare(second.owner, "ko-KR") ||
              first.accountName.localeCompare(second.accountName, "ko-KR")
            );
          }),
      [investmentDashboard, userName]
    );

  const investmentAccountIds =
    useMemo(
      () =>
        new Set(
          investmentAccounts.map(account => account.accountId)
        ),
      [investmentAccounts]
    );

  const selectedInvestmentAccount =
    useMemo<InvestmentAccountSummary | null>(
      () =>
        investmentAccounts.find(
          account => account.accountId === selectedInvestmentAccountId
        ) ?? null,
      [investmentAccounts, selectedInvestmentAccountId]
    );

  const selectedInvestmentHoldings =
    useMemo(
      () =>
        (investmentDashboard?.investments.holdings ?? []).filter(
          holding => holding.accountId === selectedInvestmentAccountId
        ),
      [investmentDashboard, selectedInvestmentAccountId]
    );

  useEffect(
    () => {
      if (mode !== "investment") {
        return;
      }

      if (
        selectedInvestmentAccountId &&
        investmentAccounts.some(
          account => account.accountId === selectedInvestmentAccountId
        )
      ) {
        return;
      }

      setSelectedInvestmentAccountId(
        investmentAccounts[0]?.accountId || ""
      );
    },
    [
      mode,
      investmentAccounts,
      selectedInvestmentAccountId
    ]
  );

  async function refreshInvestmentDashboard() {
    const data = await getDashboard(undefined, { forceRefresh: true });
    setInvestmentDashboard(data);
    setInvestmentTradeHistoryRefreshKey(
      current => current + 1
    );
  }


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

  const orderedAllAccounts =
    useMemo(
      () =>
        preferences
          ? sortAccountsByPreferences(
              allAccounts,
              preferences
            )
          : allAccounts.slice(),
      [
        allAccounts,
        preferences
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

  const automationSettings =
    bootstrap?.automationSettings;

  const isRegionalTopup =
    mode === "transfer" &&
    selectedCategory?.name === "지역화폐충전";

  const benefitAccountId =
    mode === "expense"
      ? paymentMethodId
      : isRegionalTopup
        ? toAccountId
        : "";

  const selectedBenefitRule =
    useMemo(
      () => {
        if (!benefitAccountId || !automationSettings) {
          return null;
        }

        const expectedKind =
          mode === "expense"
            ? "post_reward"
            : "pre_discount";

        return automationSettings.benefitRules.find(
          rule =>
            rule.accountId === benefitAccountId &&
            rule.kind === expectedKind &&
            isBenefitRuleActive(rule, date)
        ) ?? null;
      },
      [
        automationSettings,
        benefitAccountId,
        mode,
        date
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

  useEffect(
    () => {
      setBenefitEnabled(true);
      setBenefitPreview(null);
      setBenefitPreviewError("");
      if (!selectedBenefitRule || selectedBenefitRule.kind !== "post_reward") {
        setBenefitRewardUsedAmount("");
      }
    },
    [selectedBenefitRule?.id, selectedBenefitRule?.kind]
  );

  useEffect(
    () => {
      if (!selectedBenefitRule || !date) {
        setBenefitPreview(null);
        setBenefitPreviewLoading(false);
        setBenefitPreviewError("");
        return;
      }

      const numericAmount = Math.max(0, Number(amount) || 0);
      const numericRewardUse = Math.max(0, Number(benefitRewardUsedAmount) || 0);
      const isPostReward = selectedBenefitRule.kind === "post_reward";

      if (
        (!isPostReward && (!benefitEnabled || numericAmount <= 0 || !categoryId || !toAccountId)) ||
        (isPostReward && !paymentMethodId)
      ) {
        setBenefitPreview(null);
        setBenefitPreviewLoading(false);
        setBenefitPreviewError("");
        return;
      }

      let cancelled = false;
      setBenefitPreviewLoading(true);
      setBenefitPreviewError("");

      const timer = window.setTimeout(
        () => {
          void previewBenefit({
            date,
            type: backendType,
            amount: numericAmount,
            categoryId,
            benefitRuleId: selectedBenefitRule.id,
            ...(isPostReward
              ? {
                  paymentMethodId,
                  benefitRewardUsedAmount: numericRewardUse,
                  benefitAccrualEnabled: benefitEnabled
                }
              : {
                  toAccountId,
                  benefitFaceAmount: numericAmount
                })
          })
            .then(result => {
              if (cancelled) return;
              setBenefitPreview(result);
              if (
                isPostReward &&
                result &&
                result.rewardUsedAmount !== numericRewardUse
              ) {
                setBenefitRewardUsedAmount(
                  result.rewardUsedAmount > 0
                    ? String(Math.round(result.rewardUsedAmount))
                    : ""
                );
              }
            })
            .catch(previewError => {
              if (!cancelled) {
                setBenefitPreview(null);
                setBenefitPreviewError(
                  previewError instanceof Error
                    ? previewError.message
                    : "혜택 금액을 계산하지 못했습니다."
                );
              }
            })
            .finally(() => {
              if (!cancelled) {
                setBenefitPreviewLoading(false);
              }
            });
        },
        180
      );

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    },
    [
      selectedBenefitRule,
      benefitEnabled,
      benefitRewardUsedAmount,
      amount,
      date,
      categoryId,
      backendType,
      paymentMethodId,
      toAccountId
    ]
  );

  useEffect(() => {
    if (!isCardTransfer || !toAccountId || !billingMonth) {
      setCardBillingInfo(null);
      setCardBillingLoading(false);
      setCardBillingError("");
      cardBillingRequestKeyRef.current = "";
      return;
    }

    let cancelled = false;
    const requestKey = `${toAccountId}:${billingMonth}`;
    cardBillingRequestKeyRef.current = requestKey;
    cardAmountEditedRef.current = false;
    setCardBillingLoading(true);
    setCardBillingError("");

    void getDashboard(billingMonth, { forceRefresh: true })
      .then(data => {
        if (cancelled || cardBillingRequestKeyRef.current !== requestKey) {
          return;
        }

        const card = (data.cards || []).find(
          item => item.accountId === toAccountId
        );

        if (!card) {
          setCardBillingInfo({ usage: 0, payments: 0, estimatedRemaining: 0 });
          if (!cardAmountEditedRef.current) {
            setAmount("");
          }
          return;
        }

        const info = {
          usage: Number(card.usage) || 0,
          payments: Number(card.payments) || 0,
          estimatedRemaining: Math.max(0, Number(card.estimatedRemaining) || 0)
        };

        setCardBillingInfo(info);

        if (!cardAmountEditedRef.current) {
          setAmount(
            info.estimatedRemaining > 0
              ? String(Math.round(info.estimatedRemaining))
              : ""
          );
          requestMemory.current = null;
        }
      })
      .catch(loadError => {
        if (cancelled || cardBillingRequestKeyRef.current !== requestKey) {
          return;
        }
        setCardBillingInfo(null);
        setCardBillingError(
          loadError instanceof Error
            ? loadError.message
            : "카드 결제 예정액을 불러오지 못했습니다."
        );
      })
      .finally(() => {
        if (!cancelled && cardBillingRequestKeyRef.current === requestKey) {
          setCardBillingLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isCardTransfer, toAccountId, billingMonth]);

  function clearFeedback() {
    setError("");
    setSuccess("");
  }

  async function loadFailedTransactionForEdit(
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
      !(await confirmAction({
        title: "작성 내용 바꾸기",
        message: "현재 작성 중인 내용을 저장 실패 항목으로 바꿀까요?\n\n작성 중인 내용은 덮어씁니다.",
        confirmLabel: "바꾸기"
      }))
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
    setDescription(payload.description || "");
    setMemo(payload.memo || "");
    setBenefitRewardUsedAmount(
      payload.benefitRewardUsedAmount
        ? String(payload.benefitRewardUsedAmount)
        : ""
    );

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
      description: (payload.description || "").trim(),
      memo: (payload.memo || "").trim(),
      benefitRuleId: payload.benefitRuleId || undefined,
      benefitRewardUsedAmount: payload.benefitRewardUsedAmount || undefined,
      benefitAccrualEnabled: payload.benefitAccrualEnabled
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
    setBenefitRewardUsedAmount("");
    setLoanPrincipalAmount("");
    setLoanInterestAmount("");
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

    cardAmountEditedRef.current = false;
    setCardBillingInfo(null);
    setCardBillingError("");

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
      cardAmountEditedRef.current = false;
      setCardBillingInfo(null);
      setCardBillingError("");
      setBenefitRewardUsedAmount("");
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

    if (isCardTransfer) {
      cardAmountEditedRef.current = true;
    }

    requestMemory.current =
      null;

    clearFeedback();
  }

  function handleLoanAmountChange(
    kind: "principal" | "interest",
    value: string
  ) {
    const digits = value.replace(/[^\d]/g, "");
    const normalized = digits.replace(/^0+(?=\d)/, "");

    if (kind === "principal") {
      setLoanPrincipalAmount(normalized);
    } else {
      setLoanInterestAmount(normalized);
    }

    requestMemory.current = null;
    clearFeedback();
  }

  function handleBenefitRewardUseChange(value: string) {
    const digits = value.replace(/[^\d]/g, "");
    const normalized = digits.replace(/^0+(?=\d)/, "");
    const requested = Math.max(0, Number(normalized) || 0);
    const amountLimit = Math.max(0, Number(amount) || 0);
    const balanceLimit = benefitPreview?.rewardBalanceBefore ?? Number.POSITIVE_INFINITY;
    const maxAllowed = Math.max(0, Math.floor(Math.min(amountLimit, balanceLimit)));
    const nextValue = requested > maxAllowed
      ? maxAllowed > 0 ? String(maxAllowed) : ""
      : normalized;

    setBenefitRewardUsedAmount(nextValue);
    requestMemory.current = null;
    clearFeedback();
  }

  function handleCategoryChange(
    nextCategoryId: string
  ) {
    if (
      nextCategoryId ===
      categoryId
    ) {
      clearFeedback();
      return;
    }

    setCategoryId(
      nextCategoryId
    );

    if (
      mode ===
      "transfer"
    ) {
      const nextCategory =
        categories.find(
          category =>
            category.categoryId ===
            nextCategoryId
        ) ??
        null;

      const nextIsLoanRepayment =
        nextCategoryId ===
        LOAN_REPAYMENT_PICKER_ID;

      const nextIsCardSettlement =
        isCardSettlementCategory(
          nextCategory
        );

      const selectedFromAccount =
        allAccounts.find(
          account =>
            account.accountId ===
            fromAccountId
        ) ??
        null;

      const selectedToAccount =
        allAccounts.find(
          account =>
            account.accountId ===
            toAccountId
        ) ??
        null;

      setAmount("");
      setLoanPrincipalAmount(
        nextIsLoanRepayment
          ? String(DEFAULT_EQUAL_PRINCIPAL_REPAYMENT_KRW)
          : ""
      );
      setLoanInterestAmount("");

      if (nextIsLoanRepayment) {
        if (
          selectedFromAccount &&
          !isLoanSourceAccount(
            selectedFromAccount
          )
        ) {
          setFromAccountId("");
        }

        if (
          selectedToAccount &&
          !isLoanAccount(
            selectedToAccount
          )
        ) {
          setToAccountId("");
        }

        if (!spendingTarget) {
          setSpendingTarget(
            (bootstrap?.spendingTargets || []).includes(userName)
              ? userName
              : "공동"
          );
        }
      } else if (nextIsCardSettlement) {
        if (
          selectedFromAccount &&
          (
            selectedFromAccount.accountType !== "자산" ||
            selectedFromAccount.subType === "주식"
          )
        ) {
          setFromAccountId("");
        }

        if (
          selectedToAccount &&
          selectedToAccount.subType !==
            "신용카드"
        ) {
          setToAccountId("");
        }

        setBillingMonth(
          date.slice(
            0,
            7
          )
        );
      } else {
        if (
          selectedFromAccount &&
          !isTransferAssetAccount(
            selectedFromAccount
          )
        ) {
          setFromAccountId("");
        }

        if (
          selectedToAccount &&
          !isTransferAssetAccount(
            selectedToAccount
          )
        ) {
          setToAccountId("");
        }
      }

      cardAmountEditedRef.current = false;
      setCardBillingInfo(null);
      setCardBillingError("");
      setBenefitRewardUsedAmount("");
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
      allAccounts.find(
        account =>
          account.accountId ===
            accountId &&
          account.subType ===
            "신용카드"
      );

    setFromAccountId(
      card?.paymentAccountId ||
      ""
    );

    cardAmountEditedRef.current = false;
    setCardBillingInfo(null);
    setCardBillingError("");

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

  function applyPickerValue(
    kind: PickerKind,
    value: string
  ) {
    if (kind === "category") {
      handleCategoryChange(value);
    } else if (kind === "paymentMethod") {
      setPaymentMethodId(value);
      setBenefitRewardUsedAmount("");
      requestMemory.current = null;
      clearFeedback();
    } else if (kind === "spendingTarget") {
      setSpendingTarget(value);
      requestMemory.current = null;
      clearFeedback();
    } else if (kind === "investmentAccount") {
      setSelectedInvestmentAccountId(value);
      setInvestmentError("");
    } else if (kind === "creditCard") {
      handleCardChange(value);
    } else if (
      kind === "fromAccount" ||
      kind === "cardSource" ||
      kind === "loanSource"
    ) {
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
    if (isLoanRepayment) {
      return "대출 상환";
    }

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

    if (isCardTransfer) {
      if (!toAccountId) {
        return "결제할 카드를 선택해주세요.";
      }

      if (!fromAccountId) {
        return "돈이 나갈 계좌를 선택해주세요.";
      }

      if (!billingMonth) {
        return "대상 청구월을 선택해주세요.";
      }
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

      if (selectedBenefitRule?.kind === "post_reward") {
        const rewardUsed = Math.max(0, Number(benefitRewardUsedAmount) || 0);
        if (rewardUsed > numericAmount) {
          return "캐시백 사용액은 결제 금액보다 클 수 없습니다.";
        }
        if (rewardUsed > 0 && benefitPreviewLoading) {
          return "사용 가능한 캐시백을 확인하는 중입니다. 잠시 후 다시 저장해주세요.";
        }
        if (
          rewardUsed > 0 &&
          benefitPreview &&
          rewardUsed > benefitPreview.rewardBalanceBefore
        ) {
          return `사용 가능한 캐시백은 ${formatMoney(benefitPreview.rewardBalanceBefore)}입니다.`;
        }
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
      if (isLoanRepayment) {
        if (!fromAccountId) {
          return "돈이 나갈 계좌를 선택해주세요.";
        }

        if (!toAccountId) {
          return "상환할 대출계좌를 선택해주세요.";
        }

        if (fromAccountId === toAccountId) {
          return "출금계좌와 대출계좌는 같을 수 없습니다.";
        }

        const loanAccount = allAccounts.find(
          account => account.accountId === toAccountId
        );

        if (!loanAccount || !isLoanAccount(loanAccount)) {
          return "대출계좌를 다시 선택해주세요.";
        }

        if (
          !Number.isFinite(loanRepaymentPrincipal) ||
          loanRepaymentPrincipal <= 0
        ) {
          return "이번 달 원금을 입력해주세요.";
        }

        if (numericAmount < loanRepaymentPrincipal) {
          return `총 상환액은 원금 ${formatMoney(loanRepaymentPrincipal)} 이상이어야 합니다.`;
        }

        if (loanRepaymentInterest > 0 && !spendingTarget) {
          return "이자 지출대상을 선택해주세요.";
        }

        return null;
      }

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

  function getEffectiveDescription() {
    if (!isCardTransfer) {
      return description.trim();
    }

    return [
      selectedCard ? getAccountLabel(selectedCard) : "",
      billingMonth,
      cardTransferLabel
    ]
      .filter(Boolean)
      .join(" " );
  }

  function getEffectiveMemo() {
    return isCardTransfer ? "" : memo.trim();
  }

  function getBenefitPayloadFields() {
    if (!selectedBenefitRule) {
      return {};
    }

    if (selectedBenefitRule.kind === "pre_discount") {
      return benefitEnabled
        ? {
            benefitRuleId: selectedBenefitRule.id,
            benefitFaceAmount: Number(amount)
          }
        : {};
    }

    const rewardUsedAmount = Math.max(0, Number(benefitRewardUsedAmount) || 0);
    if (!benefitEnabled && rewardUsedAmount <= 0) {
      return {};
    }

    return {
      benefitRuleId: selectedBenefitRule.id,
      benefitRewardUsedAmount: rewardUsedAmount,
      benefitAccrualEnabled: benefitEnabled
    };
  }

  async function loadCategoriesByType(
    type: TransactionType
  ) {
    const response = await apiRequest<CategoriesResponse>(
      `/api/categories?type=${encodeURIComponent(type)}&_=${Date.now()}`,
      { cache: "no-store" }
    );

    return response.data?.items || [];
  }

  async function ensureLoanCategory(
    type: TransactionType,
    name: string
  ) {
    const bootstrapMatch = (bootstrap?.categories || []).find(
      category =>
        category.type === type &&
        category.name === name
    );

    if (bootstrapMatch) {
      return bootstrapMatch;
    }

    const current = await loadCategoriesByType(type);
    const currentMatch = current.find(
      category => category.name === name
    );

    if (currentMatch) {
      return currentMatch;
    }

    try {
      const created = await apiRequest<CategoryMutationResponse>(
        "/api/categories",
        {
          method: "POST",
          body: JSON.stringify({
            type,
            name,
            active: true
          })
        }
      );

      if (created.data?.category) {
        return created.data.category;
      }
    } catch (createError) {
      const refreshed = await loadCategoriesByType(type);
      const duplicate = refreshed.find(
        category => category.name === name
      );

      if (duplicate) {
        return duplicate;
      }

      throw createError;
    }

    throw new Error(`${name} 카테고리를 준비하지 못했습니다.`);
  }

  async function submitLoanRepayment() {
    const total = loanRepaymentTotal;
    const principal = loanRepaymentPrincipal;
    const interest = loanRepaymentInterest;
    const loanAccount = allAccounts.find(
      account => account.accountId === toAccountId
    );
    const loanLabel = loanAccount
      ? getAccountLabel(loanAccount)
      : "대출";

    const fingerprint = JSON.stringify({
      kind: "loan-repayment",
      date,
      fromAccountId,
      toAccountId,
      principal,
      interest,
      spendingTarget,
      description: description.trim(),
      memo: memo.trim()
    });

    let requestId: string;

    if (requestMemory.current?.fingerprint === fingerprint) {
      requestId = requestMemory.current.requestId;
    } else {
      requestId = createRequestId();
      requestMemory.current = { fingerprint, requestId };
    }

    const [principalCategory, interestCategory] = await Promise.all([
      principal > 0
        ? ensureLoanCategory("이체", LOAN_PRINCIPAL_CATEGORY_NAME)
        : Promise.resolve(null),
      interest > 0
        ? ensureLoanCategory("지출", LOAN_INTEREST_CATEGORY_NAME)
        : Promise.resolve(null)
    ]);

    const groupId = `LOAN_${requestId}`;
    const baseDescription = description.trim();
    const baseMemo = memo.trim();

    if (principal > 0 && principalCategory) {
      await enqueuePendingTransaction({
        owner: userName,
        label: `대출 원금 · ${formatMoney(principal)} · ${loanLabel}`,
        payload: {
          date,
          type: "이체",
          categoryId: principalCategory.categoryId,
          amount: principal,
          fromAccountId,
          toAccountId,
          description: baseDescription || `${loanLabel} 원금 상환`,
          memo: baseMemo,
          groupId,
          requestId: `${requestId}_PRINCIPAL`
        }
      });
    }

    if (interest > 0 && interestCategory) {
      await enqueuePendingTransaction({
        owner: userName,
        label: `대출 이자 · ${formatMoney(interest)} · ${loanLabel}`,
        payload: {
          date,
          type: "지출",
          categoryId: interestCategory.categoryId,
          amount: interest,
          paymentMethodId: fromAccountId,
          spendingTarget,
          description: baseDescription || `${loanLabel} 이자`,
          memo: baseMemo,
          groupId,
          requestId: `${requestId}_INTEREST`
        }
      });
    }

    clearInputDraft(userName);
    setAmount("");
    setCategoryId("");
    setLoanPrincipalAmount("");
    setLoanInterestAmount("");
    resetAccountSelections();
    setDescription("");
    setMemo("");
    setBenefitRewardUsedAmount("");
    requestMemory.current = null;
    setSuccess(`대출 상환 ${formatMoney(total)} 저장 대기열에 추가했습니다.`);
  }

  function buildPayload(
    requestId: string
  ):
    CreateTransactionPayload {
    const base = {
      date,
      type: backendType,
      categoryId,
      amount: Number(amount),
      description: getEffectiveDescription(),
      memo: getEffectiveMemo(),
      ...getBenefitPayloadFields(),
      requestId
    };

    if (mode === "expense") {
      return {
        ...base,
        paymentMethodId,
        spendingTarget
      };
    }

    if (mode === "income") {
      return {
        ...base,
        toAccountId
      };
    }

    return {
      ...base,
      fromAccountId,
      toAccountId,
      ...(isCardTransfer ? { billingMonth } : {})
    };
  }

  async function handleSubmit(
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

    if (isLoanRepayment) {
      submitGuard.current = true;
      setSubmitting(true);

      try {
        await submitLoanRepayment();
      } catch (submitError) {
        setError(getErrorMessage(submitError));
      } finally {
        setSubmitting(false);
        window.setTimeout(() => {
          submitGuard.current = false;
        }, 250);
      }

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
      !(await confirmAction({
        title: "중복 거래 확인",
        message: `같은 날짜에 ${formatMoney(numericAmount)} ${backendType} 내역이 이미 있습니다.\n\n중복이 아니라면 그대로 저장하세요.`,
        confirmLabel: "그래도 저장"
      }))
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

        description:
          getEffectiveDescription(),

        memo:
          getEffectiveMemo(),

        ...getBenefitPayloadFields()
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
        formatMoney(Number(amount)),
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
      await enqueuePendingTransaction({
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

      setDescription("");
      setMemo("");
      setBenefitRewardUsedAmount("");
      cardAmountEditedRef.current = false;
      setCardBillingInfo(null);
      setCardBillingError("");

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
            <Button
              fullWidth
              size="xl"
              onClick={() => window.location.reload()}
            >
              다시 시도
            </Button>
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
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => setShowTransactionImport(true)}
        >
          거래 내역 가져오기
        </Button>
      </header>

      <InputModeTabs value={mode} onChange={handleModeChange} />

      {showTransactionImport && (
        <TransactionImportSheet
          userName={userName}
          bootstrap={bootstrap}
          onClose={() => setShowTransactionImport(false)}
        />
      )}

      {mode === "investment" ? (
        <InvestmentInputSection
          loading={investmentLoading}
          hasDashboard={Boolean(investmentDashboard)}
          error={investmentError}
          accounts={investmentAccounts}
          selectedAccount={selectedInvestmentAccount}
          selectedHoldings={selectedInvestmentHoldings}
          tradeHistoryRefreshKey={investmentTradeHistoryRefreshKey}
          onPickAccount={() => setActivePicker("investmentAccount")}
          onDashboardChanged={refreshInvestmentDashboard}
        />
      ) : (
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
          {mode === "transfer" && (
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
                이체 분류{" "}

                <span
                  className={
                    styles.required
                  }
                >
                  *
                </span>
              </span>

              <PickerFieldButton
                value={categoryId ? getCategoryValueLabel() : ""}
                onClick={() => setActivePicker("category")}
                disabled={submitting}
              />

              <p className={styles.helper}>
                대출 상환은 원금과 이자를 자동 분리하고, 카드값 결제나 선결제는 카드 결제용 화면으로 바뀝니다.
              </p>
            </label>
          )}

          {mode !== "transfer" && (
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
          )}

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

          {mode !== "transfer" && (
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

              <PickerFieldButton
                value={categoryId ? getCategoryValueLabel() : ""}
                onClick={() => setActivePicker("category")}
                disabled={submitting}
              />
            </label>
          )}

          {mode === "transfer" && categoryId && !isCardTransfer && !isLoanRepayment && (
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
                {isRegionalTopup ? "충전 금액" : "금액"}{" "}

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
          )}

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

                  <PickerFieldButton
                    value={paymentMethodId ? getAccountValueLabel(paymentMethodId) : ""}
                    onClick={() => setActivePicker("paymentMethod")}
                    disabled={submitting}
                  />

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

                  <PickerFieldButton
                    value={spendingTarget}
                    onClick={() => setActivePicker("spendingTarget")}
                    disabled={submitting}
                  />
                </label>

                {selectedBenefitRule && selectedBenefitRule.kind === "post_reward" && (
                  <div className={styles.benefitBox}>
                    <div className={styles.benefitHeader}>
                      <div>
                        <strong>{getAccountValueLabel(selectedBenefitRule.accountId)} 캐시백</strong>
                        <span>{selectedBenefitRule.ratePercent}% 적립</span>
                      </div>
                      <label className={styles.benefitToggle}>
                        <input
                          type="checkbox"
                          checked={benefitEnabled}
                          disabled={submitting}
                          onChange={event => {
                            setBenefitEnabled(event.target.checked);
                            requestMemory.current = null;
                            clearFeedback();
                          }}
                        />
                        새 적립
                      </label>
                    </div>

                    {benefitPreviewLoading && !benefitPreview && (
                      <p className={styles.benefitMuted}>보유 캐시백을 확인하는 중입니다.</p>
                    )}

                    {benefitPreview && (
                      <>
                        <div className={styles.benefitRewardBalance}>
                          <span>보유 캐시백</span>
                          <strong><Money amount={benefitPreview.rewardBalanceBefore} /></strong>
                        </div>

                        <label className={styles.benefitRewardField}>
                          <span>이번 결제에 사용할 캐시백</span>
                          <div className={styles.benefitRewardInputRow}>
                            <div className={styles.benefitRewardInputWrap}>
                              <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                value={
                                  benefitRewardUsedAmount
                                    ? Number(benefitRewardUsedAmount).toLocaleString("ko-KR")
                                    : ""
                                }
                                placeholder="0"
                                disabled={submitting || benefitPreview.maxRewardUsable <= 0}
                                onChange={event => handleBenefitRewardUseChange(event.target.value)}
                              />
                              <span>원</span>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={submitting || benefitPreview.maxRewardUsable <= 0}
                              onClick={() =>
                                handleBenefitRewardUseChange(
                                  String(Math.floor(benefitPreview.maxRewardUsable))
                                )
                              }
                            >
                              전액 사용
                            </Button>
                          </div>
                        </label>

                        {Number(amount) > 0 && (
                          <div className={styles.benefitSummary}>
                            <span>결제 금액 <Money amount={benefitPreview.faceAmount} /></span>
                            <span>캐시백 사용 <Money amount={-benefitPreview.rewardUsedAmount} /></span>
                            <span>새 적립 대상 <Money amount={benefitPreview.eligibleAmount} /></span>
                            <strong>새 캐시백 <Money amount={benefitPreview.benefitAmount} showPlus /></strong>
                            <span>거래 후 예상 캐시백 <Money amount={benefitPreview.rewardBalanceAfter} /></span>
                          </div>
                        )}
                      </>
                    )}

                    {benefitPreviewError && (
                      <p className={styles.cardBillingError}>{benefitPreviewError}</p>
                    )}

                    <p className={styles.benefitMuted}>
                      사용한 캐시백 금액에는 새 캐시백이 붙지 않고, 나머지 결제금액에만 설정한 비율을 적용합니다. 새로 적립된 캐시백은 즉시 보유액에 더해지며 나중에 사용해도 됩니다.
                      {selectedBenefitRule.monthlyCap !== null
                        ? ` 월 혜택 한도 ${formatMoney(selectedBenefitRule.monthlyCap)}도 자동 반영합니다.`
                        : ""}
                    </p>
                  </div>
                )}
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

                  <PickerFieldButton
                    value={toAccountId ? getAccountValueLabel(toAccountId) : ""}
                    onClick={() => setActivePicker("incomeAccount")}
                    disabled={submitting}
                  />
                </label>
              </div>
            )
          }

          {
            mode === "transfer" &&
            isLoanRepayment && (
              <div className={styles.conditionalSection}>
                <h2 className={styles.sectionTitle}>
                  대출 상환
                </h2>

                <div className={styles.cardPaymentNotice}>
                  <span
                    className={styles.cardPaymentNoticeIcon}
                    aria-hidden="true"
                  >
                    💡
                  </span>
                  <p className={styles.cardPaymentNoticeText}>
                    <strong>총 상환액만 입력</strong>하면 원금균등상환 원금 <strong>791,666원</strong>을 기준으로 이자를 자동 계산합니다. 마지막 회차처럼 원금이 달라지는 경우에는 아래 원금만 직접 수정할 수 있습니다.
                  </p>
                </div>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    돈이 나갈 계좌 <span className={styles.required}>*</span>
                  </span>
                  <PickerFieldButton
                    value={fromAccountId ? getAccountValueLabel(fromAccountId) : ""}
                    onClick={() => setActivePicker("loanSource")}
                    disabled={submitting}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    상환할 대출계좌 <span className={styles.required}>*</span>
                  </span>
                  <PickerFieldButton
                    value={toAccountId ? getAccountValueLabel(toAccountId) : ""}
                    onClick={() => setActivePicker("loanAccount")}
                    disabled={submitting}
                  />
                </label>

                <label className={styles.amountField}>
                  <span className={styles.fieldLabel}>
                    총 상환액 <span className={styles.required}>*</span>
                  </span>
                  <div className={styles.amountWrap}>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      className={styles.amountInput}
                      placeholder="0"
                      value={
                        amount
                          ? Number(amount).toLocaleString("ko-KR")
                          : ""
                      }
                      disabled={submitting}
                      onChange={event =>
                        handleAmountChange(event.target.value)
                      }
                    />
                    <span className={styles.currency}>원</span>
                  </div>
                </label>

                <div className={styles.fieldPair}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>이번 달 원금</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      className={styles.input}
                      placeholder={DEFAULT_EQUAL_PRINCIPAL_REPAYMENT_KRW.toLocaleString("ko-KR")}
                      value={
                        loanPrincipalAmount
                          ? Number(loanPrincipalAmount).toLocaleString("ko-KR")
                          : ""
                      }
                      disabled={submitting}
                      onChange={event =>
                        handleLoanAmountChange("principal", event.target.value)
                      }
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>자동 계산 이자</span>
                    <input
                      type="text"
                      className={styles.input}
                      value={
                        amount
                          ? loanRepaymentInterest.toLocaleString("ko-KR")
                          : ""
                      }
                      placeholder="총 상환액 입력 후 계산"
                      readOnly
                    />
                  </label>
                </div>

                <div className={styles.cardBillingBox}>
                  <span>총 상환액 <Money amount={loanRepaymentTotal} /></span>
                  <span>원금 <Money amount={loanRepaymentPrincipal} /></span>
                  <strong>이자 <Money amount={loanRepaymentInterest} /></strong>
                  <small>원금만 대출잔액을 줄이고, 총 상환액에서 원금을 뺀 금액은 대출이자 지출로 기록됩니다.</small>
                </div>

                {loanRepaymentInterest > 0 && (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>
                      이자 지출대상 <span className={styles.required}>*</span>
                    </span>
                    <PickerFieldButton
                    value={spendingTarget}
                    onClick={() => setActivePicker("spendingTarget")}
                    disabled={submitting}
                  />
                  </label>
                )}
              </div>
            )
          }

          {
            mode ===
              "transfer" &&
            !isCardTransfer &&
            !isLoanRepayment && (
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

                    <PickerFieldButton
                    value={fromAccountId ? getAccountValueLabel(fromAccountId) : ""}
                    onClick={() => setActivePicker("fromAccount")}
                    disabled={submitting}
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
                      받는 수단{" "}

                      <span
                        className={
                          styles.required
                        }
                      >
                        *
                      </span>
                    </span>

                    <PickerFieldButton
                    value={toAccountId ? getAccountValueLabel(toAccountId) : ""}
                    onClick={() => setActivePicker("toAccount")}
                    disabled={submitting}
                  />
                  </label>
                </div>

                {selectedBenefitRule && selectedBenefitRule.kind === "pre_discount" && (
                  <div className={styles.benefitBox}>
                    <div className={styles.benefitHeader}>
                      <div>
                        <strong>{getAccountValueLabel(selectedBenefitRule.accountId)} 선할인</strong>
                        <span>{selectedBenefitRule.ratePercent}% 혜택</span>
                      </div>
                      <label className={styles.benefitToggle}>
                        <input
                          type="checkbox"
                          checked={benefitEnabled}
                          disabled={submitting}
                          onChange={event => setBenefitEnabled(event.target.checked)}
                        />
                        적용
                      </label>
                    </div>

                    {benefitEnabled && benefitPreviewLoading && (
                      <p className={styles.benefitMuted}>선할인 금액을 계산하는 중입니다.</p>
                    )}

                    {benefitEnabled && benefitPreview && (
                      <div className={styles.benefitSummary}>
                        <span>충전 금액 <Money amount={benefitPreview.faceAmount} /></span>
                        <strong>선할인 <Money amount={-benefitPreview.benefitAmount} /></strong>
                        <span>실제 출금 <Money amount={benefitPreview.actualAmount} /></span>
                      </div>
                    )}

                    {benefitEnabled && !benefitPreviewLoading && !benefitPreview && !benefitPreviewError && Number(amount) > 0 && (
                      <p className={styles.benefitMuted}>현재 월 한도까지 반영하면 이번 충전에 적용할 추가 선할인이 없습니다.</p>
                    )}

                    {benefitPreviewError && (
                      <p className={styles.cardBillingError}>{benefitPreviewError}</p>
                    )}

                    <p className={styles.benefitMuted}>
                      받는 계좌에는 입력한 충전 금액 전체가 들어가고, 보내는 계좌에서는 선할인을 뺀 실제 금액만 출금되도록 자동 기록합니다.
                      {selectedBenefitRule.monthlyCap !== null
                        ? ` 월 혜택 한도 ${formatMoney(selectedBenefitRule.monthlyCap)}도 자동 반영합니다.`
                        : ""}
                    </p>
                  </div>
                )}
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

                  <PickerFieldButton
                    value={toAccountId ? getAccountValueLabel(toAccountId) : ""}
                    onClick={() => setActivePicker("creditCard")}
                    disabled={submitting}
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
                        cardAmountEditedRef.current = false;
                        setCardBillingInfo(null);
                        setCardBillingError("");

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

                  {cardBillingLoading && (
                    <div className={styles.cardBillingBox}>
                      카드 결제 예정액을 계산하는 중입니다.
                    </div>
                  )}

                  {!cardBillingLoading && cardBillingInfo && (
                    <div className={styles.cardBillingBox}>
                      <span>사용 <Money amount={cardBillingInfo.usage} /></span>
                      <span>기결제 <Money amount={cardBillingInfo.payments} /></span>
                      <strong>남은 결제액 <Money amount={cardBillingInfo.estimatedRemaining} /></strong>
                      <small>남은 결제액을 아래 결제 금액에 자동 입력했습니다. 필요하면 직접 수정할 수 있습니다.</small>
                    </div>
                  )}

                  {!cardBillingLoading && cardBillingError && (
                    <p className={styles.cardBillingError}>{cardBillingError}</p>
                  )}
                </label>

                <label className={styles.cardAmountField}>
                  <span className={styles.fieldLabel}>
                    결제 금액 <span className={styles.required}>*</span>
                  </span>
                  <div className={styles.cardAmountWrap}>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      className={styles.cardAmountInput}
                      placeholder={cardBillingLoading ? "계산 중" : "0"}
                      value={formattedAmount}
                      disabled={submitting}
                      onChange={event => handleAmountChange(event.target.value)}
                    />
                    <span className={styles.cardAmountCurrency}>원</span>
                  </div>
                  <p className={styles.helper}>
                    자동 계산된 남은 카드값을 그대로 결제하거나 금액을 수정할 수 있습니다.
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
                    돈이 나갈 계좌{" "}

                    <span
                      className={
                        styles.required
                      }
                    >
                      *
                    </span>
                  </span>

                  <PickerFieldButton
                    value={fromAccountId ? getAccountValueLabel(fromAccountId) : ""}
                    onClick={() => setActivePicker("cardSource")}
                    disabled={submitting || !toAccountId}
                  />

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

              </div>
            )
          }

          {!isCardTransfer && (
            <>
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
                내용
              </span>
  
              <input
                className={styles.input}
                type="text"
                placeholder="예: 스타벅스, 주유, 급여"
                value={description}
                disabled={submitting}
                onChange={event => {
                  setDescription(event.target.value);
                  requestMemory.current = null;
                  clearFeedback();
                }}
              />
  
              <p className={styles.helper}>
                내역에서 한눈에 알아볼 짧은 내용을 적어주세요. 비워도 됩니다.
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
                메모
              </span>
  
              <textarea
                className={
                  styles.textarea
                }
                placeholder="추가로 남길 메모가 있다면 적어주세요."
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
            </>
          )}

          <PendingTransactionPanel
            userName={userName}
            savingCount={savingCount}
            failedTransactions={failedTransactions}
            onEditFailed={loadFailedTransactionForEdit}
          />

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
            <Button
              type="submit"
              fullWidth
              size="xl"
              loading={submitting}
              loadingLabel="저장 중..."
            >
              {`${
                isLoanRepayment
                  ? "대출 상환"
                  : isCardTransfer
                    ? cardTransferLabel
                    : getModeLabel(mode)
              } 저장`}
            </Button>
          </div>
        </section>
      </form>
      )}

      {activePicker && (
        <InputPickerSheet
          kind={activePicker}
          mode={mode}
          userName={userName}
          orderedAllAccounts={orderedAllAccounts}
          visibleAccounts={accounts}
          creditCards={creditCards}
          cardSourceAccounts={cardSourceAccounts}
          visibleAccountIds={visibleAccountIds}
          investmentAccountIds={investmentAccountIds}
          categories={categories}
          spendingTargets={bootstrap?.spendingTargets ?? []}
          selection={{
            categoryId,
            paymentMethodId,
            spendingTarget,
            fromAccountId,
            toAccountId,
            investmentAccountId: selectedInvestmentAccountId
          }}
          onSelect={applyPickerValue}
          onClose={() => setActivePicker(null)}
        />
      )}
    </main>
  );
}
