import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { apiRequest } from "../../api/client";
import { getBootstrapCacheGeneration } from "../../api/bootstrapCache";
import { createTransaction } from "../../api/transactions";
import {
  applyAccountPreferences,
  applyCategoryPreferences,
  getInputPreferences,
  sortAccountsByPreferences
} from "../../utils/inputPreferences";
import {
  enqueuePendingTransaction,
  getLastPendingTransactionCompletion,
  getPendingTransactions,
  retryAllFailedPendingTransactions,
  retryPendingTransaction,
  startPendingTransactionQueue,
  subscribePendingTransactions
} from "../../utils/pendingTransactionQueue";
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

const CARD_PAYMENT_CATEGORY = "카드정기결제";
const CARD_PREPAYMENT_CATEGORY = "카드선결제";

interface InputPageProps {
  userName: string;
}

let bootstrapPromise: Promise<BootstrapData> | null = null;
let bootstrapPromiseGeneration = -1;
let bootstrapSnapshot: BootstrapData | null = null;

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
  const now = new Date();

  const local = new Date(
    now.getTime() -
      now.getTimezoneOffset() *
        60 *
        1000
  );

  return local
    .toISOString()
    .slice(0, 10);
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

export default function InputPage({
  userName
}: InputPageProps) {
  const today =
    getToday();

  const [
    bootstrap,
    setBootstrap
  ] =
    useState<BootstrapData | null>(
      () =>
        bootstrapSnapshot
    );

  const [
    bootstrapLoading,
    setBootstrapLoading
  ] =
    useState(
      () =>
        bootstrapSnapshot ===
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
      "expense"
    );

  const [
    date,
    setDate
  ] =
    useState(
      today
    );

  const [
    amount,
    setAmount
  ] =
    useState("");

  const [
    categoryId,
    setCategoryId
  ] =
    useState("");

  const [
    paymentMethodId,
    setPaymentMethodId
  ] =
    useState("");

  const [
    spendingTarget,
    setSpendingTarget
  ] =
    useState("");

  const [
    fromAccountId,
    setFromAccountId
  ] =
    useState("");

  const [
    toAccountId,
    setToAccountId
  ] =
    useState("");

  const [
    billingMonth,
    setBillingMonth
  ] =
    useState(
      today.slice(
        0,
        7
      )
    );

  const [
    memo,
    setMemo
  ] =
    useState("");

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

      startPendingTransactionQueue(
        userName
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

        return applyAccountPreferences(
          allAccounts,
          preferences
        );
      },
      [
        allAccounts,
        preferences
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

        return sortAccountsByPreferences(
          candidates,
          preferences
        );
      },
      [
        allAccounts,
        preferences,
        selectedCard,
        toAccountId,
        visibleAccountIds
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

  function resetAccountSelections() {
    setPaymentMethodId("");
    setSpendingTarget("");
    setFromAccountId("");
    setToAccountId("");
  }

  function handleModeChange(
    nextMode: InputMode
  ) {
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
      <header
        className={
          styles.header
        }
      >
        <p
          className={
            styles.eyebrow
          }
        >
          우리 가계부
        </p>

        <h1
          className={
            styles.title
          }
        >
          거래 입력
        </h1>

        <p
          className={
            styles.description
          }
        >
          수입과 지출, 계좌 이동을 간편하게 기록합니다.
        </p>
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
              카테고리{" "}

              <span
                className={
                  styles.required
                }
              >
                *
              </span>
            </span>

            <select
              className={
                styles.select
              }
              value={
                categoryId
              }
              disabled={
                submitting
              }
              onChange={
                event =>
                  handleCategoryChange(
                    event.target.value
                  )
              }
            >
              <option
                value=""
              >
                선택하세요
              </option>

              {
                categories.map(
                  category => (
                    <option
                      key={
                        category.categoryId
                      }
                      value={
                        category.categoryId
                      }
                    >
                      {
                        getCategoryLabel(
                          category
                        )
                      }
                    </option>
                  )
                )
              }
            </select>
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

                  <select
                    className={
                      styles.select
                    }
                    value={
                      paymentMethodId
                    }
                    disabled={
                      submitting
                    }
                    onChange={
                      event => {
                        setPaymentMethodId(
                          event.target.value
                        );

                        requestMemory.current =
                          null;

                        clearFeedback();
                      }
                    }
                  >
                    <option
                      value=""
                    >
                      선택하세요
                    </option>

                    {
                      accounts.map(
                        account => (
                          <option
                            key={
                              account.accountId
                            }
                            value={
                              account.accountId
                            }
                          >
                            {
                              getAccountLabel(
                                account
                              )
                            }
                          </option>
                        )
                      )
                    }
                  </select>

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

                  <select
                    className={
                      styles.select
                    }
                    value={
                      spendingTarget
                    }
                    disabled={
                      submitting
                    }
                    onChange={
                      event => {
                        setSpendingTarget(
                          event.target.value
                        );

                        requestMemory.current =
                          null;

                        clearFeedback();
                      }
                    }
                  >
                    <option
                      value=""
                    >
                      선택하세요
                    </option>

                    {
                      bootstrap
                        .spendingTargets
                        .map(
                          target => (
                            <option
                              key={
                                target
                              }
                              value={
                                target
                              }
                            >
                              {target}
                            </option>
                          )
                        )
                    }
                  </select>
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

                  <select
                    className={
                      styles.select
                    }
                    value={
                      toAccountId
                    }
                    disabled={
                      submitting
                    }
                    onChange={
                      event => {
                        setToAccountId(
                          event.target.value
                        );

                        requestMemory.current =
                          null;

                        clearFeedback();
                      }
                    }
                  >
                    <option
                      value=""
                    >
                      선택하세요
                    </option>

                    {
                      accounts.map(
                        account => (
                          <option
                            key={
                              account.accountId
                            }
                            value={
                              account.accountId
                            }
                          >
                            {
                              getAccountLabel(
                                account
                              )
                            }
                          </option>
                        )
                      )
                    }
                  </select>
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

                    <select
                      className={
                        styles.select
                      }
                      value={
                        fromAccountId
                      }
                      disabled={
                        submitting
                      }
                      onChange={
                        event => {
                          setFromAccountId(
                            event.target.value
                          );

                          requestMemory.current =
                            null;

                          clearFeedback();
                        }
                      }
                    >
                      <option
                        value=""
                      >
                        선택하세요
                      </option>

                      {
                        accounts.map(
                          account => (
                            <option
                              key={
                                account.accountId
                              }
                              value={
                                account.accountId
                              }
                            >
                              {
                                getAccountLabel(
                                  account
                                )
                              }
                            </option>
                          )
                        )
                      }
                    </select>
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

                    <select
                      className={
                        styles.select
                      }
                      value={
                        toAccountId
                      }
                      disabled={
                        submitting
                      }
                      onChange={
                        event => {
                          setToAccountId(
                            event.target.value
                          );

                          requestMemory.current =
                            null;

                          clearFeedback();
                        }
                      }
                    >
                      <option
                        value=""
                      >
                        선택하세요
                      </option>

                      {
                        accounts.map(
                          account => (
                            <option
                              key={
                                account.accountId
                              }
                              value={
                                account.accountId
                              }
                            >
                              {
                                getAccountLabel(
                                  account
                                )
                              }
                            </option>
                          )
                        )
                      }
                    </select>
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

                  <select
                    className={
                      styles.select
                    }
                    value={
                      toAccountId
                    }
                    disabled={
                      submitting
                    }
                    onChange={
                      event =>
                        handleCardChange(
                          event.target.value
                        )
                    }
                  >
                    <option
                      value=""
                    >
                      신용카드를 선택하세요
                    </option>

                    {
                      creditCards.map(
                        account => (
                          <option
                            key={
                              account.accountId
                            }
                            value={
                              account.accountId
                            }
                          >
                            {
                              getAccountLabel(
                                account
                              )
                            }
                          </option>
                        )
                      )
                    }
                  </select>
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

                  <select
                    className={
                      styles.select
                    }
                    value={
                      fromAccountId
                    }
                    disabled={
                      submitting ||
                      !toAccountId
                    }
                    onChange={
                      event => {
                        setFromAccountId(
                          event.target.value
                        );

                        requestMemory.current =
                          null;

                        clearFeedback();
                      }
                    }
                  >
                    <option
                      value=""
                    >
                      선택하세요
                    </option>

                    {
                      cardSourceAccounts.map(
                        account => (
                          <option
                            key={
                              account.accountId
                            }
                            value={
                              account.accountId
                            }
                          >
                            {
                              getAccountLabel(
                                account
                              )
                            }
                          </option>
                        )
                      )
                    }
                  </select>

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
                              {item.error}
                            </span>
                          </div>

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
    </main>
  );
}
