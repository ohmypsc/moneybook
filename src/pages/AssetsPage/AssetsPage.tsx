import { Fragment, useEffect, useMemo, useState } from "react";

import { getDashboard, getDashboardSnapshot, getDashboardSnapshotInfo } from "../../api/dashboard";

import { getBenefitRewardBalances } from "../../api/automation";

import {
  setInvestmentCashBaseline,
  updateHoldingManualPrice,
  updateHoldingQuoteMode
} from "../../api/investments";
import {
  amountProductUnitPrice,
  isAmountProductCode
} from "../../components/investment/amountProduct";

import InvestmentTradeForm from "../../components/investment/InvestmentTradeForm/InvestmentTradeForm";

import InvestmentTradeHistory from "../../components/investment/InvestmentTradeHistory/InvestmentTradeHistory";

import { RealEstatePanel } from "../../components/realEstate/RealEstatePanel";

import { AccountSettings } from "../SettingsPage/AccountSettings";

import { updateManagedAccount } from "../../api/settingsManagement";

import { markLedgerChanged, subscribeLedgerChanges } from "../../utils/ledgerEvents";

import { markBackgroundRefreshed, shouldBackgroundRefresh } from "../../utils/backgroundRefresh";

import { getSeoulDateString } from "../../utils/dateTime";

import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import { Money, formatMoney } from "../../components/common/Money/Money";
import { DataFreshnessNotice } from "../../components/common/DataFreshnessNotice/DataFreshnessNotice";

import type { DashboardData } from "../../types/dashboard";

import styles from "./AssetsPage.module.css";
import { Skeleton } from "../../components/common/Skeleton/Skeleton";

type AssetsTab = "cash" | "investment" | "realEstate" | "liability";

function formatCurrency(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "-";
  }

  return formatMoney(value);
}

function formatSignedCurrency(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "-";
  }

  return formatMoney(value, { showPlus: true });
}

function formatPercent(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : "";

  return sign + (value * 100).toFixed(2) + "%";
}

function formatQuantity(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "-";
  }

  return value.toLocaleString("ko-KR", {
    maximumFractionDigits: 8
  });
}

function formatPrice(value: number | undefined | null, market: string, currency = "") {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "-";
  }

  const formatted = value.toLocaleString("ko-KR", {
    maximumFractionDigits: 8
  });

  return market === "국내" ? `${formatted}원` : `${formatted}${currency ? ` ${currency}` : ""}`;
}

function getToday() {
  return getSeoulDateString();
}

function formatNativeAmount(value: number, market: string) {
  if (!Number.isFinite(value)) return "-";

  return market === "국내"
    ? `${Math.round(value).toLocaleString("ko-KR")}원`
    : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} USD`;
}

interface AssetInputPreset {
  mode: "transfer";
  fromAccountId?: string | null;
  toAccountId?: string | null;
  categoryId?: string | null;
}

interface AssetsPageProps {
  userName: string;
  onOpenInput?: (preset: AssetInputPreset) => void;
}

export default function AssetsPage({ userName, onOpenInput }: AssetsPageProps) {
  function openInput(preset: AssetInputPreset) {
    if (onOpenInput) {
      onOpenInput(preset);
    }

    const currentState = window.history.state || {};

    const nextState = {
      ...currentState,
      moneybook: true,
      navigation: "input",
      inputInitialDate: null,
      inputPreset: preset
    };

    if (currentState.navigation === "input") {
      window.history.replaceState(nextState, "");
    } else {
      window.history.pushState(nextState, "");
    }

    window.dispatchEvent(new PopStateEvent("popstate", { state: nextState }));
  }
  const [activeTab, setActiveTab] = useState<AssetsTab>("cash");

  const [ownerFilter, setOwnerFilter] = useState("전체");

  const [initialDashboardInfo] = useState(() => getDashboardSnapshotInfo());

  const initialDashboard = initialDashboardInfo?.data ?? null;

  const [fallbackSnapshotAt, setFallbackSnapshotAt] = useState<number | null>(
    initialDashboardInfo?.source === "persisted" ? initialDashboardInfo.fetchedAt : null
  );

  const [dashboard, setDashboard] = useState<DashboardData | null>(initialDashboard);

  const [loading, setLoading] = useState(initialDashboard === null);

  const [error, setError] = useState("");

  const [rewardBalances, setRewardBalances] = useState<Record<string, number>>({});

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const [selectedCashAccountId, setSelectedCashAccountId] = useState<string | null>(null);

  const [selectedLiabilityAccountId, setSelectedLiabilityAccountId] = useState<string | null>(null);

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

  const [creatingAccount, setCreatingAccount] = useState(false);

  const [reconcileAccountId, setReconcileAccountId] = useState<string | null>(null);

  const [reconcileInput, setReconcileInput] = useState("");

  const [reconcileSaving, setReconcileSaving] = useState(false);

  const [reconcileError, setReconcileError] = useState("");

  useEffect(() => {
    if (activeTab !== "liability" && selectedLiabilityAccountId) {
      setSelectedLiabilityAccountId(null);
    }
  }, [activeTab, selectedLiabilityAccountId]);

  useEffect(() => {
    if (!selectedCashAccountId && !selectedAccountId && !selectedLiabilityAccountId) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCashAccountId(null);
        setSelectedAccountId(null);
        setSelectedLiabilityAccountId(null);
        setReconcileAccountId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedCashAccountId, selectedAccountId, selectedLiabilityAccountId]);

  useEffect(() => {
    if (!editingAccountId && !creatingAccount) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEditingAccountId(null);
        setCreatingAccount(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingAccountId, creatingAccount]);

  const [cashInput, setCashInput] = useState("");

  const [cashSaving, setCashSaving] = useState(false);

  const [cashError, setCashError] = useState("");

  const [tradeHistoryRefreshKey, setTradeHistoryRefreshKey] = useState(0);

  const [manualPriceDrafts, setManualPriceDrafts] = useState<Record<string, string>>({});

  const [manualPriceSavingId, setManualPriceSavingId] = useState<string | null>(null);

  const [manualPriceErrors, setManualPriceErrors] = useState<Record<string, string>>({});

  const [manualPriceFeedbackId, setManualPriceFeedbackId] = useState<string | null>(null);

  const [quoteRefreshing, setQuoteRefreshing] = useState(false);

  const [quoteModeSavingId, setQuoteModeSavingId] = useState<string | null>(null);

  const [showSoldOutHoldings, setShowSoldOutHoldings] = useState(false);

  async function loadDashboard(forceRefresh = false, refreshQuotes = false) {
    const cachedDashboard = getDashboardSnapshot();

    if (cachedDashboard) {
      setDashboard(cachedDashboard);

      setLoading(false);
    } else if (!dashboard) {
      setLoading(true);
    }

    setError("");

    try {
      const [data, benefitBalances] = await Promise.all([
        getDashboard(undefined, {
          forceRefresh,
          refreshQuotes
        }),
        getBenefitRewardBalances().catch(() => [])
      ]);

      setDashboard(data);

      setFallbackSnapshotAt(null);

      setRewardBalances(
        Object.fromEntries(
          benefitBalances.map(item => [
            item.accountId,
            Math.max(0, Number(item.rewardBalance || 0))
          ])
        )
      );

      markBackgroundRefreshed("assets-dashboard");
    } catch (err) {
      const fallbackInfo = getDashboardSnapshotInfo();

      if (fallbackInfo) {
        setDashboard(fallbackInfo.data);
        setFallbackSnapshotAt(fallbackInfo.fetchedAt);
      } else if (!dashboard) {
        setError(err instanceof Error ? err.message : "자산 정보를 불러오지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshInvestmentQuotes() {
    if (quoteRefreshing) {
      return;
    }

    setQuoteRefreshing(true);

    try {
      await loadDashboard(true, true);
    } finally {
      setQuoteRefreshing(false);
    }
  }

  useEffect(() => {
    function refreshWhenVisible() {
      if (
        document.visibilityState !== "visible" ||
        !shouldBackgroundRefresh("assets-dashboard", 60_000)
      ) {
        return;
      }

      void loadDashboard(true);
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);

  async function handleInvestmentSaved() {
    setTradeHistoryRefreshKey(current => current + 1);

    // 저장 직후 보유종목·평가금액이 바로 보이도록 캐시를 건너뛰고 다시 불러옵니다.
    await loadDashboard(true);
  }

  async function handleChangeQuoteMode(holdingId: string, quoteMode: "자동" | "수동") {
    if (quoteModeSavingId) return;

    setQuoteModeSavingId(holdingId);
    setManualPriceErrors(current => ({ ...current, [holdingId]: "" }));

    try {
      await updateHoldingQuoteMode({ holdingId, quoteMode, lastUpdated: getToday() });

      setManualPriceDrafts(current => {
        const next = { ...current };
        delete next[holdingId];
        return next;
      });

      await loadDashboard(true);
    } catch (err) {
      setManualPriceErrors(current => ({
        ...current,
        [holdingId]: err instanceof Error ? err.message : "시세 방식을 바꾸지 못했습니다."
      }));
    } finally {
      setQuoteModeSavingId(null);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(
    () =>
      subscribeLedgerChanges(() => {
        void loadDashboard(true);
      }),
    []
  );

  async function handleReconcileAccount(accountId: string) {
    const account = dashboard?.accounts.find(item => item.accountId === accountId);

    if (!account) {
      return;
    }

    const actualBalance = Number(reconcileInput.replace(/,/g, ""));

    if (!Number.isFinite(actualBalance)) {
      setReconcileError("실제 잔액을 숫자로 입력해주세요.");
      return;
    }

    const difference = actualBalance - Number(account.currentBalance || 0);

    if (Math.abs(difference) < 0.5) {
      setReconcileAccountId(null);
      setReconcileInput("");
      setReconcileError("");
      return;
    }

    setReconcileSaving(true);
    setReconcileError("");

    try {
      await updateManagedAccount({
        accountId: account.accountId,
        accountName: account.accountName,
        accountType: account.accountType,
        subType: account.subType,
        owner: account.owner,
        openingBalance: Number(account.openingBalance || 0) + difference,
        billingCutoffDay: account.billingCutoffDay,
        paymentDay: account.paymentDay,
        startYear: account.startYear,
        endYear: account.endYear,
        balanceMethod: account.balanceMethod,
        paymentAccountId: account.paymentAccountId,
        assetAttribution: account.assetAttribution
      });

      markLedgerChanged();
      await loadDashboard(true);

      setReconcileAccountId(null);
      setReconcileInput("");
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : "잔액을 맞추지 못했습니다.");
    } finally {
      setReconcileSaving(false);
    }
  }

  const summary = dashboard?.summary;

  const investmentAccountIds = new Set(
    (dashboard?.investments.accounts || []).map(account => account.accountId)
  );

  const cashLikeAccounts =
    dashboard?.accounts.filter(
      account => account.accountType === "자산" && !investmentAccountIds.has(account.accountId)
    ) || [];

  const liabilityAccounts =
    dashboard?.accounts.filter(account => account.accountType === "부채") || [];

  const selectedCashAccount =
    cashLikeAccounts.find(account => account.accountId === selectedCashAccountId) || null;

  const selectedLiabilityAccount =
    liabilityAccounts.find(account => account.accountId === selectedLiabilityAccountId) || null;

  const selectedRewardBalance =
    selectedCashAccount &&
    Object.prototype.hasOwnProperty.call(rewardBalances, selectedCashAccount.accountId)
      ? rewardBalances[selectedCashAccount.accountId]
      : null;

  const investmentAccounts = dashboard?.investments.accounts || [];

  const investmentHoldings = dashboard?.investments.holdings || [];

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();

    (dashboard?.accounts || []).forEach(account => {
      if (account.owner) owners.add(account.owner);
    });

    (dashboard?.investments.accounts || []).forEach(account => {
      if (account.owner) owners.add(account.owner);
    });

    return Array.from(owners).sort((first, second) => {
      if (first === userName) return -1;
      if (second === userName) return 1;
      if (first === "공동") return -1;
      if (second === "공동") return 1;
      return first.localeCompare(second, "ko-KR");
    });
  }, [dashboard, userName]);

  const visibleCashLikeAccounts = useMemo(() => {
    return cashLikeAccounts
      .filter(account => ownerFilter === "전체" || account.owner === ownerFilter)
      .slice()
      .sort((first, second) => {
        if (first.owner === userName && second.owner !== userName) return -1;
        if (second.owner === userName && first.owner !== userName) return 1;
        const ownerCompare = (first.owner || "").localeCompare(second.owner || "", "ko-KR");
        return ownerCompare || first.displayName.localeCompare(second.displayName, "ko-KR");
      });
  }, [cashLikeAccounts, ownerFilter, userName]);

  const visibleInvestmentAccounts = useMemo(() => {
    return investmentAccounts
      .filter(account => ownerFilter === "전체" || account.owner === ownerFilter)
      .slice()
      .sort((first, second) => {
        if (first.owner === userName && second.owner !== userName) return -1;
        if (second.owner === userName && first.owner !== userName) return 1;
        const ownerCompare = (first.owner || "").localeCompare(second.owner || "", "ko-KR");
        return ownerCompare || first.accountName.localeCompare(second.accountName, "ko-KR");
      });
  }, [investmentAccounts, ownerFilter, userName]);

  const visibleLiabilityAccounts = useMemo(() => {
    return liabilityAccounts
      .filter(account => ownerFilter === "전체" || account.owner === ownerFilter)
      .slice()
      .sort((first, second) => {
        if (first.owner === userName && second.owner !== userName) return -1;
        if (second.owner === userName && first.owner !== userName) return 1;
        const ownerCompare = (first.owner || "").localeCompare(second.owner || "", "ko-KR");
        return ownerCompare || first.displayName.localeCompare(second.displayName, "ko-KR");
      });
  }, [liabilityAccounts, ownerFilter, userName]);

  const visibleCashTotal = visibleCashLikeAccounts.reduce(
    (sum, account) => sum + Number(account.currentBalance || 0),
    0
  );

  const visibleInvestmentTotal = visibleInvestmentAccounts.reduce(
    (sum, account) => sum + Number(account.accountValueKrw || 0),
    0
  );

  const visibleInvestmentCashTotal = visibleInvestmentAccounts.reduce(
    (sum, account) => sum + Number(account.currentCashKrw || 0),
    0
  );

  const visibleInvestmentRealizedPnlTotal = visibleInvestmentAccounts.reduce(
    (sum, account) => sum + Number(account.realizedPnlKrw || 0),
    0
  );

  const visibleInvestmentAccountIds = new Set(
    visibleInvestmentAccounts.map(account => account.accountId)
  );

  const visibleStaleManualPrices = (dashboard?.investments.staleManualPrices || []).filter(item =>
    visibleInvestmentAccountIds.has(item.accountId)
  );

  const visibleCashBaselinePending = (dashboard?.investments.cashBaselinePending || []).filter(
    item => visibleInvestmentAccountIds.has(item.accountId)
  );

  const visibleLiabilityTotal = visibleLiabilityAccounts.reduce(
    (sum, account) => sum + Math.abs(Number(account.currentBalance || 0)),
    0
  );

  const selectedAccount = investmentAccounts.find(
    account => account.accountId === selectedAccountId
  );

  const holdingsForSelected = investmentHoldings.filter(
    holding => holding.accountId === selectedAccountId
  );

  // 다 판 종목(0주)은 기본으로 접어 둡니다. 매매·배당 입력 폼에는 그대로 넘깁니다.
  const soldOutHoldingCount = holdingsForSelected.filter(
    holding => !(Number(holding.quantity) > 0)
  ).length;

  const visibleHoldingsForSelected = showSoldOutHoldings
    ? holdingsForSelected
    : holdingsForSelected.filter(holding => Number(holding.quantity) > 0);

  useEffect(() => {
    if (!selectedAccount) {
      setCashInput("");

      return;
    }

    setCashInput(
      selectedAccount.cashBaselineKrw !== null ? String(selectedAccount.cashBaselineKrw) : ""
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
      setCashError(err instanceof Error ? err.message : "예수금 기준값 저장에 실패했습니다.");
    } finally {
      setCashSaving(false);
    }
  }

  function getManualPriceInput(
    holdingId: string,
    manualPrice: number | null | undefined,
    currentPrice: number | null | undefined,
    amountQuantity?: number
  ) {
    if (Object.prototype.hasOwnProperty.call(manualPriceDrafts, holdingId)) {
      return manualPriceDrafts[holdingId];
    }

    if (amountQuantity !== undefined) {
      const total = amountQuantity * amountProductUnitPrice(manualPrice, currentPrice ?? 0);

      return Number.isFinite(total) ? String(Math.round(total * 100) / 100) : "";
    }

    const value = manualPrice ?? currentPrice;

    return value !== null && value !== undefined && Number.isFinite(value) ? String(value) : "";
  }

  function handleManualPriceChange(holdingId: string, value: string) {
    setManualPriceDrafts(current => ({
      ...current,
      [holdingId]: value
    }));

    setManualPriceErrors(current => ({
      ...current,
      [holdingId]: ""
    }));

    setManualPriceFeedbackId(null);
  }

  async function handleSaveManualPrice(
    holdingId: string,
    manualPrice: number | null | undefined,
    currentPrice: number | null | undefined,
    amountQuantity?: number
  ) {
    const input = getManualPriceInput(holdingId, manualPrice, currentPrice, amountQuantity);

    const parsedInput = Number(input);

    if (!Number.isFinite(parsedInput) || parsedInput <= 0) {
      setManualPriceErrors(current => ({
        ...current,
        [holdingId]:
          amountQuantity !== undefined
            ? "현재 평가금액은 0보다 큰 숫자로 입력해주세요."
            : "수동 시세는 0보다 큰 숫자로 입력해주세요."
      }));

      return;
    }

    // 금액형 상품은 평가금액을 입력받아 1단위당 평가단가로 바꿔 저장합니다.
    const parsed =
      amountQuantity !== undefined && amountQuantity > 0
        ? parsedInput / amountQuantity
        : parsedInput;

    setManualPriceSavingId(holdingId);

    setManualPriceErrors(current => ({
      ...current,
      [holdingId]: ""
    }));

    setManualPriceFeedbackId(null);

    try {
      await updateHoldingManualPrice({
        holdingId,
        manualPrice: parsed,
        lastUpdated: getToday()
      });

      setManualPriceDrafts(current => ({
        ...current,
        [holdingId]: String(parsedInput)
      }));

      await loadDashboard(true);

      setManualPriceFeedbackId(holdingId);
    } catch (err) {
      setManualPriceErrors(current => ({
        ...current,
        [holdingId]: err instanceof Error ? err.message : "수동 시세 저장에 실패했습니다."
      }));
    } finally {
      setManualPriceSavingId(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>자산</h1>
          <p className={styles.headerHint}>항목을 누르면 상세와 관리 기능이 열립니다.</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              openInput({
                mode: "transfer"
              })
            }
          >
            이체 입력
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setEditingAccountId(null);
              setCreatingAccount(true);
            }}
          >
            + 추가
          </Button>
        </div>
      </header>

      {fallbackSnapshotAt && <DataFreshnessNotice fetchedAt={fallbackSnapshotAt} />}

      <Card as="section" padding="none" className={styles.summaryCard}>
        {loading && <Skeleton label="순자산 요약을 불러오는 중입니다." variant="block" />}

        {!loading && error && <p className={styles.error}>{error}</p>}

        {!loading && !error && summary && (
          <div className={styles.summaryHero}>
            <span className={styles.summaryHeroLabel}>순자산</span>
            <strong
              className={`${styles.summaryHeroValue} ${summary.netWorth < 0 ? styles.summaryHeroNegative : ""}`}
              title={formatCurrency(summary.netWorth)}
            >
              <Money amount={summary.netWorth} />
            </strong>

            <div className={styles.summarySecondary}>
              <div>
                <span>총자산</span>
                <strong title={formatCurrency(summary.assets)}>
                  <Money amount={summary.assets} absolute />
                </strong>
              </div>
              <div>
                <span>총부채</span>
                <strong title={formatCurrency(summary.liabilities)}>
                  <Money amount={summary.liabilities} absolute />
                </strong>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div
        className={styles.tabs}
        style={{
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))"
        }}
      >
        <button
          type="button"
          className={[styles.tabButton, activeTab === "cash" ? styles.tabButtonActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setActiveTab("cash")}
        >
          현금성자산
        </button>

        <button
          type="button"
          className={[styles.tabButton, activeTab === "investment" ? styles.tabButtonActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setActiveTab("investment")}
        >
          투자
        </button>

        <button
          type="button"
          className={[styles.tabButton, activeTab === "realEstate" ? styles.tabButtonActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setActiveTab("realEstate")}
        >
          우리집
        </button>

        <button
          type="button"
          className={[styles.tabButton, activeTab === "liability" ? styles.tabButtonActive : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setActiveTab("liability")}
        >
          부채
        </button>
      </div>

      {activeTab !== "realEstate" && ownerOptions.length > 1 && (
        <div className={styles.ownerFilter} aria-label="명의자 필터">
          {["전체", ...ownerOptions].map(owner => (
            <button
              key={owner}
              type="button"
              className={ownerFilter === owner ? styles.ownerFilterActive : ""}
              onClick={() => {
                setOwnerFilter(owner);
                setSelectedCashAccountId(null);
                setSelectedAccountId(null);
                setReconcileAccountId(null);
              }}
            >
              {owner}
            </button>
          ))}
        </div>
      )}

      {activeTab === "cash" && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>현금성자산</h2>

          {!loading && summary && (
            <div className={styles.cashSummary}>
              <span className={styles.summaryLabel}>합계</span>

              <strong className={styles.summaryValue}>{formatCurrency(visibleCashTotal)}</strong>
            </div>
          )}

          {loading && <p className={styles.loading}>불러오는 중입니다.</p>}

          {!loading && visibleCashLikeAccounts.length === 0 && (
            <p className={styles.emptyState}>표시할 현금성 계좌가 없습니다.</p>
          )}

          {!loading && visibleCashLikeAccounts.length > 0 && (
            <ul className={styles.cashAccountList}>
              {visibleCashLikeAccounts.map(account => {
                const isSelected = selectedCashAccountId === account.accountId;

                const difference =
                  isSelected && reconcileInput.trim()
                    ? Number(reconcileInput.replace(/,/g, "")) - Number(account.currentBalance || 0)
                    : null;

                return (
                  <Fragment key={account.accountId}>
                    <li>
                      <button
                        type="button"
                        className={[
                          styles.cashAccountRow,
                          isSelected ? styles.cashAccountRowActive : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => {
                          setSelectedCashAccountId(isSelected ? null : account.accountId);
                          setReconcileAccountId(null);
                          setReconcileInput("");
                          setReconcileError("");
                        }}
                      >
                        <div className={styles.cashAccountInfo}>
                          <strong className={styles.cashAccountName}>{account.displayName}</strong>

                          <span className={styles.cashAccountMeta}>
                            {[
                              account.subType,
                              account.owner,
                              Object.prototype.hasOwnProperty.call(
                                rewardBalances,
                                account.accountId
                              )
                                ? `캐시백 ${formatCurrency(rewardBalances[account.accountId])} 포함`
                                : ""
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>

                        <strong className={styles.cashAccountValue}>
                          {formatCurrency(account.currentBalance)}
                        </strong>
                      </button>
                    </li>

                    {isSelected && selectedCashAccount && (
                      <li
                        className={styles.cashDetailItem}
                        role="presentation"
                        onClick={() => {
                          setSelectedCashAccountId(null);
                          setReconcileAccountId(null);
                        }}
                      >
                        <section
                          className={styles.cashDetailCard}
                          role="dialog"
                          aria-modal="true"
                          aria-label={`${selectedCashAccount.displayName} 상세`}
                          onClick={event => event.stopPropagation()}
                        >
                          <div className={styles.cashDetailHeader}>
                            <div>
                              <span>
                                {[selectedCashAccount.subType, selectedCashAccount.owner]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              <strong>{selectedCashAccount.displayName}</strong>
                            </div>

                            <div className={styles.modalHeaderActions}>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setEditingAccountId(selectedCashAccount.accountId)}
                              >
                                편집
                              </Button>
                              <Button
                                className={styles.modalCloseButton}
                                variant="soft"
                                size="sm"
                                iconOnly
                                aria-label="상세 닫기"
                                onClick={() => {
                                  setSelectedCashAccountId(null);
                                  setReconcileAccountId(null);
                                }}
                              >
                                ×
                              </Button>
                            </div>
                          </div>

                          <div className={styles.cashDetailMetrics}>
                            <div>
                              <span>
                                {selectedRewardBalance !== null ? "총 사용 가능 잔액" : "계산 잔액"}
                              </span>
                              <strong>{formatCurrency(selectedCashAccount.currentBalance)}</strong>
                            </div>

                            {selectedRewardBalance !== null && (
                              <>
                                <div>
                                  <span>그중 캐시백</span>
                                  <strong>{formatCurrency(selectedRewardBalance)}</strong>
                                </div>
                                <div>
                                  <span>일반 잔액</span>
                                  <strong>
                                    {formatCurrency(
                                      selectedCashAccount.currentBalance - selectedRewardBalance
                                    )}
                                  </strong>
                                </div>
                              </>
                            )}

                            <div>
                              <span>시작 잔액</span>
                              <strong>{formatCurrency(selectedCashAccount.openingBalance)}</strong>
                            </div>
                          </div>

                          <div className={styles.reconcileActions}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                const accountId = selectedCashAccount.accountId;
                                setSelectedCashAccountId(null);
                                setReconcileAccountId(null);
                                openInput({
                                  mode: "transfer",
                                  fromAccountId: accountId
                                });
                              }}
                            >
                              여기서 보내기
                            </Button>

                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                const accountId = selectedCashAccount.accountId;
                                setSelectedCashAccountId(null);
                                setReconcileAccountId(null);
                                openInput({
                                  mode: "transfer",
                                  toAccountId: accountId
                                });
                              }}
                            >
                              여기로 받기
                            </Button>
                          </div>

                          {reconcileAccountId !== selectedCashAccount.accountId ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setReconcileAccountId(selectedCashAccount.accountId);
                                setReconcileInput(
                                  String(Math.round(selectedCashAccount.currentBalance))
                                );
                                setReconcileError("");
                              }}
                            >
                              실제 잔액과 맞추기
                            </Button>
                          ) : (
                            <div className={styles.reconcilePanel}>
                              <label>
                                <span>실제 잔액</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={reconcileInput}
                                  onChange={event => {
                                    setReconcileInput(event.target.value);
                                    setReconcileError("");
                                  }}
                                />
                              </label>

                              <p>
                                차이{" "}
                                {difference === null || !Number.isFinite(difference)
                                  ? "-"
                                  : formatSignedCurrency(difference)}
                              </p>
                              <small>
                                거래 내역은 건드리지 않고 시작 잔액을 차이만큼 조정합니다.
                              </small>

                              {reconcileError && <p className={styles.error}>{reconcileError}</p>}

                              <div className={styles.reconcileActions}>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setReconcileAccountId(null);
                                    setReconcileError("");
                                  }}
                                >
                                  취소
                                </Button>
                                <Button
                                  size="sm"
                                  loading={reconcileSaving}
                                  loadingLabel="저장 중"
                                  onClick={() =>
                                    void handleReconcileAccount(selectedCashAccount.accountId)
                                  }
                                >
                                  맞추기
                                </Button>
                              </div>
                            </div>
                          )}
                        </section>
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {activeTab === "realEstate" && (
        <RealEstatePanel
          userName={userName}
          owners={ownerOptions}
          onChanged={() => void loadDashboard(true)}
        />
      )}

      {activeTab === "liability" && (
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2 className={styles.sectionTitle}>부채</h2>

            {!loading && visibleLiabilityAccounts.length > 0 && (
              <span className={styles.sectionCount}>{visibleLiabilityAccounts.length}개 계좌</span>
            )}
          </div>

          {!loading && summary && (
            <div className={styles.cashSummary}>
              <span className={styles.summaryLabel}>총 부채</span>

              <strong className={styles.summaryValue}>
                {formatCurrency(visibleLiabilityTotal)}
              </strong>
            </div>
          )}

          {loading && <p className={styles.loading}>부채계좌를 불러오는 중입니다.</p>}

          {!loading && visibleLiabilityAccounts.length === 0 && (
            <p className={styles.emptyState}>등록된 부채계좌가 없습니다.</p>
          )}

          {!loading && visibleLiabilityAccounts.length > 0 && (
            <ul className={styles.cashAccountList}>
              {visibleLiabilityAccounts.map(account => {
                const outstanding = Math.abs(Number(account.currentBalance || 0));

                return (
                  <li key={account.accountId}>
                    <button
                      type="button"
                      className={styles.cashAccountRow}
                      onClick={() => setSelectedLiabilityAccountId(account.accountId)}
                    >
                      <div className={styles.cashAccountInfo}>
                        <strong className={styles.cashAccountName}>{account.displayName}</strong>

                        <span className={styles.cashAccountMeta}>
                          {[account.subType, account.owner, "눌러서 상세"]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>

                      <strong className={styles.cashAccountValue}>
                        {formatCurrency(outstanding)}
                      </strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedLiabilityAccount && (
            <div
              className={styles.investmentDetailBackdrop}
              role="presentation"
              onClick={() => setSelectedLiabilityAccountId(null)}
            >
              <div
                className={styles.detailCard}
                role="dialog"
                aria-modal="true"
                aria-label={`${selectedLiabilityAccount.displayName} 상세`}
                onClick={event => event.stopPropagation()}
              >
                <div className={styles.detailHeader}>
                  <div>
                    <span className={styles.detailEyebrow}>
                      {[selectedLiabilityAccount.subType || "부채", selectedLiabilityAccount.owner]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <h3 className={styles.detailTitle}>{selectedLiabilityAccount.displayName}</h3>
                  </div>

                  <div className={styles.detailHeaderActions}>
                    <strong className={styles.detailTotal}>
                      {formatCurrency(
                        Math.abs(Number(selectedLiabilityAccount.currentBalance || 0))
                      )}
                    </strong>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const accountId = selectedLiabilityAccount.accountId;
                        setSelectedLiabilityAccountId(null);
                        setEditingAccountId(accountId);
                      }}
                    >
                      편집
                    </Button>
                    <Button
                      className={styles.modalCloseButton}
                      variant="soft"
                      size="sm"
                      iconOnly
                      aria-label="상세 닫기"
                      onClick={() => setSelectedLiabilityAccountId(null)}
                    >
                      ×
                    </Button>
                  </div>
                </div>

                <div className={styles.cashDetailMetrics}>
                  <div>
                    <span>현재 남은 부채</span>
                    <strong>
                      {formatCurrency(
                        Math.abs(Number(selectedLiabilityAccount.currentBalance || 0))
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>시작 금액</span>
                    <strong>
                      {formatCurrency(
                        Math.abs(Number(selectedLiabilityAccount.openingBalance || 0))
                      )}
                    </strong>
                  </div>
                  {selectedLiabilityAccount.startYear && (
                    <div>
                      <span>기간</span>
                      <strong>
                        {selectedLiabilityAccount.startYear}
                        {selectedLiabilityAccount.endYear
                          ? ` ~ ${selectedLiabilityAccount.endYear}`
                          : " ~"}
                      </strong>
                    </div>
                  )}
                </div>

                {selectedLiabilityAccount.subType === "대출" && (
                  <div className={styles.liabilityPrimaryAction}>
                    <div>
                      <strong>이번 상환을 기록할까요?</strong>
                      <span>원금과 이자를 나눠 기록하고 대출잔액을 자동으로 줄입니다.</span>
                    </div>
                    <Button
                      size="lg"
                      onClick={() => {
                        const accountId = selectedLiabilityAccount.accountId;
                        setSelectedLiabilityAccountId(null);
                        openInput({
                          mode: "transfer",
                          toAccountId: accountId,
                          categoryId: "__moneybook_loan_repayment__"
                        });
                      }}
                    >
                      대출 상환 입력
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === "investment" && (
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2 className={styles.sectionTitle}>투자자산</h2>

            {!loading && visibleInvestmentAccounts.length > 0 && (
              <div className={styles.sectionHeadingActions}>
                <span className={styles.sectionCount}>
                  {visibleInvestmentAccounts.length}개 계좌
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={quoteRefreshing}
                  loadingLabel="갱신 중"
                  onClick={() => void handleRefreshInvestmentQuotes()}
                >
                  시세 새로고침
                </Button>
              </div>
            )}
          </div>

          {!loading && summary && (
            <div className={styles.investmentSummary}>
              <div>
                <span className={styles.summaryLabel}>합계</span>

                <strong className={styles.investmentSummaryValue}>
                  {formatCurrency(visibleInvestmentTotal)}
                </strong>
              </div>

              <div className={styles.investmentSummarySub}>
                <span>
                  예수금 <strong>{formatCurrency(visibleInvestmentCashTotal)}</strong>
                </span>

                <span>
                  실현손익{" "}
                  <strong
                    style={{
                      color:
                        visibleInvestmentRealizedPnlTotal < 0 ? "var(--color-error)" : undefined
                    }}
                  >
                    {formatSignedCurrency(visibleInvestmentRealizedPnlTotal)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {!loading &&
            (visibleCashBaselinePending.length > 0 || visibleStaleManualPrices.length > 0) && (
              <Card padding="sm" tone="soft" shadow="none" className={styles.investmentWarnings}>
                {visibleCashBaselinePending.map(item => (
                  <div key={`cash:${item.accountId}`} className={styles.investmentWarningRow}>
                    <div>
                      <strong>예수금 기준 미설정</strong>
                      <span>{item.accountName}의 현재 예수금을 한 번 입력해주세요.</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedAccountId(item.accountId)}
                    >
                      설정
                    </Button>
                  </div>
                ))}

                {visibleStaleManualPrices.map(item => (
                  <div key={`quote:${item.holdingId}`} className={styles.investmentWarningRow}>
                    <div>
                      <strong>수동 시세 갱신 필요</strong>
                      <span>
                        {item.stockName || item.stockCode}
                        {item.elapsedDays === null
                          ? " · 갱신일 없음"
                          : ` · ${item.elapsedDays}일 전`}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedAccountId(item.accountId)}
                    >
                      확인
                    </Button>
                  </div>
                ))}
              </Card>
            )}

          {loading && <p className={styles.loading}>투자계좌를 불러오는 중입니다.</p>}

          {!loading && visibleInvestmentAccounts.length === 0 && (
            <p className={styles.emptyState}>등록된 투자계좌가 없습니다.</p>
          )}

          {!loading && visibleInvestmentAccounts.length > 0 && (
            <div className={styles.accountList}>
              {visibleInvestmentAccounts.map(account => {
                const isSelected = selectedAccountId === account.accountId;

                const holdingCount = investmentHoldings.filter(
                  holding => holding.accountId === account.accountId
                ).length;

                return (
                  <Fragment key={account.accountId}>
                    <button
                      type="button"
                      className={[styles.accountCard, isSelected ? styles.accountCardActive : ""]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setCashError("");

                        setSelectedAccountId(isSelected ? null : account.accountId);
                      }}
                    >
                      <div className={styles.accountCardTop}>
                        <div className={styles.accountIdentity}>
                          <strong className={styles.accountName}>{account.accountName}</strong>

                          <span className={styles.accountSub}>
                            {[account.subType, account.owner, `${holdingCount}종목`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>

                        <div className={styles.accountTotal}>
                          <strong>{formatCurrency(account.accountValueKrw)}</strong>

                          <span>총 평가</span>
                        </div>
                      </div>

                      <div className={styles.accountMetrics}>
                        <div className={styles.accountMetric}>
                          <span>예수금</span>

                          <strong>
                            {account.cashBaselineConfigured
                              ? formatCurrency(account.currentCashKrw)
                              : "미설정"}
                          </strong>
                        </div>

                        <div className={styles.accountMetric}>
                          <span>실현손익</span>

                          <strong
                            style={{
                              color: account.realizedPnlKrw < 0 ? "var(--color-error)" : undefined
                            }}
                          >
                            {formatSignedCurrency(account.realizedPnlKrw)}
                          </strong>
                        </div>
                      </div>
                    </button>

                    {isSelected && selectedAccount && (
                      <div
                        className={styles.investmentDetailBackdrop}
                        role="presentation"
                        onClick={() => setSelectedAccountId(null)}
                      >
                        <div
                          className={styles.detailCard}
                          role="dialog"
                          aria-modal="true"
                          aria-label={`${selectedAccount.accountName} 상세`}
                          onClick={event => event.stopPropagation()}
                        >
                          <div className={styles.detailHeader}>
                            <div>
                              <span className={styles.detailEyebrow}>
                                {["투자계좌", selectedAccount.owner].filter(Boolean).join(" · ")}
                              </span>

                              <h3 className={styles.detailTitle}>{selectedAccount.accountName}</h3>
                            </div>

                            <div className={styles.detailHeaderActions}>
                              <strong className={styles.detailTotal}>
                                {formatCurrency(selectedAccount.accountValueKrw)}
                              </strong>

                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setEditingAccountId(selectedAccount.accountId)}
                              >
                                편집
                              </Button>

                              <Button
                                className={styles.modalCloseButton}
                                variant="soft"
                                size="sm"
                                iconOnly
                                aria-label="상세 닫기"
                                onClick={() => setSelectedAccountId(null)}
                              >
                                ×
                              </Button>
                            </div>
                          </div>

                          <div className={styles.detailMetrics}>
                            <div className={styles.detailMetric}>
                              <span>현재 예수금</span>

                              <strong>
                                {selectedAccount.cashBaselineConfigured
                                  ? formatCurrency(selectedAccount.currentCashKrw)
                                  : "미설정"}
                              </strong>
                            </div>

                            <div className={styles.detailMetric}>
                              <span>보유종목</span>

                              <strong>{formatCurrency(selectedAccount.holdingValueKrw)}</strong>
                            </div>

                            <div className={styles.detailMetric}>
                              <span>실현손익</span>

                              <strong
                                style={{
                                  color:
                                    selectedAccount.realizedPnlKrw < 0
                                      ? "var(--color-error)"
                                      : undefined
                                }}
                              >
                                {formatSignedCurrency(selectedAccount.realizedPnlKrw)}
                              </strong>
                            </div>
                          </div>

                          <div className={styles.reconcileActions}>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                const accountId = selectedAccount.accountId;
                                setSelectedAccountId(null);
                                openInput({
                                  mode: "transfer",
                                  fromAccountId: accountId
                                });
                              }}
                            >
                              여기서 보내기
                            </Button>

                            <Button
                              size="sm"
                              onClick={() => {
                                const accountId = selectedAccount.accountId;
                                setSelectedAccountId(null);
                                openInput({
                                  mode: "transfer",
                                  toAccountId: accountId
                                });
                              }}
                            >
                              여기로 받기
                            </Button>
                          </div>

                          {!selectedAccount.cashBaselineConfigured && (
                            <div className={styles.cashSetupCard}>
                              <div className={styles.cashSetupHeading}>
                                <strong>예수금 설정</strong>

                                <span>증권사 앱의 현재 예수금을 한 번 입력해주세요.</span>
                              </div>

                              <div className={styles.cashForm}>
                                <input
                                  className={styles.cashInput}
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  value={cashInput}
                                  onChange={event => setCashInput(event.target.value)}
                                  placeholder="예: 327500"
                                />

                                <Button
                                  size="sm"
                                  onClick={handleSaveCashBaseline}
                                  loading={cashSaving}
                                  loadingLabel="저장 중..."
                                >
                                  설정
                                </Button>
                              </div>
                            </div>
                          )}

                          {selectedAccount.cashBaselineConfigured && (
                            <details className={styles.baselineDetails}>
                              <summary className={styles.baselineSummary}>
                                예수금 기준값 다시 설정
                              </summary>

                              <div className={styles.baselineBody}>
                                <p className={styles.helperText}>
                                  현재 예수금과 다른 값입니다. 투자거래 계산의 시작점이 되는
                                  기준값입니다.
                                </p>

                                <div className={styles.cashForm}>
                                  <input
                                    className={styles.cashInput}
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    value={cashInput}
                                    onChange={event => setCashInput(event.target.value)}
                                  />

                                  <Button
                                    size="sm"
                                    onClick={handleSaveCashBaseline}
                                    loading={cashSaving}
                                    loadingLabel="저장 중..."
                                  >
                                    저장
                                  </Button>
                                </div>
                              </div>
                            </details>
                          )}

                          {cashError && <p className={styles.error}>{cashError}</p>}

                          <div className={styles.holdingsHeader}>
                            <h4 className={styles.holdingsTitle}>보유종목</h4>

                            <span className={styles.holdingsCount}>
                              {holdingsForSelected.length - soldOutHoldingCount}
                              종목
                            </span>
                          </div>

                          {visibleHoldingsForSelected.length === 0 && (
                            <p className={styles.emptyState}>보유 중인 종목이 없습니다.</p>
                          )}

                          {visibleHoldingsForSelected.length > 0 && (
                            <ul className={styles.investmentHoldingList}>
                              {visibleHoldingsForSelected.map(holding => {
                                const evaluationPnl = holding.valueKrw - holding.costKrw;
                                const amountType = isAmountProductCode(holding.stockCode);
                                const amountQuantity = amountType
                                  ? Number(holding.quantity)
                                  : undefined;
                                const nativeAmount =
                                  Number(holding.quantity) *
                                  amountProductUnitPrice(holding.manualPrice, holding.currentPrice);
                                const quoteMissing =
                                  holding.quoteMode === "자동" &&
                                  Number(holding.quantity) > 0 &&
                                  !(holding.currentPrice > 0);

                                return (
                                  <li
                                    key={holding.holdingId}
                                    className={styles.investmentHoldingRow}
                                  >
                                    <div className={styles.investmentHoldingTop}>
                                      <div className={styles.investmentHoldingIdentity}>
                                        <div className={styles.stockNameRow}>
                                          <strong className={styles.holdingName}>
                                            {holding.stockName}
                                          </strong>

                                          {holding.quoteMode === "수동" && !amountType && (
                                            <span className={styles.manualBadge}>수동시세</span>
                                          )}
                                        </div>

                                        <span className={styles.holdingMeta}>
                                          {amountType ? (
                                            <>
                                              {holding.market === "국내" ? "원화" : "달러"} 금액형
                                              {" · "}
                                              {formatNativeAmount(nativeAmount, holding.market)}
                                            </>
                                          ) : (
                                            <>
                                              {holding.stockCode}
                                              {" · "}
                                              {holding.market === "해외"
                                                ? holding.currency || "USD"
                                                : holding.market}
                                              {" · "}
                                              {formatQuantity(holding.quantity)}주
                                              {typeof holding.dayChangeRate === "number" &&
                                                Number(holding.quantity) > 0 && (
                                                  <span
                                                    style={{
                                                      color:
                                                        holding.dayChangeRate < 0
                                                          ? "var(--color-error)"
                                                          : undefined
                                                    }}
                                                  >
                                                    {" · 오늘 "}
                                                    {formatPercent(holding.dayChangeRate)}
                                                  </span>
                                                )}
                                            </>
                                          )}
                                        </span>
                                      </div>

                                      <div className={styles.holdingResult}>
                                        <strong className={styles.holdingValue}>
                                          {formatCurrency(holding.valueKrw)}
                                        </strong>

                                        <span
                                          className={styles.holdingReturn}
                                          style={{
                                            color:
                                              holding.returnRate < 0
                                                ? "var(--color-error)"
                                                : undefined
                                          }}
                                        >
                                          {formatPercent(holding.returnRate)}
                                        </span>
                                      </div>
                                    </div>

                                    {amountType ? (
                                      <div className={styles.holdingDetails}>
                                        <div className={styles.holdingDetailItem}>
                                          <span>원금</span>
                                          <strong>{formatCurrency(holding.costKrw)}</strong>
                                        </div>

                                        <div className={styles.holdingDetailItem}>
                                          <span>평가금액</span>
                                          <strong>
                                            {formatNativeAmount(nativeAmount, holding.market)}
                                          </strong>
                                        </div>

                                        <div className={styles.holdingDetailItem}>
                                          <span>평가손익</span>
                                          <strong
                                            style={{
                                              color:
                                                evaluationPnl < 0 ? "var(--color-error)" : undefined
                                            }}
                                          >
                                            {formatSignedCurrency(evaluationPnl)}
                                          </strong>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className={styles.holdingDetails}>
                                        <div className={styles.holdingDetailItem}>
                                          <span>평단</span>

                                          <strong>
                                            {formatPrice(
                                              holding.avgBuyPrice,
                                              holding.market,
                                              holding.currency
                                            )}
                                          </strong>
                                        </div>

                                        <div className={styles.holdingDetailItem}>
                                          <span>현재가</span>

                                          <strong>
                                            {formatPrice(
                                              holding.currentPrice,
                                              holding.market,
                                              holding.currency
                                            )}
                                          </strong>
                                        </div>

                                        <div className={styles.holdingDetailItem}>
                                          <span>평가손익</span>

                                          <strong
                                            style={{
                                              color:
                                                evaluationPnl < 0 ? "var(--color-error)" : undefined
                                            }}
                                          >
                                            {formatSignedCurrency(evaluationPnl)}
                                          </strong>
                                        </div>
                                      </div>
                                    )}

                                    {quoteMissing && (
                                      <p className={styles.error}>
                                        자동 시세를 아직 받지 못했습니다. 시세가 조회되지 않는
                                        상품이면 아래에서 직접 입력으로 바꿔주세요.
                                      </p>
                                    )}

                                    {holding.quoteMode === "자동" && (
                                      <details className={styles.baselineDetails}>
                                        <summary className={styles.baselineSummary}>
                                          시세 설정
                                        </summary>

                                        <div className={styles.baselineBody}>
                                          <p className={styles.helperText}>
                                            자동 시세로 평가 중입니다. 비상장·장외 상품처럼 시세가
                                            조회되지 않으면 직접 입력으로 바꿔주세요.
                                          </p>

                                          <Button
                                            size="sm"
                                            variant="secondary"
                                            loading={quoteModeSavingId === holding.holdingId}
                                            loadingLabel="바꾸는 중"
                                            onClick={() =>
                                              void handleChangeQuoteMode(holding.holdingId, "수동")
                                            }
                                          >
                                            직접 시세 입력으로 바꾸기
                                          </Button>

                                          {manualPriceErrors[holding.holdingId] && (
                                            <p className={styles.error}>
                                              {manualPriceErrors[holding.holdingId]}
                                            </p>
                                          )}
                                        </div>
                                      </details>
                                    )}

                                    {holding.quoteMode === "수동" && (
                                      <details className={styles.baselineDetails}>
                                        <summary className={styles.baselineSummary}>
                                          {amountType ? "평가금액 수정" : "수동시세 수정"}
                                        </summary>

                                        <div className={styles.baselineBody}>
                                          <p className={styles.helperText}>
                                            {amountType
                                              ? `이자가 붙은 현재 금액(${holding.market === "국내" ? "원" : "USD"})을 입력하세요.${holding.market === "해외" ? " 원화 평가액은 환율로 자동 계산됩니다." : ""}`
                                              : "자동 시세 대신 이 평가단가를 사용합니다."}
                                          </p>

                                          <div className={styles.cashForm}>
                                            <input
                                              className={styles.cashInput}
                                              type="number"
                                              inputMode="decimal"
                                              min="0"
                                              step="any"
                                              value={getManualPriceInput(
                                                holding.holdingId,
                                                holding.manualPrice,
                                                holding.currentPrice,
                                                amountQuantity
                                              )}
                                              onChange={event =>
                                                handleManualPriceChange(
                                                  holding.holdingId,
                                                  event.target.value
                                                )
                                              }
                                              placeholder={
                                                amountType
                                                  ? "현재 평가금액"
                                                  : holding.market === "국내"
                                                    ? "평가단가(원)"
                                                    : "평가단가(USD)"
                                              }
                                            />

                                            <Button
                                              size="sm"
                                              loading={manualPriceSavingId === holding.holdingId}
                                              loadingLabel="저장 중"
                                              onClick={() =>
                                                void handleSaveManualPrice(
                                                  holding.holdingId,
                                                  holding.manualPrice,
                                                  holding.currentPrice,
                                                  amountQuantity
                                                )
                                              }
                                            >
                                              시세 저장
                                            </Button>
                                          </div>

                                          {manualPriceErrors[holding.holdingId] && (
                                            <p className={styles.error}>
                                              {manualPriceErrors[holding.holdingId]}
                                            </p>
                                          )}

                                          {manualPriceFeedbackId === holding.holdingId && (
                                            <p className={styles.helperText}>
                                              수동시세를 저장했습니다.
                                            </p>
                                          )}

                                          {!amountType && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              loading={quoteModeSavingId === holding.holdingId}
                                              loadingLabel="바꾸는 중"
                                              onClick={() =>
                                                void handleChangeQuoteMode(
                                                  holding.holdingId,
                                                  "자동"
                                                )
                                              }
                                            >
                                              자동 시세로 바꾸기
                                            </Button>
                                          )}
                                        </div>
                                      </details>
                                    )}

                                    {holding.market === "해외" && holding.fx > 0 && (
                                      <p className={styles.fxMeta}>
                                        적용환율 {formatCurrency(holding.fx)}
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {soldOutHoldingCount > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowSoldOutHoldings(current => !current)}
                            >
                              {showSoldOutHoldings
                                ? "매도 완료 종목 숨기기"
                                : `매도 완료 ${soldOutHoldingCount}종목 보기`}
                            </Button>
                          )}

                          <InvestmentTradeForm
                            account={selectedAccount}
                            holdings={holdingsForSelected}
                            onSaved={handleInvestmentSaved}
                          />

                          <InvestmentTradeHistory
                            accountId={selectedAccount.accountId}
                            refreshKey={tradeHistoryRefreshKey}
                            onChanged={handleInvestmentSaved}
                          />
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </section>
      )}

      {(editingAccountId || creatingAccount) && (
        <div
          className={styles.editorBackdrop}
          role="presentation"
          onClick={() => {
            setEditingAccountId(null);
            setCreatingAccount(false);
          }}
        >
          <section
            className={styles.editorSheet}
            role="dialog"
            aria-modal="true"
            aria-label="계좌 편집"
            onClick={event => event.stopPropagation()}
          >
            <AccountSettings
              initialAccountId={editingAccountId || undefined}
              createNew={creatingAccount}
              initialOwner={userName}
              embedded
              onClose={() => {
                setEditingAccountId(null);
                setCreatingAccount(false);
              }}
              onSaved={async () => {
                markLedgerChanged();
                await loadDashboard(true);
              }}
            />
          </section>
        </div>
      )}
    </main>
  );
}
