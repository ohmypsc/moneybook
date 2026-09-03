import {
  type FormEvent,
  useEffect,
  useMemo,
  useState
} from "react";

import {
  createInvestmentTrade,
  searchInvestmentSymbols
} from "../../../api/investments";

import type {
  HoldingSummary,
  InvestmentAccountSummary
} from "../../../types/dashboard";

import type {
  CreateInvestmentTradePayload,
  InvestmentSymbolSearchItem,
  InvestmentTradeType,
  Market
} from "../../../types/investment";

import styles from "./InvestmentTradeForm.module.css";

interface InvestmentTradeFormProps {
  account: InvestmentAccountSummary;
  holdings: HoldingSummary[];
  onSaved: () => void | Promise<void>;
}

type SearchStatus =
  | "idle"
  | "loading"
  | "done"
  | "error";

type SelectedInstrument = {
  stockCode: string;
  stockName: string;
  market: Market;
  holdingId?: string;
};

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
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60 * 1000
  );

  return local.toISOString().slice(0, 10);
}

function formatCurrency(value: number | null | undefined) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function normalizeMarket(value: string | null | undefined): Market {
  return value === "해외" ? "해외" : "국내";
}

function normalizeSearchText(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function aliasSearchText(value: string) {
  return FUND_BRAND_ALIASES.reduce(
    (current, [pattern, replacement]) =>
      current.replace(pattern, replacement),
    value
  );
}

function holdingMatchesQuery(
  holding: HoldingSummary,
  query: string
) {
  if (!query.trim()) return true;

  const haystack = normalizeSearchText(
    `${holding.stockName} ${holding.stockCode}`
  );

  const raw = normalizeSearchText(query);
  const aliased = normalizeSearchText(aliasSearchText(query));

  return [raw, aliased]
    .filter(Boolean)
    .some(term => haystack.includes(term));
}

function makeRequestId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    "INV",
    Date.now(),
    Math.random().toString(36).slice(2)
  ].join("_");
}

export default function InvestmentTradeForm({
  account,
  holdings,
  onSaved
}: InvestmentTradeFormProps) {
  const [tradeType, setTradeType] =
    useState<InvestmentTradeType>("매수");
  const [tradeDate, setTradeDate] = useState(getToday());

  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] =
    useState<SearchStatus>("idle");
  const [remoteResults, setRemoteResults] =
    useState<InvestmentSymbolSearchItem[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedInstrument, setSelectedInstrument] =
    useState<SelectedInstrument | null>(null);

  const [manualMode, setManualMode] = useState(false);
  const [manualStockCode, setManualStockCode] = useState("");
  const [manualStockName, setManualStockName] = useState("");
  const [manualMarket, setManualMarket] =
    useState<Market>("국내");

  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [settlementKrw, setSettlementKrw] = useState("");
  const [memo, setMemo] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeHoldings = useMemo(
    () => holdings.filter(holding => !holding.isDeleted),
    [holdings]
  );

  const sellableHoldings = useMemo(
    () =>
      activeHoldings.filter(
        holding => Number(holding.quantity) > 0
      ),
    [activeHoldings]
  );

  const localMatches = useMemo(() => {
    const source =
      tradeType === "매도"
        ? sellableHoldings
        : activeHoldings;

    return source.filter(holding =>
      holdingMatchesQuery(holding, searchQuery)
    );
  }, [
    activeHoldings,
    sellableHoldings,
    searchQuery,
    tradeType
  ]);

  const selectedHolding = useMemo(() => {
    if (!selectedInstrument) return null;

    if (selectedInstrument.holdingId) {
      return (
        activeHoldings.find(
          holding =>
            holding.holdingId ===
            selectedInstrument.holdingId
        ) ?? null
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

  const isNewHolding =
    tradeType === "매수" &&
    !!selectedInstrument &&
    !selectedHolding;

  const effectiveMarket: Market = selectedInstrument
    ? selectedInstrument.market
    : "국내";

  const isForeign = effectiveMarket === "해외";

  const filteredRemoteResults = useMemo(() => {
    const localCodes = new Set(
      localMatches.map(holding =>
        holding.stockCode.trim().toUpperCase()
      )
    );

    return remoteResults.filter(
      item =>
        !localCodes.has(
          item.stockCode.trim().toUpperCase()
        )
    );
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
    setFxRate("");
  }

  function resetTradeInputs() {
    setQuantity("");
    setUnitPrice("");
    setSettlementKrw("");
    setMemo("");
  }

  useEffect(() => {
    setTradeType("매수");
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
    if (
      tradeType !== "매수" ||
      selectedInstrument ||
      manualMode
    ) {
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

        setRemoteResults(
          Array.isArray(result.items) ? result.items : []
        );
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
  }, [
    manualMode,
    searchQuery,
    selectedInstrument,
    tradeType
  ]);

  useEffect(() => {
    if (!isForeign) {
      setFxRate("");
    }
  }, [isForeign]);

  const grossKrw = useMemo(() => {
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(unitPrice);
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
  }, [quantity, unitPrice, fxRate, isForeign]);

  const estimatedSettlement =
    grossKrw;


  const actualSettlement = useMemo(() => {
    if (!settlementKrw.trim()) return null;
    const value = Number(settlementKrw);
    return Number.isFinite(value) ? value : null;
  }, [settlementKrw]);

  const settlementForDisplay =
    actualSettlement !== null && actualSettlement > 0
      ? actualSettlement
      : estimatedSettlement;

  const transactionCostDifference =
    actualSettlement !== null &&
    actualSettlement > 0 &&
    grossKrw > 0
      ? tradeType === "매수"
        ? actualSettlement - grossKrw
        : grossKrw - actualSettlement
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
    setFxRate("");
    setError("");
  }

  function chooseRemote(item: InvestmentSymbolSearchItem) {
    const existing = activeHoldings.find(
      holding =>
        holding.stockCode.trim().toUpperCase() ===
        item.stockCode.trim().toUpperCase()
    );

    setSelectedInstrument({
      stockCode: item.stockCode,
      stockName: item.stockName || item.stockCode,
      market: item.market,
      holdingId: existing?.holdingId
    });
    setSearchQuery(item.stockName || item.stockCode);
    setRemoteResults([]);
    setSearchStatus("idle");
    setShowResults(false);
    setManualMode(false);
    setFxRate("");
    setError("");
  }

  function confirmManualInstrument() {
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
      holding =>
        holding.stockCode.trim().toUpperCase() === code
    );

    if (existing) {
      chooseHolding(existing);
      return;
    }

    setSelectedInstrument({
      stockCode: code,
      stockName: name,
      market: manualMarket
    });
    setSearchQuery(name);
    setManualMode(false);
    setShowResults(false);
    setError("");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) return;

    setError("");
    setSuccess("");

    if (!account.cashBaselineConfigured) {
      setError(
        "먼저 이 투자계좌의 현재 예수금을 설정해주세요."
      );
      return;
    }

    if (!selectedInstrument) {
      setError(
        tradeType === "매수"
          ? "매수한 종목을 선택해주세요."
          : "매도한 종목을 선택해주세요."
      );
      return;
    }

    if (!tradeDate) {
      setError("거래일을 입력해주세요.");
      return;
    }

    const parsedQuantity = Number(quantity);

    if (
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      setError("수량은 0보다 커야 합니다.");
      return;
    }

    if (
      tradeType === "매도" &&
      selectedHolding &&
      parsedQuantity > Number(selectedHolding.quantity)
    ) {
      setError(
        `보유수량 ${selectedHolding.quantity}주보다 많이 기록할 수 없습니다.`
      );
      return;
    }

    const parsedUnitPrice = Number(unitPrice);

    if (
      !Number.isFinite(parsedUnitPrice) ||
      parsedUnitPrice <= 0
    ) {
      setError("체결단가는 0보다 커야 합니다.");
      return;
    }

    const parsedFxRate = isForeign ? Number(fxRate) : 1;

    if (
      isForeign &&
      (!Number.isFinite(parsedFxRate) || parsedFxRate <= 0)
    ) {
      setError("해외주식은 체결 당시 환율을 입력해주세요.");
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
      currency: isForeign ? "USD" : "KRW",
      fxRate: parsedFxRate,
      requestId: makeRequestId()
    };

    if (parsedSettlement !== undefined) {
      payload.settlementKrw = parsedSettlement;
    }

    if (memo.trim()) {
      payload.memo = memo.trim();
    }

    if (isNewHolding) {
      payload.stockName = selectedInstrument.stockName;
      payload.market = selectedInstrument.market;

      // KRX 금현물(04020000)은 GOOGLEFINANCE 자동시세 대상이 아니므로
      // 최초 등록 시 체결단가를 현재 수동시세의 시작값으로 사용한다.
      if (selectedInstrument.stockCode === "04020000") {
        payload.quoteMode = "수동";
        payload.manualPrice = parsedUnitPrice;
      } else {
        payload.quoteMode = "자동";
      }
    }

    setSaving(true);

    try {
      await createInvestmentTrade(payload);

      setSuccess(
        tradeType === "매수"
          ? "매수 내역을 저장했습니다."
          : "매도 내역을 저장했습니다."
      );

      resetTradeInputs();
      resetSelection();

      void Promise.resolve(onSaved()).catch(() => {});
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "투자거래 저장에 실패했습니다."
      );
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
            <p className={styles.description}>
              매매를 기록하려면 먼저 현재 예수금을 설정해주세요.
            </p>
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
        <button
          type="button"
          className={[
            styles.tradeTab,
            tradeType === "매수" ? styles.tradeTabActive : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setTradeType("매수")}
        >
          매수 기록
        </button>

        <button
          type="button"
          className={[
            styles.tradeTab,
            tradeType === "매도" ? styles.tradeTabActive : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setTradeType("매도")}
        >
          매도 기록
        </button>
      </div>

      {selectedInstrument ? (
        <div className={styles.selectedInstrument}>
          <div className={styles.selectedInstrumentMain}>
            <strong>{selectedInstrument.stockName}</strong>
            <span>
              {selectedInstrument.stockCode}
              {" · "}
              {selectedInstrument.market}
              {selectedHolding
                ? ` · ${selectedHolding.quantity}주 보유`
                : " · 신규 종목"}
            </span>
          </div>

          <button
            type="button"
            className={styles.changeInstrumentButton}
            onClick={() => {
              resetSelection();
              setShowResults(true);
            }}
          >
            변경
          </button>
        </div>
      ) : manualMode && tradeType === "매수" ? (
        <div className={styles.manualBox}>
          <div className={styles.manualHeader}>
            <strong>종목 직접 입력</strong>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setManualMode(false);
                setShowResults(true);
                setError("");
              }}
            >
              검색으로 돌아가기
            </button>
          </div>

          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>종목이름</span>
              <input
                className={styles.input}
                type="text"
                value={manualStockName}
                onChange={event =>
                  setManualStockName(event.target.value)
                }
                placeholder="예: 삼성전자"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>종목코드</span>
              <input
                className={styles.input}
                type="text"
                value={manualStockCode}
                onChange={event =>
                  setManualStockCode(
                    event.target.value.toUpperCase()
                  )
                }
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
              onChange={event =>
                setManualMarket(event.target.value as Market)
              }
            >
              <option value="국내">국내</option>
              <option value="해외">해외</option>
            </select>
          </label>

          <button
            type="button"
            className={styles.secondaryButton}
            onClick={confirmManualInstrument}
          >
            이 종목 사용
          </button>
        </div>
      ) : (
        <div className={styles.searchSection}>
          <label className={styles.field}>
            <span className={styles.label}>
              {tradeType === "매수"
                ? "매수한 종목"
                : "매도한 종목"}
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
                placeholder={
                  tradeType === "매수"
                    ? "종목이름 검색"
                    : "보유종목 이름 검색"
                }
                autoComplete="off"
              />
            </div>

            <span className={styles.fieldHint}>
              {tradeType === "매수"
                ? "이미 보유한 종목은 바로 선택할 수 있고, 새 종목은 이름으로 검색합니다."
                : "현재 보유 중인 종목에서만 선택합니다."}
            </span>
          </label>

          {showResults && (
            <div className={styles.searchPanel}>
              {localMatches.length > 0 && (
                <div className={styles.resultGroup}>
                  <div className={styles.resultGroupTitle}>
                    {tradeType === "매수"
                      ? "보유 중"
                      : "보유종목"}
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
                  <div className={styles.resultGroupTitle}>
                    종목 검색
                  </div>

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
                      <span className={styles.resultName}>
                        {item.stockName || item.stockCode}
                      </span>
                      <span className={styles.resultMeta}>
                        {item.stockCode}
                        {" · "}
                        {item.market}
                        {item.assetType
                          ? ` · ${item.assetType}`
                          : ""}
                      </span>
                    </button>
                  ))}

                  {searchStatus === "done" &&
                    filteredRemoteResults.length === 0 &&
                    localMatches.length === 0 && (
                      <div className={styles.searchState}>
                        검색 결과가 없습니다.
                      </div>
                    )}

                  {searchStatus === "error" && (
                    <div className={styles.searchState}>
                      종목 검색 서버에 연결하지 못했습니다.
                    </div>
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
            </div>
          )}
        </div>
      )}

      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>
            {tradeType === "매수"
              ? "실제 매수수량"
              : "실제 매도수량"}
          </span>

          <input
            className={styles.input}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={event => setQuantity(event.target.value)}
            placeholder="0"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            실제 체결단가
            {isForeign ? " (USD)" : " (원)"}
          </span>

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
            placeholder="예: 1385.50"
          />
        </label>
      )}

      {selectedInstrument && estimatedSettlement > 0 && (
        <div className={styles.settlementBox}>
          <div className={styles.settlementRow}>
            <span>
              {actualSettlement !== null && actualSettlement > 0
                ? tradeType === "매수"
                  ? "실제 출금액"
                  : "실제 입금액"
                : tradeType === "매수"
                  ? "예상 출금액"
                  : "예상 입금액"}
            </span>
            <strong>{formatCurrency(settlementForDisplay)}</strong>
          </div>

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
              onChange={event =>
                setSettlementKrw(event.target.value)
              }
              placeholder={
                tradeType === "매수"
                  ? "실제 출금액"
                  : "실제 입금액"
              }
            />

            <span className={styles.fieldHint}>
              증권사 거래내역에 찍힌 실제 금액을 알고 있을 때만 입력하세요. 비워두면 수량 × 체결단가 × 환율로 계산합니다.
            </span>
          </label>

          {transactionCostDifference !== null && (
            <div className={styles.settlementSubRow}>
              <span>거래비용 차이</span>
              <span>{formatCurrency(transactionCostDifference)}</span>
            </div>
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

      <button
        className={styles.submitButton}
        type="submit"
        disabled={
          saving ||
          !selectedInstrument ||
          (tradeType === "매도" && sellableHoldings.length === 0)
        }
      >
        {saving
          ? "저장 중..."
          : tradeType === "매수"
            ? "매수 내역 저장"
            : "매도 내역 저장"}
      </button>
    </form>
  );
}
