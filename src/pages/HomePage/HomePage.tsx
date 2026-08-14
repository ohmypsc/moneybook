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


interface DashboardCard {
  accountId: string;
  name: string;
  balance: number;
  unpaidAmount: number;
  billingCutoffDay: number | null;
  paymentDay: number | null;
  paymentAccountId: string | null;
  billingMonth: string;
  estimatedUsage: number;
  payments: number;
  estimatedRemaining: number;
}


interface SpendingSummary {
  name: string;
  amount: number;
}


interface DashboardData {
  asOf: string;
  month: string;

  summary: DashboardSummary;

  cards: DashboardCard[];

  spending: {
    byCategory: SpendingSummary[];
    byTarget: SpendingSummary[];
  };
}


type HomePageProps =
  Record<string, unknown>;


function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}


function toNumber(
  value: unknown
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


function toNullableNumber(
  value: unknown
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function toNullableString(
  value: unknown
): string | null {
  return typeof value === "string" &&
    value.trim()
    ? value
    : null;
}


function normalizeSummary(
  value: unknown
): DashboardSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    assets:
      toNumber(
        value.assets
      ),

    liabilities:
      toNumber(
        value.liabilities
      ),

    netWorth:
      toNumber(
        value.netWorth
      ),

    investmentValue:
      toNumber(
        value.investmentValue
      ),

    cashLikeValue:
      toNumber(
        value.cashLikeValue
      ),

    monthIncome:
      toNumber(
        value.monthIncome
      ),

    monthExpense:
      toNumber(
        value.monthExpense
      ),

    monthNetCashFlow:
      toNumber(
        value.monthNetCashFlow
      )
  };
}


function normalizeCards(
  value: unknown
): DashboardCard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (
        card,
        index
      ) => {
        const accountId =
          typeof card.accountId ===
            "string"
            ? card.accountId
            : `card-${index}`;

        const name =
          typeof card.name ===
            "string" &&
          card.name.trim()
            ? card.name
            : "신용카드";

        return {
          accountId,

          name,

          balance:
            toNumber(
              card.balance
            ),

          unpaidAmount:
            toNumber(
              card.unpaidAmount
            ),

          billingCutoffDay:
            toNullableNumber(
              card.billingCutoffDay
            ),

          paymentDay:
            toNullableNumber(
              card.paymentDay
            ),

          paymentAccountId:
            toNullableString(
              card.paymentAccountId
            ),

          billingMonth:
            typeof card.billingMonth ===
              "string"
              ? card.billingMonth
              : "",

          estimatedUsage:
            toNumber(
              card.estimatedUsage
            ),

          payments:
            toNumber(
              card.payments
            ),

          estimatedRemaining:
            toNumber(
              card.estimatedRemaining
            )
        };
      }
    );
}


function normalizeSpending(
  value: unknown
): SpendingSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      isRecord
    )
    .map(
      (
        item,
        index
      ) => ({
        name:
          typeof item.name ===
            "string" &&
          item.name.trim()
            ? item.name
            : `항목 ${index + 1}`,

        amount:
          toNumber(
            item.amount
          )
      })
    );
}


function normalizeDashboard(
  value: unknown
): DashboardData | null {
  /*
   * 정상 구조:
   *
   * data: {
   *   month,
   *   summary,
   *   cards,
   *   spending
   * }
   *
   * Worker에서 실수로 한 단계 더
   * 감싸져 오는 경우도 안전하게 처리:
   *
   * data: {
   *   data: {
   *     month,
   *     summary,
   *     ...
   *   }
   * }
   */

  let candidate =
    value;


  if (
    isRecord(candidate) &&
    !isRecord(
      candidate.summary
    ) &&
    isRecord(
      candidate.data
    )
  ) {
    candidate =
      candidate.data;
  }


  if (
    !isRecord(candidate)
  ) {
    return null;
  }


  const summary =
    normalizeSummary(
      candidate.summary
    );


  if (!summary) {
    return null;
  }


  const spending =
    isRecord(
      candidate.spending
    )
      ? candidate.spending
      : {};


  const month =
    typeof candidate.month ===
      "string"
      ? candidate.month
      : "";


  if (!month) {
    return null;
  }


  return {
    asOf:
      typeof candidate.asOf ===
        "string"
        ? candidate.asOf
        : "",

    month,

    summary,

    cards:
      normalizeCards(
        candidate.cards
      ),

    spending: {
      byCategory:
        normalizeSpending(
          spending.byCategory
        ),

      byTarget:
        normalizeSpending(
          spending.byTarget
        )
    }
  };
}


function getErrorMessage(
  body: unknown
) {
  if (
    !isRecord(body) ||
    !isRecord(
      body.error
    )
  ) {
    return "";
  }

  return typeof body.error.message ===
    "string"
    ? body.error.message
    : "";
}


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


  if (!match) {
    return month ||
      "이번 달";
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
      null
    );


  const [
    loading,
    setLoading
  ] =
    useState(
      true
    );


  const [
    errorMessage,
    setErrorMessage
  ] =
    useState(
      ""
    );


  async function loadDashboard() {
    setLoading(
      true
    );

    setErrorMessage(
      ""
    );


    try {
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
        unknown;


      try {
        body =
          await response
            .json();

      } catch {
        throw new Error(
          "가계부 데이터를 읽지 못했습니다."
        );
      }


      if (
        !response.ok
      ) {
        throw new Error(
          getErrorMessage(
            body
          ) ||
          "가계부 데이터를 불러오지 못했습니다."
        );
      }


      if (
        !isRecord(body) ||
        body.success !== true
      ) {
        throw new Error(
          getErrorMessage(
            body
          ) ||
          "가계부 데이터를 불러오지 못했습니다."
        );
      }


      const normalized =
        normalizeDashboard(
          body.data
        );


      if (!normalized) {
        throw new Error(
          "대시보드 응답 형식이 올바르지 않습니다."
        );
      }


      setDashboard(
        normalized
      );

    } catch (
      error
    ) {
      setDashboard(
        null
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "가계부 데이터를 불러오지 못했습니다."
      );

    } finally {
      setLoading(
        false
      );
    }
  }


  useEffect(
    () => {
      void loadDashboard();
    },
    []
  );


  const cardSummary =
    useMemo(
      () => {
        const cards =
          dashboard?.cards ??
          [];


        const visibleCards =
          cards
            .filter(
              card =>
                Number.isFinite(
                  card
                    .estimatedRemaining
                ) &&
                card
                  .estimatedRemaining >
                  0
            )
            .slice()
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
          visibleCards
            .reduce(
              (
                sum,
                card
              ) =>
                sum +
                Math.max(
                  0,
                  card
                    .estimatedRemaining
                ),
              0
            );


        return {
          total,
          cards:
            visibleCards
        };
      },
      [
        dashboard
      ]
    );


  const spendingTargets =
    useMemo(
      () => {
        const rows =
          (
            dashboard
              ?.spending
              ?.byTarget ??
            []
          )
            .filter(
              item =>
                Number.isFinite(
                  item.amount
                ) &&
                item.amount >
                  0
            );


        const total =
          rows.reduce(
            (
              sum,
              item
            ) =>
              sum +
              item.amount,
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
                      item.amount /
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
              errorMessage ||
              "가계부 데이터를 불러오지 못했습니다."
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
