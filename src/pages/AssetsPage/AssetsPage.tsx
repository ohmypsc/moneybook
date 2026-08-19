import { useEffect, useState } from "react";
import { getDashboard } from "../../api/dashboard";
import { setInvestmentCashBaseline } from "../../api/investments";
import type { DashboardData } from "../../types/dashboard";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );

  const [cashInput, setCashInput] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [cashError, setCashError] = useState("");

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      const data = await getDashboard();
      setDashboard(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "자산 정보를 불러오지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const summary = dashboard?.summary;

  const cashLikeAccounts =
    dashboard?.accounts.filter(
      account =>
        account.accountType === "자산" &&
        account.balanceMethod !== "평가입력"
    ) || [];

  const investmentAccounts = dashboard?.investments.accounts || [];

  const selectedAccount = investmentAccounts.find(
    account => account.accountId === selectedAccountId
  );

  const holdingsForSelected =
    dashboard?.investments.holdings.filter(
      holding => holding.accountId === selectedAccountId
    ) || [];

  useEffect(() => {
    if (!selectedAccount) {
      setCashInput("");
      return;
    }

    setCashInput(
      selectedAccount.cashBaselineKrw !== null
        ? String(selectedAccount.cashBaselineKrw)
        : ""
    );
  }, [selectedAccountId, selectedAccount?.cashBaselineKrw]);

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
        cashBaselineKrw: parsed,
        force: true
      });

      await loadDashboard();
    } catch (err) {
      setCashError(
        err instanceof Error
          ? err.message
          : "예수금 저장에 실패했습니다."
      );
    } finally {
      setCashSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>자산</p>
        <h1 className={styles.title}>우리 가계부 자산</h1>
      </header>

      <section className={styles.summaryCard}>
        {loading && (
          <p className={styles.loading}>순자산 요약을 불러오는 중입니다.</p>
        )}

        {!loading && error && <p className={styles.error}>{error}</p>}

        {!loading && !error && summary && (
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>총자산</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(summary.assets)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>총부채</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(summary.liabilities)}
              </strong>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>순자산</span>
              <strong
                className={styles.summaryValue}
                style={{
                  color:
                    summary.netWorth < 0
                      ? "var(--color-error)"
                      : undefined
                }}
              >
                {formatCurrency(summary.netWorth)}
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

          {!loading && summary && (
            <div className={styles.cashSummary}>
              <span className={styles.summaryLabel}>현금성자산 합계</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(summary.cashLikeValue)}
              </strong>
            </div>
          )}

          {loading && (
            <p className={styles.loading}>불러오는 중입니다.</p>
          )}

          {!loading && cashLikeAccounts.length === 0 && (
            <p className={styles.emptyState}>
              표시할 현금성 계좌가 없습니다.
            </p>
          )}

          {!loading && cashLikeAccounts.length > 0 && (
            <ul className={styles.holdingsList}>
              {cashLikeAccounts.map(account => (
                <li key={account.accountId} className={styles.holdingRow}>
                  <div className={styles.holdingInfo}>
                    <span className={styles.holdingName}>
                      {account.displayName}
                    </span>
                    <span className={styles.holdingMeta}>
                      {account.subType}
                    </span>
                  </div>
                  <strong className={styles.holdingValue}>
                    {formatCurrency(account.currentBalance)}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === "investment" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>투자자산</h2>

          {!loading && summary && (
            <div className={styles.cashSummary}>
              <span className={styles.summaryLabel}>투자자산 합계</span>
              <strong className={styles.summaryValue}>
                {formatCurrency(summary.investmentValue)}
              </strong>
            </div>
          )}

          {loading && (
            <p className={styles.loading}>투자계좌를 불러오는 중입니다.</p>
          )}

          {!loading && investmentAccounts.length === 0 && (
            <p className={styles.emptyState}>등록된 투자계좌가 없습니다.</p>
          )}

          {!loading && investmentAccounts.length > 0 && (
            <div className={styles.accountList}>
              {investmentAccounts.map(account => (
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
                    {account.accountName}
                  </span>
                  <span className={styles.holdingMeta}>
                    {formatCurrency(account.accountValueKrw)}
                    {!account.cashBaselineConfigured && " · 예수금 미설정"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selectedAccount && (
            <div className={styles.detailCard}>
              <h3 className={styles.detailTitle}>
                {selectedAccount.accountName}
              </h3>

              <div className={styles.holdingsTotal}>
                <span className={styles.summaryLabel}>보유종목 평가액</span>
                <strong className={styles.summaryValue}>
                  {formatCurrency(selectedAccount.holdingValueKrw)}
                </strong>
              </div>

              <div className={styles.holdingsTotal}>
                <span className={styles.summaryLabel}>실현손익</span>
                <strong
                  className={styles.summaryValue}
                  style={{
                    color:
                      selectedAccount.realizedPnlKrw < 0
                        ? "var(--color-error)"
                        : undefined
                  }}
                >
                  {formatCurrency(selectedAccount.realizedPnlKrw)}
                </strong>
              </div>

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

              {!selectedAccount.cashBaselineConfigured && (
                <p className={styles.helperText}>
                  아직 예수금 기준값이 설정되지 않았습니다. 증권사 앱에서
                  현재 예수금을 확인해 한 번만 입력해주세요.
                </p>
              )}

              {holdingsForSelected.length === 0 && (
                <p className={styles.emptyState}>
                  보유 중인 종목이 없습니다.
                </p>
              )}

              {holdingsForSelected.length > 0 && (
                <ul className={styles.holdingsList}>
                  {holdingsForSelected.map(holding => (
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
                          {formatPercent(holding.returnRate)}
                        </span>
                      </div>
                      <strong
                        className={styles.holdingValue}
                        style={{
                          color:
                            holding.returnRate < 0
                              ? "var(--color-error)"
                              : undefined
                        }}
                      >
                        {formatCurrency(holding.valueKrw)}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
