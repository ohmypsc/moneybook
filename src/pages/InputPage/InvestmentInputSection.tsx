import InvestmentTradeForm
  from "../../components/investment/InvestmentTradeForm/InvestmentTradeForm";
import InvestmentTradeHistory
  from "../../components/investment/InvestmentTradeHistory/InvestmentTradeHistory";
import type {
  HoldingSummary,
  InvestmentAccountSummary
} from "../../types/dashboard";
import styles from "./InputPage.module.css";

interface InvestmentInputSectionProps {
  loading: boolean;
  hasDashboard: boolean;
  error: string;
  accounts: InvestmentAccountSummary[];
  selectedAccount: InvestmentAccountSummary | null;
  selectedHoldings: HoldingSummary[];
  tradeHistoryRefreshKey: number;
  onPickAccount: () => void;
  onDashboardChanged: () => void | Promise<void>;
}

export function InvestmentInputSection({
  loading,
  hasDashboard,
  error,
  accounts,
  selectedAccount,
  selectedHoldings,
  tradeHistoryRefreshKey,
  onPickAccount,
  onDashboardChanged
}: InvestmentInputSectionProps) {
  return (
    <div className={styles.form}>
      <section className={styles.card}>
        <div className={styles.conditionalSection}>
          <h2 className={styles.sectionTitle}>투자 매수 · 매도</h2>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              투자계좌 <span className={styles.required}>*</span>
            </span>

            <button
              type="button"
              className={styles.pickerButton}
              disabled={loading || accounts.length === 0}
              onClick={onPickAccount}
            >
              <span
                className={
                  selectedAccount
                    ? styles.pickerValue
                    : styles.pickerPlaceholder
                }
              >
                {selectedAccount
                  ? `${selectedAccount.accountName}${
                      selectedAccount.owner
                        ? `(${selectedAccount.owner})`
                        : ""
                    }`
                  : loading
                    ? "투자계좌 불러오는 중"
                    : "선택하세요"}
              </span>
              <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
            </button>

            <p className={styles.helper}>
              주식·ETF·금처럼 실제 보유종목의 매수·매도만 기록합니다. 예수금이나 CMA 발행어음처럼 현금으로 관리할 금액은 종목으로 입력하지 말고 이체·예수금으로 관리하세요.
            </p>
          </label>
        </div>

        {loading && !hasDashboard && (
          <div className={styles.loading}>투자계좌 정보를 불러오는 중입니다.</div>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!loading && !error && accounts.length === 0 && (
          <p className={styles.helper}>
            등록된 투자계좌가 없습니다. 자산 또는 설정에서 투자계좌를 먼저 추가해주세요.
          </p>
        )}

        {selectedAccount && (
          <>
            <InvestmentTradeForm
              key={`form:${selectedAccount.accountId}`}
              account={selectedAccount}
              holdings={selectedHoldings}
              onSaved={onDashboardChanged}
            />

            <InvestmentTradeHistory
              key={`history:${selectedAccount.accountId}`}
              accountId={selectedAccount.accountId}
              refreshKey={tradeHistoryRefreshKey}
              onChanged={onDashboardChanged}
            />
          </>
        )}
      </section>
    </div>
  );
}
