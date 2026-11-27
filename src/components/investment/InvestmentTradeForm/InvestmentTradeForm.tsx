import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  createInvestmentTrade,
  getInvestmentTrades,
  lookupInvestmentSymbol,
  searchInvestmentSymbols
} from "../../../api/investments";

import type { HoldingSummary, InvestmentAccountSummary } from "../../../types/dashboard";

import type {
  CreateInvestmentTradePayload,
  InvestmentSymbolSearchItem,
  InvestmentTrade,
  InvestmentTradeType,
  Market,
  QuoteMode
} from "../../../types/investment";

import { getSeoulDateString } from "../../../utils/dateTime";

import { Button } from "../../common/Button/Button";
import { Card } from "../../common/Card/Card";
import { formatMoney } from "../../common/Money/Money";
import {
  amountProductUnitPrice,
  amountToTradeUnits,
  isAmountProductCode,
  makeAmountProductCode
} from "../amountProduct";
import { FOREIGN_CURRENCIES, estimateTradeCosts, guessForeignCurrency } from "../tradeCostEstimate";

import styles from "./InvestmentTradeForm.module.css";

interface InvestmentTradeFormProps {
  account: InvestmentAccountSummary;
  holdings: HoldingSummary[];
  onSaved: () => void | Promise<void>;
}

type SearchStatus = "idle" | "loading" | "done" | "error";

type SelectedInstrument = {
  stockCode: string;
  stockName: string;
  market: Market;
  holdingId?: string;
  /* 신규 종목의 시세 방식. 비우면 자동 시세입니다. */
  quoteMode?: QuoteMode;
};

type ProductKind = "stock" | "amount";

const GOLD_SPOT_CODE = "04020000";

const FUND_BRAND_ALIASES: Array<[RegExp, string]> = [
  [/코덱스/gi, "KODEX"],
  [/타이거/gi, "TIGER"],
  [/에이스/gi, "ACE"],
  [/라이즈/gi, "RISE"],
  [/솔/gi, "SOL"],
  [/플러스/gi, "PLUS"],
  [/타임폴리오/gi, "TIMEFOLIO"]
];

function getToday() {
  return getSeoulDateString();
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return formatMoney(value);
}

function formatAmountInCurrency(value: number, foreign: boolean) {
  if (!Number.isFinite(value)) return "-";

  return foreign
    ? `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} USD`
    : formatMoney(value);
}

function normalizeMarket(value: string | null | undefined): Market {
  return value === "해외" ? "해외" : "국내";
}

function normalizeSearchText(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function aliasSearchText(value: string) {
  return FUND_BRAND_ALIASES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}

function holdingMatchesQuery(holding: HoldingSummary, query: string) {
  if (!query.trim()) return true;

  const haystack = normalizeSearchText(`${holding.stockName} ${holding.stockCode}`);

  const raw = normalizeSearchText(query);
  const aliased = normalizeSearchText(aliasSearchText(query));

  return [raw, aliased].filter(Boolean).some(term => haystack.includes(term));
}

function makeRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return ["INV", Date.now(), Math.random().toString(36).slice(2)].join("_");
}

export default function InvestmentTradeForm({
  account,
  holdings,
  onSaved
}: InvestmentTradeFormProps) {
  const [tradeType, setTradeType] = useState<InvestmentTradeType>("매수");
  const [tradeDate, setTradeDate] = useState(getToday());

  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [remoteResults, setRemoteResults] = useState<InvestmentSymbolSearchItem[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<SelectedInstrument | null>(null);

  const [manualMode, setManualMode] = useState(false);
  const [manualStockCode, setManualStockCode] = useState("");
  const [manualStockName, setManualStockName] = useState("");
  const [manualMarket, setManualMarket] = useState<Market>("국내");
  const [manualChecking, setManualChecking] = useState(false);

  const [productKind, setProductKind] = useState<ProductKind>("stock");
  const [amountProductName, setAmountProductName] = useState("");
  const [amountCurrency, setAmountCurrency] = useState<"KRW" | "USD">("USD");
  const [amount, setAmount] = useState("");
  const [closeAll, setCloseAll] = useState(false);

  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [recentTrades, setRecentTrades] = useState<InvestmentTrade[]>([]);
  const [feeKrw, setFeeKrw] = useState("");
  const [taxKrw, setTaxKrw] = useState("");
  const [settlementKrw, setSettlementKrw] = useState("");
  const [memo, setMemo] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const requestMemory = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);

  const activeHoldings = useMemo(() => holdings.filter(holding => !holding.isDeleted), [holdings]);

  const sellableHoldings = useMemo(
    () => activeHoldings.filter(holding => Number(holding.quantity) > 0),
    [activeHoldings]
  );

  const isDividend = tradeType === "배당";

  const localMatches = useMemo(() => {
    // 매수: 지금 보유 중인 일반 종목 / 매도: 수량이 남은 종목 / 배당: 다 판 종목까지 전부
    const source =
      tradeType === "매도"
        ? sellableHoldings
        : tradeType === "배당"
          ? activeHoldings
          : sellableHoldings.filter(holding => !isAmountProductCode(holding.stockCode));

    return source.filter(holding => holdingMatchesQuery(holding, searchQuery));
  }, [activeHoldings, sellableHoldings, searchQuery, tradeType]);

  const amountHoldings = useMemo(
    () => sellableHoldings.filter(holding => isAmountProductCode(holding.stockCode)),
    [sellableHoldings]
  );

  // 해외 종목 환율 입력을 줄이기 위해 이 계좌에서 같은 통화로 마지막에 쓰인 적용환율을 기본값으로 씁니다.
  function recentFxFor(code: string) {
    const fx = activeHoldings.find(
      holding => holding.market === "해외" && (holding.currency || "USD") === code && holding.fx > 0
    )?.fx;

    return fx ? String(Math.round(fx * 100) / 100) : "";
  }

  useEffect(() => {
    let cancelled = false;

    getInvestmentTrades({ accountId: account.accountId })
      .then(result => {
        if (!cancelled) setRecentTrades(Array.isArray(result.items) ? result.items : []);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [account.accountId, success]);

  const selectedHolding = useMemo(() => {
    if (!selectedInstrument) return null;

    if (selectedInstrument.holdingId) {
      return (
        activeHoldings.find(holding => holding.holdingId === selectedInstrument.holdingId) ?? null
      );
    }

    return (
      activeHoldings.find(
        holding =>
          holding.stockCode.trim().toUpperCase() ===
          selectedInstrument.stockCode.trim().toUpperCase()
      ) ?? null
    );
  }, [activeHoldings, selectedInstrument]);

  const isNewHolding = tradeType === "매수" && !!selectedInstrument && !selectedHolding;

  const effectiveMarket: Market = selectedInstrument ? selectedInstrument.market : "국내";

  const isForeign = effectiveMarket === "해외";

  const isAmountInstrument =
    !!selectedInstrument && isAmountProductCode(selectedInstrument.stockCode);

  const amountUnitPrice = selectedHolding
    ? amountProductUnitPrice(selectedHolding.manualPrice, selectedHolding.currentPrice)
    : 1;

  const currencyLabel = isForeign ? currency : "원";

  const amountCurrencyLabel = currencyLabel;

  const usesAmountInput = isDividend || isAmountInstrument;

  const heldAmount = selectedHolding ? Number(selectedHolding.quantity) * amountUnitPrice : 0;

  const amountUnits = useMemo(
    () =>
      isAmountInstrument && tradeType !== "배당"
        ? amountToTradeUnits({
            tradeType,
            amount: Number(amount),
            unitPrice: amountUnitPrice,
            heldQuantity: selectedHolding ? Number(selectedHolding.quantity) : 0,
            closeAll: tradeType === "매도" && closeAll
          })
        : null,
    [amount, amountUnitPrice, closeAll, isAmountInstrument, selectedHolding, tradeType]
  );

  // 배당·이자는 받은 금액을 "1단위 × 금액"으로 기록합니다.
  const effectiveQuantity = isDividend
    ? Number(amount) > 0
      ? 1
      : 0
    : isAmountInstrument
      ? (amountUnits?.quantity ?? 0)
      : Number(quantity);

  const effectiveUnitPrice = isDividend
    ? Number(amount)
    : isAmountInstrument
      ? (amountUnits?.unitPrice ?? 0)
      : Number(unitPrice);

  const filteredRemoteResults = useMemo(() => {
    const localCodes = new Set(localMatches.map(holding => holding.stockCode.trim().toUpperCase()));

    return remoteResults.filter(item => !localCodes.has(item.stockCode.trim().toUpperCase()));
  }, [localMatches, remoteResults]);

  function resetSelection() {
    setSelectedInstrument(null);
    setSearchQuery("");
    setRemoteResults([]);
    setSearchStatus("idle");
    setShowResults(false);
    setManualMode(false);
    setManualStockCode("");
    setManualStockName("");
    setManualMarket("국내");
    setManualChecking(false);
    setAmountProductName("");
    setFxRate("");
    setCurrency("USD");
  }

  function resetTradeInputs() {
    setQuantity("");
    setUnitPrice("");
    setAmount("");
    setCloseAll(false);
    setFeeKrw("");
    setTaxKrw("");
    setSettlementKrw("");
    setMemo("");
    requestMemory.current = null;
  }

  useEffect(() => {
    setTradeType("매수");
    setProductKind("stock");
    setTradeDate(getToday());
    resetSelection();
    resetTradeInputs();
    setError("");
    setSuccess("");
  }, [account.accountId]);

  useEffect(() => {
    resetSelection();
    resetTradeInputs();
    setError("");
    setSuccess("");
  }, [tradeType]);

  useEffect(() => {
    if (tradeType !== "매수" || selectedInstrument || manualMode) {
      return;
    }

    const query = searchQuery.trim();

    if (!query) {
      setRemoteResults([]);
      setSearchStatus("idle");
      return;
    }

    let cancelled = false;

    setSearchStatus("loading");

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchInvestmentSymbols(query);

        if (cancelled) return;

        setRemoteResults(Array.isArray(result.items) ? result.items : []);
        setSearchStatus("done");
      } catch {
        if (cancelled) return;
        setRemoteResults([]);
        setSearchStatus("error");
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [manualMode, searchQuery, selectedInstrument, tradeType]);

  useEffect(() => {
    if (!isForeign) {
      setFxRate("");
    }
  }, [isForeign]);

  const grossKrw = useMemo(() => {
    const parsedQuantity = effectiveQuantity;
    const parsedPrice = effectiveUnitPrice;
    const parsedFx = isForeign ? Number(fxRate) : 1;

    if (
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity <= 0 ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice <= 0 ||
      !Number.isFinite(parsedFx) ||
      parsedFx <= 0
    ) {
      return 0;
    }

    return parsedQuantity * parsedPrice * parsedFx;
  }, [effectiveQuantity, effectiveUnitPrice, fxRate, isForeign]);

  const costEstimate = useMemo(
    () =>
      selectedInstrument && (tradeType === "매수" || tradeType === "매도")
        ? estimateTradeCosts(recentTrades, {
            tradeType,
            market: selectedInstrument.market,
            stockCode: selectedInstrument.stockCode,
            grossKrw
          })
        : { feeKrw: 0, taxKrw: 0, feeRate: null, taxRate: null },
    [grossKrw, recentTrades, selectedInstrument, tradeType]
  );

  // 비워 둔 수수료·세금은 최근 거래 비율로 추정한 값을 씁니다.
  const feeIsEstimated = !feeKrw.trim() && costEstimate.feeKrw > 0;
  const taxIsEstimated = !taxKrw.trim() && costEstimate.taxKrw > 0;

  const parsedFeeForPreview = feeKrw.trim()
    ? Number.isFinite(Number(feeKrw)) && Number(feeKrw) >= 0
      ? Number(feeKrw)
      : 0
    : costEstimate.feeKrw;

  const parsedTaxForPreview = taxKrw.trim()
    ? Number.isFinite(Number(taxKrw)) && Number(taxKrw) >= 0
      ? Number(taxKrw)
      : 0
    : costEstimate.taxKrw;

  const estimatedSettlement =
    grossKrw > 0
      ? tradeType === "매수"
        ? grossKrw + parsedFeeForPreview + parsedTaxForPreview
        : Math.max(0, grossKrw - parsedFeeForPreview - parsedTaxForPreview)
      : 0;

  const actualSettlement = useMemo(() => {
    if (!settlementKrw.trim()) return null;
    const value = Number(settlementKrw);
    return Number.isFinite(value) ? value : null;
  }, [settlementKrw]);

  const settlementForDisplay =
    actualSettlement !== null && actualSettlement > 0 ? actualSettlement : estimatedSettlement;

  const transactionCostDifference =
    actualSettlement !== null && actualSettlement > 0 && estimatedSettlement > 0
      ? tradeType === "매수"
        ? actualSettlement - estimatedSettlement
        : estimatedSettlement - actualSettlement
      : null;

  const cashAfterTrade =
    account.currentCashKrw !== null &&
    account.currentCashKrw !== undefined &&
    settlementForDisplay > 0
      ? tradeType === "매수"
        ? account.currentCashKrw - settlementForDisplay
        : account.currentCashKrw + settlementForDisplay
      : null;

  function chooseHolding(holding: HoldingSummary) {
    setSelectedInstrument({
      stockCode: holding.stockCode,
      stockName: holding.stockName || holding.stockCode,
      market: normalizeMarket(holding.market),
      holdingId: holding.holdingId
    });
    setSearchQuery(holding.stockName || holding.stockCode);
    setRemoteResults([]);
    setSearchStatus("idle");
    setShowResults(false);
    setManualMode(false);
    const holdingCurrency = holding.market === "해외" ? holding.currency || "USD" : "KRW";
    setCurrency(holding.market === "해외" ? holdingCurrency : "USD");
    setFxRate(
      holding.market === "해외" && holding.fx > 0
        ? String(Math.round(holding.fx * 100) / 100)
        : holding.market === "해외"
          ? recentFxFor(holdingCurrency)
          : ""
    );
    setCloseAll(false);
    setError("");
  }

  function chooseRemote(item: InvestmentSymbolSearchItem) {
    const existing = activeHoldings.find(
      holding => holding.stockCode.trim().toUpperCase() === item.stockCode.trim().toUpperCase()
    );

    setSelectedInstrument({
      stockCode: item.stockCode,
      stockName: item.stockName || item.stockCode,
      market: item.market,
      holdingId: existing?.holdingId
    });
    if (existing) {
      chooseHolding(existing);
      return;
    }

    setSearchQuery(item.stockName || item.stockCode);
    setRemoteResults([]);
    setSearchStatus("idle");
    setShowResults(false);
    setManualMode(false);
    const guessed = guessForeignCurrency(item.symbol || item.stockCode);
    setCurrency(guessed);
    setFxRate(item.market === "해외" ? recentFxFor(guessed) : "");
    setError("");
  }

  async function confirmManualInstrument() {
    const code = manualStockCode.trim().toUpperCase();
    const name = manualStockName.trim();

    if (!code) {
      setError("종목코드를 입력해주세요.");
      return;
    }

    if (!name) {
      setError("종목이름을 입력해주세요.");
      return;
    }

    const existing = activeHoldings.find(
      holding => holding.stockCode.trim().toUpperCase() === code
    );

    if (existing) {
      chooseHolding(existing);
      return;
    }

    // 직접 입력한 코드가 시세 조회되는지 먼저 확인합니다.
    // 조회가 안 되면 처음부터 직접 시세로 등록해, 평가금액이 0원으로 남지 않게 합니다.
    setManualChecking(true);
    let quoteMode: QuoteMode = "수동";

    try {
      const lookup = await lookupInvestmentSymbol(code);
      if (lookup.found) quoteMode = "자동";
    } catch {
      quoteMode = "수동";
    } finally {
      setManualChecking(false);
    }

    setSelectedInstrument({
      stockCode: code,
      stockName: name,
      market: manualMarket,
      quoteMode
    });
    setSearchQuery(name);
    setManualMode(false);
    setShowResults(false);
    setCurrency("USD");
    setFxRate(manualMarket === "해외" ? recentFxFor("USD") : "");
    setError("");
  }

  function confirmAmountProduct() {
    const name = amountProductName.trim();

    if (!name) {
      setError("상품 이름을 입력해주세요. 예: 달러 발행어음");
      return;
    }

    const market: Market = amountCurrency === "USD" ? "해외" : "국내";

    const existing = amountHoldings.find(
      holding => holding.stockName.trim() === name && normalizeMarket(holding.market) === market
    );

    if (existing) {
      chooseHolding(existing);
      return;
    }

    setSelectedInstrument({
      stockCode: makeAmountProductCode(),
      stockName: name,
      market,
      quoteMode: "수동"
    });
    setSearchQuery(name);
    setShowResults(false);
    setCurrency("USD");
    setFxRate(market === "해외" ? recentFxFor("USD") : "");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    setError("");
    setSuccess("");

    if (!account.cashBaselineConfigured) {
      setError("먼저 이 투자계좌의 현재 예수금을 설정해주세요.");
      return;
    }

    if (!selectedInstrument) {
      setError(
        tradeType === "매수"
          ? "매수한 종목을 선택해주세요."
          : tradeType === "매도"
            ? "매도한 종목을 선택해주세요."
            : "배당·이자를 받은 종목을 선택해주세요."
      );
      return;
    }

    if (!tradeDate) {
      setError("거래일을 입력해주세요.");
      return;
    }

    let parsedQuantity = effectiveQuantity;

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError(usesAmountInput ? "금액은 0보다 커야 합니다." : "수량은 0보다 커야 합니다.");
      return;
    }

    if (tradeType === "매도" && selectedHolding) {
      const held = Number(selectedHolding.quantity);

      if (isAmountInstrument && parsedQuantity > held && parsedQuantity <= held * (1 + 1e-9)) {
        // 소수점 계산 오차로 보유분을 살짝 넘는 경우는 보유분 전체로 맞춥니다.
        parsedQuantity = held;
      }

      if (parsedQuantity > held) {
        setError(
          isAmountInstrument
            ? "현재 평가금액보다 많습니다. 전부 찾았다면 '전액 해지'를 선택해주세요."
            : `보유수량 ${selectedHolding.quantity}주보다 많이 기록할 수 없습니다.`
        );
        return;
      }
    }

    const parsedUnitPrice = effectiveUnitPrice;

    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice <= 0) {
      setError("체결단가는 0보다 커야 합니다.");
      return;
    }

    const parsedFxRate = isForeign ? Number(fxRate) : 1;

    if (isForeign && (!Number.isFinite(parsedFxRate) || parsedFxRate <= 0)) {
      setError(`${currency} 상품은 체결 당시 환율을 입력해주세요.`);
      return;
    }

    // 배당·이자는 실제로 받은 금액만 기록합니다(원천징수 세금은 이미 빠진 금액).
    const parsedFee = isDividend ? 0 : feeKrw.trim() ? Number(feeKrw) : costEstimate.feeKrw;
    const parsedTax = isDividend ? 0 : taxKrw.trim() ? Number(taxKrw) : costEstimate.taxKrw;

    if (!Number.isFinite(parsedFee) || parsedFee < 0) {
      setError("수수료는 0 이상의 숫자로 입력해주세요.");
      return;
    }

    if (!Number.isFinite(parsedTax) || parsedTax < 0) {
      setError("세금은 0 이상의 숫자로 입력해주세요.");
      return;
    }

    let parsedSettlement: number | undefined;

    if (settlementKrw.trim()) {
      const value = Number(settlementKrw);

      if (!Number.isFinite(value) || value <= 0) {
        setError("실제 결제금액은 0보다 커야 합니다.");
        return;
      }

      parsedSettlement = value;
    }

    const payload: CreateInvestmentTradePayload = {
      accountId: account.accountId,
      tradeType,
      tradeDate,
      stockCode: selectedInstrument.stockCode,
      quantity: parsedQuantity,
      unitPrice: parsedUnitPrice,
      currency: isForeign ? currency : "KRW",
      fxRate: parsedFxRate,
      feeKrw: parsedFee,
      taxKrw: parsedTax
    };

    if (parsedSettlement !== undefined && !isDividend) {
      payload.settlementKrw = parsedSettlement;
    }

    if (memo.trim()) {
      payload.memo = memo.trim();
    }

    if (isNewHolding) {
      payload.stockName = selectedInstrument.stockName;
      payload.market = selectedInstrument.market;

      // 금액형 상품·KRX 금현물·시세 조회가 안 되는 직접 입력 종목은 수동 시세로 시작하고,
      // 체결단가를 첫 평가단가로 씁니다.
      const quoteMode: QuoteMode =
        isAmountInstrument || selectedInstrument.stockCode === GOLD_SPOT_CODE
          ? "수동"
          : (selectedInstrument.quoteMode ?? "자동");

      payload.quoteMode = quoteMode;

      if (quoteMode === "수동") {
        payload.manualPrice = parsedUnitPrice;
      }
    }

    const fingerprint = JSON.stringify(payload);

    const requestId =
      requestMemory.current?.fingerprint === fingerprint
        ? requestMemory.current.requestId
        : makeRequestId();

    requestMemory.current = {
      fingerprint,
      requestId
    };

    payload.requestId = requestId;

    setSaving(true);

    try {
      await createInvestmentTrade(payload);

      setSuccess(`${tradeType === "배당" ? "배당·이자" : tradeType} 내역을 저장했습니다.`);

      resetTradeInputs();
      resetSelection();

      void Promise.resolve(onSaved()).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "투자거래 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!account.cashBaselineConfigured) {
    return (
      <section className={styles.form}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h3 className={styles.title}>매매 기록</h3>
            <p className={styles.description}>매매를 기록하려면 먼저 현재 예수금을 설정해주세요.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.title}>매매 기록</h3>
          <p className={styles.description}>
            증권사에서 이미 체결된 내역을 기록하면 자산현황에 자동 반영됩니다.
          </p>
        </div>

        <div className={styles.cash}>
          <span>현재 예수금</span>
          <strong>{formatCurrency(account.currentCashKrw)}</strong>
        </div>
      </div>

      <div className={styles.tradeTabs}>
        {(
          [
            ["매수", "매수"],
            ["매도", "매도"],
            ["배당", "배당·이자"]
          ] as Array<[InvestmentTradeType, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={[styles.tradeTab, tradeType === value ? styles.tradeTabActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setTradeType(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tradeType === "매수" && !selectedInstrument && (
        <div className={styles.kindTabs} role="group" aria-label="상품 종류">
          <button
            type="button"
            className={[styles.kindTab, productKind === "stock" ? styles.kindTabActive : ""]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={productKind === "stock"}
            onClick={() => {
              setProductKind("stock");
              setError("");
            }}
          >
            주식 · ETF · 금
          </button>
          <button
            type="button"
            className={[styles.kindTab, productKind === "amount" ? styles.kindTabActive : ""]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={productKind === "amount"}
            onClick={() => {
              setProductKind("amount");
              setManualMode(false);
              setShowResults(false);
              setError("");
            }}
          >
            어음 · IMA · RP
          </button>
        </div>
      )}

      {selectedInstrument ? (
        <div className={styles.selectedInstrument}>
          <div className={styles.selectedInstrumentMain}>
            <strong>{selectedInstrument.stockName}</strong>
            <span>
              {isAmountInstrument ? (
                <>
                  {isForeign ? "달러" : "원화"} 금액형
                  {selectedHolding
                    ? ` · 평가 ${formatAmountInCurrency(heldAmount, isForeign)}`
                    : " · 신규 상품"}
                </>
              ) : (
                <>
                  {selectedInstrument.stockCode}
                  {" · "}
                  {selectedInstrument.market}
                  {selectedHolding ? ` · ${selectedHolding.quantity}주 보유` : " · 신규 종목"}
                  {!selectedHolding && selectedInstrument.quoteMode === "수동"
                    ? " · 시세 직접 입력"
                    : ""}
                </>
              )}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetSelection();
              setShowResults(true);
            }}
          >
            변경
          </Button>
        </div>
      ) : tradeType === "매수" && productKind === "amount" ? (
        <div className={styles.manualBox}>
          {amountHoldings.length > 0 && (
            <div className={styles.resultGroup}>
              <div className={styles.resultGroupTitle}>보유 중인 상품에 추가</div>
              {amountHoldings.map(holding => (
                <button
                  key={holding.holdingId}
                  type="button"
                  className={styles.resultItem}
                  onClick={() => chooseHolding(holding)}
                >
                  <span className={styles.resultName}>{holding.stockName}</span>
                  <span className={styles.resultMeta}>
                    {holding.market === "해외" ? "달러" : "원화"}
                    {" · 평가 "}
                    {formatAmountInCurrency(
                      Number(holding.quantity) *
                        amountProductUnitPrice(holding.manualPrice, holding.currentPrice),
                      holding.market === "해외"
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className={styles.manualHeader}>
            <strong>새 상품</strong>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>상품 이름</span>
            <input
              className={styles.input}
              type="text"
              value={amountProductName}
              onChange={event => setAmountProductName(event.target.value)}
              placeholder="예: 달러 발행어음, IMA 1년"
            />
          </label>

          <div className={styles.kindTabs} role="group" aria-label="통화">
            {(["USD", "KRW"] as const).map(code => (
              <button
                key={code}
                type="button"
                className={[styles.kindTab, amountCurrency === code ? styles.kindTabActive : ""]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={amountCurrency === code}
                onClick={() => setAmountCurrency(code)}
              >
                {code === "USD" ? "달러(USD)" : "원화(KRW)"}
              </button>
            ))}
          </div>

          <span className={styles.fieldHint}>
            주가 없이 금액으로 관리합니다. 이자가 붙으면 자산 화면에서 현재 평가금액만 고치면
            됩니다.{amountCurrency === "USD" ? " 원화 평가액은 매일 환율로 자동 계산됩니다." : ""}
          </span>

          <Button variant="secondary" onClick={confirmAmountProduct}>
            이 상품으로 기록
          </Button>
        </div>
      ) : manualMode && tradeType === "매수" ? (
        <div className={styles.manualBox}>
          <div className={styles.manualHeader}>
            <strong>종목 직접 입력</strong>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setManualMode(false);
                setShowResults(true);
                setError("");
              }}
            >
              검색으로 돌아가기
            </Button>
          </div>

          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>종목이름</span>
              <input
                className={styles.input}
                type="text"
                value={manualStockName}
                onChange={event => setManualStockName(event.target.value)}
                placeholder="예: 삼성전자"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>종목코드</span>
              <input
                className={styles.input}
                type="text"
                value={manualStockCode}
                onChange={event => setManualStockCode(event.target.value.toUpperCase())}
                placeholder="예: 005930 / AAPL"
                autoCapitalize="characters"
              />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>시장</span>
            <select
              className={styles.select}
              value={manualMarket}
              onChange={event => setManualMarket(event.target.value as Market)}
            >
              <option value="국내">국내</option>
              <option value="해외">해외</option>
            </select>
          </label>

          <span className={styles.fieldHint}>
            시세가 조회되지 않는 코드면 직접 입력한 시세로 평가합니다.
          </span>

          <Button
            variant="secondary"
            loading={manualChecking}
            loadingLabel="시세 확인 중..."
            onClick={() => void confirmManualInstrument()}
          >
            이 종목 사용
          </Button>
        </div>
      ) : (
        <div className={styles.searchSection}>
          <label className={styles.field}>
            <span className={styles.label}>
              {tradeType === "매수"
                ? "매수한 종목"
                : tradeType === "매도"
                  ? "매도한 종목"
                  : "배당·이자를 받은 종목"}
            </span>

            <div className={styles.searchInputWrap}>
              <span className={styles.searchIcon} aria-hidden="true">
                ⌕
              </span>
              <input
                className={styles.searchInput}
                type="search"
                value={searchQuery}
                onFocus={() => setShowResults(true)}
                onChange={event => {
                  setSearchQuery(event.target.value);
                  setShowResults(true);
                  setSuccess("");
                  setError("");
                }}
                placeholder={tradeType === "매수" ? "종목이름 검색" : "보유종목 이름 검색"}
                autoComplete="off"
              />
            </div>

            <span className={styles.fieldHint}>
              {tradeType === "매수"
                ? "이미 보유한 종목은 바로 선택할 수 있고, 새 종목은 이름으로 검색합니다."
                : tradeType === "매도"
                  ? "현재 보유 중인 종목에서만 선택합니다."
                  : "이미 다 판 종목도 고를 수 있습니다."}
            </span>
          </label>

          {showResults && (
            <Card padding="none" className={styles.searchPanel}>
              {localMatches.length > 0 && (
                <div className={styles.resultGroup}>
                  <div className={styles.resultGroupTitle}>
                    {tradeType === "매수" ? "보유 중" : "보유종목"}
                  </div>

                  {localMatches.map(holding => (
                    <button
                      key={holding.holdingId}
                      type="button"
                      className={styles.resultItem}
                      onClick={() => chooseHolding(holding)}
                    >
                      <span className={styles.resultName}>
                        {holding.stockName || holding.stockCode}
                      </span>
                      <span className={styles.resultMeta}>
                        {holding.stockCode}
                        {" · "}
                        {holding.market}
                        {" · "}
                        {holding.quantity}주 보유
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {tradeType === "매수" && searchQuery.trim() && (
                <div className={styles.resultGroup}>
                  <div className={styles.resultGroupTitle}>종목 검색</div>

                  {searchStatus === "loading" && (
                    <div className={styles.searchState}>
                      <span className={styles.lookupSpinner} />
                      <span>국내·해외 종목 찾는 중...</span>
                    </div>
                  )}

                  {filteredRemoteResults.map(item => (
                    <button
                      key={`${item.market}:${item.stockCode}:${item.symbol ?? ""}`}
                      type="button"
                      className={styles.resultItem}
                      onClick={() => chooseRemote(item)}
                    >
                      <span className={styles.resultName}>{item.stockName || item.stockCode}</span>
                      <span className={styles.resultMeta}>
                        {item.stockCode}
                        {" · "}
                        {item.market}
                        {item.assetType ? ` · ${item.assetType}` : ""}
                      </span>
                    </button>
                  ))}

                  {searchStatus === "done" &&
                    filteredRemoteResults.length === 0 &&
                    localMatches.length === 0 && (
                      <div className={styles.searchState}>검색 결과가 없습니다.</div>
                    )}

                  {searchStatus === "error" && (
                    <div className={styles.searchState}>종목 검색 서버에 연결하지 못했습니다.</div>
                  )}
                </div>
              )}

              {!searchQuery.trim() && localMatches.length === 0 && (
                <div className={styles.searchState}>
                  {tradeType === "매수"
                    ? "종목이름을 입력해 검색해주세요."
                    : "현재 매도할 수 있는 보유종목이 없습니다."}
                </div>
              )}

              {tradeType === "매수" && (
                <button
                  type="button"
                  className={styles.manualLink}
                  onClick={() => {
                    setManualMode(true);
                    setShowResults(false);
                    setError("");
                  }}
                >
                  검색이 안 되는 종목은 직접 입력
                </button>
              )}
            </Card>
          )}
        </div>
      )}

      {usesAmountInput && selectedInstrument ? (
        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.label}>
              {isDividend ? "입금된 금액" : tradeType === "매수" ? "넣은 금액" : "찾은 금액"} (
              {amountCurrencyLabel})
            </span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              placeholder="0"
            />
          </label>

          {isDividend && (
            <span className={styles.fieldHint}>
              세금이 떼인 뒤 실제로 들어온 금액을 입력하세요. 전액 실현손익으로 잡힙니다.
            </span>
          )}

          {tradeType === "매도" && (
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={closeAll}
                onChange={event => setCloseAll(event.target.checked)}
              />
              <span>전액 해지 · 만기 (남은 금액을 모두 찾음)</span>
            </label>
          )}

          {tradeType === "매도" && selectedHolding && (
            <span className={styles.fieldHint}>
              현재 평가금액 {formatAmountInCurrency(heldAmount, isForeign)}.{" "}
              {closeAll
                ? "받은 금액과 원금의 차이가 실현손익(이자)으로 기록됩니다."
                : "일부만 찾으면 현재 평가금액 기준으로 줄어듭니다."}
            </span>
          )}
        </div>
      ) : (tradeType === "매수" && productKind === "amount" && !selectedInstrument) ||
        (isDividend && !selectedInstrument) ? null : (
        <div className={styles.grid}>
          <div className={styles.field}>
            <span className={styles.labelRow}>
              <span className={styles.label}>
                {tradeType === "매수" ? "실제 매수수량" : "실제 매도수량"}
              </span>
              {tradeType === "매도" && selectedHolding && (
                <button
                  type="button"
                  className={styles.inlineAction}
                  onClick={() => setQuantity(String(selectedHolding.quantity))}
                >
                  전량
                </button>
              )}
            </span>

            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              aria-label={tradeType === "매수" ? "실제 매수수량" : "실제 매도수량"}
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
              placeholder="0"
            />

            {tradeType === "매도" && selectedHolding && (
              <span className={styles.fieldHint}>
                보유 {selectedHolding.quantity}주 · 평단{" "}
                {Number(selectedHolding.avgBuyPrice).toLocaleString("ko-KR", {
                  maximumFractionDigits: 4
                })}
                {isForeign ? ` ${currency}` : "원"}
              </span>
            )}
          </div>

          <label className={styles.field}>
            <span className={styles.label}>실제 체결단가 ({currencyLabel})</span>

            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={unitPrice}
              onChange={event => setUnitPrice(event.target.value)}
              placeholder="0"
            />
          </label>
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.label}>거래일</span>
        <input
          className={styles.input}
          type="date"
          value={tradeDate}
          onChange={event => setTradeDate(event.target.value)}
          required
        />
      </label>

      {selectedInstrument && isForeign && (
        <div className={styles.grid}>
          {!isAmountInstrument && (
            <label className={styles.field}>
              <span className={styles.label}>거래통화</span>
              <select
                className={styles.select}
                value={currency}
                onChange={event => {
                  setCurrency(event.target.value);
                  setFxRate(recentFxFor(event.target.value));
                }}
              >
                {FOREIGN_CURRENCIES.map(code => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={styles.field}>
            <span className={styles.label}>체결 당시 환율</span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={fxRate}
              onChange={event => setFxRate(event.target.value)}
              placeholder={`1 ${currency} = ?원`}
            />
          </label>
        </div>
      )}

      {selectedInstrument && estimatedSettlement > 0 && (
        <div className={styles.settlementBox}>
          <div className={styles.settlementRow}>
            <span>
              {isDividend
                ? "입금액"
                : actualSettlement !== null && actualSettlement > 0
                  ? tradeType === "매수"
                    ? "실제 출금액"
                    : "실제 입금액"
                  : tradeType === "매수"
                    ? "예상 출금액"
                    : "예상 입금액"}
            </span>
            <strong>{formatCurrency(settlementForDisplay)}</strong>
          </div>

          {!isDividend &&
            (feeIsEstimated || taxIsEstimated) &&
            !(actualSettlement !== null && actualSettlement > 0) && (
              <div className={styles.settlementSubRow}>
                <span>
                  {[
                    feeIsEstimated ? `수수료 ${formatCurrency(costEstimate.feeKrw)}` : "",
                    taxIsEstimated ? `세금 ${formatCurrency(costEstimate.taxKrw)}` : ""
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  포함
                </span>
                <span>최근 거래 비율로 추정</span>
              </div>
            )}

          {cashAfterTrade !== null && (
            <div className={styles.settlementSubRow}>
              <span>기록 후 예상 예수금</span>
              <span>{formatCurrency(cashAfterTrade)}</span>
            </div>
          )}
        </div>
      )}

      <details className={styles.details}>
        <summary className={styles.detailsSummary}>
          추가 정보
          <span>필요할 때만 입력</span>
        </summary>

        <div className={styles.detailsContent}>
          {!isDividend && (
            <>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span className={styles.label}>
                    수수료
                    <span className={styles.optional}>선택</span>
                  </span>

                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={feeKrw}
                    onChange={event => setFeeKrw(event.target.value)}
                    placeholder={costEstimate.feeKrw > 0 ? `약 ${costEstimate.feeKrw}` : "0"}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>
                    세금 · 제세금
                    <span className={styles.optional}>선택</span>
                  </span>

                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={taxKrw}
                    onChange={event => setTaxKrw(event.target.value)}
                    placeholder={costEstimate.taxKrw > 0 ? `약 ${costEstimate.taxKrw}` : "0"}
                  />
                </label>
              </div>

              <p className={styles.detailsHelp}>
                비워두면 이 계좌의 최근 거래 비율로 수수료·세금을 추정합니다. 0원이면 0을
                입력하세요. 나중에 거래내역에서 수정할 수 있습니다.
              </p>

              <label className={styles.field}>
                <span className={styles.label}>
                  증권사 실제 결제금액
                  <span className={styles.optional}>선택</span>
                </span>

                <input
                  className={styles.input}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={settlementKrw}
                  onChange={event => setSettlementKrw(event.target.value)}
                  placeholder={tradeType === "매수" ? "실제 출금액" : "실제 입금액"}
                />

                <span className={styles.fieldHint}>
                  증권사 거래내역에 찍힌 실제 금액을 알고 있을 때만 입력하세요. 비워두면 수량 ×
                  체결단가 × 환율로 계산합니다.
                </span>
              </label>

              {transactionCostDifference !== null && Math.abs(transactionCostDifference) >= 0.5 && (
                <div className={styles.settlementSubRow}>
                  <span>입력한 비용 외 차이</span>
                  <span>{formatCurrency(transactionCostDifference)}</span>
                </div>
              )}
            </>
          )}

          <label className={styles.field}>
            <span className={styles.label}>
              메모
              <span className={styles.optional}>선택</span>
            </span>
            <input
              className={styles.input}
              type="text"
              value={memo}
              onChange={event => setMemo(event.target.value)}
              placeholder="필요한 경우에만 입력"
            />
          </label>
        </div>
      </details>

      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>{success}</p>}

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={saving}
        loadingLabel="저장 중..."
        disabled={!selectedInstrument || (tradeType === "매도" && sellableHoldings.length === 0)}
      >
        {tradeType === "배당" ? "배당·이자 저장" : `${tradeType} 내역 저장`}
      </Button>
    </form>
  );
}
