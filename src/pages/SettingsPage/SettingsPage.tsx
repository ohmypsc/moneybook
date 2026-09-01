import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  apiRequest
} from "../../api/client";

import {
  getSession,
  logout
} from "../../api/auth";

import {
  getTransactions
} from "../../api/transactions";

import type {
  Transaction
} from "../../api/transactions";

import {
  clearLedgerStartDate,
  createManagedAccount,
  createManagedCategory,
  deleteManagedAccount,
  deleteManagedCategory,
  getLedgerConfig,
  getManagedAccounts,
  getManagedCategories,
  restoreManagedAccount,
  restoreManagedCategory,
  setLedgerStartDate,
  updateManagedAccount,
  updateManagedCategory
} from "../../api/settingsManagement";

import type {
  LedgerCategoryType,
  ManagedAccount,
  ManagedCategory,
  SaveAccountInput
} from "../../api/settingsManagement";

import {
  applyCategoryPreferences,
  createDefaultInputPreferences,
  getInputPreferences,
  normalizeInputPreferences,
  saveInputPreferences,
  sortAccountsByPreferences
} from "../../utils/inputPreferences";

import type {
  InputPreferences,
  PreferenceTransactionType,
  SharedInputPreferencesState
} from "../../utils/inputPreferences";

import styles
  from "./SettingsPage.module.css";


type SettingsView =
  | "home"
  | "input"
  | "categories"
  | "accounts"
  | "ledger"
  | "profile";


interface InputAccount {
  accountId: string;

  accountName?: string;

  displayName: string;

  accountType: string;

  subType: string;

  owner?: string;

  paymentAccountId?:
    string |
    null;
}


interface InputCategory {
  categoryId: string;

  type:
    PreferenceTransactionType;

  name: string;
}


interface BootstrapData {
  transactionTypes:
    PreferenceTransactionType[];

  members: string[];

  spendingTargets: string[];

  accounts:
    InputAccount[];

  categories:
    InputCategory[];

  inputPreferences?:
    SharedInputPreferencesState;
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


interface SavePreferencesResponse {
  success: boolean;

  apiVersion?: string;

  data?:
    SharedInputPreferencesState;

  error?: {
    code?: string;
    message?: string;
  };
}


interface AccountFormState {
  accountName: string;

  accountType: string;

  subType: string;

  owner: string;

  openingBalance: string;

  billingCutoffDay: string;

  paymentDay: string;

  startYear: string;

  endYear: string;

  balanceMethod: string;

  paymentAccountId: string;

  assetAttribution: string;
}


const CATEGORY_TYPES:
  PreferenceTransactionType[] = [
    "지출",
    "수입",
    "이체"
  ];


const MANAGED_CATEGORY_TYPES:
  LedgerCategoryType[] = [
    "지출",
    "수입",
    "이체"
  ];


const FIXED_OWNERS = [
  "공동",
  "미영",
  "승철"
];


const ACCOUNT_OWNER_TABS = [
  "미영",
  "승철",
  "공동"
] as const;


type AccountOwnerTab =
  typeof ACCOUNT_OWNER_TABS[number];


const ACCOUNT_TYPE_SUGGESTIONS = [
  "자산",
  "부채",
  "투자"
];


const ACCOUNT_SUBTYPE_SUGGESTIONS = [
  "입출금",
  "현금",
  "체크카드",
  "신용카드",
  "선불/지역화폐",
  "예금",
  "적금",
  "주식",
  "대출"
];


function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error
    ? error.message
    : fallback;
}


function moveItem(
  items: string[],
  index: number,
  direction: -1 | 1
) {
  const nextIndex =
    index + direction;

  if (
    nextIndex < 0 ||
    nextIndex >= items.length
  ) {
    return items;
  }

  const next =
    items.slice();

  [
    next[index],
    next[nextIndex]
  ] = [
    next[nextIndex],
    next[index]
  ];

  return next;
}


function getInputAccountName(
  account:
    InputAccount
) {
  return (
    account.displayName ||
    account.accountName ||
    account.accountId
  );
}


function formatKrw(
  value:
    number |
    undefined
) {
  if (
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  return `${Math.round(
    value
  ).toLocaleString(
    "ko-KR"
  )}원`;
}


function csvCell(
  value: unknown
) {
  const text =
    value === null ||
    value === undefined
      ? ""
      : String(value);

  return `"${text.replace(
    /"/g,
    '""'
  )}"`;
}


function createEmptyAccountForm(
  owner: string =
    "공동"
): AccountFormState {
  return {
    accountName: "",
    accountType: "자산",
    subType: "입출금",
    owner,
    openingBalance: "0",
    billingCutoffDay: "",
    paymentDay: "",
    startYear: "",
    endYear: "",
    balanceMethod: "자동계산",
    paymentAccountId: "",
    assetAttribution: owner
  };
}


function accountToForm(
  account:
    ManagedAccount
): AccountFormState {
  return {
    accountName:
      account.accountName,

    accountType:
      account.accountType,

    subType:
      account.subType,

    owner:
      account.owner,

    openingBalance:
      String(
        account.openingBalance ??
          0
      ),

    billingCutoffDay:
      account.billingCutoffDay ===
      null
        ? ""
        : String(
            account.billingCutoffDay
          ),

    paymentDay:
      account.paymentDay ===
      null
        ? ""
        : String(
            account.paymentDay
          ),

    startYear:
      account.startYear ===
      null
        ? ""
        : String(
            account.startYear
          ),

    endYear:
      account.endYear ===
      null
        ? ""
        : String(
            account.endYear
          ),

    balanceMethod:
      account.balanceMethod ||
      "자동계산",

    paymentAccountId:
      account.paymentAccountId ||
      "",

    assetAttribution:
      account.assetAttribution ||
      account.owner
  };
}


function parseOptionalInteger(
  value: string,
  label: string,
  minimum: number,
  maximum: number
) {
  const text =
    value.trim();

  if (!text) {
    return null;
  }

  const number =
    Number(text);

  if (
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new Error(
      `${label}은 ${minimum}~${maximum} 사이의 정수여야 합니다.`
    );
  }

  return number;
}


function buildAccountPayload(
  form:
    AccountFormState
): SaveAccountInput {
  const accountName =
    form.accountName.trim();

  const accountType =
    form.accountType.trim();

  const subType =
    form.subType.trim();

  const owner =
    form.owner.trim();

  const openingBalance =
    Number(
      form.openingBalance ||
        0
    );

  if (!accountName) {
    throw new Error(
      "계좌 이름을 입력해주세요."
    );
  }

  if (!accountType) {
    throw new Error(
      "계좌 유형을 입력해주세요."
    );
  }

  if (!subType) {
    throw new Error(
      "세부 구분을 입력해주세요."
    );
  }

  if (!owner) {
    throw new Error(
      "명의자를 선택해주세요."
    );
  }

  if (
    !Number.isFinite(
      openingBalance
    )
  ) {
    throw new Error(
      "시작 잔액은 숫자로 입력해주세요."
    );
  }

  const billingCutoffDay =
    parseOptionalInteger(
      form.billingCutoffDay,
      "청구 마감일",
      1,
      31
    );

  const paymentDay =
    parseOptionalInteger(
      form.paymentDay,
      "결제일",
      1,
      31
    );

  const startYear =
    parseOptionalInteger(
      form.startYear,
      "사용 시작 연도",
      1900,
      2200
    );

  const endYear =
    parseOptionalInteger(
      form.endYear,
      "사용 종료 연도",
      1900,
      2200
    );

  if (
    startYear !== null &&
    endYear !== null &&
    startYear > endYear
  ) {
    throw new Error(
      "사용 시작 연도는 종료 연도보다 늦을 수 없습니다."
    );
  }

  const isCard =
    subType === "체크카드" ||
    subType === "신용카드";

  if (
    isCard &&
    !form.paymentAccountId
  ) {
    throw new Error(
      "카드의 결제계좌를 선택해주세요."
    );
  }

  return {
    accountName,
    accountType,
    subType,
    owner,
    openingBalance,
    billingCutoffDay,
    paymentDay,
    startYear,
    endYear,

    balanceMethod:
      form.balanceMethod.trim() ||
      "자동계산",

    paymentAccountId:
      isCard
        ? form.paymentAccountId
        : null,

    assetAttribution:
      form.assetAttribution.trim() ||
      owner
  };
}


function SettingsHome(
  {
    onOpen
  }: {
    onOpen:
      (
        view:
          SettingsView
      ) => void;
  }
) {
  const sharedItems: Array<{
    key: SettingsView;
    title: string;
    description: string;
  }> = [
    {
      key: "input",
      title: "입력 화면 설정",
      description:
        "카테고리와 계좌의 표시 순서·노출 여부"
    },
    {
      key: "categories",
      title: "카테고리 관리",
      description:
        "추가·이름 변경·사용 중지·삭제·복원"
    },
    {
      key: "accounts",
      title: "계좌·카드 관리",
      description:
        "계좌와 카드의 추가·수정·사용 종료·복원"
    },
    {
      key: "ledger",
      title: "가계부 운영·데이터",
      description:
        "가계부 시작일, 전체 거래 내보내기, 새로고침"
    }
  ];

  return (
    <>
      <header
        className={
          styles.pageHeader
        }
      >
        <p
          className={
            styles.eyebrow
          }
        >
          설정
        </p>

        <h1
          className={
            styles.pageTitle
          }
        >
          우리 가계부 설정
        </h1>

        <p
          className={
            styles.pageDescription
          }
        >
          부부가 함께 쓰는 설정과
          내 계정 정보를 관리합니다.
        </p>
      </header>

      <section
        className={
          styles.menuSection
        }
      >
        <h2
          className={
            styles.menuSectionTitle
          }
        >
          부부 공통
        </h2>

        <div
          className={
            styles.menuCard
          }
        >
          {
            sharedItems.map(
              item => (
                <button
                  type="button"
                  key={
                    item.key
                  }
                  className={
                    styles.menuRow
                  }
                  onClick={
                    () =>
                      onOpen(
                        item.key
                      )
                  }
                >
                  <span
                    className={
                      styles.menuText
                    }
                  >
                    <strong>
                      {
                        item.title
                      }
                    </strong>

                    <span>
                      {
                        item.description
                      }
                    </span>
                  </span>

                  <span
                    className={
                      styles.chevron
                    }
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
              )
            )
          }
        </div>
      </section>

      <section
        className={
          styles.menuSection
        }
      >
        <h2
          className={
            styles.menuSectionTitle
          }
        >
          내 설정
        </h2>

        <div
          className={
            styles.menuCard
          }
        >
          <button
            type="button"
            className={
              styles.menuRow
            }
            onClick={
              () =>
                onOpen(
                  "profile"
                )
            }
          >
            <span
              className={
                styles.menuText
              }
            >
              <strong>
                내 계정·앱 정보
              </strong>

              <span>
                현재 사용자, 데이터 저장 방식, 로그아웃
              </span>
            </span>

            <span
              className={
                styles.chevron
              }
              aria-hidden="true"
            >
              ›
            </span>
          </button>
        </div>
      </section>
    </>
  );
}


function DetailHeader(
  {
    title,
    description,
    onBack
  }: {
    title: string;
    description: string;
    onBack: () => void;
  }
) {
  return (
    <header
      className={
        styles.detailHeader
      }
    >
      <button
        type="button"
        className={
          styles.backButton
        }
        onClick={
          onBack
        }
      >
        <span
          aria-hidden="true"
        >
          ‹
        </span>

        설정
      </button>

      <h1
        className={
          styles.detailTitle
        }
      >
        {title}
      </h1>

      <p
        className={
          styles.detailDescription
        }
      >
        {description}
      </p>
    </header>
  );
}


function InputSettings() {
  const [
    bootstrap,
    setBootstrap
  ] =
    useState<BootstrapData | null>(
      null
    );

  const [
    preferences,
    setPreferences
  ] =
    useState<InputPreferences | null>(
      null
    );

  const [
    categoryType,
    setCategoryType
  ] =
    useState<PreferenceTransactionType>(
      "지출"
    );

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    error,
    setError
  ] =
    useState("");

  const [
    feedback,
    setFeedback
  ] =
    useState("");

  const [
    saveError,
    setSaveError
  ] =
    useState("");

  const [
    saving,
    setSaving
  ] =
    useState(false);


  useEffect(
    () => {
      let active =
        true;

      async function load() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const response =
            await apiRequest<
              BootstrapResponse
            >(
              "/api/bootstrap"
            );

          if (
            !response.success ||
            !response.data
          ) {
            throw new Error(
              response.error
                ?.message ||
                "설정 정보를 불러오지 못했습니다."
            );
          }

          if (!active) {
            return;
          }

          const data =
            response.data;

          const sharedPreferences =
            data.inputPreferences
              ?.configured ===
            true
              ? data
                  .inputPreferences
                  .preferences
              : null;

          const nextPreferences =
            sharedPreferences
              ? normalizeInputPreferences(
                  sharedPreferences,
                  data.categories,
                  data.accounts
                )
              : getInputPreferences(
                  data.categories,
                  data.accounts
                );

          if (
            sharedPreferences
          ) {
            saveInputPreferences(
              nextPreferences
            );
          }

          setBootstrap(
            data
          );

          setPreferences(
            nextPreferences
          );
        } catch (
          loadError
        ) {
          if (
            active
          ) {
            setError(
              getErrorMessage(
                loadError,
                "설정 정보를 불러오지 못했습니다."
              )
            );
          }
        } finally {
          if (
            active
          ) {
            setLoading(
              false
            );
          }
        }
      }

      void load();

      return () => {
        active =
          false;
      };
    },
    []
  );


  const categoryItems =
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
          categoryType,
          preferences
        );
      },
      [
        bootstrap,
        categoryType,
        preferences
      ]
    );


  const accountItems =
    useMemo(
      () => {
        if (
          !bootstrap ||
          !preferences
        ) {
          return [];
        }

        return sortAccountsByPreferences(
          bootstrap.accounts,
          preferences
        );
      },
      [
        bootstrap,
        preferences
      ]
    );


  const hiddenAccountSet =
    useMemo(
      () =>
        new Set(
          preferences
            ?.hiddenAccountIds ||
            []
        ),
      [
        preferences
      ]
    );


  function clearMessages() {
    setFeedback(
      ""
    );

    setSaveError(
      ""
    );
  }


  function handleMoveCategory(
    index: number,
    direction: -1 | 1
  ) {
    if (
      !preferences
    ) {
      return;
    }

    setPreferences({
      ...preferences,

      categoryOrder: {
        ...preferences
          .categoryOrder,

        [categoryType]:
          moveItem(
            preferences
              .categoryOrder[
                categoryType
              ],
            index,
            direction
          )
      }
    });

    clearMessages();
  }


  function handleMoveAccount(
    index: number,
    direction: -1 | 1
  ) {
    if (
      !preferences
    ) {
      return;
    }

    setPreferences({
      ...preferences,

      accountOrder:
        moveItem(
          preferences
            .accountOrder,
          index,
          direction
        )
    });

    clearMessages();
  }


  function handleToggleAccount(
    accountId: string
  ) {
    if (
      !preferences
    ) {
      return;
    }

    const hidden =
      new Set(
        preferences
          .hiddenAccountIds
      );

    if (
      hidden.has(
        accountId
      )
    ) {
      hidden.delete(
        accountId
      );
    } else {
      hidden.add(
        accountId
      );
    }

    setPreferences({
      ...preferences,

      hiddenAccountIds:
        Array.from(
          hidden
        )
    });

    clearMessages();
  }


  async function handleSave() {
    if (
      !preferences ||
      !bootstrap ||
      saving
    ) {
      return;
    }

    const normalized =
      normalizeInputPreferences(
        preferences,
        bootstrap.categories,
        bootstrap.accounts
      );

    saveInputPreferences(
      normalized
    );

    setPreferences(
      normalized
    );

    setSaving(
      true
    );

    clearMessages();

    try {
      const response =
        await apiRequest<
          SavePreferencesResponse
        >(
          "/api/settings/input-preferences",
          {
            method:
              "POST",

            body:
              JSON.stringify({
                preferences:
                  normalized
              })
          }
        );

      if (
        !response.success ||
        !response.data ||
        response.data
          .configured !==
          true ||
        !response.data
          .preferences
      ) {
        throw new Error(
          response.error
            ?.message ||
            "부부 공통 설정을 저장하지 못했습니다."
        );
      }

      const saved =
        normalizeInputPreferences(
          response.data
            .preferences,
          bootstrap.categories,
          bootstrap.accounts
        );

      saveInputPreferences(
        saved
      );

      setPreferences(
        saved
      );

      setFeedback(
        "부부 공통 설정으로 저장했습니다."
      );
    } catch (
      saveFailure
    ) {
      setSaveError(
        `공통 서버 저장에 실패했습니다. 현재 브라우저에는 저장했습니다. (${getErrorMessage(
          saveFailure,
          "알 수 없는 오류"
        )})`
      );
    } finally {
      setSaving(
        false
      );
    }
  }


  function handleReset() {
    if (
      !bootstrap ||
      saving
    ) {
      return;
    }

    setPreferences(
      createDefaultInputPreferences(
        bootstrap.categories,
        bootstrap.accounts
      )
    );

    setFeedback(
      "기본 설정으로 되돌렸습니다. 저장을 누르면 부부 공통으로 적용됩니다."
    );

    setSaveError(
      ""
    );
  }


  if (
    loading
  ) {
    return (
      <p
        className={
          styles.state
        }
      >
        입력 설정을 불러오는 중입니다.
      </p>
    );
  }


  if (
    error ||
    !bootstrap ||
    !preferences
  ) {
    return (
      <p
        className={
          styles.error
        }
        role="alert"
      >
        {
          error ||
          "입력 설정을 불러오지 못했습니다."
        }
      </p>
    );
  }


  return (
    <div
      className={
        styles.settingsBody
      }
    >
      <p
        className={
          styles.notice
        }
      >
        저장한 순서와 노출 설정은
        미영·승철 계정에 공통으로 적용됩니다.
      </p>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            카테고리 순서
          </h2>

          <p>
            입력 화면에 표시되는 순서를
            거래 유형별로 정합니다.
          </p>
        </div>

        <div
          className={
            styles.segmentedControl
          }
        >
          {
            CATEGORY_TYPES.map(
              type => (
                <button
                  type="button"
                  key={
                    type
                  }
                  className={
                    categoryType ===
                    type
                      ? styles
                          .segmentButtonActive
                      : styles
                          .segmentButton
                  }
                  onClick={
                    () =>
                      setCategoryType(
                        type
                      )
                  }
                >
                  {type}
                </button>
              )
            )
          }
        </div>

        {
          categoryItems.length ===
          0
            ? (
              <p
                className={
                  styles.emptyState
                }
              >
                표시할 카테고리가 없습니다.
              </p>
            )
            : (
              <ul
                className={
                  styles.itemList
                }
              >
                {
                  categoryItems.map(
                    (
                      category,
                      index
                    ) => (
                      <li
                        key={
                          category
                            .categoryId
                        }
                        className={
                          styles.orderRow
                        }
                      >
                        <span
                          className={
                            styles.orderNumber
                          }
                        >
                          {
                            index +
                            1
                          }
                        </span>

                        <span
                          className={
                            styles.primaryItemText
                          }
                        >
                          {
                            category.name
                          }
                        </span>

                        <div
                          className={
                            styles.compactActions
                          }
                        >
                          <button
                            type="button"
                            className={
                              styles.iconButton
                            }
                            aria-label={`${category.name} 위로 이동`}
                            disabled={
                              index ===
                              0
                            }
                            onClick={
                              () =>
                                handleMoveCategory(
                                  index,
                                  -1
                                )
                            }
                          >
                            ↑
                          </button>

                          <button
                            type="button"
                            className={
                              styles.iconButton
                            }
                            aria-label={`${category.name} 아래로 이동`}
                            disabled={
                              index ===
                              categoryItems.length -
                                1
                            }
                            onClick={
                              () =>
                                handleMoveCategory(
                                  index,
                                  1
                                )
                            }
                          >
                            ↓
                          </button>
                        </div>
                      </li>
                    )
                  )
                }
              </ul>
            )
        }
      </section>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            입력 화면 계좌·카드
          </h2>

          <p>
            일상 거래 입력에 필요한 항목만
            표시하고 순서를 정합니다.
          </p>
        </div>

        {
          accountItems.length ===
          0
            ? (
              <p
                className={
                  styles.emptyState
                }
              >
                등록된 계좌가 없습니다.
              </p>
            )
            : (
              <ul
                className={
                  styles.itemList
                }
              >
                {
                  accountItems.map(
                    (
                      account,
                      index
                    ) => {
                      const hidden =
                        hiddenAccountSet.has(
                          account.accountId
                        );

                      return (
                        <li
                          key={
                            account.accountId
                          }
                          className={`${styles.orderRow} ${
                            hidden
                              ? styles.mutedRow
                              : ""
                          }`}
                        >
                          <span
                            className={
                              styles.orderNumber
                            }
                          >
                            {
                              index +
                              1
                            }
                          </span>

                          <span
                            className={
                              styles.itemTextGroup
                            }
                          >
                            <strong>
                              {
                                getInputAccountName(
                                  account
                                )
                              }
                            </strong>

                            <span>
                              {
                                [
                                  account.accountType,
                                  account.subType
                                ]
                                  .filter(
                                    Boolean
                                  )
                                  .join(
                                    " · "
                                  )
                              }
                            </span>
                          </span>

                          <div
                            className={
                              styles.compactActions
                            }
                          >
                            <button
                              type="button"
                              className={
                                hidden
                                  ? styles.visibilityButton
                                  : styles.visibleButton
                              }
                              onClick={
                                () =>
                                  handleToggleAccount(
                                    account.accountId
                                  )
                              }
                            >
                              {
                                hidden
                                  ? "숨김"
                                  : "표시"
                              }
                            </button>

                            <button
                              type="button"
                              className={
                                styles.iconButton
                              }
                              aria-label={`${getInputAccountName(
                                account
                              )} 위로 이동`}
                              disabled={
                                index ===
                                0
                              }
                              onClick={
                                () =>
                                  handleMoveAccount(
                                    index,
                                    -1
                                  )
                              }
                            >
                              ↑
                            </button>

                            <button
                              type="button"
                              className={
                                styles.iconButton
                              }
                              aria-label={`${getInputAccountName(
                                account
                              )} 아래로 이동`}
                              disabled={
                                index ===
                                accountItems.length -
                                  1
                              }
                              onClick={
                                () =>
                                  handleMoveAccount(
                                    index,
                                    1
                                  )
                              }
                            >
                              ↓
                            </button>
                          </div>
                        </li>
                      );
                    }
                  )
                }
              </ul>
            )
        }
      </section>

      {
        feedback && (
          <p
            className={
              styles.feedback
            }
            role="status"
          >
            {feedback}
          </p>
        )
      }

      {
        saveError && (
          <p
            className={
              styles.error
            }
            role="alert"
          >
            {saveError}
          </p>
        )
      }

      <div
        className={
          styles.stickyActions
        }
      >
        <button
          type="button"
          className={
            styles.secondaryButton
          }
          disabled={
            saving
          }
          onClick={
            handleReset
          }
        >
          기본값
        </button>

        <button
          type="button"
          className={
            styles.primaryButton
          }
          disabled={
            saving
          }
          onClick={
            () =>
              void handleSave()
          }
        >
          {
            saving
              ? "저장 중..."
              : "설정 저장"
          }
        </button>
      </div>
    </div>
  );
}


function CategorySettings() {
  const [
    categories,
    setCategories
  ] =
    useState<
      ManagedCategory[]
    >(
      []
    );

  const [
    selectedType,
    setSelectedType
  ] =
    useState<
      LedgerCategoryType
    >(
      "지출"
    );

  const [
    newName,
    setNewName
  ] =
    useState("");

  const [
    editingId,
    setEditingId
  ] =
    useState<
      string |
      null
    >(
      null
    );

  const [
    editingName,
    setEditingName
  ] =
    useState("");

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    busyKey,
    setBusyKey
  ] =
    useState("");

  const [
    error,
    setError
  ] =
    useState("");

  const [
    feedback,
    setFeedback
  ] =
    useState("");


  async function refresh() {
    const result =
      await getManagedCategories({
        includeDeleted:
          true
      });

    setCategories(
      result.items
    );
  }


  useEffect(
    () => {
      let active =
        true;

      async function load() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const result =
            await getManagedCategories({
              includeDeleted:
                true
            });

          if (
            active
          ) {
            setCategories(
              result.items
            );
          }
        } catch (
          loadError
        ) {
          if (
            active
          ) {
            setError(
              getErrorMessage(
                loadError,
                "카테고리를 불러오지 못했습니다."
              )
            );
          }
        } finally {
          if (
            active
          ) {
            setLoading(
              false
            );
          }
        }
      }

      void load();

      return () => {
        active =
          false;
      };
    },
    []
  );


  const activeItems =
    useMemo(
      () =>
        categories.filter(
          category =>
            category.type ===
              selectedType &&
            !category.isDeleted
        ),
      [
        categories,
        selectedType
      ]
    );


  const deletedItems =
    useMemo(
      () =>
        categories.filter(
          category =>
            category.type ===
              selectedType &&
            category.isDeleted
        ),
      [
        categories,
        selectedType
      ]
    );


  async function runMutation(
    key: string,
    work:
      () =>
        Promise<unknown>,
    successMessage:
      string
  ) {
    if (
      busyKey
    ) {
      return false;
    }

    setBusyKey(
      key
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      await work();
      await refresh();

      setFeedback(
        successMessage
      );

      return true;
    } catch (
      mutationError
    ) {
      setError(
        getErrorMessage(
          mutationError,
          "카테고리를 처리하지 못했습니다."
        )
      );

      return false;
    } finally {
      setBusyKey(
        ""
      );
    }
  }


  async function handleCreate() {
    const name =
      newName.trim();

    if (!name) {
      setError(
        "추가할 카테고리 이름을 입력해주세요."
      );

      return;
    }

    const completed =
      await runMutation(
        "create",

        () =>
          createManagedCategory({
            type:
              selectedType,

            name
          }),

        `${selectedType} 카테고리를 추가했습니다.`
      );

    if (
      completed
    ) {
      setNewName(
        ""
      );
    }
  }


  async function handleRename(
    category:
      ManagedCategory
  ) {
    const name =
      editingName.trim();

    if (!name) {
      setError(
        "카테고리 이름을 입력해주세요."
      );

      return;
    }

    if (
      name ===
      category.name
    ) {
      setEditingId(
        null
      );

      return;
    }

    const completed =
      await runMutation(
        `rename:${category.categoryId}`,

        () =>
          updateManagedCategory({
            categoryId:
              category.categoryId,

            name
          }),

        "카테고리 이름을 변경했습니다."
      );

    if (
      completed
    ) {
      setEditingId(
        null
      );

      setEditingName(
        ""
      );
    }
  }


  async function handleDelete(
    category:
      ManagedCategory
  ) {
    if (
      !window.confirm(
        `‘${category.name}’ 카테고리를 삭제할까요?\n\n거래에서 사용 중인 카테고리는 삭제되지 않습니다.`
      )
    ) {
      return;
    }

    await runMutation(
      `delete:${category.categoryId}`,

      () =>
        deleteManagedCategory(
          category.categoryId
        ),

      "카테고리를 삭제했습니다."
    );
  }


  return (
    <div
      className={
        styles.settingsBody
      }
    >
      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.segmentedControl
          }
        >
          {
            MANAGED_CATEGORY_TYPES.map(
              type => (
                <button
                  type="button"
                  key={
                    type
                  }
                  className={
                    selectedType ===
                    type
                      ? styles.segmentButtonActive
                      : styles.segmentButton
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onClick={
                    () => {
                      setSelectedType(
                        type
                      );

                      setEditingId(
                        null
                      );

                      setError(
                        ""
                      );

                      setFeedback(
                        ""
                      );
                    }
                  }
                >
                  {type}
                </button>
              )
            )
          }
        </div>

        <div
          className={
            styles.createRow
          }
        >
          <label
            className={
              styles.field
            }
          >
            <span>
              새 {selectedType} 카테고리
            </span>

            <input
              type="text"
              value={
                newName
              }
              maxLength={
                40
              }
              placeholder="예: 식비"
              disabled={
                Boolean(
                  busyKey
                )
              }
              onChange={
                event =>
                  setNewName(
                    event
                      .target
                      .value
                  )
              }
              onKeyDown={
                event => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    event.preventDefault();

                    void handleCreate();
                  }
                }
              }
            />
          </label>

          <button
            type="button"
            className={
              styles.primaryButton
            }
            disabled={
              Boolean(
                busyKey
              ) ||
              !newName.trim()
            }
            onClick={
              () =>
                void handleCreate()
            }
          >
            {
              busyKey ===
              "create"
                ? "추가 중..."
                : "추가"
            }
          </button>
        </div>

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
          feedback && (
            <p
              className={
                styles.feedback
              }
              role="status"
            >
              {feedback}
            </p>
          )
        }

        {
          loading
            ? (
              <p
                className={
                  styles.state
                }
              >
                카테고리를 불러오는 중입니다.
              </p>
            )
            : activeItems.length ===
              0
              ? (
                <p
                  className={
                    styles.emptyState
                  }
                >
                  등록된 {selectedType} 카테고리가 없습니다.
                </p>
              )
              : (
                <ul
                  className={
                    styles.itemList
                  }
                >
                  {
                    activeItems.map(
                      category => {
                        const editing =
                          editingId ===
                          category.categoryId;

                        const rowBusy =
                          busyKey.endsWith(
                            category.categoryId
                          );

                        return (
                          <li
                            key={
                              category.categoryId
                            }
                            className={`${styles.managementRow} ${
                              !category.active
                                ? styles.mutedRow
                                : ""
                            }`}
                          >
                            {
                              editing
                                ? (
                                  <div
                                    className={
                                      styles.inlineEdit
                                    }
                                  >
                                    <input
                                      type="text"
                                      value={
                                        editingName
                                      }
                                      maxLength={
                                        40
                                      }
                                      disabled={
                                        Boolean(
                                          busyKey
                                        )
                                      }
                                      aria-label={`${category.name} 새 이름`}
                                      onChange={
                                        event =>
                                          setEditingName(
                                            event
                                              .target
                                              .value
                                          )
                                      }
                                      onKeyDown={
                                        event => {
                                          if (
                                            event.key ===
                                            "Enter"
                                          ) {
                                            event.preventDefault();

                                            void handleRename(
                                              category
                                            );
                                          }

                                          if (
                                            event.key ===
                                            "Escape"
                                          ) {
                                            setEditingId(
                                              null
                                            );
                                          }
                                        }
                                      }
                                    />

                                    <button
                                      type="button"
                                      className={
                                        styles.secondarySmallButton
                                      }
                                      disabled={
                                        Boolean(
                                          busyKey
                                        )
                                      }
                                      onClick={
                                        () =>
                                          setEditingId(
                                            null
                                          )
                                      }
                                    >
                                      취소
                                    </button>

                                    <button
                                      type="button"
                                      className={
                                        styles.primarySmallButton
                                      }
                                      disabled={
                                        Boolean(
                                          busyKey
                                        ) ||
                                        !editingName.trim()
                                      }
                                      onClick={
                                        () =>
                                          void handleRename(
                                            category
                                          )
                                      }
                                    >
                                      {
                                        rowBusy
                                          ? "저장 중..."
                                          : "저장"
                                      }
                                    </button>
                                  </div>
                                )
                                : (
                                  <>
                                    <span
                                      className={
                                        styles.itemTextGroup
                                      }
                                    >
                                      <strong>
                                        {
                                          category.name
                                        }
                                      </strong>

                                      <span>
                                        {
                                          category.active
                                            ? "사용 중"
                                            : "사용 중지"
                                        }
                                      </span>
                                    </span>

                                    <div
                                      className={
                                        styles.rowActions
                                      }
                                    >
                                      <button
                                        type="button"
                                        className={
                                          styles.secondarySmallButton
                                        }
                                        disabled={
                                          Boolean(
                                            busyKey
                                          )
                                        }
                                        onClick={
                                          () => {
                                            setEditingId(
                                              category.categoryId
                                            );

                                            setEditingName(
                                              category.name
                                            );

                                            setError(
                                              ""
                                            );

                                            setFeedback(
                                              ""
                                            );
                                          }
                                        }
                                      >
                                        이름 변경
                                      </button>

                                      <button
                                        type="button"
                                        className={
                                          styles.secondarySmallButton
                                        }
                                        disabled={
                                          Boolean(
                                            busyKey
                                          )
                                        }
                                        onClick={
                                          () =>
                                            void runMutation(
                                              `active:${category.categoryId}`,

                                              () =>
                                                updateManagedCategory({
                                                  categoryId:
                                                    category.categoryId,

                                                  active:
                                                    !category.active
                                                }),

                                              category.active
                                                ? "카테고리를 사용 중지했습니다."
                                                : "카테고리를 다시 사용합니다."
                                            )
                                        }
                                      >
                                        {
                                          rowBusy
                                            ? "처리 중..."
                                            : category.active
                                              ? "사용 중지"
                                              : "다시 사용"
                                        }
                                      </button>

                                      <button
                                        type="button"
                                        className={
                                          styles.dangerSmallButton
                                        }
                                        disabled={
                                          Boolean(
                                            busyKey
                                          )
                                        }
                                        onClick={
                                          () =>
                                            void handleDelete(
                                              category
                                            )
                                        }
                                      >
                                        삭제
                                      </button>
                                    </div>
                                  </>
                                )
                            }
                          </li>
                        );
                      }
                    )
                  }
                </ul>
              )
        }

        <details
          className={
            styles.deletedSection
          }
        >
          <summary>
            삭제된 {selectedType} 카테고리

            <span>
              {
                deletedItems.length
              }
            </span>
          </summary>

          {
            deletedItems.length ===
            0
              ? (
                <p
                  className={
                    styles.emptyState
                  }
                >
                  삭제된 카테고리가 없습니다.
                </p>
              )
              : (
                <ul
                  className={
                    styles.itemList
                  }
                >
                  {
                    deletedItems.map(
                      category => (
                        <li
                          key={
                            category.categoryId
                          }
                          className={
                            styles.deletedRow
                          }
                        >
                          <span>
                            {
                              category.name
                            }
                          </span>

                          <button
                            type="button"
                            className={
                              styles.restoreButton
                            }
                            disabled={
                              Boolean(
                                busyKey
                              )
                            }
                            onClick={
                              () =>
                                void runMutation(
                                  `restore:${category.categoryId}`,

                                  () =>
                                    restoreManagedCategory(
                                      category.categoryId
                                    ),

                                  "카테고리를 복원했습니다."
                                )
                            }
                          >
                            {
                              busyKey ===
                              `restore:${category.categoryId}`
                                ? "복원 중..."
                                : "복원"
                            }
                          </button>
                        </li>
                      )
                    )
                  }
                </ul>
              )
          }
        </details>
      </section>
    </div>
  );
}


function AccountSettings() {
  const [
    accounts,
    setAccounts
  ] =
    useState<
      ManagedAccount[]
    >(
      []
    );

  const [
    form,
    setForm
  ] =
    useState<AccountFormState>(
      createEmptyAccountForm
    );

  const [
    editingId,
    setEditingId
  ] =
    useState<
      string |
      null
    >(
      null
    );

  const [
    showForm,
    setShowForm
  ] =
    useState(false);

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    busyKey,
    setBusyKey
  ] =
    useState("");

  const [
    error,
    setError
  ] =
    useState("");

  const [
    feedback,
    setFeedback
  ] =
    useState("");

  const [
    ownerTab,
    setOwnerTab
  ] =
    useState<AccountOwnerTab>(
      "미영"
    );


  async function refresh() {
    const result =
      await getManagedAccounts({
        includeDeleted:
          true
      });

    setAccounts(
      result.items
    );
  }


  useEffect(
    () => {
      let active =
        true;

      async function load() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const result =
            await getManagedAccounts({
              includeDeleted:
                true
            });

          if (
            active
          ) {
            setAccounts(
              result.items
            );
          }
        } catch (
          loadError
        ) {
          if (
            active
          ) {
            setError(
              getErrorMessage(
                loadError,
                "계좌를 불러오지 못했습니다."
              )
            );
          }
        } finally {
          if (
            active
          ) {
            setLoading(
              false
            );
          }
        }
      }

      void load();

      return () => {
        active =
          false;
      };
    },
    []
  );


  const allActiveAccounts =
    useMemo(
      () =>
        accounts.filter(
          account =>
            !account.isDeleted
        ),
      [
        accounts
      ]
    );


  const activeAccounts =
    useMemo(
      () =>
        allActiveAccounts.filter(
          account =>
            account.owner ===
            ownerTab
        ),
      [
        allActiveAccounts,
        ownerTab
      ]
    );


  const deletedAccounts =
    useMemo(
      () =>
        accounts.filter(
          account =>
            account.isDeleted &&
            account.owner ===
              ownerTab
        ),
      [
        accounts,
        ownerTab
      ]
    );


  const ownerOptions =
    useMemo(
      () =>
        Array.from(
          new Set([
            ...FIXED_OWNERS,

            ...accounts
              .map(
                account =>
                  account.owner
              )
              .filter(
                Boolean
              )
          ])
        ),
      [
        accounts
      ]
    );


  const paymentAccountOptions =
    useMemo(
      () =>
        allActiveAccounts.filter(
          account => {
            if (
              account.accountId ===
              editingId
            ) {
              return false;
            }

            return ![
              "체크카드",
              "신용카드",
              "주식",
              "대출"
            ].some(
              keyword =>
                account.subType.includes(
                  keyword
                )
            );
          }
        ),
      [
        allActiveAccounts,
        editingId
      ]
    );


  const isCard =
    form.subType ===
      "체크카드" ||
    form.subType ===
      "신용카드";


  function updateForm<
    K extends
      keyof AccountFormState
  >(
    key: K,
    value:
      AccountFormState[K]
  ) {
    setForm(
      current => ({
        ...current,
        [key]: value
      })
    );
  }


  function beginCreate() {
    setEditingId(
      null
    );

    setForm(
      createEmptyAccountForm(
        ownerTab
      )
    );

    setShowForm(
      true
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );
  }


  function beginEdit(
    account:
      ManagedAccount
  ) {
    setEditingId(
      account.accountId
    );

    setForm(
      accountToForm(
        account
      )
    );

    setShowForm(
      true
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );
  }


  function closeForm() {
    setEditingId(
      null
    );

    setForm(
      createEmptyAccountForm(
        ownerTab
      )
    );

    setShowForm(
      false
    );
  }


  async function runMutation(
    key: string,
    work:
      () =>
        Promise<unknown>,
    successMessage:
      string
  ) {
    if (
      busyKey
    ) {
      return false;
    }

    setBusyKey(
      key
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      await work();
      await refresh();

      setFeedback(
        successMessage
      );

      return true;
    } catch (
      mutationError
    ) {
      setError(
        getErrorMessage(
          mutationError,
          "계좌를 처리하지 못했습니다."
        )
      );

      return false;
    } finally {
      setBusyKey(
        ""
      );
    }
  }


  async function handleSave() {
    let payload:
      SaveAccountInput;

    try {
      payload =
        buildAccountPayload(
          form
        );
    } catch (
      validationError
    ) {
      setError(
        getErrorMessage(
          validationError,
          "입력값을 확인해주세요."
        )
      );

      return;
    }

    const completed =
      editingId
        ? await runMutation(
            `save:${editingId}`,

            () =>
              updateManagedAccount({
                accountId:
                  editingId,

                ...payload
              }),

            "계좌 정보를 수정했습니다."
          )
        : await runMutation(
            "create",

            () =>
              createManagedAccount(
                payload
              ),

            "새 계좌를 추가했습니다."
          );

    if (
      completed
    ) {
      closeForm();
    }
  }


  async function handleDelete(
    account:
      ManagedAccount
  ) {
    if (
      !window.confirm(
        `‘${account.displayName}’ 계좌를 삭제할까요?\n\n거래나 카드 결제계좌로 사용 중이면 삭제되지 않습니다. 그 경우 사용 종료 연도를 설정해주세요.`
      )
    ) {
      return;
    }

    await runMutation(
      `delete:${account.accountId}`,

      () =>
        deleteManagedAccount(
          account.accountId
        ),

      "계좌를 삭제했습니다."
    );
  }


  return (
    <div
      className={
        styles.settingsBody
      }
    >
      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.segmentedControl
          }
        >
          {
            ACCOUNT_OWNER_TABS.map(
              owner => (
                <button
                  type="button"
                  key={
                    owner
                  }
                  className={
                    ownerTab ===
                    owner
                      ? styles.segmentButtonActive
                      : styles.segmentButton
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onClick={
                    () => {
                      setOwnerTab(
                        owner
                      );

                      setEditingId(
                        null
                      );

                      setShowForm(
                        false
                      );

                      setForm(
                        createEmptyAccountForm(
                          owner
                        )
                      );

                      setError(
                        ""
                      );

                      setFeedback(
                        ""
                      );
                    }
                  }
                >
                  {
                    owner
                  }
                  {
                    " "
                  }
                  {
                    accounts.filter(
                      account =>
                        !account.isDeleted &&
                        account.owner ===
                          owner
                    ).length
                  }
                </button>
              )
            )
          }
        </div>
      </section>

      <div
        className={
          styles.topActionRow
        }
      >
        <p>
          과거 거래가 있는 계좌는
          삭제 대신 사용 종료 연도를 설정하세요.
        </p>

        <button
          type="button"
          className={
            styles.primaryButton
          }
          onClick={
            beginCreate
          }
        >
          {ownerTab} 계좌 추가
        </button>
      </div>

      {
        showForm && (
          <section
            className={
              styles.formCard
            }
          >
            <div
              className={
                styles.formHeader
              }
            >
              <div>
                <h2>
                  {
                    editingId
                      ? "계좌 수정"
                      : "새 계좌 추가"
                  }
                </h2>

                <p>
                  카드는 결제계좌를 반드시 연결해야 합니다.
                </p>
              </div>

              <button
                type="button"
                className={
                  styles.closeButton
                }
                aria-label="입력창 닫기"
                disabled={
                  Boolean(
                    busyKey
                  )
                }
                onClick={
                  closeForm
                }
              >
                ×
              </button>
            </div>

            <datalist
              id="account-type-suggestions"
            >
              {
                ACCOUNT_TYPE_SUGGESTIONS.map(
                  value => (
                    <option
                      key={
                        value
                      }
                      value={
                        value
                      }
                    />
                  )
                )
              }
            </datalist>

            <datalist
              id="account-subtype-suggestions"
            >
              {
                ACCOUNT_SUBTYPE_SUGGESTIONS.map(
                  value => (
                    <option
                      key={
                        value
                      }
                      value={
                        value
                      }
                    />
                  )
                )
              }
            </datalist>

            <div
              className={
                styles.formGrid
              }
            >
              <label
                className={
                  styles.field
                }
              >
                <span>
                  계좌·카드 이름
                </span>

                <input
                  type="text"
                  value={
                    form.accountName
                  }
                  maxLength={
                    60
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "accountName",
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
                <span>
                  명의자
                </span>

                <select
                  value={
                    form.owner
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event => {
                      const owner =
                        event
                          .target
                          .value;

                      setForm(
                        current => ({
                          ...current,

                          owner,

                          assetAttribution:
                            current.assetAttribution ===
                            current.owner
                              ? owner
                              : current.assetAttribution
                        })
                      );
                    }
                  }
                >
                  {
                    ownerOptions.map(
                      owner => (
                        <option
                          key={
                            owner
                          }
                          value={
                            owner
                          }
                        >
                          {owner}
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
                <span>
                  계좌 유형
                </span>

                <input
                  type="text"
                  list="account-type-suggestions"
                  value={
                    form.accountType
                  }
                  maxLength={
                    30
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "accountType",
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
                <span>
                  세부 구분
                </span>

                <input
                  type="text"
                  list="account-subtype-suggestions"
                  value={
                    form.subType
                  }
                  maxLength={
                    40
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      setForm(
                        current => ({
                          ...current,

                          subType:
                            event.target.value,

                          paymentAccountId:
                            event.target.value ===
                              "체크카드" ||
                            event.target.value ===
                              "신용카드"
                              ? current.paymentAccountId
                              : ""
                        })
                      )
                  }
                />
              </label>

              <label
                className={
                  styles.field
                }
              >
                <span>
                  시작 잔액
                </span>

                <input
                  type="number"
                  inputMode="numeric"
                  value={
                    form.openingBalance
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "openingBalance",
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
                <span>
                  자산 귀속
                </span>

                <select
                  value={
                    form.assetAttribution
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "assetAttribution",
                        event.target.value
                      )
                  }
                >
                  {
                    ownerOptions.map(
                      owner => (
                        <option
                          key={
                            owner
                          }
                          value={
                            owner
                          }
                        >
                          {owner}
                        </option>
                      )
                    )
                  }
                </select>
              </label>

              {
                isCard && (
                  <label
                    className={`${styles.field} ${styles.fullField}`}
                  >
                    <span>
                      카드 결제계좌
                    </span>

                    <select
                      value={
                        form.paymentAccountId
                      }
                      disabled={
                        Boolean(
                          busyKey
                        )
                      }
                      onChange={
                        event =>
                          updateForm(
                            "paymentAccountId",
                            event.target.value
                          )
                      }
                    >
                      <option
                        value=""
                      >
                        선택해주세요
                      </option>

                      {
                        paymentAccountOptions.map(
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
                                account.displayName
                              }
                            </option>
                          )
                        )
                      }
                    </select>
                  </label>
                )
              }

              {
                form.subType ===
                "신용카드" && (
                  <>
                    <label
                      className={
                        styles.field
                      }
                    >
                      <span>
                        청구 마감일
                      </span>

                      <input
                        type="number"
                        inputMode="numeric"
                        min={
                          1
                        }
                        max={
                          31
                        }
                        value={
                          form.billingCutoffDay
                        }
                        placeholder="1~31"
                        disabled={
                          Boolean(
                            busyKey
                          )
                        }
                        onChange={
                          event =>
                            updateForm(
                              "billingCutoffDay",
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
                      <span>
                        결제일
                      </span>

                      <input
                        type="number"
                        inputMode="numeric"
                        min={
                          1
                        }
                        max={
                          31
                        }
                        value={
                          form.paymentDay
                        }
                        placeholder="1~31"
                        disabled={
                          Boolean(
                            busyKey
                          )
                        }
                        onChange={
                          event =>
                            updateForm(
                              "paymentDay",
                              event.target.value
                            )
                        }
                      />
                    </label>
                  </>
                )
              }

              <label
                className={
                  styles.field
                }
              >
                <span>
                  사용 시작 연도
                </span>

                <input
                  type="number"
                  inputMode="numeric"
                  min={
                    1900
                  }
                  max={
                    2200
                  }
                  value={
                    form.startYear
                  }
                  placeholder="선택 입력"
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "startYear",
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
                <span>
                  사용 종료 연도
                </span>

                <input
                  type="number"
                  inputMode="numeric"
                  min={
                    1900
                  }
                  max={
                    2200
                  }
                  value={
                    form.endYear
                  }
                  placeholder="사용 중이면 비워두기"
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "endYear",
                        event.target.value
                      )
                  }
                />
              </label>

              <label
                className={`${styles.field} ${styles.fullField}`}
              >
                <span>
                  잔액 계산 방식
                </span>

                <select
                  value={
                    form.balanceMethod
                  }
                  disabled={
                    Boolean(
                      busyKey
                    )
                  }
                  onChange={
                    event =>
                      updateForm(
                        "balanceMethod",
                        event.target.value
                      )
                  }
                >
                  <option
                    value="자동계산"
                  >
                    자동계산
                  </option>

                  <option
                    value="평가입력"
                  >
                    평가입력
                  </option>
                </select>
              </label>
            </div>

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

            <div
              className={
                styles.formActions
              }
            >
              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                disabled={
                  Boolean(
                    busyKey
                  )
                }
                onClick={
                  closeForm
                }
              >
                취소
              </button>

              <button
                type="button"
                className={
                  styles.primaryButton
                }
                disabled={
                  Boolean(
                    busyKey
                  )
                }
                onClick={
                  () =>
                    void handleSave()
                }
              >
                {
                  busyKey
                    ? "저장 중..."
                    : editingId
                      ? "수정 저장"
                      : "계좌 추가"
                }
              </button>
            </div>
          </section>
        )
      }

      {
        !showForm &&
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
        feedback && (
          <p
            className={
              styles.feedback
            }
            role="status"
          >
            {feedback}
          </p>
        )
      }

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            {ownerTab} 계좌·카드
          </h2>

          <p>
            입력 화면 노출 여부와 순서는
            ‘입력 화면 설정’에서 바꿉니다.
          </p>
        </div>

        {
          loading
            ? (
              <p
                className={
                  styles.state
                }
              >
                계좌를 불러오는 중입니다.
              </p>
            )
            : activeAccounts.length ===
              0
              ? (
                <p
                  className={
                    styles.emptyState
                  }
                >
                  {ownerTab} 명의로 등록된 계좌가 없습니다.
                </p>
              )
              : (
                <ul
                  className={
                    styles.itemList
                  }
                >
                  {
                    activeAccounts.map(
                      account => (
                        <li
                          key={
                            account.accountId
                          }
                          className={`${styles.managementRow} ${
                            !account.active
                              ? styles.mutedRow
                              : ""
                          }`}
                        >
                          <span
                            className={
                              styles.itemTextGroup
                            }
                          >
                            <strong>
                              {
                                account.displayName
                              }
                            </strong>

                            <span>
                              {
                                [
                                  account.accountType,
                                  account.subType,
                                  account.owner
                                ]
                                  .filter(
                                    Boolean
                                  )
                                  .join(
                                    " · "
                                  )
                              }
                            </span>

                            <span>
                              현재 잔액 {
                                formatKrw(
                                  account.currentBalance
                                )
                              }

                              {
                                !account.active
                                  ? " · 사용 종료"
                                  : ""
                              }
                            </span>
                          </span>

                          <div
                            className={
                              styles.rowActions
                            }
                          >
                            <button
                              type="button"
                              className={
                                styles.secondarySmallButton
                              }
                              disabled={
                                Boolean(
                                  busyKey
                                )
                              }
                              onClick={
                                () =>
                                  beginEdit(
                                    account
                                  )
                              }
                            >
                              수정
                            </button>

                            <button
                              type="button"
                              className={
                                styles.dangerSmallButton
                              }
                              disabled={
                                Boolean(
                                  busyKey
                                )
                              }
                              onClick={
                                () =>
                                  void handleDelete(
                                    account
                                  )
                              }
                            >
                              {
                                busyKey ===
                                `delete:${account.accountId}`
                                  ? "처리 중..."
                                  : "삭제"
                              }
                            </button>
                          </div>
                        </li>
                      )
                    )
                  }
                </ul>
              )
        }

        <details
          className={
            styles.deletedSection
          }
        >
          <summary>
            삭제된 계좌·카드

            <span>
              {
                deletedAccounts.length
              }
            </span>
          </summary>

          {
            deletedAccounts.length ===
            0
              ? (
                <p
                  className={
                    styles.emptyState
                  }
                >
                  {ownerTab} 명의의 삭제된 계좌가 없습니다.
                </p>
              )
              : (
                <ul
                  className={
                    styles.itemList
                  }
                >
                  {
                    deletedAccounts.map(
                      account => (
                        <li
                          key={
                            account.accountId
                          }
                          className={
                            styles.deletedRow
                          }
                        >
                          <span>
                            {
                              account.displayName
                            }
                          </span>

                          <button
                            type="button"
                            className={
                              styles.restoreButton
                            }
                            disabled={
                              Boolean(
                                busyKey
                              )
                            }
                            onClick={
                              () =>
                                void runMutation(
                                  `restore:${account.accountId}`,

                                  () =>
                                    restoreManagedAccount(
                                      account.accountId
                                    ),

                                  "계좌를 복원했습니다."
                                )
                            }
                          >
                            {
                              busyKey ===
                              `restore:${account.accountId}`
                                ? "복원 중..."
                                : "복원"
                            }
                          </button>
                        </li>
                      )
                    )
                  }
                </ul>
              )
          }
        </details>
      </section>
    </div>
  );
}


function LedgerDataSettings() {
  const [
    ledgerStartDateValue,
    setLedgerStartDateValue
  ] =
    useState("");

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    busyKey,
    setBusyKey
  ] =
    useState("");

  const [
    error,
    setError
  ] =
    useState("");

  const [
    feedback,
    setFeedback
  ] =
    useState("");


  useEffect(
    () => {
      let active =
        true;

      async function load() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const result =
            await getLedgerConfig();

          if (
            active
          ) {
            setLedgerStartDateValue(
              result.ledgerStartDate ||
              ""
            );
          }
        } catch (
          loadError
        ) {
          if (
            active
          ) {
            setError(
              getErrorMessage(
                loadError,
                "가계부 설정을 불러오지 못했습니다."
              )
            );
          }
        } finally {
          if (
            active
          ) {
            setLoading(
              false
            );
          }
        }
      }

      void load();

      return () => {
        active =
          false;
      };
    },
    []
  );


  async function handleSaveStartDate() {
    if (
      !ledgerStartDateValue
    ) {
      setError(
        "가계부 시작일을 선택해주세요."
      );

      return;
    }

    setBusyKey(
      "start-date"
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      const result =
        await setLedgerStartDate(
          ledgerStartDateValue
        );

      setLedgerStartDateValue(
        result.ledgerStartDate ||
        ledgerStartDateValue
      );

      setFeedback(
        "가계부 시작일을 저장했습니다."
      );
    } catch (
      saveError
    ) {
      setError(
        getErrorMessage(
          saveError,
          "가계부 시작일을 저장하지 못했습니다."
        )
      );
    } finally {
      setBusyKey(
        ""
      );
    }
  }


  async function handleClearStartDate() {
    if (
      !window.confirm(
        "가계부 시작일 제한을 해제할까요?"
      )
    ) {
      return;
    }

    setBusyKey(
      "clear-date"
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      await clearLedgerStartDate();

      setLedgerStartDateValue(
        ""
      );

      setFeedback(
        "가계부 시작일 제한을 해제했습니다."
      );
    } catch (
      clearError
    ) {
      setError(
        getErrorMessage(
          clearError,
          "가계부 시작일을 해제하지 못했습니다."
        )
      );
    } finally {
      setBusyKey(
        ""
      );
    }
  }


  async function handleExport() {
    setBusyKey(
      "export"
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      const items:
        Transaction[] = [];

      let offset =
        0;

      const limit =
        1000;

      let total =
        0;

      do {
        const response =
          await getTransactions({
            limit,
            offset
          });

        total =
          response.data.total;

        items.push(
          ...response
            .data
            .items
        );

        offset +=
          response
            .data
            .items
            .length;

        if (
          response
            .data
            .items
            .length ===
          0
        ) {
          break;
        }
      } while (
        offset <
        total
      );

      const headers = [
        "거래ID",
        "날짜",
        "유형",
        "카테고리",
        "금액",
        "출금계좌",
        "입금계좌",
        "결제수단",
        "지출대상",
        "메모",
        "청구월",
        "입력자",
        "수정자",
        "입력시각",
        "수정시각"
      ];

      const rows =
        items.map(
          transaction => [
            transaction.transactionId,
            transaction.date,
            transaction.type,
            transaction.category,
            transaction.amount,
            transaction.fromAccount ||
              "",
            transaction.toAccount ||
              "",
            transaction.paymentMethod ||
              "",
            transaction.spendingTarget ||
              "",
            transaction.memo,
            transaction.billingMonth ||
              "",
            transaction.createdBy,
            transaction.updatedBy,
            transaction.createdAt ||
              "",
            transaction.updatedAt ||
              ""
          ]
        );

      const csv =
        [
          headers,
          ...rows
        ]
          .map(
            row =>
              row
                .map(
                  csvCell
                )
                .join(
                  ","
                )
          )
          .join(
            "\r\n"
          );

      const blob =
        new Blob(
          [
            "\uFEFF",
            csv
          ],
          {
            type:
              "text/csv;charset=utf-8"
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const link =
        document.createElement(
          "a"
        );

      const today =
        new Date()
          .toISOString()
          .slice(
            0,
            10
          );

      link.href =
        url;

      link.download =
        `우리_가계부_거래_${today}.csv`;

      document.body.appendChild(
        link
      );

      link.click();
      link.remove();

      URL.revokeObjectURL(
        url
      );

      setFeedback(
        `거래 ${items.length.toLocaleString(
          "ko-KR"
        )}건을 내보냈습니다.`
      );
    } catch (
      exportError
    ) {
      setError(
        getErrorMessage(
          exportError,
          "거래를 내보내지 못했습니다."
        )
      );
    } finally {
      setBusyKey(
        ""
      );
    }
  }


  return (
    <div
      className={
        styles.settingsBody
      }
    >
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
        feedback && (
          <p
            className={
              styles.feedback
            }
            role="status"
          >
            {feedback}
          </p>
        )
      }

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            가계부 시작일
          </h2>

          <p>
            이 날짜보다 이전의 거래 입력을 막아
            실수를 방지합니다.
          </p>
        </div>

        {
          loading
            ? (
              <p
                className={
                  styles.state
                }
              >
                가계부 설정을 불러오는 중입니다.
              </p>
            )
            : (
              <div
                className={
                  styles.dateSettingRow
                }
              >
                <label
                  className={
                    styles.field
                  }
                >
                  <span>
                    시작일
                  </span>

                  <input
                    type="date"
                    value={
                      ledgerStartDateValue
                    }
                    disabled={
                      Boolean(
                        busyKey
                      )
                    }
                    onChange={
                      event =>
                        setLedgerStartDateValue(
                          event.target.value
                        )
                    }
                  />
                </label>

                <div
                  className={
                    styles.rowActions
                  }
                >
                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    disabled={
                      Boolean(
                        busyKey
                      ) ||
                      !ledgerStartDateValue
                    }
                    onClick={
                      () =>
                        void handleClearStartDate()
                    }
                  >
                    제한 해제
                  </button>

                  <button
                    type="button"
                    className={
                      styles.primaryButton
                    }
                    disabled={
                      Boolean(
                        busyKey
                      ) ||
                      !ledgerStartDateValue
                    }
                    onClick={
                      () =>
                        void handleSaveStartDate()
                    }
                  >
                    {
                      busyKey ===
                      "start-date"
                        ? "저장 중..."
                        : "시작일 저장"
                    }
                  </button>
                </div>
              </div>
            )
        }
      </section>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            거래 데이터 내보내기
          </h2>

          <p>
            현재 저장된 거래를 엑셀에서도 열 수 있는
            CSV 파일로 받습니다.
          </p>
        </div>

        <button
          type="button"
          className={
            styles.fullWidthButton
          }
          disabled={
            Boolean(
              busyKey
            )
          }
          onClick={
            () =>
              void handleExport()
          }
        >
          {
            busyKey ===
            "export"
              ? "내보내는 중..."
              : "전체 거래 CSV로 내보내기"
          }
        </button>
      </section>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            앱 데이터 다시 불러오기
          </h2>

          <p>
            다른 계정에서 바꾼 내용이 보이지 않을 때
            최신 데이터를 다시 읽습니다.
          </p>
        </div>

        <button
          type="button"
          className={
            styles.fullWidthButton
          }
          disabled={
            Boolean(
              busyKey
            )
          }
          onClick={
            () =>
              window.location.reload()
          }
        >
          최신 데이터 다시 불러오기
        </button>
      </section>
    </div>
  );
}


function ProfileSettings() {
  const [
    userName,
    setUserName
  ] =
    useState("");

  const [
    loading,
    setLoading
  ] =
    useState(true);

  const [
    loggingOut,
    setLoggingOut
  ] =
    useState(false);


  useEffect(
    () => {
      let active =
        true;

      async function loadSession() {
        try {
          const session =
            await getSession();

          if (
            active &&
            session.loggedIn &&
            session.user
          ) {
            setUserName(
              session.user.name
            );
          }
        } finally {
          if (
            active
          ) {
            setLoading(
              false
            );
          }
        }
      }

      void loadSession();

      return () => {
        active =
          false;
      };
    },
    []
  );


  async function handleLogout() {
    if (
      !window.confirm(
        "로그아웃할까요?"
      )
    ) {
      return;
    }

    setLoggingOut(
      true
    );

    try {
      await logout();

      window.location.reload();
    } finally {
      setLoggingOut(
        false
      );
    }
  }


  return (
    <div
      className={
        styles.settingsBody
      }
    >
      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.profileRow
          }
        >
          <span
            className={
              styles.avatar
            }
            aria-hidden="true"
          >
            {
              (
                userName ||
                "내"
              ).slice(
                0,
                1
              )
            }
          </span>

          <span
            className={
              styles.itemTextGroup
            }
          >
            <strong>
              {
                loading
                  ? "확인 중..."
                  : userName ||
                    "로그인 사용자"
              }
            </strong>

            <span>
              현재 로그인한 사용자
            </span>
          </span>
        </div>
      </section>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            우리 가계부
          </h2>

          <p>
            미영·승철 두 사람이 함께 사용하는
            부부 공유 가계부입니다.
          </p>
        </div>

        <dl
          className={
            styles.infoList
          }
        >
          <div>
            <dt>
              로그인 유지
            </dt>

            <dd>
              접속할 때마다 최대 400일로 연장
            </dd>
          </div>

          <div>
            <dt>
              원본 데이터
            </dt>

            <dd>
              Google Sheets
            </dd>
          </div>

          <div>
            <dt>
              설정 공유
            </dt>

            <dd>
              부부 공통 설정은 두 계정에 동일 적용
            </dd>
          </div>
        </dl>
      </section>

      <button
        type="button"
        className={
          styles.logoutButton
        }
        disabled={
          loggingOut
        }
        onClick={
          () =>
            void handleLogout()
        }
      >
        {
          loggingOut
            ? "로그아웃 중..."
            : "로그아웃"
        }
      </button>
    </div>
  );
}


export default function SettingsPage() {
  const [
    view,
    setView
  ] =
    useState<SettingsView>(
      "home"
    );


  const detail = {
    input: {
      title:
        "입력 화면 설정",

      description:
        "자주 쓰는 항목의 순서와 노출 여부를 정합니다."
    },

    categories: {
      title:
        "카테고리 관리",

      description:
        "수입·지출·이체 카테고리를 직접 관리합니다."
    },

    accounts: {
      title:
        "계좌·카드 관리",

      description:
        "계좌와 카드의 정보와 사용 기간을 관리합니다."
    },

    ledger: {
      title:
        "가계부 운영·데이터",

      description:
        "운영 기준과 데이터 내보내기를 관리합니다."
    },

    profile: {
      title:
        "내 계정·앱 정보",

      description:
        "현재 로그인 정보와 앱의 저장 방식을 확인합니다."
    }
  } as const;


  return (
    <main
      className={
        styles.page
      }
    >
      {
        view ===
        "home"
          ? (
            <SettingsHome
              onOpen={
                setView
              }
            />
          )
          : (
            <>
              <DetailHeader
                title={
                  detail[
                    view
                  ].title
                }
                description={
                  detail[
                    view
                  ].description
                }
                onBack={
                  () =>
                    setView(
                      "home"
                    )
                }
              />

              {
                view ===
                "input" && (
                  <InputSettings />
                )
              }

              {
                view ===
                "categories" && (
                  <CategorySettings />
                )
              }

              {
                view ===
                "accounts" && (
                  <AccountSettings />
                )
              }

              {
                view ===
                "ledger" && (
                  <LedgerDataSettings />
                )
              }

              {
                view ===
                "profile" && (
                  <ProfileSettings />
                )
              }
            </>
          )
      }
    </main>
  );
}
