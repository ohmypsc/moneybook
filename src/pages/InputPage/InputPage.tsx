import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  apiRequest
} from "../../api/client";

import {
  createTransaction
} from "../../api/transactions";

import styles from "./InputPage.module.css";


type TransactionType =
  | "지출"
  | "수입"
  | "이체";


type InputMode =
  | "expense"
  | "income"
  | "transfer"
  | "card-payment"
  | "card-prepayment";


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


const CARD_PAYMENT_CATEGORY =
  "카드정기결제";

const CARD_PREPAYMENT_CATEGORY =
  "카드선결제";


const CARD_CATEGORY_NAMES =
  new Set([
    CARD_PAYMENT_CATEGORY,
    CARD_PREPAYMENT_CATEGORY
  ]);


let bootstrapPromise:
  Promise<BootstrapData> | null =
    null;


/**
 * InputPage가 처음 열렸을 때만 bootstrap을 가져옵니다.
 * 이후 다시 열면 같은 Promise를 재사용합니다.
 */
async function loadBootstrap():
  Promise<BootstrapData> {

  if (!bootstrapPromise) {
    bootstrapPromise =
      apiRequest<BootstrapResponse>(
        "/api/bootstrap"
      )
        .then(
          response => {
            if (
              !response.success ||
              !response.data
            ) {
              throw new Error(
                response.error?.message ||
                "입력 정보를 불러오지 못했습니다."
              );
            }

            return response.data;
          }
        )
        .catch(
          error => {
            bootstrapPromise =
              null;

            throw error;
          }
        );
  }

  return bootstrapPromise;
}


function getToday():
  string {

  const now =
    new Date();

  const local =
    new Date(
      now.getTime() -
      now.getTimezoneOffset() *
        60 *
        1000
    );

  return local
    .toISOString()
    .slice(
      0,
      10
    );
}


function createRequestId():
  string {

  if (
    globalThis.crypto &&
    typeof globalThis.crypto
      .randomUUID ===
      "function"
  ) {
    return globalThis.crypto
      .randomUUID();
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
):
  string {

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
):
  TransactionType {

  if (
    mode ===
      "card-payment" ||
    mode ===
      "card-prepayment"
  ) {
    return "이체";
  }

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
):
  string {

  switch (mode) {
    case "income":
      return "수입";

    case "transfer":
      return "이체";

    case "card-payment":
      return "카드값 결제";

    case "card-prepayment":
      return "카드 선결제";

    default:
      return "지출";
  }
}


function getAccountLabel(
  account: Account
):
  string {

  return (
    account.displayName ||
    account.accountName ||
    account.accountId
  );
}


export default function InputPage() {
  const today =
    getToday();


  const [
    bootstrap,
    setBootstrap
  ] =
    useState<BootstrapData | null>(
      null
    );


  const [
    bootstrapLoading,
    setBootstrapLoading
  ] =
    useState(true);


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
    useState(today);


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


  /*
   * 같은 내용으로 재시도할 때
   * 동일한 requestId를 사용하기 위한 메모리입니다.
   */
  const requestMemory =
    useRef<RequestMemory | null>(
      null
    );


  const isCardMode =
    mode ===
      "card-payment" ||
    mode ===
      "card-prepayment";


  useEffect(
    () => {
      let active =
        true;

      loadBootstrap()
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


  const backendType =
    getBackendType(
      mode
    );


  /*
   * 일반 이체 화면에서는
   * 카드대금 전용 카테고리를 숨깁니다.
   */
  const categories =
    useMemo(
      () => {
        if (!bootstrap) {
          return [];
        }

        return bootstrap.categories
          .filter(
            category =>
              category.type ===
              backendType
          )
          .filter(
            category => {
              if (
                mode !==
                "transfer"
              ) {
                return true;
              }

              return !CARD_CATEGORY_NAMES
                .has(
                  category.name
                );
            }
          );
      },
      [
        bootstrap,
        backendType,
        mode
      ]
    );


  const accounts =
    bootstrap?.accounts ||
    [];


  /*
   * 카드값 결제 및 선결제 대상은
   * 신용카드만 보여줍니다.
   */
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
        creditCards.find(
          account =>
            account.accountId ===
            toAccountId
        ) ||
        null,
      [
        creditCards,
        toAccountId
      ]
    );


  /*
   * 카드대금 출금계좌는 기본적으로
   * 자산 계좌에서 선택합니다.
   *
   * 카드에 연결된 paymentAccountId는
   * 반드시 목록에 포함되도록 합니다.
   */
  const cardSourceAccounts =
    useMemo(
      () => {
        const linkedId =
          selectedCard
            ?.paymentAccountId ||
          "";

        return accounts.filter(
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

            return (
              account.accountType ===
                "자산" &&
              account.subType !==
                "주식"
            );
          }
        );
      },
      [
        accounts,
        selectedCard,
        toAccountId
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


  function handleModeChange(
    nextMode: InputMode
  ) {
    setMode(
      nextMode
    );

    /*
     * 날짜, 금액, 메모는 유지합니다.
     * 입력 유형을 잘못 눌렀다가 바꿔도
     * 다시 입력하지 않도록 합니다.
     */
    setCategoryId("");
    setPaymentMethodId("");
    setSpendingTarget("");
    setFromAccountId("");
    setToAccountId("");

    if (
      nextMode ===
        "card-payment" ||
      nextMode ===
        "card-prepayment"
    ) {
      setBillingMonth(
        date.slice(
          0,
          7
        )
      );
    }

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

    /*
     * 카드 입력에서 사용자가 청구월을
     * 별도로 바꾸지 않았다면
     * 거래 날짜 변경에 맞춰 자동 변경합니다.
     */
    if (
      isCardMode &&
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

    /*
     * 카드에 등록된 결제계좌가 있으면
     * 자동으로 출금계좌 기본값으로 사용합니다.
     * 사용자는 아래 Select에서 변경할 수 있습니다.
     */
    setFromAccountId(
      card?.paymentAccountId ||
      ""
    );

    clearFeedback();
  }


  function getCardCategory():
    Category | undefined {

    if (!bootstrap) {
      return undefined;
    }

    const categoryName =
      mode ===
        "card-prepayment"
        ? CARD_PREPAYMENT_CATEGORY
        : CARD_PAYMENT_CATEGORY;

    return bootstrap.categories
      .find(
        category =>
          category.type ===
            "이체" &&
          category.name ===
            categoryName
      );
  }


  function validate():
    string | null {

    if (!bootstrap) {
      return "입력 정보를 불러오지 못했습니다.";
    }

    if (!date) {
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


    if (isCardMode) {
      if (
        !getCardCategory()
      ) {
        return mode ===
          "card-prepayment"
          ? "카드선결제 카테고리를 찾을 수 없습니다."
          : "카드정기결제 카테고리를 찾을 수 없습니다.";
      }

      if (!toAccountId) {
        return "결제할 카드를 선택해주세요.";
      }

      if (!fromAccountId) {
        return "돈이 나갈 계좌를 선택해주세요.";
      }

      if (!billingMonth) {
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


    if (!categoryId) {
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
      "income"
    ) {
      if (
        !toAccountId
      ) {
        return "입금수단을 선택해주세요.";
      }
    }


    if (
      mode ===
      "transfer"
    ) {
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


  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      submitting
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


    if (!bootstrap) {
      return;
    }


    const cardCategory =
      isCardMode
        ? getCardCategory()
        : undefined;


    const resolvedCategoryId =
      isCardMode
        ? cardCategory
            ?.categoryId
        : categoryId;


    if (
      !resolvedCategoryId
    ) {
      setError(
        "카테고리 정보를 찾을 수 없습니다."
      );

      return;
    }


    const payload:
      Record<
        string,
        unknown
      > = {
        date,
        type:
          backendType,
        categoryId:
          resolvedCategoryId,
        amount:
          Number(
            amount
          ),
        memo:
          memo.trim()
      };


    /*
     * 지출
     */
    if (
      mode ===
      "expense"
    ) {
      payload.paymentMethodId =
        paymentMethodId;

      payload.spendingTarget =
        spendingTarget;
    }


    /*
     * 수입
     */
    if (
      mode ===
      "income"
    ) {
      payload.toAccountId =
        toAccountId;
    }


    /*
     * 일반 이체
     */
    if (
      mode ===
      "transfer"
    ) {
      payload.fromAccountId =
        fromAccountId;

      payload.toAccountId =
        toAccountId;
    }


    /*
     * 카드값 결제 / 카드 선결제
     *
     * 프론트에서는 별도 모드지만
     * 백엔드에는 이체로 저장합니다.
     */
    if (
      isCardMode
    ) {
      payload.fromAccountId =
        fromAccountId;

      payload.toAccountId =
        toAccountId;

      payload.billingMonth =
        billingMonth;
    }


    /*
     * 전송할 실제 내용으로 fingerprint를 만듭니다.
     *
     * 저장 결과를 못 받은 상태에서
     * 같은 내용을 다시 누르면
     * 같은 requestId를 재사용합니다.
     */
    const fingerprint =
      JSON.stringify(
        payload
      );


    let requestId:
      string;


    if (
      requestMemory.current &&
      requestMemory.current
        .fingerprint ===
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


    payload.requestId =
      requestId;


    setSubmitting(
      true
    );


    try {
      const result =
        await createTransaction(
          payload as
            Parameters<
              typeof createTransaction
            >[0]
        );


      /*
       * Worker가 Apps Script의
       * success:false 응답을 그대로 반환하는
       * 경우까지 한 번 더 확인합니다.
       */
      const apiResult =
        result as
          ApiResult;


      if (
        apiResult &&
        apiResult.success ===
          false
      ) {
        throw new Error(
          apiResult.error
            ?.message ||
          "거래를 저장하지 못했습니다."
        );
      }


      setSuccess(
        `${getModeLabel(
          mode
        )} 내역을 저장했습니다.`
      );


      /*
       * 성공 후 날짜와 현재 입력 모드는 유지합니다.
       * 연속 입력하기 편하게 하기 위함입니다.
       */
      setAmount("");
      setCategoryId("");
      setPaymentMethodId("");
      setSpendingTarget("");
      setFromAccountId("");
      setToAccountId("");
      setMemo("");


      if (
        isCardMode
      ) {
        setBillingMonth(
          date.slice(
            0,
            7
          )
        );
      }


      requestMemory.current =
        null;

    } catch (
      submitError
    ) {
      /*
       * 실패 시 requestMemory를 지우지 않습니다.
       * 같은 폼으로 다시 저장하면
       * 동일 requestId를 사용합니다.
       */
      setError(
        getErrorMessage(
          submitError
        )
      );

    } finally {
      setSubmitting(
        false
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
                  window.location
                    .reload()
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
          수입과 지출, 계좌 이동을
          간편하게 기록합니다.
        </p>
      </header>


      {/* 일반 거래 유형 */}
      <div
        className={
          styles.typeTabs
        }
        aria-label="거래 유형"
      >
        <button
          type="button"
          className={[
            styles.typeButton,
            mode ===
              "expense"
              ? styles
                  .typeButtonActive
              : ""
          ].join(" ")}
          aria-pressed={
            mode ===
            "expense"
          }
          onClick={
            () =>
              handleModeChange(
                "expense"
              )
          }
        >
          지출
        </button>


        <button
          type="button"
          className={[
            styles.typeButton,
            mode ===
              "income"
              ? styles
                  .typeButtonActive
              : ""
          ].join(" ")}
          aria-pressed={
            mode ===
            "income"
          }
          onClick={
            () =>
              handleModeChange(
                "income"
              )
          }
        >
          수입
        </button>


        <button
          type="button"
          className={[
            styles.typeButton,
            mode ===
              "transfer"
              ? styles
                  .typeButtonActive
              : ""
          ].join(" ")}
          aria-pressed={
            mode ===
            "transfer"
          }
          onClick={
            () =>
              handleModeChange(
                "transfer"
              )
          }
        >
          이체
        </button>
      </div>


      {/* 카드대금 전용 입력 */}
      <section
        className={
          styles.quickSection
        }
      >
        <div
          className={
            styles.quickHeader
          }
        >
          <p
            className={
              styles.quickTitle
            }
          >
            카드대금
          </p>
        </div>


        <div
          className={
            styles.quickActions
          }
        >
          <button
            type="button"
            className={[
              styles
                .quickActionButton,
              mode ===
                "card-payment"
                ? styles
                    .quickActionSelected
                : ""
            ].join(" ")}
            aria-pressed={
              mode ===
              "card-payment"
            }
            onClick={
              () =>
                handleModeChange(
                  "card-payment"
                )
            }
          >
            <span
              className={
                styles
                  .quickActionIcon
              }
              aria-hidden="true"
            >
              💳
            </span>

            <span
              className={
                styles
                  .quickActionText
              }
            >
              <span
                className={
                  styles
                    .quickActionLabel
                }
              >
                카드값 결제
              </span>

              <span
                className={
                  styles
                    .quickActionHint
                }
              >
                결제일에 카드대금 납부
              </span>
            </span>
          </button>


          <button
            type="button"
            className={[
              styles
                .quickActionButton,
              mode ===
                "card-prepayment"
                ? styles
                    .quickActionSelected
                : ""
            ].join(" ")}
            aria-pressed={
              mode ===
              "card-prepayment"
            }
            onClick={
              () =>
                handleModeChange(
                  "card-prepayment"
                )
            }
          >
            <span
              className={
                styles
                  .quickActionIcon
              }
              aria-hidden="true"
            >
              ⚡
            </span>

            <span
              className={
                styles
                  .quickActionText
              }
            >
              <span
                className={
                  styles
                    .quickActionLabel
                }
              >
                카드 선결제
              </span>

              <span
                className={
                  styles
                    .quickActionHint
                }
              >
                결제일 전에 미리 납부
              </span>
            </span>
          </button>
        </div>
      </section>


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
          {/* 날짜 */}
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
              날짜

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
                    event.target
                      .value
                  )
              }
            />
          </label>


          {/* 금액 */}
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
              금액

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
                      event.target
                        .value
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


          {/* 일반 거래 카테고리 */}
          {!isCardMode && (
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
                카테고리

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
                  event => {
                    setCategoryId(
                      event.target
                        .value
                    );

                    clearFeedback();
                  }
                }
              >
                <option
                  value=""
                >
                  선택하세요
                </option>

                {categories.map(
                  category => (
                    <option
                      key={
                        category
                          .categoryId
                      }
                      value={
                        category
                          .categoryId
                      }
                    >
                      {
                        category.name
                      }
                    </option>
                  )
                )}
              </select>
            </label>
          )}


          {/* 지출 */}
          {mode ===
            "expense" && (
            <div
              className={
                styles
                  .conditionalSection
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
                  결제수단

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
                        event.target
                          .value
                      );

                      clearFeedback();
                    }
                  }
                >
                  <option
                    value=""
                  >
                    선택하세요
                  </option>

                  {accounts.map(
                    account => (
                      <option
                        key={
                          account
                            .accountId
                        }
                        value={
                          account
                            .accountId
                        }
                      >
                        {
                          getAccountLabel(
                            account
                          )
                        }
                      </option>
                    )
                  )}
                </select>

                <p
                  className={
                    styles.helper
                  }
                >
                  체크카드는 연결된
                  통장에서 자동 출금됩니다.
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
                  지출대상

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
                        event.target
                          .value
                      );

                      clearFeedback();
                    }
                  }
                >
                  <option
                    value=""
                  >
                    선택하세요
                  </option>

                  {bootstrap
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
                          {
                            target
                          }
                        </option>
                      )
                    )}
                </select>
              </label>
            </div>
          )}


          {/* 수입 */}
          {mode ===
            "income" && (
            <div
              className={
                styles
                  .conditionalSection
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
                  입금수단

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
                        event.target
                          .value
                      );

                      clearFeedback();
                    }
                  }
                >
                  <option
                    value=""
                  >
                    선택하세요
                  </option>

                  {accounts.map(
                    account => (
                      <option
                        key={
                          account
                            .accountId
                        }
                        value={
                          account
                            .accountId
                        }
                      >
                        {
                          getAccountLabel(
                            account
                          )
                        }
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>
          )}


          {/* 일반 이체 */}
          {mode ===
            "transfer" && (
            <div
              className={
                styles
                  .conditionalSection
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
                    보내는 수단

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
                          event.target
                            .value
                        );

                        clearFeedback();
                      }
                    }
                  >
                    <option
                      value=""
                    >
                      선택하세요
                    </option>

                    {accounts.map(
                      account => (
                        <option
                          key={
                            account
                              .accountId
                          }
                          value={
                            account
                              .accountId
                          }
                        >
                          {
                            getAccountLabel(
                              account
                            )
                          }
                        </option>
                      )
                    )}
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
                    받는 수단

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
                          event.target
                            .value
                        );

                        clearFeedback();
                      }
                    }
                  >
                    <option
                      value=""
                    >
                      선택하세요
                    </option>

                    {accounts.map(
                      account => (
                        <option
                          key={
                            account
                              .accountId
                          }
                          value={
                            account
                              .accountId
                          }
                        >
                          {
                            getAccountLabel(
                              account
                            )
                          }
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>
            </div>
          )}


          {/* 카드값 결제 / 선결제 */}
          {isCardMode && (
            <div
              className={
                styles
                  .conditionalSection
              }
            >
              <h2
                className={
                  styles.sectionTitle
                }
              >
                {
                  getModeLabel(
                    mode
                  )
                }
              </h2>


              <div
                className={
                  styles
                    .cardPaymentNotice
                }
              >
                <span
                  className={
                    styles
                      .cardPaymentNoticeIcon
                  }
                  aria-hidden="true"
                >
                  💡
                </span>

                <p
                  className={
                    styles
                      .cardPaymentNoticeText
                  }
                >
                  <strong>
                    {
                      mode ===
                      "card-prepayment"
                        ? "카드선결제"
                        : "카드정기결제"
                    }
                  </strong>
                  로 자동 기록됩니다.
                  일반 이체에서 별도로
                  카테고리를 찾을 필요가
                  없습니다.
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
                  결제할 카드

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
                        event.target
                          .value
                      )
                  }
                >
                  <option
                    value=""
                  >
                    신용카드를 선택하세요
                  </option>

                  {creditCards.map(
                    account => (
                      <option
                        key={
                          account
                            .accountId
                        }
                        value={
                          account
                            .accountId
                        }
                      >
                        {
                          getAccountLabel(
                            account
                          )
                        }
                      </option>
                    )
                  )}
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
                  돈이 나갈 계좌

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
                        event.target
                          .value
                      );

                      clearFeedback();
                    }
                  }
                >
                  <option
                    value=""
                  >
                    선택하세요
                  </option>

                  {cardSourceAccounts
                    .map(
                      account => (
                        <option
                          key={
                            account
                              .accountId
                          }
                          value={
                            account
                              .accountId
                          }
                        >
                          {
                            getAccountLabel(
                              account
                            )
                          }
                        </option>
                      )
                    )}
                </select>

                {selectedCard
                  ?.paymentAccountId && (
                  <p
                    className={
                      styles.helper
                    }
                  >
                    카드에 등록된
                    결제계좌를 자동으로
                    선택했습니다. 실제
                    출금계좌가 다르면
                    변경할 수 있습니다.
                  </p>
                )}
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
                  대상 청구월

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
                        event.target
                          .value
                      );

                      clearFeedback();
                    }
                  }
                />

                <p
                  className={
                    styles.helper
                  }
                >
                  이 결제가 어느 달
                  카드대금에 해당하는지
                  선택합니다.
                </p>
              </label>
            </div>
          )}


          {/* 메모 */}
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
                    event.target
                      .value
                  );

                  clearFeedback();
                }
              }
            />
          </label>


          {error && (
            <p
              className={
                styles.error
              }
              role="alert"
            >
              {error}
            </p>
          )}


          {success && (
            <p
              className={
                styles.success
              }
              role="status"
            >
              {success}
            </p>
          )}


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
              {submitting
                ? "저장 중..."
                : `${getModeLabel(
                    mode
                  )} 저장`}
            </button>
          </div>
        </section>
      </form>
    </main>
  );
}
