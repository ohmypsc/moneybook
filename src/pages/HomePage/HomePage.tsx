import {
  useEffect,
  useMemo,
  useState
} from "react";

import styles from "./HomePage.module.css";


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


interface DashboardData {
  backendVersion: string;
  month: string;

  summary: DashboardSummary;

  accounts: DashboardAccount[];

  categoryExpense: SpendingSummary[];
  spendingTargetExpense: SpendingSummary[];

  cards: DashboardCard[];
}


interface DashboardResponse {
  success: boolean;
  apiVersion?: string;

  data?: DashboardData;

  error?: {
    code?: string;
    message?: string;
  };
}


let dashboardMemoryCache:
  DashboardData | null =
    null;


let dashboardRequest:
  Promise<DashboardData> | null =
    null;


async function requestDashboard() {
  if (
    dashboardRequest
  ) {
    return dashboardRequest;
  }


  dashboardRequest =
    (async () => {
      const response =
        await fetch(
          "/api/dashboard",
          {
            method:
              "GET",

            credentials:
              "same-origin",

            headers: {
              Accept:
                "application/json"
            }
          }
        );


      let body:
        DashboardResponse;


      try {
        body =
          await response
            .json() as
              DashboardResponse;

      } catch {
        throw new Error(
          "가계부 데이터를 읽지 못했습니다."
        );
      }


      if (
        !response.ok ||
        body.success !== true ||
        !body.data
      ) {
        throw new Error(
          body.error?.message ||
          "가계부 데이터를 불러오지 못했습니다."
        );
      }


      dashboardMemoryCache =
        body.data;


      return body.data;
    })();


  try {
    return await dashboardRequest;

  } finally {
    dashboardRequest =
      null;
  }
}


type HomePageProps =
  Record<string, unknown>;


function formatWon(
  value: number
) {
  const safeValue =
    Number.isFinite(value)
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
    Number.isFinite(value)
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
    `${Number(match[2])}월`
  );
}


export default function HomePage(
  _props: HomePageProps
) {
  const [
    dashboard,
    setDashboard
  ] =
    useState<DashboardData | null>(
      () =>
        dashboardMemoryCache
    );


  const [
    loading,
    setLoading
  ] =
    useState(
      dashboardMemoryCache ===
        null
    );


  const [
    errorMessage,
    setErrorMessage
  ] =
    useState("");


  async function loadDashboard() {
    const cachedDashboard =
      dashboardMemoryCache;


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
        await requestDashboard();


      setDashboard(
        data
      );

    } catch (
      error
    ) {
      if (
        dashboardMemoryCache
      ) {
        setDashboard(
          dashboardMemoryCache
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


  useEffect(
    () => {
      let cancelled =
        false;


      async function refreshDashboard() {
        const cachedDashboard =
          dashboardMemoryCache;


        if (
          cachedDashboard
        ) {
          setDashboard(
            cachedDashboard
          );

          setLoading(
            false
          );
        }


        try {
          const data =
            await requestDashboard();


          if (
            cancelled
          ) {
            return;
          }


          setDashboard(
            data
          );

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


          if (
            dashboardMemoryCache
          ) {
            setDashboard(
              dashboardMemoryCache
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


      return () => {
        cancelled =
          true;
      };
    },
    []
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


        const total =
          cards.reduce(
            (
              sum,
              card
            ) =>
              sum +
              Math.max(
                0,
                Number(
                  card.estimatedRemaining
                ) ||
                0
              ),
            0
          );


        return {
          total,
          cards
        };
      },
      [
        dashboard
      ]
    );


  const spendingTargets =
    useMemo(
      () => {
        if (
          !dashboard
        ) {
          return [];
        }


        const rows =
          (
            Array.isArray(
              dashboard
                .spendingTargetExpense
            )
              ? dashboard
                  .spendingTargetExpense
              : []
          )
            .filter(
              item =>
                Number(
                  item.amount
                ) > 0
            );


        const total =
          rows.reduce(
            (
              sum,
              item
            ) =>
              sum +
              (
                Number(
                  item.amount
                ) ||
                0
              ),
            0
          );


        return rows.map(
          item => ({
            ...item,

            ratio:
              total > 0
                ? Math.min(
                    100,
                    (
                      Number(
                        item.amount
                      ) /
                      total
                    ) *
                      100
                  )
                : 0
          })
        );
      },
      [
        dashboard
      ]
    );


  if (
    loading
  ) {
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
              styles.monthLabel
            }
          >
            가계부
          </p>

          <h1>
            불러오는 중
          </h1>
        </header>


        <section
          className={
            styles.loadingCard
          }
        >
          <div
            className={
              styles.loadingLineShort
            }
          />

          <div
            className={
              styles.loadingLineLong
            }
          />

          <div
            className={
              styles.loadingGrid
            }
          >
            <div />

            <div />
          </div>
        </section>
      </main>
    );
  }


  if (
    errorMessage ||
    !dashboard
  ) {
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
              styles.monthLabel
            }
          >
            가계부
          </p>

          <h1>
            데이터를 불러오지 못했어요
          </h1>
        </header>


        <section
          className={
            styles.errorCard
          }
        >
          <p>
            {
              errorMessage
            }
          </p>

          <button
            type="button"
            className={
              styles.retryButton
            }
            onClick={
              () =>
                void loadDashboard()
            }
          >
            다시 불러오기
          </button>
        </section>
      </main>
    );
  }


  const {
    monthIncome,
    monthExpense,
    monthNetCashFlow
  } =
    dashboard.summary;


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
            styles.monthLabel
          }
        >
          이번 달
        </p>

        <h1>
          {
            formatMonth(
              dashboard.month
            )
          }
        </h1>
      </header>


      <section
        className={
          styles.summaryCard
        }
      >
        <div
          className={
            styles.primarySummary
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
              styles.expenseAmount
            }
          >
            {
              formatWon(
                monthExpense
              )
            }
          </strong>
        </div>


        <div
          className={
            styles.summaryDivider
          }
        />


        <div
          className={
            styles.summaryGrid
          }
        >
          <div
            className={
              styles.summaryItem
            }
          >
            <span>
              수입
            </span>

            <strong>
              {
                formatWon(
                  monthIncome
                )
              }
            </strong>
          </div>


          <div
            className={
              styles.summaryItem
            }
          >
            <span>
              차액
            </span>

            <strong>
              {
                formatSignedWon(
                  monthNetCashFlow
                )
              }
            </strong>
          </div>
        </div>
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
          <h2>
            카드 결제 예정
          </h2>

          <strong
            className={
              styles.sectionTotal
            }
          >
            {
              formatWon(
                cardSummary.total
              )
            }
          </strong>
        </div>


        <div
          className={
            styles.cardList
          }
        >
          {
            cardSummary.cards
              .length >
            0
              ? (
                  cardSummary.cards
                    .map(
                      card => (
                        <div
                          key={
                            card.accountId
                          }
                          className={
                            styles.cardRow
                          }
                        >
                          <div
                            className={
                              styles.cardName
                            }
                          >
                            <span
                              className={
                                styles.cardIcon
                              }
                              aria-hidden="true"
                            >
                              ₩
                            </span>

                            <div>
                              <strong>
                                {
                                  card.name
                                }
                              </strong>

                              <span>
                                {
                                  card.paymentDay
                                    ? `${card.paymentDay}일 결제`
                                    : "결제일 미설정"
                                }
                              </span>
                            </div>
                          </div>

                          <strong
                            className={
                              styles.cardAmount
                            }
                          >
                            {
                              formatWon(
                                card
                                  .estimatedRemaining
                              )
                            }
                          </strong>
                        </div>
                      )
                    )
                )
              : (
                  <p
                    className={
                      styles.emptyText
                    }
                  >
                    이번 달 결제 예정액이 없습니다.
                  </p>
                )
          }
        </div>
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
          <h2>
            지출대상
          </h2>
        </div>


        <div
          className={
            styles.targetCard
          }
        >
          {
            spendingTargets
              .length >
            0
              ? (
                  spendingTargets
                    .map(
                      target => (
                        <div
                          key={
                            target.name
                          }
                          className={
                            styles.targetRow
                          }
                        >
                          <div
                            className={
                              styles.targetTop
                            }
                          >
                            <strong>
                              {
                                target.name
                              }
                            </strong>

                            <div
                              className={
                                styles.targetNumbers
                              }
                            >
                              <span>
                                {
                                  Math.round(
                                    target.ratio
                                  )
                                }
                                %
                              </span>

                              <strong>
                                {
                                  formatWon(
                                    target.amount
                                  )
                                }
                              </strong>
                            </div>
                          </div>


                          <div
                            className={
                              styles.progressTrack
                            }
                            aria-hidden="true"
                          >
                            <div
                              className={
                                styles.progressBar
                              }
                              style={{
                                width:
                                  `${target.ratio}%`
                              }}
                            />
                          </div>
                        </div>
                      )
                    )
                )
              : (
                  <p
                    className={
                      styles.emptyText
                    }
                  >
                    이번 달 지출 기록이 없습니다.
                  </p>
                )
          }
        </div>
      </section>
    </main>
  );
}
