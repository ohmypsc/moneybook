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


interface DashboardAccount {
  accountId: string;
  displayName: string;
  paymentDay: number | null;
  owner: string;
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
  owner: string;
}


type HomePageProps = {
  onOpenHistory?: () => void;
};


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

function formatBalanceWon(
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
      Math.round(safeValue)
    ) +
    "원"
  );
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



const TOGETHER_START = {
  year: 2026,
  monthIndex: 6,
  day: 11
};

function getTogetherDays() {
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startUtc = Date.UTC(
    TOGETHER_START.year,
    TOGETHER_START.monthIndex,
    TOGETHER_START.day
  );
  const difference = Math.floor(
    (todayUtc - startUtc) / 86400000
  );

  return Math.max(1, difference + 1);
}

function formatShortDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[2])}.${Number(match[3])}`;
}

function getRecentTitle(transaction: DashboardData["recentTransactions"][number]) {
  return transaction.memo || transaction.category || transaction.type;
}

function getRecentMeta(transaction: DashboardData["recentTransactions"][number]) {
  if (transaction.type === "수입") {
    return transaction.toAccount || "입금";
  }

  if (transaction.type === "이체") {
    const from = transaction.fromAccount || "출금";
    const to = transaction.toAccount || "입금";
    return `${from} → ${to}`;
  }

  return transaction.paymentMethod || transaction.fromAccount || transaction.category || "지출";
}

export default function HomePage({
  onOpenHistory
}: HomePageProps) {
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


  async function loadDashboard(
    forceRefresh = false
  ) {
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
        await getDashboard(
          undefined,
          {
            forceRefresh
          }
        );

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


  useEffect(
    () => {
      function refreshWhenVisible() {
        if (
          document.visibilityState !==
          "visible"
        ) {
          return;
        }

        void loadDashboard(
          true
        );
      }

      document.addEventListener(
        "visibilitychange",
        refreshWhenVisible
      );

      return () => {
        document.removeEventListener(
          "visibilitychange",
          refreshWhenVisible
        );
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
                    null,

                  owner:
                    account?.owner ||
                    ""
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
    netWorth,
    monthIncome,
    monthExpense,
    monthNetCashFlow
  } = dashboard.summary;

  const togetherDays = getTogetherDays();
  const recentTransactions = Array.isArray(dashboard.recentTransactions)
    ? dashboard.recentTransactions.slice(0, 5)
    : [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.togetherBlock}>
          <img
            src="/splash-photo.jpg"
            alt=""
            className={styles.homePhoto}
            aria-hidden="true"
          />

          <div>
            <p className={styles.togetherLabel}>함께한 지</p>
            <h1 className={styles.togetherValue}>
              {new Intl.NumberFormat("ko-KR").format(togetherDays)}일
            </h1>
            <p className={styles.togetherDate}>2026.07.11 ~ 오늘</p>
          </div>
        </div>

      </header>

      <section className={styles.summaryCard}>
        <div className={styles.summaryHeader}>
          <h2>우리 집 한눈에</h2>
          <span>{formatMonth(dashboard.month)}</span>
        </div>

        <div className={styles.summaryRows}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>우리 순자산</span>
            <strong className={netWorth < 0 ? styles.negativeAmount : styles.netAmount}>
              {formatBalanceWon(netWorth)}
            </strong>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>수입</span>
            <strong className={styles.incomeAmount}>{formatWon(monthIncome)}</strong>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>지출</span>
            <strong className={styles.expenseAmount}>{formatWon(monthExpense)}</strong>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>남은 금액</span>
            <strong className={monthNetCashFlow < 0 ? styles.negativeAmount : styles.netAmount}>
              {formatSignedWon(monthNetCashFlow)}
            </strong>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>카드 결제 예정</h2>
            <span className={styles.sectionHint}>이번 달 남은 결제액</span>
          </div>
          <strong className={styles.sectionTotal}>{formatWon(cardSummary.total)}</strong>
        </div>

        <div className={styles.cardList}>
          {cardSummary.cards.length > 0 ? (
            cardSummary.cards.map(card => (
              <div key={card.accountId} className={styles.cardRow}>
                <div className={styles.cardName}>
                  <span className={styles.cardIcon} aria-hidden="true">₩</span>
                  <div>
                    <strong>{card.name}</strong>
                    <span>
                      {[
                        card.paymentDay
                          ? `${card.paymentDay}일 결제`
                          : "결제일 미설정",
                        card.owner
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </div>
                <strong className={styles.cardAmount}>
                  {formatWon(card.estimatedRemaining)}
                </strong>
              </div>
            ))
          ) : (
            <p className={styles.emptyText}>이번 달 결제 예정액이 없습니다.</p>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>최근 내역</h2>
            <span className={styles.sectionHint}>최근 기록 5건</span>
          </div>
          {onOpenHistory && (
            <button type="button" className={styles.sectionLink} onClick={onOpenHistory}>
              더보기
            </button>
          )}
        </div>

        <div className={styles.recentList}>
          {recentTransactions.length > 0 ? (
            recentTransactions.map(transaction => {
              const amountClass = transaction.type === "수입"
                ? styles.recentIncome
                : transaction.type === "지출"
                  ? styles.recentExpense
                  : styles.recentTransfer;
              const prefix = transaction.type === "수입" ? "+" : transaction.type === "지출" ? "-" : "";

              return (
                <div key={transaction.transactionId} className={styles.recentRow}>
                  <span className={styles.recentDate}>{formatShortDate(transaction.date)}</span>
                  <div className={styles.recentText}>
                    <strong>{getRecentTitle(transaction)}</strong>
                    <span>{getRecentMeta(transaction)}</span>
                  </div>
                  <strong className={`${styles.recentAmount} ${amountClass}`}>
                    {prefix}{formatWon(transaction.amount)}
                  </strong>
                </div>
              );
            })
          ) : (
            <p className={styles.emptyText}>최근 거래가 없습니다.</p>
          )}
        </div>
      </section>
    </main>
  );
}
