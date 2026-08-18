import { useEffect, useState } from "react";
import { getDashboard } from "../../api/dashboard";
import {
  getInvestmentAccounts,
  getHoldings,
  getInvestmentCash,
  setInvestmentCashBaseline
} from "../../api/investments";
import type { DashboardData } from "../../types/dashboard";
import type {
  InvestmentAccount,
  Holding
} from "../../types/investment";
import styles from "./AssetsPage.module.css";

type AssetsTab = "cash" | "investment";

function formatCurrency(value: number | undefined | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }

  return value.toLocaleString("ko-KR") + "원";
}

function formatPercent(value: number | undefined | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }

  return (value * 100).toFixed(2) + "%";
}

export default function AssetsPage() {
  const [activeTab, setActiveTab] = useState<AssetsTab>("cash");

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  const [accounts, setAccounts] = useState<InvestmentAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState("");

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsError, setHoldingsError] = useState("");

  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [cashInput, setCashInput] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [cashError, setCashError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setDashboardLoading(true);
      setDashboardError("");

      try {
        const data = await getDashboard();

        if (!cancelled) {
          setDashboard(data);
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardError(
            error instanceof Error
              ? error.message
              : "자산 요약을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) {
          setDashboardLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "investment") {
      return;
    }

    if (accounts.length > 0) {
      return;
    }

    let cancelled = false;

    async function loadAccounts() {
      setAccountsLoading(true);
      setAccountsError("");

      try {
        const data = await getInvestmentAccounts();

        if (!cancelled) {
          setAccounts(data.items || []);
        }
      } catch (error) {
        if (!cancelled) {
          setAccountsError(
            error instanceof Error
              ? error.message
              : "투자계좌 목록을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) {
          setAccountsLoading(false);
        }
      }
    }

    void loadAccounts();

    return () => {
      cancelled = true;
    };
  }, [activeTab, accounts.length]);

  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }

    let cancelled = false;

    async function loadAccountDetail() {
      setHoldingsLoading(true);
      setHoldingsError("");
      setCashError("");

      try {
        const [holdingsData, cashData] = await Promise.all([
          getHoldings({ accountId: selectedAccountId as string }),
          getInvestmentCash(selectedAccountId as string)
        ]);

        if (cancelled) {
          return;
        }

        setHoldings(holdingsData.items || []);

        const cash = Array.isArray(cashData) ? cashData[0] : cashData;

        if (cash && typeof cash.cashBalance === "number") {
          setCashBalance(cash.cashBalance);
          setCashInput(String(cash.cashBalance));
        } else {
          setCashBalance(null);
          setCashInput("");
        }
      } catch (error) {
        if (!cancelled) {
          setHoldingsError(
            error instanceof Error
              ? error.message
              : "보유종목을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) {
          setHoldingsLoading(false);
        }
      }
    }

    void loadAccountDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  async function handleSaveCashBaseline() {
    if (!selectedAccountId) {
      return;
    }

    const parsed = Number(cashInput);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setCashError("올바른 금액을 입력해주세요.");
      return;
    }

    setCashSaving(true);
    setCashError("");

    try {
      await setInvestmentCashBaseline({
        accountId: selectedAccountId,
        cashBalance: parsed,
        force: true
      });

      setCashBalance(parsed);
    } catch (error) {
      setCashError(
        error instanceof Error
          ? error.message
          : "예수금 저장에 실패했습니다."
      );
    } finally {
      setCashSaving(false);
    }
  }

  const selectedAccount = accounts.find(
    account => account.accountId === selectedAccountId
  );

  const holdingsEvalTotal = holdings.reduce(
    (sum, holding) => sum + (holding.evalAmountKrw || 0),
    0
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>자산</p>
        <h1 className={styles.title}>우리 가계부 자산</h1>
      </header>

      <section className={styles.summaryCard}>
        {dashboardLoading && (
          <p className={styles.loading}>순자산 요약을 불러오는 중입니다.</p>
        )}

        {!dashboardLoading && dashboardError && (
          <p className={styles.error}>{dashboardError}</p>
        )}

        {!dashboardLoading && !dashboardError && dashboard && (
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>총자산</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(dashboard.assets)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>총부채</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(dashboard.liabilities)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>순자산</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(dashboard.netWorth)}
              </strong>
            </div>
          </div>
        )}
      </section>

      <div className={styles.tabs}>
        <button
          type="button"
          className={[
            styles.tabButton,
            activeTab === "cash" ? styles.tabButtonActive : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setActiveTab("cash")}
        >
          현금성자산
        </button>
        <button
          type="button"
          className={[
            styles.tabButton,
            activeTab === "investment" ? styles.tabButtonActive : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setActiveTab("investment")}
        >
          투자
        </button>
      </div>

      {activeTab === "cash" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>현금성자산</h2>

          {dashboardLoading && (
            <p className={styles.loading}>불러오는 중입니다.</p>
          )}

          {!dashboardLoading && dashboard && (
            <div className={styles.cashSummary}>
              <span className={styles.summaryLabel}>현금성자산 합계</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(dashboard.cashLikeValue)}
              </strong>
            </div>
          )}

          <p className={styles.helperText}>
            계좌별 상세 내역은 다음 업데이트에서 추가될 예정입니다.
          </p>
        </section>
      )}

      {activeTab === "investment" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>투자자산</h2>

          {!dashboardLoading && dashboard && (
            <div className={styles.cashSummary}>
              <span className={styles.summaryLabel}>투자자산 합계</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(dashboard.investmentValue)}
              </strong>
            </div>
          )}

          {accountsLoading && (
            <p className={styles.loading}>투자계좌를 불러오는 중입니다.</p>
          )}

          {!accountsLoading && accountsError && (
            <p className={styles.error}>{accountsError}</p>
          )}

          {!accountsLoading && !accountsError && accounts.length === 0 && (
            <p className={styles.emptyState}>등록된 투자계좌가 없습니다.</p>
          )}

          {!accountsLoading && accounts.length > 0 && (
            <div className={styles.accountList}>
              {accounts.map(account => (
                <button
                  type="button"
                  key={account.accountId}
                  className={[
                    styles.accountCard,
                    selectedAccountId === account.accountId
                      ? styles.accountCardActive
                      : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() =>
                    setSelectedAccountId(
                      selectedAccountId === account.accountId
                        ? null
                        : account.accountId
                    )
                  }
                >
                  <span className={styles.accountName}>
                    {account.displayName}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selectedAccount && (
            <div className={styles.detailCard}>
              <h3 className={styles.detailTitle}>
                {selectedAccount.displayName}
              </h3>

              <div className={styles.cashForm}>
                <span className={styles.summaryLabel}>현재 예수금</span>
                <input
                  className={styles.cashInput}
                  type="number"
                  inputMode="numeric"
                  value={cashInput}
                  onChange={event => setCashInput(event.target.value)}
                  placeholder="예: 327500"
                />
                <button
                  type="button"
                  className={styles.cashButton}
                  onClick={handleSaveCashBaseline}
                  disabled={cashSaving}
                >
                  {cashSaving ? "저장 중..." : "저장"}
                </button>
              </div>

              {cashError && <p className={styles.error}>{cashError}</p>}

              {cashBalance !== null && (
                <p className={styles.helperText}>
                  현재 저장된 예수금: {formatCurrency(cashBalance)}
                </p>
              )}

              {holdingsLoading && (
                <p className={styles.loading}>
                  보유종목을 불러오는 중입니다.
                </p>
              )}

              {!holdingsLoading && holdingsError && (
                <p className={styles.error}>{holdingsError}</p>
              )}

              {!holdingsLoading &&
                !holdingsError &&
                holdings.length === 0 && (
                  <p className={styles.emptyState}>
                    보유 중인 종목이 없습니다.
                  </p>
                )}

              {!holdingsLoading && holdings.length > 0 && (
                <>
                  <div className={styles.holdingsTotal}>
                    <span className={styles.summaryLabel}>
                      보유종목 평가액 합계
                    </span>
                    <strong className={styles.summaryValue}>
                      {formatCurrency(holdingsEvalTotal)}
                    </strong>
                  </div>

                  <ul className={styles.holdingsList}>
                    {holdings.map(holding => (
                      <li
                        key={holding.holdingId}
                        className={styles.holdingRow}
                      >
                        <div className={styles.holdingInfo}>
                          <span className={styles.holdingName}>
                            {holding.stockName}
                          </span>
                          <span className={styles.holdingMeta}>
                            {holding.quantity}주 ·{" "}
                            {formatPercent(holding.profitRate)}
                          </span>
                        </div>
                        <strong className={styles.holdingValue}>
                          {formatCurrency(holding.evalAmountKrw)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
