import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  getDashboard,
  getDashboardSnapshot
} from "../../api/dashboard";

import type {
  DashboardAccount,
  DashboardData
} from "../../types/dashboard";

import {
  clearLedgerDirty,
  isLedgerDirty,
  subscribeLedgerChanges
} from "../../utils/ledgerEvents";

import {
  markBackgroundRefreshed,
  shouldBackgroundRefresh
} from "../../utils/backgroundRefresh";

import {
  getSeoulDateString,
  getSeoulTimestampLabel
} from "../../utils/dateTime";

import styles
  from "./HomePage.module.css";

interface DashboardCardView {
  accountId: string;
  accountName: string;
  billingMonth: string;
  usage: number;
  payments: number;
  estimatedRemaining: number;
  name: string;
  paymentDay: number | null;
  owner: string;
}

function formatWon(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return (
    new Intl.NumberFormat("ko-KR").format(
      Math.round(Math.abs(safeValue))
    ) + "원"
  );
}

function formatSignedWon(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  if (safeValue > 0) return `+${formatWon(safeValue)}`;
  if (safeValue < 0) return `-${formatWon(safeValue)}`;
  return "0원";
}

function formatBalanceWon(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0;

  return (
    new Intl.NumberFormat("ko-KR").format(
      Math.round(safeValue)
    ) + "원"
  );
}

function formatMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${match[1]}년 ${Number(match[2])}월`;
}

const TOGETHER_START = "2026-07-11";

function getTogetherDays() {
  const today = getSeoulDateString();
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const [startYear, startMonth, startDay] = TOGETHER_START.split("-").map(Number);

  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay);
  const difference = Math.floor((todayUtc - startUtc) / 86_400_000);

  return Math.max(1, difference + 1);
}

export default function HomePage() {
  const [needsInitialRefresh] = useState(() => isLedgerDirty());
  const [initialDashboard] = useState<DashboardData | null>(
    () => getDashboardSnapshot()
  );
  const [dashboard, setDashboard] = useState<DashboardData | null>(
    initialDashboard
  );
  const [loading, setLoading] = useState(initialDashboard === null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("");

  async function loadDashboard(options: {
    forceRefresh?: boolean;
    background?: boolean;
  } = {}) {
    const cachedDashboard = getDashboardSnapshot();

    if (cachedDashboard) {
      setDashboard(cachedDashboard);
      setLoading(false);
    } else if (!options.background) {
      setLoading(true);
    }

    if (!options.background) {
      setErrorMessage("");
    }

    try {
      const data = await getDashboard(undefined, {
        forceRefresh: options.forceRefresh === true
      });

      setDashboard(data);
      clearLedgerDirty();
      markBackgroundRefreshed("dashboard");
      setLastUpdatedLabel(getSeoulTimestampLabel());
      setErrorMessage("");
    } catch (error) {
      const fallback = getDashboardSnapshot();

      if (fallback) {
        setDashboard(fallback);
      } else if (!options.background) {
        setDashboard(null);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "가계부 데이터를 불러오지 못했습니다."
        );
      }
    } finally {
      if (!options.background) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshAfterLedgerChange() {
      try {
        const data = await getDashboard();
        if (cancelled) return;
        setDashboard(data);
        clearLedgerDirty();
        markBackgroundRefreshed("dashboard");
        setLastUpdatedLabel(getSeoulTimestampLabel());
        setErrorMessage("");
      } catch (error) {
        if (cancelled || getDashboardSnapshot()) return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "가계부 데이터를 불러오지 못했습니다."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (needsInitialRefresh || !initialDashboard) {
      void loadDashboard();
    } else {
      setLastUpdatedLabel(getSeoulTimestampLabel());
    }

    const unsubscribe = subscribeLedgerChanges(() => {
      void refreshAfterLedgerChange();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [initialDashboard, needsInitialRefresh]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      if (!shouldBackgroundRefresh("dashboard", 60_000)) return;

      void loadDashboard({
        forceRefresh: true,
        background: true
      });
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);

  const cardSummary = useMemo(() => {
    if (!dashboard) {
      return { total: 0, cards: [] as DashboardCardView[] };
    }

    const accountMap = new Map<string, DashboardAccount>(
      (Array.isArray(dashboard.accounts) ? dashboard.accounts : [])
        .map(account => [account.accountId, account] as const)
    );

    const cards = (Array.isArray(dashboard.cards) ? dashboard.cards : [])
      .filter(card => Number(card.estimatedRemaining) > 0)
      .map(card => {
        const account = accountMap.get(card.accountId);

        return {
          ...card,
          name: card.accountName || account?.displayName || "신용카드",
          paymentDay: account?.paymentDay ?? null,
          owner: account?.owner || ""
        };
      })
      .sort((first, second) =>
        (first.paymentDay ?? 99) - (second.paymentDay ?? 99)
      );

    return {
      total: cards.reduce(
        (sum, card) => sum + Math.max(0, Number(card.estimatedRemaining) || 0),
        0
      ),
      cards
    };
  }, [dashboard]);

  const topCategories = useMemo(() => {
    return (dashboard?.categoryExpense || [])
      .filter(item => Number(item.amount) > 0)
      .slice()
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 3);
  }, [dashboard]);

  if (loading && !dashboard) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.monthLabel}>가계부</p>
          <h1>불러오는 중</h1>
        </header>
        <section className={styles.loadingCard}>
          <div className={styles.loadingLineShort} />
          <div className={styles.loadingLineLong} />
          <div className={styles.loadingGrid}><div /><div /></div>
        </section>
      </main>
    );
  }

  if (errorMessage || !dashboard) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.monthLabel}>가계부</p>
          <h1>데이터를 불러오지 못했어요</h1>
        </header>
        <section className={styles.errorCard}>
          <p>{errorMessage}</p>
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => void loadDashboard({ forceRefresh: true })}
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
          <div className={styles.summaryMeta}>
            <span>{formatMonth(dashboard.month)}</span>
            {lastUpdatedLabel && <small>갱신 {lastUpdatedLabel}</small>}
          </div>
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
            <span className={styles.summaryLabel}>순현금흐름</span>
            <strong className={monthNetCashFlow < 0 ? styles.negativeAmount : styles.netAmount}>
              {formatSignedWon(monthNetCashFlow)}
            </strong>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>이번 달 많이 쓴 곳</h2>
            <span className={styles.sectionHint}>지출 카테고리 TOP 3</span>
          </div>
        </div>

        <div className={styles.rankList}>
          {topCategories.length > 0 ? (
            topCategories.map((item, index) => (
              <div key={item.name} className={styles.rankRow}>
                <span className={styles.rankNumber}>{index + 1}</span>
                <strong className={styles.rankName}>{item.name}</strong>
                <span className={styles.rankAmount}>{formatWon(item.amount)}</span>
              </div>
            ))
          ) : (
            <p className={styles.emptyText}>이번 달 지출 내역이 없습니다.</p>
          )}
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
                        card.paymentDay ? `${card.paymentDay}일 결제` : "결제일 미설정",
                        card.owner
                      ].filter(Boolean).join(" · ")}
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
    </main>
  );
}
