import {
  type FormEvent,
  useEffect,
  useMemo,
  useState
} from "react";

import CalendarPage from "../CalendarPage/CalendarPage";

import {
  getTransactions,
  type Transaction
} from "../../api/transactions";

import {
  getAssetSnapshots,
  saveAssetSnapshot,
  type AssetSnapshot
} from "../../api/assetSnapshots";

import {
  getDashboard,
  getDashboardSnapshot
} from "../../api/dashboard";

import type {
  DashboardData
} from "../../types/dashboard";

import {
  getSeoulMonthString
} from "../../utils/dateTime";

import styles from "./HistoryPage.module.css";

type HistoryView = "calendar" | "search" | "report";
type TransactionFilter = "전체" | "지출" | "수입" | "이체";

interface HistoryPageProps {
  onAddTransaction: (date: string) => void;
}

const FILTERS: TransactionFilter[] = ["전체", "지출", "수입", "이체"];

function formatWon(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.abs(safe)).toLocaleString("ko-KR")}원`;
}

function formatSignedWon(value: number) {
  if (value > 0) return `+${formatWon(value)}`;
  if (value < 0) return `-${formatWon(value)}`;
  return "0원";
}

function formatBalanceWon(value: number) {
  if (value < 0) return `-${formatWon(value)}`;
  return formatWon(value);
}

function formatMonthLabel(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? `${match[1]}년 ${Number(match[2])}월` : month;
}

function moveMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getTransactionTitle(transaction: Transaction) {
  return transaction.memo || transaction.category || transaction.type;
}

function getTransactionMeta(transaction: Transaction) {
  if (transaction.type === "수입") {
    return [transaction.toAccount, transaction.createdBy]
      .filter(Boolean)
      .join(" · ");
  }

  if (transaction.type === "이체") {
    return [
      `${transaction.fromAccount || "출금"} → ${transaction.toAccount || "입금"}`,
      transaction.createdBy
    ].filter(Boolean).join(" · ");
  }

  return [
    transaction.paymentMethod || transaction.fromAccount,
    transaction.spendingTarget,
    transaction.createdBy
  ].filter(Boolean).join(" · ");
}

export default function HistoryPage({
  onAddTransaction
}: HistoryPageProps) {
  const [view, setView] = useState<HistoryView>("calendar");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TransactionFilter>("전체");
  const [searchItems, setSearchItems] = useState<Transaction[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [reportMonth, setReportMonth] = useState(getSeoulMonthString());
  const [report, setReport] = useState<DashboardData | null>(
    () => getDashboardSnapshot(getSeoulMonthString())
  );
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [assetSnapshots, setAssetSnapshots] = useState<AssetSnapshot[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshotFeedback, setSnapshotFeedback] = useState("");

  async function runSearch(
    event?: FormEvent,
    filterOverride: TransactionFilter = filter
  ) {
    event?.preventDefault();
    setSearchLoading(true);
    setSearchError("");

    try {
      const trimmed = query.trim();
      const normalizedNumber = trimmed.replace(/,/g, "");
      const numericQuery = /^\d+(?:\.\d+)?$/.test(normalizedNumber)
        ? Number(normalizedNumber)
        : undefined;

      const response = await getTransactions({
        type: filterOverride === "전체" ? undefined : filterOverride,
        amount: numericQuery,
        q: numericQuery === undefined && trimmed ? trimmed : undefined,
        limit: 100
      });

      setSearchItems(response.data.items || []);
      setSearchTotal(response.data.total || 0);
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "내역을 검색하지 못했습니다."
      );
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadReport(month: string, forceRefresh = false) {
    const cached = getDashboardSnapshot(month);
    if (cached) setReport(cached);
    if (!cached) setReportLoading(true);
    setReportError("");

    try {
      const data = await getDashboard(month, { forceRefresh });
      setReport(data);
    } catch (error) {
      if (!cached) {
        setReportError(
          error instanceof Error ? error.message : "리포트를 불러오지 못했습니다."
        );
      }
    } finally {
      setReportLoading(false);
    }
  }

  async function loadAssetSnapshots() {
    setSnapshotLoading(true);
    setSnapshotError("");

    try {
      const data = await getAssetSnapshots({ limit: 24 });
      setAssetSnapshots(data.items || []);
    } catch (error) {
      setSnapshotError(
        error instanceof Error
          ? error.message
          : "순자산 기록을 불러오지 못했습니다."
      );
    } finally {
      setSnapshotLoading(false);
    }
  }

  async function handleSaveSnapshot() {
    const currentMonth = getSeoulMonthString();
    if (reportMonth !== currentMonth || snapshotSaving) return;

    setSnapshotSaving(true);
    setSnapshotError("");
    setSnapshotFeedback("");

    try {
      const result = await saveAssetSnapshot(currentMonth);
      setSnapshotFeedback(
        result.updated
          ? "이번 달 순자산 기록을 최신 값으로 갱신했습니다."
          : "이번 달 순자산을 기록했습니다."
      );
      await loadAssetSnapshots();
    } catch (error) {
      setSnapshotError(
        error instanceof Error
          ? error.message
          : "순자산을 기록하지 못했습니다."
      );
    } finally {
      setSnapshotSaving(false);
    }
  }

  useEffect(() => {
    if (view === "search" && searchItems.length === 0 && !searchLoading) {
      void runSearch();
    }
  }, [view]);

  useEffect(() => {
    if (view === "report") {
      void loadReport(reportMonth);
    }
  }, [view, reportMonth]);

  useEffect(() => {
    if (view === "report") {
      void loadAssetSnapshots();
    }
  }, [view]);

  const topCategories = useMemo(
    () => (report?.categoryExpense || []).slice(0, 5),
    [report]
  );

  const spendingTargets = useMemo(
    () => (report?.spendingTargetExpense || []).filter(item => item.amount > 0),
    [report]
  );

  const selectedSnapshot = useMemo(
    () => assetSnapshots.find(item => item.month === reportMonth) || null,
    [assetSnapshots, reportMonth]
  );

  const recentSnapshots = useMemo(
    () => assetSnapshots.slice(0, 6),
    [assetSnapshots]
  );

  return (
    <>
      <div className={styles.toolbarWrap}>
        <div className={styles.toolbar} aria-label="내역 보기 방식">
          <button
            type="button"
            className={view === "calendar" ? styles.active : ""}
            onClick={() => setView("calendar")}
          >
            캘린더
          </button>
          <button
            type="button"
            className={view === "search" ? styles.active : ""}
            onClick={() => setView("search")}
          >
            검색
          </button>
          <button
            type="button"
            className={view === "report" ? styles.active : ""}
            onClick={() => setView("report")}
          >
            리포트
          </button>
        </div>
      </div>

      {view === "calendar" && (
        <CalendarPage onAddTransaction={onAddTransaction} />
      )}

      {view === "search" && (
        <main className={styles.page}>
          <header className={styles.header}>
            <h1>전체 내역 검색</h1>
            <p>메모·카테고리·계좌·지출대상 또는 정확한 금액으로 찾을 수 있습니다.</p>
          </header>

          <form className={styles.searchCard} onSubmit={runSearch}>
            <div className={styles.searchRow}>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="예: 쿠팡, 식비, 125000"
                aria-label="내역 검색어"
              />
              <button type="submit" disabled={searchLoading}>
                {searchLoading ? "검색 중" : "검색"}
              </button>
            </div>

            <div className={styles.filterRow}>
              {FILTERS.map(item => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? styles.filterActive : ""}
                  onClick={() => {
                    setFilter(item);
                    void runSearch(undefined, item);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </form>

          <div className={styles.resultHeader}>
            <strong>{searchTotal.toLocaleString("ko-KR")}건</strong>
            <span>최대 100건 표시</span>
          </div>

          {searchError && <p className={styles.error}>{searchError}</p>}

          <section className={styles.listCard}>
            {!searchLoading && searchItems.length === 0 ? (
              <p className={styles.empty}>조건에 맞는 거래가 없습니다.</p>
            ) : (
              searchItems.map(transaction => {
                const prefix = transaction.type === "수입" ? "+" : transaction.type === "지출" ? "-" : "";
                return (
                  <article key={transaction.transactionId} className={styles.transactionRow}>
                    <div className={styles.transactionMain}>
                      <span className={styles.transactionDate}>{transaction.date}</span>
                      <strong>{getTransactionTitle(transaction)}</strong>
                      <span>{getTransactionMeta(transaction)}</span>
                    </div>
                    <strong className={
                      transaction.type === "수입"
                        ? styles.income
                        : transaction.type === "지출"
                          ? styles.expense
                          : styles.transfer
                    }>
                      {prefix}{formatWon(transaction.amount)}
                    </strong>
                  </article>
                );
              })
            )}
          </section>
        </main>
      )}

      {view === "report" && (
        <main className={styles.page}>
          <header className={styles.header}>
            <h1>월간 리포트</h1>
            <p>홈에는 필요한 숫자만 두고, 자세한 분석은 여기에서 확인합니다.</p>
          </header>

          <div className={styles.monthControl}>
            <button type="button" aria-label="이전 달" onClick={() => setReportMonth(current => moveMonth(current, -1))}>‹</button>
            <strong>{formatMonthLabel(reportMonth)}</strong>
            <button
              type="button"
              aria-label="다음 달"
              disabled={reportMonth >= getSeoulMonthString()}
              onClick={() => setReportMonth(current => moveMonth(current, 1))}
            >›</button>
          </div>

          {reportLoading && !report && <p className={styles.state}>리포트를 불러오는 중입니다.</p>}
          {reportError && <p className={styles.error}>{reportError}</p>}

          {report && (
            <>
              <section className={styles.reportSummary}>
                <div><span>수입</span><strong className={styles.income}>{formatWon(report.summary.monthIncome)}</strong></div>
                <div><span>지출</span><strong className={styles.expense}>{formatWon(report.summary.monthExpense)}</strong></div>
                <div><span>순현금흐름</span><strong>{formatSignedWon(report.summary.monthNetCashFlow)}</strong></div>
              </section>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>카테고리별 지출</h2>
                  <span>상위 5개</span>
                </div>
                <div className={styles.rankList}>
                  {topCategories.length ? topCategories.map((item, index) => (
                    <div key={item.name} className={styles.rankRow}>
                      <span>{index + 1}</span>
                      <strong>{item.name}</strong>
                      <b>{formatWon(item.amount)}</b>
                    </div>
                  )) : <p className={styles.empty}>이 달의 지출이 없습니다.</p>}
                </div>
              </section>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>지출대상별</h2>
                  <span>상세 분석용</span>
                </div>
                <div className={styles.targetGrid}>
                  {spendingTargets.length ? spendingTargets.map(item => (
                    <div key={item.name}>
                      <span>{item.name}</span>
                      <strong>{formatWon(item.amount)}</strong>
                    </div>
                  )) : <p className={styles.empty}>분류된 지출이 없습니다.</p>}
                </div>
              </section>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>순자산 기록</h2>
                  <span>월 1회 스냅샷</span>
                </div>

                <div className={styles.snapshotCard}>
                  {selectedSnapshot ? (
                    <div className={styles.snapshotCurrent}>
                      <div>
                        <span>{formatMonthLabel(selectedSnapshot.month)} 순자산</span>
                        <strong>{formatBalanceWon(selectedSnapshot.netWorth)}</strong>
                      </div>
                      <small>
                        자산 {formatWon(selectedSnapshot.assets)} · 부채 {formatWon(selectedSnapshot.liabilities)}
                        {selectedSnapshot.updatedBy ? ` · 기록 ${selectedSnapshot.updatedBy}` : ""}
                      </small>
                    </div>
                  ) : (
                    <p className={styles.empty}>이 달에 저장된 순자산 기록이 없습니다.</p>
                  )}

                  {reportMonth === getSeoulMonthString() && (
                    <div className={styles.snapshotActions}>
                      <button
                        type="button"
                        onClick={() => void handleSaveSnapshot()}
                        disabled={snapshotSaving}
                      >
                        {snapshotSaving
                          ? "기록 중..."
                          : selectedSnapshot
                            ? "현재 값으로 다시 기록"
                            : "현재 순자산 기록"}
                      </button>
                      <small>현재 계좌·투자 평가액을 이달 기록으로 저장하며 수입·지출 통계에는 영향을 주지 않습니다.</small>
                    </div>
                  )}

                  {snapshotFeedback && <p className={styles.feedback}>{snapshotFeedback}</p>}
                  {snapshotError && <p className={styles.error}>{snapshotError}</p>}
                  {snapshotLoading && !assetSnapshots.length && <p className={styles.state}>순자산 기록을 불러오는 중입니다.</p>}
                </div>

                {recentSnapshots.length > 0 && (
                  <div className={styles.snapshotHistory}>
                    {recentSnapshots.map(item => (
                      <div key={item.month}>
                        <span>{formatMonthLabel(item.month)}</span>
                        <strong>{formatBalanceWon(item.netWorth)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>

            </>
          )}
        </main>
      )}
    </>
  );
}
