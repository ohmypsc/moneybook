import {
  type FormEvent,
  useEffect,
  useMemo,
  useState
} from "react";

import CalendarPage from "../CalendarPage/CalendarPage";

import { getBootstrap } from "../../api/bootstrap";

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

import type { BootstrapData } from "../../types/bootstrap";

import {
  getSeoulMonthString
} from "../../utils/dateTime";

import {
  subscribeLedgerChanges
} from "../../utils/ledgerEvents";

import {
  isPreDiscountBenefitTransaction
} from "../../utils/transactionBenefits";

import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { Money, formatMoney } from "../../components/common/Money/Money";

import styles from "./HistoryPage.module.css";

type HistoryView = "calendar" | "search" | "report";
type TransactionFilter = "전체" | "지출" | "수입" | "이체";

interface HistoryPageProps {
  onAddTransaction: (date: string) => void;
  onCopyTransaction?: (transaction: Transaction) => void;
}

const FILTERS: TransactionFilter[] = ["전체", "지출", "수입", "이체"];
const SEARCH_PAGE_SIZE = 100;

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
  if (isPreDiscountBenefitTransaction(transaction)) return "선할인 혜택";
  return transaction.description || transaction.category || transaction.type;
}

function getTransactionMeta(transaction: Transaction) {
  if (isPreDiscountBenefitTransaction(transaction)) {
    return "충전 선할인 혜택 · 수입 합계 제외";
  }

  if (transaction.type === "수입") {
    return [transaction.description ? transaction.category : "", transaction.toAccount, transaction.createdBy]
      .filter(Boolean)
      .join(" · ");
  }

  if (transaction.type === "이체") {
    return [
      transaction.description ? transaction.category : "",
      `${transaction.fromAccount || "출금"} → ${transaction.toAccount || "입금"}`,
      transaction.createdBy
    ].filter(Boolean).join(" · ");
  }

  return [
    transaction.description ? transaction.category : "",
    transaction.paymentMethod || transaction.fromAccount,
    transaction.spendingTarget,
    transaction.createdBy
  ].filter(Boolean).join(" · ");
}

export default function HistoryPage({
  onAddTransaction,
  onCopyTransaction
}: HistoryPageProps) {
  const [view, setView] = useState<HistoryView>("calendar");
  const [calendarEditTarget, setCalendarEditTarget] = useState<{
    transactionId: string;
    date: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TransactionFilter>("전체");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchCategoryId, setSearchCategoryId] = useState("");
  const [searchAccountId, setSearchAccountId] = useState("");
  const [searchSpendingTarget, setSearchSpendingTarget] = useState("");
  const [searchBootstrap, setSearchBootstrap] = useState<BootstrapData | null>(null);
  const [searchItems, setSearchItems] = useState<Transaction[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
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
  const [ledgerVersion, setLedgerVersion] = useState(0);

  async function runSearch(
    event?: FormEvent,
    options: { append?: boolean } = {}
  ) {
    event?.preventDefault();

    if (searchDateFrom && searchDateTo && searchDateFrom > searchDateTo) {
      setSearchError("조회 시작일은 종료일보다 늦을 수 없습니다.");
      return;
    }

    const append = Boolean(options.append);
    if (append) {
      setSearchLoadingMore(true);
    } else {
      setSearchLoading(true);
    }
    setSearchError("");

    try {
      const trimmed = query.trim();
      const normalizedNumber = trimmed.replace(/,/g, "");
      const numericQuery = /^\d+(?:\.\d+)?$/.test(normalizedNumber)
        ? Number(normalizedNumber)
        : undefined;

      const response = await getTransactions({
        dateFrom: searchDateFrom || undefined,
        dateTo: searchDateTo || undefined,
        type: filter === "전체" ? undefined : filter,
        categoryId: searchCategoryId || undefined,
        accountId: searchAccountId || undefined,
        spendingTarget: searchSpendingTarget || undefined,
        amount: numericQuery,
        q: numericQuery === undefined && trimmed ? trimmed : undefined,
        limit: SEARCH_PAGE_SIZE,
        offset: append ? searchItems.length : 0
      });

      const activeItems = (response.data.items || []).filter(
        transaction => !transaction.isDeleted
      );

      setSearchItems(current =>
        append ? [...current, ...activeItems] : activeItems
      );
      setSearchTotal(response.data.total || 0);
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "내역을 검색하지 못했습니다."
      );
    } finally {
      if (append) {
        setSearchLoadingMore(false);
      } else {
        setSearchLoading(false);
      }
    }
  }

  function openSearchResultForEdit(transaction: Transaction) {
    setCalendarEditTarget({
      transactionId: transaction.transactionId,
      date: transaction.date
    });
    setView("calendar");
  }

  function resetSearchFilters() {
    setQuery("");
    setFilter("전체");
    setSearchDateFrom("");
    setSearchDateTo("");
    setSearchCategoryId("");
    setSearchAccountId("");
    setSearchSpendingTarget("");
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
    return subscribeLedgerChanges(() => {
      setLedgerVersion(value => value + 1);
    });
  }, []);

  useEffect(() => {
    if (view === "search") {
      void runSearch();
    }
  }, [view, ledgerVersion]);

  useEffect(() => {
    if (view !== "search" || searchBootstrap) return;

    let active = true;
    void getBootstrap()
      .then(response => {
        if (active && response.success && response.data) {
          setSearchBootstrap(response.data);
        }
      })
      .catch(() => {
        /* 검색 자체는 마스터 필터 없이도 사용할 수 있습니다. */
      });

    return () => {
      active = false;
    };
  }, [view, searchBootstrap]);

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

  const searchCategories = useMemo(
    () => (searchBootstrap?.categories || [])
      .filter(category => category.active && !category.isDeleted)
      .filter(category => filter === "전체" || category.type === filter)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [searchBootstrap, filter]
  );

  const searchAccounts = useMemo(
    () => (searchBootstrap?.accounts || [])
      .filter(account => account.active && !account.isDeleted)
      .slice()
      .sort((a, b) => (a.displayName || a.accountName).localeCompare(b.displayName || b.accountName, "ko")),
    [searchBootstrap]
  );

  const selectedSnapshot = useMemo(
    () => assetSnapshots.find(item => item.month === reportMonth) || null,
    [assetSnapshots, reportMonth]
  );

  const recentSnapshots = useMemo(
    () => assetSnapshots.slice(0, 6),
    [assetSnapshots]
  );

  const monthlyTrend = report?.monthlyTrend || [];
  const monthlyTrendMax = Math.max(
    1,
    ...monthlyTrend.flatMap(item => [Math.abs(item.income), Math.abs(item.expense)])
  );

  const netWorthTrend = useMemo(
    () => assetSnapshots.slice().reverse(),
    [assetSnapshots]
  );
  const netWorthTrendMax = Math.max(
    1,
    ...netWorthTrend.map(item => Math.abs(item.netWorth))
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
        <CalendarPage
          onAddTransaction={onAddTransaction}
          openTransaction={calendarEditTarget}
        />
      )}

      {view === "search" && (
        <main className={styles.page}>
          <header className={styles.header}>
            <h1>전체 내역 검색</h1>
            <p>내용·메모·카테고리·계좌·지출대상 또는 정확한 금액으로 찾을 수 있습니다.</p>
          </header>

          <Card as="form" padding="sm" onSubmit={runSearch}>
            <div className={styles.searchRow}>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="예: 쿠팡, 식비, 125000"
                aria-label="내역 검색어"
              />
              <Button type="submit" loading={searchLoading} loadingLabel="검색 중">
                검색
              </Button>
            </div>

            <div className={styles.filterRow}>
              {FILTERS.map(item => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? styles.filterActive : ""}
                  onClick={() => {
                    setFilter(item);
                    const selected = searchBootstrap?.categories.find(
                      category => category.categoryId === searchCategoryId
                    );
                    if (selected && item !== "전체" && selected.type !== item) {
                      setSearchCategoryId("");
                    }
                  }}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className={styles.advancedFilters}>
              <label>
                <span>시작일</span>
                <input
                  type="date"
                  value={searchDateFrom}
                  onChange={event => setSearchDateFrom(event.target.value)}
                />
              </label>
              <label>
                <span>종료일</span>
                <input
                  type="date"
                  value={searchDateTo}
                  onChange={event => setSearchDateTo(event.target.value)}
                />
              </label>
              <label>
                <span>카테고리</span>
                <select
                  value={searchCategoryId}
                  onChange={event => setSearchCategoryId(event.target.value)}
                >
                  <option value="">전체 카테고리</option>
                  {searchCategories.map(category => (
                    <option key={category.categoryId} value={category.categoryId}>
                      {filter === "전체" ? `${category.type} · ` : ""}{category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>계좌·카드</span>
                <select
                  value={searchAccountId}
                  onChange={event => setSearchAccountId(event.target.value)}
                >
                  <option value="">전체 계좌·카드</option>
                  {searchAccounts.map(account => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.displayName || account.accountName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>지출대상</span>
                <select
                  value={searchSpendingTarget}
                  onChange={event => setSearchSpendingTarget(event.target.value)}
                >
                  <option value="">전체 지출대상</option>
                  {(searchBootstrap?.spendingTargets || []).map(target => (
                    <option key={target} value={target}>{target}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.searchActions}>
              <Button type="button" variant="ghost" size="sm" onClick={resetSearchFilters}>
                조건 초기화
              </Button>
            </div>
          </Card>

          <div className={styles.resultHeader}>
            <strong>{searchTotal.toLocaleString("ko-KR")}건</strong>
            <span>{searchItems.length.toLocaleString("ko-KR")}건 표시 중</span>
          </div>

          {searchError && <p className={styles.error}>{searchError}</p>}

          <Card as="section" padding="none" className={styles.listCard}>
            {!searchLoading && searchItems.length === 0 ? (
              <p className={styles.empty}>조건에 맞는 거래가 없습니다.</p>
            ) : (
              searchItems.map(transaction => {
                const isPreDiscountBenefit = isPreDiscountBenefitTransaction(transaction);

                return (
                  <article key={transaction.transactionId} className={styles.transactionRow}>
                    <div className={styles.transactionMain}>
                      <span className={styles.transactionDate}>{transaction.date}</span>
                      <strong>{getTransactionTitle(transaction)}</strong>
                      <span>{getTransactionMeta(transaction)}</span>
                    </div>
                    <div className={styles.transactionActions}>
                      <strong className={
                        isPreDiscountBenefit
                          ? styles.transfer
                          : transaction.type === "수입"
                            ? styles.income
                            : transaction.type === "지출"
                              ? styles.expense
                              : styles.transfer
                      }>
                        <Money
                          amount={transaction.type === "지출" ? -transaction.amount : transaction.amount}
                          showPlus={transaction.type === "수입"}
                          tone={
                            isPreDiscountBenefit
                              ? "muted"
                              : transaction.type === "수입"
                                ? "income"
                                : transaction.type === "지출"
                                  ? "expense"
                                  : "muted"
                          }
                        />
                      </strong>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openSearchResultForEdit(transaction)}
                      >
                        수정
                      </Button>
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
                );
              })
            )}
          </Card>

          {searchItems.length < searchTotal && (
            <div className={styles.loadMore}>
              <Button
                variant="secondary"
                fullWidth
                loading={searchLoadingMore}
                loadingLabel="불러오는 중"
                onClick={() => void runSearch(undefined, { append: true })}
              >
                {Math.min(SEARCH_PAGE_SIZE, searchTotal - searchItems.length).toLocaleString("ko-KR")}건 더 보기
              </Button>
            </div>
          )}
        </main>
      )}

      {view === "report" && (
        <main className={styles.page}>
          <header className={styles.header}>
            <h1>월간 리포트</h1>
            <p>홈에는 필요한 숫자만 두고, 자세한 분석은 여기에서 확인합니다.</p>
          </header>

          <div className={styles.monthControl}>
            <Button variant="ghost" size="sm" iconOnly aria-label="이전 달" onClick={() => setReportMonth(current => moveMonth(current, -1))}>‹</Button>
            <strong>{formatMonthLabel(reportMonth)}</strong>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="다음 달"
              disabled={reportMonth >= getSeoulMonthString()}
              onClick={() => setReportMonth(current => moveMonth(current, 1))}
            >›</Button>
          </div>

          {reportLoading && !report && <p className={styles.state}>리포트를 불러오는 중입니다.</p>}
          {reportError && <p className={styles.error}>{reportError}</p>}

          {report && (
            <>
              <Card as="section" padding="none" className={styles.reportSummary}>
                <div><span>수입</span><strong><Money amount={report.summary.monthIncome} absolute tone="income" /></strong></div>
                <div><span>지출</span><strong><Money amount={report.summary.monthExpense} absolute tone="expense" /></strong></div>
                <div><span>순현금흐름</span><strong><Money amount={report.summary.monthNetCashFlow} showPlus tone={report.summary.monthNetCashFlow < 0 ? "negative" : "positive"} /></strong></div>
              </Card>

              <Card padding="sm" tone="soft" shadow="none" className={styles.grossBreakdown}>
                <div>
                  <span>총 지출</span>
                  <strong><Money amount={report.summary.monthExpenseGross} absolute /></strong>
                </div>
                <div>
                  <span>환불</span>
                  <strong><Money amount={report.summary.monthRefunds} absolute tone="positive" /></strong>
                </div>
                <div>
                  <span>순지출</span>
                  <strong><Money amount={report.summary.monthExpense} absolute tone="expense" /></strong>
                </div>
              </Card>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>6개월 현금흐름</h2>
                  <span>수입 · 지출</span>
                </div>
                <Card padding="sm" className={styles.trendCard}>
                  <div className={styles.trendLegend}>
                    <span><i className={styles.incomeDot} />수입</span>
                    <span><i className={styles.expenseDot} />지출</span>
                  </div>
                  <div className={styles.trendBars}>
                    {monthlyTrend.map(item => (
                      <div
                        key={item.month}
                        className={styles.trendMonth}
                        title={`${formatMonthLabel(item.month)} · 수입 ${formatMoney(item.income)} · 지출 ${formatMoney(item.expense)}`}
                      >
                        <div className={styles.trendBarArea}>
                          <span
                            className={styles.incomeBar}
                            style={{ height: `${Math.max(3, Math.abs(item.income) / monthlyTrendMax * 100)}%` }}
                          />
                          <span
                            className={styles.expenseBar}
                            style={{ height: `${Math.max(3, Math.abs(item.expense) / monthlyTrendMax * 100)}%` }}
                          />
                        </div>
                        <small>{Number(item.month.slice(5))}월</small>
                      </div>
                    ))}
                  </div>
                </Card>
              </section>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>카테고리별 지출</h2>
                  <span>상위 5개</span>
                </div>
                <Card padding="none" className={styles.rankList}>
                  {topCategories.length ? topCategories.map((item, index) => (
                    <div key={item.name} className={styles.rankRow}>
                      <span>{index + 1}</span>
                      <strong>{item.name}</strong>
                      <b><Money amount={item.amount} absolute /></b>
                    </div>
                  )) : <p className={styles.empty}>이 달의 지출이 없습니다.</p>}
                </Card>
              </section>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>지출대상별</h2>
                  <span>상세 분석용</span>
                </div>
                <Card padding="sm" className={styles.targetGrid}>
                  {spendingTargets.length ? spendingTargets.map(item => (
                    <div key={item.name}>
                      <span>{item.name}</span>
                      <strong><Money amount={item.amount} absolute /></strong>
                    </div>
                  )) : <p className={styles.empty}>분류된 지출이 없습니다.</p>}
                </Card>
              </section>

              <section className={styles.reportSection}>
                <div className={styles.sectionTitle}>
                  <h2>순자산 기록</h2>
                  <span>월 1회 스냅샷</span>
                </div>

                <Card padding="none" className={styles.snapshotCard}>
                  {selectedSnapshot ? (
                    <div className={styles.snapshotCurrent}>
                      <div>
                        <span>{formatMonthLabel(selectedSnapshot.month)} 순자산</span>
                        <strong><Money amount={selectedSnapshot.netWorth} /></strong>
                      </div>
                      <small>
                        자산 <Money amount={selectedSnapshot.assets} absolute /> · 부채 <Money amount={selectedSnapshot.liabilities} absolute />
                        {selectedSnapshot.updatedBy ? ` · 기록 ${selectedSnapshot.updatedBy}` : ""}
                      </small>
                    </div>
                  ) : (
                    <p className={styles.empty}>이 달에 저장된 순자산 기록이 없습니다.</p>
                  )}

                  {reportMonth === getSeoulMonthString() && (
                    <div className={styles.snapshotActions}>
                      <Button
                        size="sm"
                        fullWidth
                        loading={snapshotSaving}
                        loadingLabel="기록 중..."
                        onClick={() => void handleSaveSnapshot()}
                      >
                        {selectedSnapshot ? "현재 값으로 다시 기록" : "현재 순자산 기록"}
                      </Button>
                      <small>현재 계좌·투자 평가액을 이달 기록으로 저장하며 수입·지출 통계에는 영향을 주지 않습니다.</small>
                    </div>
                  )}

                  {snapshotFeedback && <p className={styles.feedback}>{snapshotFeedback}</p>}
                  {snapshotError && <p className={styles.error}>{snapshotError}</p>}
                  {snapshotLoading && !assetSnapshots.length && <p className={styles.state}>순자산 기록을 불러오는 중입니다.</p>}
                </Card>

                {netWorthTrend.length > 1 && (
                  <Card padding="sm" className={styles.netWorthTrendCard}>
                    <div className={styles.netWorthTrendBars}>
                      {netWorthTrend.map(item => (
                        <div
                          key={item.month}
                          className={styles.netWorthTrendMonth}
                          title={`${formatMonthLabel(item.month)} · 순자산 ${formatMoney(item.netWorth)}`}
                        >
                          <div className={styles.netWorthBarArea}>
                            <span
                              className={item.netWorth < 0 ? styles.netWorthBarNegative : styles.netWorthBar}
                              style={{ height: `${Math.max(3, Math.abs(item.netWorth) / netWorthTrendMax * 100)}%` }}
                            />
                          </div>
                          <small>{item.month.slice(2).replace("-", ".")}</small>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {recentSnapshots.length > 0 && (
                  <Card padding="none" shadow="none" className={styles.snapshotHistory}>
                    {recentSnapshots.map(item => (
                      <div key={item.month}>
                        <span>{formatMonthLabel(item.month)}</span>
                        <strong><Money amount={item.netWorth} /></strong>
                      </div>
                    ))}
                  </Card>
                )}
              </section>

            </>
          )}
        </main>
      )}
    </>
  );
}
