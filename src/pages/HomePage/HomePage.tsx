import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  getDashboard,
  getDashboardSnapshot,
  getDashboardSnapshotInfo
} from "../../api/dashboard";

import { getBootstrap } from "../../api/bootstrap";
import type { RecurringTransactionRule } from "../../api/automation";

import {
  getTransactions,
  type Transaction
} from "../../api/transactions";

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

import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { Money, formatMoney } from "../../components/common/Money/Money";
import { DataFreshnessNotice } from "../../components/common/DataFreshnessNotice/DataFreshnessNotice";
import PwaInstallPrompt from "../../components/pwa/PwaInstallPrompt/PwaInstallPrompt";

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
  paymentAccountId: string | null;
  paymentAccountName: string | null;
  paymentAccountBalance: number | null;
  paymentAccountScheduledTotal: number;
  paymentAccountShortage: number;
}

interface UpcomingOutflowItem {
  id: string;
  date: string;
  label: string;
  meta: string;
  amount: number;
  kind: "card" | "recurring";
  shortage?: number;
}

function formatMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${match[1]}년 ${Number(match[2])}월`;
}

function getMonthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return { dateFrom: `${month}-01`, dateTo: `${month}-31` };
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, "0")}`
  };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateForMonthDay(month: string, day: number | null) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match || !day) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const safeDay = Math.min(Math.max(1, day), daysInMonth(year, monthNumber));
  return `${match[1]}-${match[2]}-${String(safeDay).padStart(2, "0")}`;
}

function addMonths(month: string, delta: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dateDistance(from: string, to: string) {
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!fromMatch || !toMatch) return Number.POSITIVE_INFINITY;
  const fromUtc = Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]));
  const toUtc = Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]));
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

function formatUpcomingDate(date: string) {
  const today = getSeoulDateString();
  const distance = dateDistance(today, date);
  const [, month = "", day = ""] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) || [];
  const dateLabel = month && day ? `${Number(month)}/${Number(day)}` : date;
  if (distance === 0) return `오늘 · ${dateLabel}`;
  if (distance === 1) return `내일 · ${dateLabel}`;
  if (distance > 1 && distance <= 7) return `D-${distance} · ${dateLabel}`;
  return dateLabel;
}

function nextRecurringDate(rule: RecurringTransactionRule, today: string) {
  if (!rule.enabled || !(rule.amount > 0)) return null;
  const todayMonth = today.slice(0, 7);
  for (const month of [todayMonth, addMonths(todayMonth, 1)]) {
    if (rule.startMonth && month < rule.startMonth) continue;
    if (rule.endMonth && month > rule.endMonth) continue;
    const date = dateForMonthDay(month, rule.dayOfMonth);
    if (!date || date < today) continue;
    return date;
  }
  return null;
}

function getTransactionTitle(transaction: Transaction) {
  return transaction.description || transaction.category || transaction.type;
}

function getTransactionMeta(transaction: Transaction) {
  const method = transaction.type === "수입"
    ? transaction.toAccount
    : transaction.type === "이체"
      ? `${transaction.fromAccount || "출금"} → ${transaction.toAccount || "입금"}`
      : transaction.paymentMethod || transaction.fromAccount;

  return [
    transaction.description ? transaction.category : "",
    method,
    transaction.type === "지출" ? transaction.spendingTarget : "",
    transaction.createdBy
  ].filter(Boolean).join(" · ");
}

interface HomePageProps {
  onCopyTransaction?: (transaction: Transaction) => void;
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

export default function HomePage({
  onCopyTransaction
}: HomePageProps) {
  const [needsInitialRefresh] = useState(() => isLedgerDirty());
  const [initialDashboardInfo] = useState(
    () => getDashboardSnapshotInfo()
  );
  const initialDashboard = initialDashboardInfo?.data ?? null;
  const [dashboard, setDashboard] = useState<DashboardData | null>(
    initialDashboard
  );
  const [fallbackSnapshotAt, setFallbackSnapshotAt] = useState<number | null>(
    initialDashboardInfo?.source === "persisted"
      ? initialDashboardInfo.fetchedAt
      : null
  );
  const [loading, setLoading] = useState(initialDashboard === null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState("");
  const [detailType, setDetailType] = useState<"수입" | "지출" | null>(null);
  const [detailItems, setDetailItems] = useState<Transaction[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [recurringRules, setRecurringRules] = useState<RecurringTransactionRule[]>([]);

  useEffect(() => {
    if (!detailType) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailType(null);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailType]);

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
      setFallbackSnapshotAt(null);
      clearLedgerDirty();
      markBackgroundRefreshed("dashboard");
      setLastUpdatedLabel(getSeoulTimestampLabel());
      setErrorMessage("");
    } catch (error) {
      const fallbackInfo = getDashboardSnapshotInfo();
      const fallback = fallbackInfo?.data ?? null;

      if (fallback) {
        setDashboard(fallback);
        setFallbackSnapshotAt(fallbackInfo?.fetchedAt ?? null);
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
        setFallbackSnapshotAt(null);
        clearLedgerDirty();
        markBackgroundRefreshed("dashboard");
        setLastUpdatedLabel(getSeoulTimestampLabel());
        setErrorMessage("");
      } catch (error) {
        if (cancelled) return;

        const fallbackInfo = getDashboardSnapshotInfo();
        if (fallbackInfo) {
          setDashboard(fallbackInfo.data);
          setFallbackSnapshotAt(fallbackInfo.fetchedAt);
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "가계부 데이터를 불러오지 못했습니다."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (
      needsInitialRefresh ||
      !initialDashboard ||
      initialDashboardInfo?.source === "persisted"
    ) {
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

  useEffect(() => {
    let active = true;
    void getBootstrap()
      .then(response => {
        if (!active) return;
        setRecurringRules(response.data?.automationSettings?.recurringRules || []);
      })
      .catch(() => {
        // 예정 지출 보조 정보가 없어도 홈의 핵심 데이터는 그대로 표시합니다.
      });
    return () => {
      active = false;
    };
  }, []);

  async function openMonthlyDetail(type: "수입" | "지출") {
    if (!dashboard) return;

    setDetailType(type);
    setDetailItems([]);
    setDetailError("");
    setDetailLoading(true);

    const range = getMonthRange(dashboard.month);

    try {
      const response = await getTransactions({
        ...range,
        type,
        limit: 500
      });
      setDetailItems(response.data.items || []);
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : "거래 내역을 불러오지 못했습니다."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  const cardSummary = useMemo(() => {
    if (!dashboard) {
      return { total: 0, cards: [] as DashboardCardView[] };
    }

    const accountMap = new Map<string, DashboardAccount>(
      (Array.isArray(dashboard.accounts) ? dashboard.accounts : [])
        .map(account => [account.accountId, account] as const)
    );

    const baseCards = (Array.isArray(dashboard.cards) ? dashboard.cards : [])
      .filter(card => Number(card.estimatedRemaining) > 0)
      .map(card => {
        const account = accountMap.get(card.accountId);

        return {
          ...card,
          name: card.accountName || account?.displayName || "신용카드",
          paymentDay: account?.paymentDay ?? null,
          owner: account?.owner || "",
          paymentAccountId: account?.paymentAccountId ?? null
        };
      });

    const scheduledByPaymentAccount = new Map<string, number>();
    for (const card of baseCards) {
      if (!card.paymentAccountId) continue;
      scheduledByPaymentAccount.set(
        card.paymentAccountId,
        (scheduledByPaymentAccount.get(card.paymentAccountId) || 0) + Math.max(0, Number(card.estimatedRemaining) || 0)
      );
    }

    const cards = baseCards
      .map(card => {
        const paymentAccount = card.paymentAccountId
          ? accountMap.get(card.paymentAccountId)
          : undefined;
        const paymentAccountBalance = paymentAccount
          ? Number(paymentAccount.currentBalance || 0)
          : null;
        const paymentAccountScheduledTotal = card.paymentAccountId
          ? scheduledByPaymentAccount.get(card.paymentAccountId) || 0
          : 0;
        const paymentAccountShortage = paymentAccountBalance === null
          ? 0
          : Math.max(0, paymentAccountScheduledTotal - Math.max(0, paymentAccountBalance));

        return {
          ...card,
          paymentAccountName: paymentAccount?.displayName || paymentAccount?.accountName || null,
          paymentAccountBalance,
          paymentAccountScheduledTotal,
          paymentAccountShortage
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

  const upcomingOutflows = useMemo(() => {
    if (!dashboard) return { total: 0, items: [] as UpcomingOutflowItem[] };
    const today = getSeoulDateString();
    const accountMap = new Map(
      (dashboard.accounts || []).map(account => [account.accountId, account] as const)
    );
    const items: UpcomingOutflowItem[] = [];

    for (const card of cardSummary.cards) {
      const dueDate = dateForMonthDay(card.billingMonth, card.paymentDay);
      if (!dueDate) continue;
      const distance = dateDistance(today, dueDate);
      if (distance < 0 || distance > 7) continue;
      items.push({
        id: `card:${card.accountId}:${card.billingMonth}`,
        date: dueDate,
        label: `${card.name} 결제`,
        meta: [
          card.paymentAccountName || "결제계좌 미설정",
          formatUpcomingDate(dueDate)
        ].join(" · "),
        amount: Math.max(0, Number(card.estimatedRemaining) || 0),
        kind: "card",
        shortage: card.paymentAccountShortage
      });
    }

    for (const rule of recurringRules) {
      if (!rule.enabled || rule.type === "수입") continue;
      const paymentAccount = rule.paymentMethodId
        ? accountMap.get(rule.paymentMethodId)
        : undefined;
      if (rule.type === "지출" && paymentAccount?.subType === "신용카드") {
        continue;
      }
      const date = nextRecurringDate(rule, today);
      if (!date) continue;
      const distance = dateDistance(today, date);
      // 오늘 날짜의 자동 정기거래는 Cron에서 이미 장부에 반영됐을 수 있으므로
      // 잔액과 예정액을 동시에 차감해 보이는 일을 피하고 내일부터 표시합니다.
      if (distance <= 0 || distance > 7) continue;
      const sourceAccount = rule.type === "이체" && rule.fromAccountId
        ? accountMap.get(rule.fromAccountId)
        : paymentAccount;
      items.push({
        id: `recurring:${rule.id}:${date}`,
        date,
        label: rule.name || rule.description || (rule.type === "이체" ? "정기 이체" : "정기 지출"),
        meta: [
          rule.type === "이체" ? "정기 이체" : "정기 지출",
          sourceAccount?.displayName || sourceAccount?.accountName || "",
          formatUpcomingDate(date)
        ].filter(Boolean).join(" · "),
        amount: Math.max(0, Number(rule.amount) || 0),
        kind: "recurring"
      });
    }

    items.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    return {
      total: items.reduce((sum, item) => sum + item.amount, 0),
      items
    };
  }, [dashboard, cardSummary.cards, recurringRules]);

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
        <Card as="section" className={styles.loadingCard}>
          <div className={styles.loadingLineShort} />
          <div className={styles.loadingLineLong} />
          <div className={styles.loadingGrid}><div /><div /></div>
        </Card>
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
        <Card as="section" className={styles.errorCard}>
          <p>{errorMessage}</p>
          <Button
            fullWidth
            size="lg"
            onClick={() => void loadDashboard({ forceRefresh: true })}
          >
            다시 불러오기
          </Button>
        </Card>
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

      {fallbackSnapshotAt && (
        <DataFreshnessNotice fetchedAt={fallbackSnapshotAt} />
      )}

      <Card as="section" className={styles.summaryCard}>
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
              <Money amount={netWorth} />
            </strong>
          </div>
          <button
            type="button"
            className={[styles.summaryRow, styles.summaryRowButton].join(" ")}
            onClick={() => void openMonthlyDetail("수입")}
          >
            <span className={styles.summaryLabel}>수입 <small>내역 보기</small></span>
            <strong className={styles.incomeAmount}><Money amount={monthIncome} absolute tone="income" /></strong>
          </button>
          <button
            type="button"
            className={[styles.summaryRow, styles.summaryRowButton].join(" ")}
            onClick={() => void openMonthlyDetail("지출")}
          >
            <span className={styles.summaryLabel}>지출 <small>내역 보기</small></span>
            <strong className={styles.expenseAmount}><Money amount={monthExpense} absolute tone="expense" /></strong>
          </button>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>순현금흐름</span>
            <strong className={monthNetCashFlow < 0 ? styles.negativeAmount : styles.netAmount}>
              <Money amount={monthNetCashFlow} showPlus tone={monthNetCashFlow < 0 ? "negative" : "positive"} />
            </strong>
          </div>
        </div>
      </Card>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>이번 달 많이 쓴 곳</h2>
            <span className={styles.sectionHint}>지출 카테고리 TOP 3</span>
          </div>
        </div>

        <Card padding="none" className={styles.rankList}>
          {topCategories.length > 0 ? (
            topCategories.map((item, index) => (
              <div key={item.name} className={styles.rankRow}>
                <span className={styles.rankNumber}>{index + 1}</span>
                <strong className={styles.rankName}>{item.name}</strong>
                <span className={styles.rankAmount}><Money amount={item.amount} absolute /></span>
              </div>
            ))
          ) : (
            <p className={styles.emptyText}>이번 달 지출 내역이 없습니다.</p>
          )}
        </Card>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>카드 결제 예정</h2>
            <span className={styles.sectionHint}>결제계좌 잔액과 부족 예상액까지 확인</span>
          </div>
          <strong className={styles.sectionTotal}><Money amount={cardSummary.total} absolute /></strong>
        </div>

        <Card padding="none" className={styles.cardList}>
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
                    <small className={styles.cardAccountMeta}>
                      {card.paymentAccountName
                        ? `${card.paymentAccountName} 잔액 ${formatMoney(card.paymentAccountBalance || 0)}`
                        : "결제계좌 미설정"}
                    </small>
                  </div>
                </div>
                <div className={styles.cardAmountBlock}>
                  <strong className={styles.cardAmount}>
                    <Money amount={card.estimatedRemaining} absolute />
                  </strong>
                  {card.paymentAccountShortage > 0 && (
                    <span className={styles.shortageBadge}>
                      부족 <Money amount={card.paymentAccountShortage} absolute />
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className={styles.emptyText}>이번 달 결제 예정액이 없습니다.</p>
          )}
        </Card>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>앞으로 나갈 돈</h2>
            <span className={styles.sectionHint}>7일 안에 예정된 카드대금·정기 지출</span>
          </div>
          <strong className={styles.sectionTotal}><Money amount={upcomingOutflows.total} absolute /></strong>
        </div>

        <Card padding="none" className={styles.upcomingList}>
          {upcomingOutflows.items.length > 0 ? (
            upcomingOutflows.items.map(item => (
              <div key={item.id} className={styles.upcomingRow}>
                <span
                  className={[
                    styles.upcomingIcon,
                    item.kind === "card" ? styles.upcomingIconCard : styles.upcomingIconRecurring
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {item.kind === "card" ? "C" : "↻"}
                </span>
                <div className={styles.upcomingCopy}>
                  <strong>{item.label}</strong>
                  <span>{item.meta}</span>
                  {item.shortage && item.shortage > 0 ? (
                    <small>결제계좌 부족 예상 <Money amount={item.shortage} absolute /></small>
                  ) : null}
                </div>
                <strong className={styles.upcomingAmount}><Money amount={item.amount} absolute /></strong>
              </div>
            ))
          ) : (
            <p className={styles.emptyText}>7일 안에 예정된 출금이 없습니다.</p>
          )}
        </Card>
      </section>

      <PwaInstallPrompt />

      {detailType && (
        <div
          className={styles.detailBackdrop}
          role="presentation"
          onClick={() => setDetailType(null)}
        >
          <section
            className={styles.detailModal}
            role="dialog"
            aria-modal="true"
            aria-label={`${formatMonth(dashboard.month)} ${detailType} 내역`}
            onClick={event => event.stopPropagation()}
          >
            <div className={styles.detailHeader}>
              <div>
                <strong>{formatMonth(dashboard.month)} {detailType} 내역</strong>
                <span>{detailItems.length.toLocaleString("ko-KR")}건</span>
              </div>
              <Button className={styles.detailClose} variant="soft" size="sm" iconOnly aria-label="닫기" onClick={() => setDetailType(null)}>×</Button>
            </div>

            {detailLoading && <p className={styles.detailState}>내역을 불러오는 중입니다.</p>}
            {!detailLoading && detailError && <p className={styles.detailError}>{detailError}</p>}
            {!detailLoading && !detailError && detailItems.length === 0 && (
              <p className={styles.detailState}>해당 거래가 없습니다.</p>
            )}

            {!detailLoading && !detailError && detailItems.length > 0 && (
              <div className={styles.detailList}>
                {detailItems.map(transaction => (
                  <article key={transaction.transactionId} className={styles.detailRow}>
                    <div>
                      <span>{transaction.date}</span>
                      <strong>{getTransactionTitle(transaction)}</strong>
                      <small>{getTransactionMeta(transaction)}</small>
                      {transaction.memo && <em>{transaction.memo}</em>}
                    </div>
                    <div className={styles.detailRowActions}>
                      <b className={detailType === "수입" ? styles.incomeAmount : styles.expenseAmount}>
                        <Money
                          amount={detailType === "수입" ? transaction.amount : -transaction.amount}
                          showPlus={detailType === "수입"}
                          tone={detailType === "수입" ? "income" : "expense"}
                        />
                      </b>
                      {onCopyTransaction && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onCopyTransaction(transaction)}
                        >
                          복사 입력
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
