import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  apiRequest
} from "../../api/client";

import {
  applyCategoryPreferences,
  createDefaultInputPreferences,
  getInputPreferences,
  resetInputPreferences,
  saveInputPreferences,
  sortAccountsByPreferences
} from "../../utils/inputPreferences";

import type {
  InputPreferences,
  PreferenceTransactionType
} from "../../utils/inputPreferences";

import styles
  from "./SettingsPage.module.css";


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

  type:
    PreferenceTransactionType;

  name: string;
}


interface BootstrapData {
  transactionTypes:
    PreferenceTransactionType[];

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


const CATEGORY_TYPES:
  PreferenceTransactionType[] = [
    "지출",
    "수입",
    "이체"
  ];


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

  const currentValue =
    next[index];

  next[index] =
    next[nextIndex];

  next[nextIndex] =
    currentValue;

  return next;
}


function getAccountName(
  account: Account
) {
  return (
    account.displayName ||
    account.accountName ||
    account.accountId
  );
}


export default function SettingsPage() {
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
    useState<
      PreferenceTransactionType
    >(
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

          setBootstrap(
            data
          );

          setPreferences(
            getInputPreferences(
              data.categories,
              data.accounts
            )
          );
        } catch (
          loadError
        ) {
          if (!active) {
            return;
          }

          setError(
            loadError instanceof Error
              ? loadError.message
              : "설정 정보를 불러오지 못했습니다."
          );
        } finally {
          if (active) {
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
        preferences,
        categoryType
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


  function handleMoveCategory(
    index: number,
    direction: -1 | 1
  ) {
    if (!preferences) {
      return;
    }

    const currentOrder =
      preferences
        .categoryOrder[
          categoryType
        ];

    setPreferences({
      ...preferences,

      categoryOrder: {
        ...preferences
          .categoryOrder,

        [categoryType]:
          moveItem(
            currentOrder,
            index,
            direction
          )
      }
    });

    setFeedback(
      ""
    );
  }


  function handleMoveAccount(
    index: number,
    direction: -1 | 1
  ) {
    if (!preferences) {
      return;
    }

    setPreferences({
      ...preferences,

      accountOrder:
        moveItem(
          preferences.accountOrder,
          index,
          direction
        )
    });

    setFeedback(
      ""
    );
  }


  function handleToggleAccount(
    accountId: string
  ) {
    if (!preferences) {
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

    setFeedback(
      ""
    );
  }


  function handleSave() {
    if (!preferences) {
      return;
    }

    saveInputPreferences(
      preferences
    );

    setFeedback(
      "입력 화면 설정을 저장했습니다."
    );
  }


  function handleReset() {
    if (!bootstrap) {
      return;
    }

    const next =
      resetInputPreferences(
        bootstrap.categories,
        bootstrap.accounts
      );

    setPreferences(
      next
    );

    setFeedback(
      "기본 설정으로 되돌렸습니다. 저장 버튼을 누르면 적용됩니다."
    );
  }


  if (loading) {
    return (
      <main
        className={
          styles.page
        }
      >
        <p
          className={
            styles.loading
          }
        >
          설정 정보를
          불러오는 중입니다.
        </p>
      </main>
    );
  }


  if (
    error ||
    !bootstrap ||
    !preferences
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <p
          className={
            styles.error
          }
          role="alert"
        >
          {
            error ||
            "설정 정보를 불러오지 못했습니다."
          }
        </p>
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
          설정
        </p>

        <h1
          className={
            styles.title
          }
        >
          입력 화면 설정
        </h1>

        <p
          className={
            styles.description
          }
        >
          자주 쓰는 카테고리와
          결제수단을 앞쪽에 두고,
          필요 없는 계좌는
          입력 화면에서 숨길 수 있습니다.
        </p>
      </header>


      <p
        className={
          styles.storageNotice
        }
      >
        현재 단계에서는 이 설정이
        사용 중인 브라우저에 저장됩니다.
        앱 전체 기능을 완성한 뒤
        마지막 통합 단계에서
        부부 공통 서버 설정으로
        전환할 예정입니다.
      </p>


      <section
        className={
          styles.section
        }
      >
        <div
          className={
            styles.sectionHeader
          }
        >
          <h2
            className={
              styles.sectionTitle
            }
          >
            카테고리 순서
          </h2>

          <p
            className={
              styles.sectionDescription
            }
          >
            입력 화면의 카테고리
            드롭다운에 표시되는
            순서를 정합니다.
          </p>
        </div>


        <div
          className={
            styles.typeTabs
          }
        >
          {CATEGORY_TYPES.map(
            type => (
              <button
                type="button"
                key={
                  type
                }
                className={[
                  styles
                    .typeButton,

                  categoryType ===
                  type
                    ? styles
                        .typeButtonActive
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
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
          )}
        </div>


        {categoryItems.length ===
          0 && (
          <p
            className={
              styles.emptyState
            }
          >
            표시할 카테고리가
            없습니다.
          </p>
        )}


        {categoryItems.length >
          0 && (
          <ul
            className={
              styles.list
            }
          >
            {categoryItems.map(
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
                    styles.row
                  }
                >
                  <span
                    className={
                      styles.orderNumber
                    }
                  >
                    {
                      index + 1
                    }
                  </span>

                  <div
                    className={
                      styles.itemInfo
                    }
                  >
                    <span
                      className={
                        styles.itemName
                      }
                    >
                      {
                        category.name
                      }
                    </span>

                    <span
                      className={
                        styles.itemMeta
                      }
                    >
                      {
                        category.type
                      }
                    </span>
                  </div>

                  <div
                    className={
                      styles.controls
                    }
                  >
                    <button
                      type="button"
                      className={
                        styles
                          .moveButton
                      }
                      aria-label={`${category.name} 위로 이동`}
                      disabled={
                        index === 0
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
                        styles
                          .moveButton
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
            )}
          </ul>
        )}
      </section>


      <section
        className={
          styles.section
        }
      >
        <div
          className={
            styles.sectionHeader
          }
        >
          <h2
            className={
              styles.sectionTitle
            }
          >
            결제수단·계좌
          </h2>

          <p
            className={
              styles.sectionDescription
            }
          >
            입력 화면에 표시할
            계좌를 선택하고
            순서를 정합니다.
            주식·대출·예적금 계좌는
            기본적으로 숨김 처리됩니다.
          </p>
        </div>


        {accountItems.length ===
          0 && (
          <p
            className={
              styles.emptyState
            }
          >
            등록된 계좌가 없습니다.
          </p>
        )}


        {accountItems.length >
          0 && (
          <ul
            className={
              styles.list
            }
          >
            {accountItems.map(
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
                    className={[
                      styles.row,

                      hidden
                        ? styles
                            .rowHidden
                        : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span
                      className={
                        styles.orderNumber
                      }
                    >
                      {
                        index + 1
                      }
                    </span>

                    <div
                      className={
                        styles.itemInfo
                      }
                    >
                      <span
                        className={
                          styles.itemName
                        }
                      >
                        {
                          getAccountName(
                            account
                          )
                        }
                      </span>

                      <span
                        className={
                          styles.itemMeta
                        }
                      >
                        {
                          [
                            account
                              .accountType,
                            account
                              .subType
                          ]
                            .filter(
                              Boolean
                            )
                            .join(
                              " · "
                            )
                        }
                      </span>
                    </div>

                    <div
                      className={
                        styles.controls
                      }
                    >
                      <button
                        type="button"
                        className={[
                          styles
                            .visibilityButton,

                          !hidden
                            ? styles
                                .visibilityButtonVisible
                            : ""
                        ]
                          .filter(
                            Boolean
                          )
                          .join(" ")}
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
                          styles
                            .moveButton
                        }
                        aria-label={`${getAccountName(
                          account
                        )} 위로 이동`}
                        disabled={
                          index === 0
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
                          styles
                            .moveButton
                        }
                        aria-label={`${getAccountName(
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
            )}
          </ul>
        )}
      </section>


      {feedback && (
        <p
          className={
            styles.feedback
          }
          role="status"
        >
          {feedback}
        </p>
      )}


      <div
        className={
          styles.actionArea
        }
      >
        <button
          type="button"
          className={
            styles.resetButton
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
            styles.saveButton
          }
          onClick={
            handleSave
          }
        >
          설정 저장
        </button>
      </div>
    </main>
  );
}
