import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  getDashboard
} from "../../api/dashboard";

import {
  getCalendarTransactions
} from "../../api/calendar";

import type {
  CalendarTransaction,
  LedgerTransactionType
} from "../../api/calendar";

import type {
  DashboardData
} from "../../types/dashboard";

import styles
  from "./CalendarPage.module.css";


type CalendarFilter =
  | "전체"
  | LedgerTransactionType;


interface CalendarCell {
  date: string | null;
  day: number | null;
}


const WEEKDAYS = [
  "일",
  "월",
  "화",
  "수",
  "목",
  "금",
  "토"
];


const FILTERS:
  CalendarFilter[] = [
    "전체",
    "지출",
    "수입",
    "이체"
  ];


function pad(
  value: number
) {
  return String(value)
    .padStart(
      2,
      "0"
    );
}


function getToday() {
  const now =
    new Date();

  return [
    now.getFullYear(),
    pad(
      now.getMonth() + 1
    ),
    pad(
      now.getDate()
    )
  ].join("-");
}


function getCurrentMonth() {
  return getToday()
    .slice(
      0,
      7
    );
}


function parseMonth(
  month: string
) {
  const [
    yearText,
    monthText
  ] =
    month.split("-");

  return {
    year:
      Number(yearText),

    monthIndex:
      Number(monthText) - 1
  };
}


function getDaysInMonth(
  month: string
) {
  const {
    year,
    monthIndex
  } =
    parseMonth(month);

  return new Date(
    year,
    monthIndex + 1,
    0
  ).getDate();
}


function getMonthBounds(
  month: string
) {
  return {
    dateFrom:
      `${month}-01`,

    dateTo:
      `${month}-${pad(
        getDaysInMonth(month)
      )}`
  };
}


function moveMonthValue(
  month: string,
  offset: number
) {
  const {
    year,
    monthIndex
  } =
    parseMonth(month);

  const date =
    new Date(
      year,
      monthIndex + offset,
      1
    );

  return [
    date.getFullYear(),
    pad(
      date.getMonth() + 1
    )
  ].join("-");
}


function formatMonthLabel(
  month: string
) {
  const {
    year,
    monthIndex
  } =
    parseMonth(month);

  return `${year}년 ${monthIndex + 1}월`;
}


function formatDateLabel(
  dateText: string
) {
  const [
    year,
    month,
    day
  ] =
    dateText
      .split("-")
      .map(Number);

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      month:
        "long",
      day:
        "numeric",
      weekday:
        "short"
    }
  ).format(date);
}


function formatCurrency(
  value:
    number |
    null |
    undefined
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  return (
    Math.round(value)
      .toLocaleString(
        "ko-KR"
      ) +
    "원"
  );
}


function formatCalendarAmount(
  value: number
) {
  const absolute =
    Math.abs(value);

  if (
    absolute >=
    100000000
  ) {
    const divided =
      absolute /
      100000000;

    return (
      divided
        .toFixed(
          divided >= 10
            ? 0
            : 1
        )
        .replace(
          /\.0$/,
          ""
        ) +
      "억"
    );
  }

  if (
    absolute >=
    10000
  ) {
    const divided =
      absolute /
      10000;

    return (
      divided
        .toFixed(
          divided >= 10
            ? 0
            : 1
        )
        .replace(
          /\.0$/,
          ""
        ) +
      "만"
    );
  }

  return Math.round(
    absolute
  ).toLocaleString(
    "ko-KR"
  );
}


function buildCalendarCells(
  month: string
):
  CalendarCell[] {
  const {
    year,
    monthIndex
  } =
    parseMonth(month);

  const firstWeekday =
    new Date(
      year,
      monthIndex,
      1
    ).getDay();

  const daysInMonth =
    getDaysInMonth(
      month
    );

  const cells:
    CalendarCell[] = [];

  for (
    let index = 0;
    index < firstWeekday;
    index += 1
  ) {
    cells.push({
      date:
        null,
      day:
        null
    });
  }

  for (
    let day = 1;
    day <= daysInMonth;
    day += 1
  ) {
    cells.push({
      date:
        `${month}-${pad(day)}`,
      day
    });
  }

  while (
    cells.length % 7 !== 0
  ) {
    cells.push({
      date:
        null,
      day:
        null
    });
  }

  return cells;
}


function sumTransactions(
  items:
    CalendarTransaction[],
  type:
    LedgerTransactionType
) {
  return items
    .filter(
      item =>
        item.type === type
    )
    .reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.amount,
      0
    );
}


function getTransactionMethod(
  transaction:
    CalendarTransaction
) {
  if (
    transaction.type ===
    "지출"
  ) {
    const parts = [
      transaction
        .paymentMethod ||
        transaction
          .fromAccount,

      transaction
        .spendingTarget
    ].filter(Boolean);

    if (
      transaction.billingMonth
    ) {
      parts.push(
        `${transaction.billingMonth} 청구`
      );
    }

    return parts.join(
      " · "
    );
  }

  if (
    transaction.type ===
    "수입"
  ) {
    return (
      transaction.toAccount ||
      "입금수단 미지정"
    );
  }

  return [
    transaction.fromAccount ||
      "-",
    "→",
    transaction.toAccount ||
      "-"
  ].join(" ");
}


function getAmountText(
  transaction:
    CalendarTransaction
) {
  const amount =
    formatCurrency(
      transaction.amount
    );

  if (
    transaction.type ===
    "지출"
  ) {
    return `-${amount}`;
  }

  if (
    transaction.type ===
    "수입"
  ) {
    return `+${amount}`;
  }

  return amount;
}


export default function CalendarPage() {
  const today =
    getToday();

  const [
    month,
    setMonth
  ] =
    useState(
      getCurrentMonth()
    );

  const [
    selectedDate,
    setSelectedDate
  ] =
    useState(
      today
    );

  const [
    filter,
    setFilter
  ] =
    useState<CalendarFilter>(
      "전체"
    );

  const [
    transactions,
    setTransactions
  ] =
    useState<
      CalendarTransaction[]
    >([]);

  const [
    dashboard,
    setDashboard
  ] =
    useState<
      DashboardData |
      null
    >(null);

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
    reloadKey,
    setReloadKey
  ] =
    useState(0);


  useEffect(
    () => {
      let cancelled =
        false;

      async function loadMonth() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const {
            dateFrom,
            dateTo
          } =
            getMonthBounds(
              month
            );

          const [
            transactionResult,
            dashboardResult
          ] =
            await Promise.all([
              getCalendarTransactions({
                dateFrom,
                dateTo,
                limit:
                  1000
              }),

              getDashboard(
                month
              )
            ]);

          if (
            cancelled
          ) {
            return;
          }

          setTransactions(
            transactionResult
              .items
              .filter(
                item =>
                  !item.isDeleted
              )
          );

          setDashboard(
            dashboardResult
          );
        } catch (
          loadError
        ) {
          if (
            cancelled
          ) {
            return;
          }

          setError(
            loadError instanceof Error
              ? loadError.message
              : "거래 내역을 불러오지 못했습니다."
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

      void loadMonth();

      return () => {
        cancelled =
          true;
      };
    },
    [
      month,
      reloadKey
    ]
  );


  const filteredTransactions =
    useMemo(
      () => {
        if (
          filter ===
          "전체"
        ) {
          return transactions;
        }

        return transactions.filter(
          transaction =>
            transaction.type ===
            filter
        );
      },
      [
        transactions,
        filter
      ]
    );


  const transactionsByDate =
    useMemo(
      () => {
        const map =
          new Map<
            string,
            CalendarTransaction[]
          >();

        filteredTransactions
          .forEach(
            transaction => {
              const current =
                map.get(
                  transaction.date
                ) || [];

              current.push(
                transaction
              );

              map.set(
                transaction.date,
                current
              );
            }
          );

        return map;
      },
      [
        filteredTransactions
      ]
    );


  const calendarCells =
    useMemo(
      () =>
        buildCalendarCells(
          month
        ),
      [
        month
      ]
    );


  const selectedTransactions =
    useMemo(
      () =>
        transactionsByDate.get(
          selectedDate
        ) || [],
      [
        transactionsByDate,
        selectedDate
      ]
    );


  const selectedIncome =
    sumTransactions(
      selectedTransactions,
      "수입"
    );

  const selectedExpense =
    sumTransactions(
      selectedTransactions,
      "지출"
    );

  const selectedTransfer =
    sumTransactions(
      selectedTransactions,
      "이체"
    );


  function changeMonth(
    offset: number
  ) {
    const nextMonth =
      moveMonthValue(
        month,
        offset
      );

    setMonth(
      nextMonth
    );

    if (
      today.startsWith(
        nextMonth
      )
    ) {
      setSelectedDate(
        today
      );
    } else {
      setSelectedDate(
        `${nextMonth}-01`
      );
    }
  }


  function goToday() {
    setMonth(
      today.slice(
        0,
        7
      )
    );

    setSelectedDate(
      today
    );
  }


  const summary =
    dashboard?.summary;


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
          달력
        </p>

        <h1
          className={
            styles.title
          }
        >
          거래 내역
        </h1>

        <p
          className={
            styles.description
          }
        >
          날짜별 수입과 지출,
          계좌 이동 내역을
          한눈에 확인합니다.
        </p>
      </header>


      <div
        className={
          styles.toolbar
        }
      >
        <div
          className={
            styles.monthNavigator
          }
        >
          <button
            type="button"
            className={
              styles.iconButton
            }
            aria-label="이전 달"
            onClick={
              () =>
                changeMonth(
                  -1
                )
            }
            disabled={
              loading
            }
          >
            ‹
          </button>

          <h2
            className={
              styles.monthLabel
            }
          >
            {
              formatMonthLabel(
                month
              )
            }
          </h2>

          <button
            type="button"
            className={
              styles.iconButton
            }
            aria-label="다음 달"
            onClick={
              () =>
                changeMonth(
                  1
                )
            }
            disabled={
              loading
            }
          >
            ›
          </button>
        </div>


        <div
          className={
            styles.toolbarActions
          }
        >
          <button
            type="button"
            className={
              styles.todayButton
            }
            onClick={
              goToday
            }
          >
            오늘
          </button>

          <button
            type="button"
            className={
              styles.refreshButton
            }
            aria-label="새로고침"
            onClick={
              () =>
                setReloadKey(
                  value =>
                    value + 1
                )
            }
            disabled={
              loading
            }
          >
            ↻
          </button>
        </div>
      </div>


      <section
        className={
          styles.summaryGrid
        }
        aria-label="월 요약"
      >
        <div
          className={
            styles.summaryCard
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
            className={[
              styles.summaryValue,
              styles.summaryIncome
            ].join(" ")}
          >
            {
              formatCurrency(
                summary
                  ?.monthIncome
              )
            }
          </strong>
        </div>


        <div
          className={
            styles.summaryCard
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
            className={[
              styles.summaryValue,
              styles.summaryExpense
            ].join(" ")}
          >
            {
              formatCurrency(
                summary
                  ?.monthExpense
              )
            }
          </strong>
        </div>


        <div
          className={
            styles.summaryCard
          }
        >
          <span
            className={
              styles.summaryLabel
            }
          >
            순현금흐름
          </span>

          <strong
            className={[
              styles.summaryValue,
              (
                summary
                  ?.monthNetCashFlow ??
                0
              ) < 0
                ? styles
                    .summaryNegative
                : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {
              formatCurrency(
                summary
                  ?.monthNetCashFlow
              )
            }
          </strong>
        </div>
      </section>


      <div
        className={
          styles.filters
        }
        aria-label="거래 유형"
      >
        {FILTERS.map(
          item => (
            <button
              type="button"
              key={
                item
              }
              className={[
                styles
                  .filterButton,
                filter === item
                  ? styles
                      .filterButtonActive
                  : ""
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={
                () =>
                  setFilter(
                    item
                  )
              }
            >
              {item}
            </button>
          )
        )}
      </div>


      {loading && (
        <p
          className={
            styles.loading
          }
        >
          거래 내역을
          불러오는 중입니다.
        </p>
      )}


      {!loading &&
        error && (
          <p
            className={
              styles.error
            }
            role="alert"
          >
            {error}
          </p>
        )}


      {!loading &&
        !error && (
          <>
            <section
              className={
                styles.calendarCard
              }
              aria-label={`${formatMonthLabel(
                month
              )} 거래 달력`}
            >
              <div
                className={
                  styles.weekdays
                }
              >
                {WEEKDAYS.map(
                  weekday => (
                    <div
                      key={
                        weekday
                      }
                      className={
                        styles.weekday
                      }
                    >
                      {
                        weekday
                      }
                    </div>
                  )
                )}
              </div>


              <div
                className={
                  styles.calendarGrid
                }
              >
                {calendarCells.map(
                  (
                    cell,
                    index
                  ) => {
                    if (
                      !cell.date ||
                      cell.day ===
                        null
                    ) {
                      return (
                        <div
                          key={
                            `blank-${index}`
                          }
                          className={
                            styles.blankCell
                          }
                          aria-hidden="true"
                        />
                      );
                    }

                    const dayItems =
                      transactionsByDate
                        .get(
                          cell.date
                        ) || [];

                    const income =
                      sumTransactions(
                        dayItems,
                        "수입"
                      );

                    const expense =
                      sumTransactions(
                        dayItems,
                        "지출"
                      );

                    const transferCount =
                      dayItems.filter(
                        item =>
                          item.type ===
                          "이체"
                      ).length;

                    const selected =
                      selectedDate ===
                      cell.date;

                    const isToday =
                      today ===
                      cell.date;

                    return (
                      <button
                        type="button"
                        key={
                          cell.date
                        }
                        className={[
                          styles
                            .dayCell,
                          selected
                            ? styles
                                .dayCellSelected
                            : "",
                          isToday
                            ? styles
                                .dayCellToday
                            : ""
                        ]
                          .filter(
                            Boolean
                          )
                          .join(" ")}
                        onClick={
                          () =>
                            setSelectedDate(
                              cell.date as string
                            )
                        }
                        aria-label={
                          `${cell.day}일, 거래 ${dayItems.length}건`
                        }
                      >
                        <div
                          className={
                            styles.dayNumberRow
                          }
                        >
                          <span
                            className={
                              styles.dayNumber
                            }
                          >
                            {
                              cell.day
                            }
                          </span>

                          {dayItems
                            .length >
                            0 && (
                            <span
                              className={
                                styles
                                  .transactionCount
                              }
                            >
                              {
                                dayItems
                                  .length
                              }
                            </span>
                          )}
                        </div>


                        <div
                          className={
                            styles.dayStats
                          }
                        >
                          {income >
                            0 && (
                            <span
                              className={
                                styles.dayIncome
                              }
                            >
                              +
                              {
                                formatCalendarAmount(
                                  income
                                )
                              }
                            </span>
                          )}

                          {expense >
                            0 && (
                            <span
                              className={
                                styles.dayExpense
                              }
                            >
                              -
                              {
                                formatCalendarAmount(
                                  expense
                                )
                              }
                            </span>
                          )}

                          {transferCount >
                            0 && (
                            <span
                              className={
                                styles.dayTransfer
                              }
                            >
                              이체{" "}
                              {
                                transferCount
                              }
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            </section>


            <section
              className={
                styles.detailSection
              }
            >
              <div
                className={
                  styles.detailHeader
                }
              >
                <div
                  className={
                    styles.detailTitleGroup
                  }
                >
                  <p
                    className={
                      styles.detailEyebrow
                    }
                  >
                    선택한 날짜
                  </p>

                  <h2
                    className={
                      styles.detailTitle
                    }
                  >
                    {
                      formatDateLabel(
                        selectedDate
                      )
                    }
                  </h2>
                </div>

                <span
                  className={
                    styles.detailCount
                  }
                >
                  {
                    selectedTransactions
                      .length
                  }
                  건
                </span>
              </div>


              <div
                className={
                  styles.daySummary
                }
              >
                <div
                  className={
                    styles.daySummaryItem
                  }
                >
                  <span
                    className={
                      styles.daySummaryLabel
                    }
                  >
                    수입
                  </span>

                  <strong
                    className={[
                      styles
                        .daySummaryValue,
                      styles
                        .summaryIncome
                    ].join(" ")}
                  >
                    {
                      formatCurrency(
                        selectedIncome
                      )
                    }
                  </strong>
                </div>


                <div
                  className={
                    styles.daySummaryItem
                  }
                >
                  <span
                    className={
                      styles.daySummaryLabel
                    }
                  >
                    지출
                  </span>

                  <strong
                    className={[
                      styles
                        .daySummaryValue,
                      styles
                        .summaryExpense
                    ].join(" ")}
                  >
                    {
                      formatCurrency(
                        selectedExpense
                      )
                    }
                  </strong>
                </div>


                <div
                  className={
                    styles.daySummaryItem
                  }
                >
                  <span
                    className={
                      styles.daySummaryLabel
                    }
                  >
                    이체
                  </span>

                  <strong
                    className={
                      styles
                        .daySummaryValue
                    }
                  >
                    {
                      formatCurrency(
                        selectedTransfer
                      )
                    }
                  </strong>
                </div>
              </div>


              {selectedTransactions
                .length ===
                0 && (
                <p
                  className={
                    styles.emptyState
                  }
                >
                  이 날짜에는
                  표시할 거래가
                  없습니다.
                </p>
              )}


              {selectedTransactions
                .length >
                0 && (
                <ul
                  className={
                    styles.transactionList
                  }
                >
                  {selectedTransactions.map(
                    transaction => (
                      <li
                        key={
                          transaction
                            .transactionId
                        }
                        className={
                          styles.transactionItem
                        }
                      >
                        <div
                          className={
                            styles.transactionTop
                          }
                        >
                          <div
                            className={
                              styles.transactionMain
                            }
                          >
                            <div
                              className={
                                styles
                                  .transactionTitleRow
                              }
                            >
                              <span
                                className={[
                                  styles
                                    .transactionType,

                                  transaction
                                    .type ===
                                  "지출"
                                    ? styles
                                        .transactionTypeExpense
                                    : transaction
                                          .type ===
                                        "수입"
                                      ? styles
                                          .transactionTypeIncome
                                      : styles
                                          .transactionTypeTransfer
                                ].join(
                                  " "
                                )}
                              >
                                {
                                  transaction
                                    .type
                                }
                              </span>

                              <span
                                className={
                                  styles.transactionTitle
                                }
                              >
                                {
                                  transaction
                                    .category ||
                                  transaction
                                    .type
                                }
                              </span>

                              {transaction
                                .reversalOf && (
                                <span
                                  className={
                                    styles
                                      .reversalLabel
                                  }
                                >
                                  취소/환불
                                </span>
                              )}
                            </div>


                            <p
                              className={
                                styles
                                  .transactionMeta
                              }
                            >
                              {
                                getTransactionMethod(
                                  transaction
                                )
                              }
                            </p>
                          </div>


                          <strong
                            className={[
                              styles
                                .transactionAmount,

                              transaction
                                .type ===
                              "지출"
                                ? styles
                                    .amountExpense
                                : transaction
                                      .type ===
                                    "수입"
                                  ? styles
                                      .amountIncome
                                  : styles
                                      .amountTransfer
                            ].join(
                              " "
                            )}
                          >
                            {
                              getAmountText(
                                transaction
                              )
                            }
                          </strong>
                        </div>


                        {transaction
                          .memo && (
                          <p
                            className={
                              styles.transactionMemo
                            }
                          >
                            {
                              transaction.memo
                            }
                          </p>
                        )}
                      </li>
                    )
                  )}
                </ul>
              )}
            </section>
          </>
        )}
    </main>
  );
}
