import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  getDashboard,
  getDashboardSnapshot,
  invalidateDashboardCache
} from "../../api/dashboard";

import type {
  DashboardData
} from "../../types/dashboard";

import {
  clearLedgerDirty,
  isLedgerDirty,
  subscribeLedgerChanges
} from "../../utils/ledgerEvents";

import styles
  from "./HomePage.module.css";


interface DashboardSummary {
  assets: number;
  liabilities: number;
  netWorth: number;
  investmentValue: number;
  cashLikeValue: number;
  monthIncome: number;
  monthExpense: number;
  monthNetCashFlow: number;
}


interface DashboardAccount {
  accountId: string;
  displayName: string;
  paymentDay: number | null;
}


interface DashboardCard {
  accountId: string;
  accountName: string;
  billingMonth: string;
  usage: number;
  payments: number;
  estimatedRemaining: number;
}


interface DashboardCardView
  extends DashboardCard {
  name: string;
  paymentDay: number | null;
}


interface SpendingSummary {
  name: string;
  amount: number;
}


type HomePageProps =
  Record<string, unknown>;


function formatWon(
  value: number
) {
  const safeValue =
    Number.isFinite(
      value
    )
      ? value
      : 0;

  return (
    new Intl.NumberFormat(
      "ko-KR"
    ).format(
      Math.round(
        Math.abs(
          safeValue
        )
      )
    ) +
    "원"
  );
}


function formatSignedWon(
  value: number
) {
  const safeValue =
    Number.isFinite(
      value
    )
      ? value
      : 0;

  if (
    safeValue > 0
  ) {
    return (
      "+" +
      formatWon(
        safeValue
      )
    );
  }

  if (
    safeValue < 0
  ) {
    return (
      "-" +
      formatWon(
        safeValue
      )
    );
  }

  return "0원";
}


function formatMonth(
  month: string
) {
  const match =
    /^(\d{4})-(\d{2})$/
      .exec(
        month
      );

  if (
    !match
  ) {
    return month;
  }

  return (
    `${match[1]}년 ` +
    `${Number(
      match[2]
    )}월`
  );
}


export default function HomePage(
  _props: HomePageProps
) {
  const [
    needsInitialRefresh
  ] =
    useState(
      () =>
        isLedgerDirty()
    );


  const [
    initialDashboard
  ] =
    useState<
      DashboardData | null
    >(
      () =>
        needsInitialRefresh
          ? null
          : getDashboardSnapshot()
    );


  const [
    dashboard,
    setDashboard
  ] =
    useState<
      DashboardData | null
    >(
      initialDashboard
    );


  const [
    loading,
    setLoading
  ] =
    useState(
      needsInitialRefresh ||
      initialDashboard ===
        null
    );


  const [
    errorMessage,
    setErrorMessage
  ] =
    useState(
      ""
    );


  const [
    refreshing,
    setRefreshing
  ] =
    useState(
      false
    );


  async function loadDashboard() {
    const cachedDashboard =
      getDashboardSnapshot();

    if (
      cachedDashboard
    ) {
      setDashboard(
        cachedDashboard
      );

      setLoading(
        false
      );

    } else {
      setLoading(
        true
      );
    }

    setErrorMessage(
      ""
    );

    try {
      const data =
        await getDashboard();

      setDashboard(
        data
      );

      clearLedgerDirty();

    } catch (
      error
    ) {
      const fallback =
        getDashboardSnapshot();

      if (
        fallback
      ) {
        setDashboard(
          fallback
        );

      } else {
        setDashboard(
          null
        );

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "가계부 데이터를 불러오지 못했습니다."
        );
      }

    } finally {
      setLoading(
        false
      );
    }
  }


  async function handleManualRefresh() {
    if (
      refreshing
    ) {
      return;
    }

    setRefreshing(
      true
    );

    try {
      const data =
        await getDashboard(
          undefined,
          {
            forceRefresh:
              true
          }
        );

      setDashboard(
        data
      );

      clearLedgerDirty();

      setErrorMessage(
        ""
      );

    } catch (
      error
    ) {
      if (
        !dashboard
      ) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "가계부 데이터를 불러오지 못했습니다."
        );

        return;
      }

      window.alert(
        error instanceof Error
          ? error.message
          : "새로고침에 실패했습니다."
      );

    } finally {
      setRefreshing(
        false
      );
    }
  }


  useEffect(
    () => {
      let cancelled =
        false;


      if (
        needsInitialRefresh
      ) {
        invalidateDashboardCache();
      }


      async function refreshDashboard(
        afterLedgerChange =
          false
      ) {
        const cachedDashboard =
          getDashboardSnapshot();

        if (
          !afterLedgerChange &&
          !needsInitialRefresh &&
          cachedDashboard
        ) {
          setDashboard(
            cachedDashboard
          );

          setLoading(
            false
          );
        }


        if (
          afterLedgerChange
        ) {
          invalidateDashboardCache();

          setLoading(
            true
          );
        }


        try {
          const data =
            await getDashboard();

          if (
            cancelled
          ) {
            return;
          }

          setDashboard(
            data
          );

          clearLedgerDirty();

          setErrorMessage(
            ""
          );

        } catch (
          error
        ) {
          if (
            cancelled
          ) {
            return;
          }

          const fallback =
            getDashboardSnapshot();

          if (
            fallback
          ) {
            setDashboard(
              fallback
            );

            return;
          }

          setDashboard(
            null
          );

          setErrorMessage(
            error instanceof Error
              ? error.message
              : "가계부 데이터를 불러오지 못했습니다."
          );

        } finally {
          if (
            !cancelled
          ) {
            setLoading(
              false
            );
          }
        }
      }


      void refreshDashboard();


      const unsubscribe =
        subscribeLedgerChanges(
          () => {
            if (
              cancelled
            ) {
              return;
            }

            void refreshDashboard(
              true
            );
          }
        );


      return () => {
        cancelled =
          true;

        unsubscribe();
      };
    },
    [
      needsInitialRefresh
    ]
  );


  const cardSummary =
    useMemo(
      () => {
        if (
          !dashboard
        ) {
          return {
            total: 0,

            cards: [] as
              DashboardCardView[]
          };
        }


        const accountMap =
          new Map(
            (
              Array.isArray(
                dashboard.accounts
              )
                ? dashboard.accounts
                : []
            )
              .map(
                account => [
                  account.accountId,
                  account
                ] as const
              )
          );


        const cards =
          (
            Array.isArray(
              dashboard.cards
            )
              ? dashboard.cards
              : []
          )
            .filter(
              card =>
                Number(
                  card.estimatedRemaining
                ) > 0
            )
            .map(
              card => {
                const account =
                  accountMap.get(
                    card.accountId
                  );

                return {
                  ...card,

                  name:
                    card.accountName ||
                    account?.displayName ||
                    "신용카드",

                  paymentDay:
                    account?.paymentDay ??
                    null
                };
              }
            )
            .sort(
              (
                first,
                second
              ) =>
                (
                  first.paymentDay ??
                  99
                ) -
                (
                  second.paymentDay ??
                  99
                )
            );


        return {
          total:
            cards.reduce(
              (
                sum,
                card
              ) =>
                sum +
                Number(
                  card.estimatedRemaining ||
                  0
                ),
              0
            ),

          cards
        };
      },
      [
        dashboard
      ]
    );


  const categoryExpense =
    useMemo(
      () =>
        (
          Array.isArray(
            dashboard
              ?.categoryExpense
          )
            ? dashboard
                ?.categoryExpense
            : []
        ) as
          SpendingSummary[],
      [
        dashboard
      ]
    );


  const spendingTargetExpense =
    useMemo(
      () =>
        (
          Array.isArray(
            dashboard
              ?.spendingTargetExpense
          )
            ? dashboard
                ?.spendingTargetExpense
            : []
        ) as
          SpendingSummary[],
      [
        dashboard
      ]
    );


  const hasDashboard =
    !!dashboard;


  const summary =
    dashboard?.summary;


  const monthIncome =
    Number(
      summary?.monthIncome ||
      0
    );


  const monthExpense =
    Number(
      summary?.monthExpense ||
      0
    );


  const monthNetCashFlow =
    Number(
      summary
        ?.monthNetCashFlow ||
      0
    );


  const assets =
    Number(
      summary?.assets ||
      0
    );


  const liabilities =
    Number(
      summary?.liabilities ||
      0
    );


  const netWorth =
    Number(
      summary?.netWorth ||
      0
    );


  if (
    loading &&
    !hasDashboard
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.loadingCard
          }
        >
          <strong>
            가계부를 불러오는 중입니다.
          </strong>

          <span>
            잠시만 기다려주세요.
          </span>
        </section>
      </main>
    );
  }


  if (
    errorMessage &&
    !hasDashboard
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.errorCard
          }
        >
          <strong>
            가계부를 불러오지 못했습니다.
          </strong>

          <span>
            {errorMessage}
          </span>

          <button
            type="button"
            className={
              styles.retryButton
            }
            onClick={
              () => {
                void loadDashboard();
              }
            }
          >
            다시 시도
          </button>
        </section>
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
        <div>
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
            {formatMonth(
              dashboard?.month ||
              ""
            )}
          </h1>
        </div>

        <button
          type="button"
          className={
            styles.refreshButton
          }
          disabled={
            refreshing
          }
          onClick={
            () => {
              void handleManualRefresh();
            }
          }
        >
          {
            refreshing
              ? "새로고침 중"
              : "새로고침"
          }
        </button>
      </header>


      <section
        className={
          styles.monthSummary
        }
      >
        <div
          className={
            styles.monthSummaryItem
          }
        >
          <span
            className={
              styles.summaryLabel
            }
          >
            수입
          </span>

          <strong
            className={
              styles.incomeValue
            }
          >
            {formatWon(
              monthIncome
            )}
          </strong>
        </div>

        <div
          className={
            styles.monthSummaryItem
          }
        >
          <span
            className={
              styles.summaryLabel
            }
          >
            지출
          </span>

          <strong
            className={
              styles.expenseValue
            }
          >
            {formatWon(
              monthExpense
            )}
          </strong>
        </div>

        <div
          className={
            styles.monthSummaryItem
          }
        >
          <span
            className={
              styles.summaryLabel
            }
          >
            차액
          </span>

          <strong
            className={
              monthNetCashFlow <
              0
                ? styles.negativeValue
                : styles.netValue
            }
          >
            {formatSignedWon(
              monthNetCashFlow
            )}
          </strong>
        </div>
      </section>


      <section
        className={
          styles.netWorthCard
        }
      >
        <div
          className={
            styles.netWorthMain
          }
        >
          <span
            className={
              styles.summaryLabel
            }
          >
            순자산
          </span>

          <strong
            className={
              netWorth <
              0
                ? styles
                    .negativeNetWorth
                : styles
                    .netWorthValue
            }
          >
            {formatSignedWon(
              netWorth
            )}
          </strong>
        </div>

        <div
          className={
            styles.netWorthSub
          }
        >
          <div>
            <span>
              자산
            </span>

            <strong>
              {formatWon(
                assets
              )}
            </strong>
          </div>

          <div>
            <span>
              부채
            </span>

            <strong>
              {formatWon(
                liabilities
              )}
            </strong>
          </div>
        </div>
      </section>


      <section
        className={
          styles.card
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <div>
            <p
              className={
                styles.sectionEyebrow
              }
            >
              카드
            </p>

            <h2
              className={
                styles.sectionTitle
              }
            >
              이번 달 청구 예정
            </h2>
          </div>

          <strong
            className={
              styles.sectionTotal
            }
          >
            {formatWon(
              cardSummary.total
            )}
          </strong>
        </div>


        {
          cardSummary.cards
            .length ===
          0
            ? (
              <p
                className={
                  styles.empty
                }
              >
                이번 달 청구 예정 금액이 없습니다.
              </p>
            )
            : (
              <ul
                className={
                  styles.cardList
                }
              >
                {
                  cardSummary.cards
                    .map(
                      card => (
                        <li
                          key={
                            card.accountId
                          }
                          className={
                            styles.cardRow
                          }
                        >
                          <div
                            className={
                              styles.cardInfo
                            }
                          >
                            <strong>
                              {card.name}
                            </strong>

                            <span>
                              {
                                card.paymentDay
                                  ? `${card.paymentDay}일 결제`
                                  : "결제일 미설정"
                              }
                            </span>
                          </div>

                          <strong
                            className={
                              styles.cardAmount
                            }
                          >
                            {formatWon(
                              Number(
                                card.estimatedRemaining ||
                                0
                              )
                            )}
                          </strong>
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
          styles.card
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <div>
            <p
              className={
                styles.sectionEyebrow
              }
            >
              지출
            </p>

            <h2
              className={
                styles.sectionTitle
              }
            >
              카테고리별 지출
            </h2>
          </div>
        </div>


        {
          categoryExpense.length ===
          0
            ? (
              <p
                className={
                  styles.empty
                }
              >
                이번 달 지출 내역이 없습니다.
              </p>
            )
            : (
              <ul
                className={
                  styles.summaryList
                }
              >
                {
                  categoryExpense.map(
                    item => (
                      <li
                        key={
                          item.name
                        }
                        className={
                          styles.summaryRow
                        }
                      >
                        <span>
                          {item.name}
                        </span>

                        <strong>
                          {formatWon(
                            Number(
                              item.amount ||
                              0
                            )
                          )}
                        </strong>
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
          styles.card
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <div>
            <p
              className={
                styles.sectionEyebrow
              }
            >
              지출대상
            </p>

            <h2
              className={
                styles.sectionTitle
              }
            >
              누구를 위한 지출인가요?
            </h2>
          </div>
        </div>


        {
          spendingTargetExpense
            .length ===
          0
            ? (
              <p
                className={
                  styles.empty
                }
              >
                이번 달 지출 내역이 없습니다.
              </p>
            )
            : (
              <ul
                className={
                  styles.summaryList
                }
              >
                {
                  spendingTargetExpense
                    .map(
                      item => (
                        <li
                          key={
                            item.name
                          }
                          className={
                            styles.summaryRow
                          }
                        >
                          <span>
                            {item.name}
                          </span>

                          <strong>
                            {formatWon(
                              Number(
                                item.amount ||
                                0
                              )
                            )}
                          </strong>
                        </li>
                      )
                    )
                }
              </ul>
            )
        }
      </section>
    </main>
  );
}
