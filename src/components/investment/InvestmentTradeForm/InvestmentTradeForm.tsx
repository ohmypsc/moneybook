import {
  type FormEvent,
  useEffect,
  useMemo,
  useState
} from "react";


import {
  createInvestmentTrade
} from "../../../api/investments";


import type {
  HoldingSummary,
  InvestmentAccountSummary
} from "../../../types/dashboard";


import type {
  CreateInvestmentTradePayload,
  InvestmentTradeType,
  Market,
  QuoteMode
} from "../../../types/investment";


import styles
  from "./InvestmentTradeForm.module.css";


interface InvestmentTradeFormProps {
  account:
    InvestmentAccountSummary;

  holdings:
    HoldingSummary[];

  onSaved:
    () => void | Promise<void>;
}


const NEW_HOLDING =
  "__new__";


function getToday() {
  const now =
    new Date();

  const local =
    new Date(
      now.getTime() -
      now.getTimezoneOffset() *
        60 *
        1000
    );

  return local
    .toISOString()
    .slice(
      0,
      10
    );
}


function formatCurrency(
  value:
    number |
    null |
    undefined
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      value
    )
  ) {
    return "-";
  }

  return (
    Math.round(value)
      .toLocaleString(
        "ko-KR"
      ) +
    "원"
  );
}


function normalizeMarket(
  value:
    string |
    null |
    undefined
): Market {
  return value ===
    "해외"
    ? "해외"
    : "국내";
}


function normalizeQuoteMode(
  value:
    string |
    null |
    undefined
): QuoteMode {
  return value ===
    "수동"
    ? "수동"
    : "자동";
}


function makeRequestId() {
  if (
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    "INV",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2)
  ].join("_");
}


export default function InvestmentTradeForm({
  account,
  holdings,
  onSaved
}: InvestmentTradeFormProps) {
  const [
    tradeType,
    setTradeType
  ] =
    useState<InvestmentTradeType>(
      "매수"
    );


  const [
    tradeDate,
    setTradeDate
  ] =
    useState(
      getToday()
    );


  const [
    selectedHoldingId,
    setSelectedHoldingId
  ] =
    useState(
      NEW_HOLDING
    );


  /*
   * 신규 종목 정보
   */
  const [
    stockCode,
    setStockCode
  ] =
    useState("");


  const [
    stockName,
    setStockName
  ] =
    useState("");


  const [
    market,
    setMarket
  ] =
    useState<Market>(
      "국내"
    );


  const [
    quoteMode,
    setQuoteMode
  ] =
    useState<QuoteMode>(
      "자동"
    );


  const [
    manualPrice,
    setManualPrice
  ] =
    useState("");


  /*
   * 거래 정보
   */
  const [
    quantity,
    setQuantity
  ] =
    useState("");


  const [
    unitPrice,
    setUnitPrice
  ] =
    useState("");


  const [
    fxRate,
    setFxRate
  ] =
    useState("");


  /*
   * 실제 결제금액
   */
  const [
    settlementKrw,
    setSettlementKrw
  ] =
    useState("");


  /*
   * 상세 입력
   */
  const [
    feeKrw,
    setFeeKrw
  ] =
    useState("");


  const [
    taxKrw,
    setTaxKrw
  ] =
    useState("");


  const [
    memo,
    setMemo
  ] =
    useState("");


  const [
    saving,
    setSaving
  ] =
    useState(false);


  const [
    error,
    setError
  ] =
    useState("");


  const [
    success,
    setSuccess
  ] =
    useState("");


  const activeHoldings =
    useMemo(
      () =>
        holdings.filter(
          holding =>
            !holding.isDeleted
        ),
      [
        holdings
      ]
    );


  const sellableHoldings =
    useMemo(
      () =>
        activeHoldings.filter(
          holding =>
            Number(
              holding.quantity
            ) >
            0
        ),
      [
        activeHoldings
      ]
    );


  const selectedHolding =
    useMemo(
      () =>
        activeHoldings.find(
          holding =>
            holding.holdingId ===
            selectedHoldingId
        ),
      [
        activeHoldings,
        selectedHoldingId
      ]
    );


  const isNewHolding =
    tradeType ===
      "매수" &&
    selectedHoldingId ===
      NEW_HOLDING;


  const effectiveMarket:
    Market =
    selectedHolding
      ? normalizeMarket(
          selectedHolding.market
        )
      : market;


  const isForeign =
    effectiveMarket ===
    "해외";


  /*
   * 계좌가 바뀌면
   * 새 입력 상태로 초기화
   */
  useEffect(
    () => {
      setTradeType(
        "매수"
      );

      setTradeDate(
        getToday()
      );

      setSelectedHoldingId(
        NEW_HOLDING
      );

      setStockCode("");
      setStockName("");

      setMarket(
        "국내"
      );

      setQuoteMode(
        "자동"
      );

      setManualPrice("");

      setQuantity("");
      setUnitPrice("");
      setFxRate("");

      setSettlementKrw("");

      setFeeKrw("");
      setTaxKrw("");
      setMemo("");

      setError("");
      setSuccess("");
    },
    [
      account.accountId
    ]
  );


  /*
   * 매수 / 매도 전환
   */
  useEffect(
    () => {
      setError("");
      setSuccess("");

      setQuantity("");
      setUnitPrice("");
      setSettlementKrw("");
      setFeeKrw("");
      setTaxKrw("");

      if (
        tradeType ===
        "매도"
      ) {
        const currentExists =
          sellableHoldings.some(
            holding =>
              holding.holdingId ===
              selectedHoldingId
          );

        if (
          !currentExists
        ) {
          setSelectedHoldingId(
            sellableHoldings[0]
              ?.holdingId ??
              ""
          );
        }

        return;
      }

      /*
       * 매수로 돌아오면
       * 기본값은 신규 종목
       */
      setSelectedHoldingId(
        NEW_HOLDING
      );
    },
    [
      tradeType
    ]
  );


  /*
   * 대시보드 갱신 후
   * 매도 대상이 사라졌으면
   * 다음 보유종목으로 이동
   */
  useEffect(
    () => {
      if (
        tradeType !==
        "매도"
      ) {
        return;
      }

      const exists =
        sellableHoldings.some(
          holding =>
            holding.holdingId ===
            selectedHoldingId
        );

      if (
        !exists
      ) {
        setSelectedHoldingId(
          sellableHoldings[0]
            ?.holdingId ??
            ""
        );
      }
    },
    [
      tradeType,
      sellableHoldings,
      selectedHoldingId
    ]
  );


  /*
   * 기존 종목을 선택하면
   * 해당 종목 정보 자동 반영
   */
  useEffect(
    () => {
      if (
        selectedHolding
      ) {
        setStockCode(
          selectedHolding.stockCode
        );

        setStockName(
          selectedHolding.stockName
        );

        setMarket(
          normalizeMarket(
            selectedHolding.market
          )
        );

        setQuoteMode(
          normalizeQuoteMode(
            selectedHolding.quoteMode
          )
        );

        setManualPrice(
          selectedHolding.manualPrice !==
            null &&
          selectedHolding.manualPrice !==
            undefined
            ? String(
                selectedHolding.manualPrice
              )
            : ""
        );

        setFxRate(
          normalizeMarket(
            selectedHolding.market
          ) ===
            "해외" &&
          Number(
            selectedHolding.fx
          ) >
            0
            ? String(
                selectedHolding.fx
              )
            : ""
        );

        return;
      }

      if (
        selectedHoldingId ===
        NEW_HOLDING
      ) {
        setStockCode("");
        setStockName("");

        setMarket(
          "국내"
        );

        setQuoteMode(
          "자동"
        );

        setManualPrice("");
        setFxRate("");
      }
    },
    [
      selectedHoldingId,
      selectedHolding?.holdingId
    ]
  );


  /*
   * 국내 종목은 환율 입력 불필요
   */
  useEffect(
    () => {
      if (
        !isForeign
      ) {
        setFxRate("");
      }
    },
    [
      isForeign
    ]
  );


  const grossKrw =
    useMemo(
      () => {
        const parsedQuantity =
          Number(
            quantity
          );

        const parsedPrice =
          Number(
            unitPrice
          );

        const parsedFx =
          isForeign
            ? Number(
                fxRate
              )
            : 1;

        if (
          !Number.isFinite(
            parsedQuantity
          ) ||
          parsedQuantity <=
            0 ||
          !Number.isFinite(
            parsedPrice
          ) ||
          parsedPrice <=
            0 ||
          !Number.isFinite(
            parsedFx
          ) ||
          parsedFx <=
            0
        ) {
          return 0;
        }

        return (
          parsedQuantity *
          parsedPrice *
          parsedFx
        );
      },
      [
        quantity,
        unitPrice,
        fxRate,
        isForeign
      ]
    );


  const feeNumber =
    useMemo(
      () => {
        if (
          !feeKrw.trim()
        ) {
          return 0;
        }

        const value =
          Number(
            feeKrw
          );

        return Number.isFinite(
          value
        )
          ? value
          : 0;
      },
      [
        feeKrw
      ]
    );


  const taxNumber =
    useMemo(
      () => {
        if (
          !taxKrw.trim()
        ) {
          return 0;
        }

        const value =
          Number(
            taxKrw
          );

        return Number.isFinite(
          value
        )
          ? value
          : 0;
      },
      [
        taxKrw
      ]
    );


  const estimatedSettlement =
    useMemo(
      () => {
        if (
          grossKrw <=
          0
        ) {
          return 0;
        }

        if (
          tradeType ===
          "매수"
        ) {
          return (
            grossKrw +
            feeNumber +
            taxNumber
          );
        }

        return Math.max(
          0,
          grossKrw -
            feeNumber -
            taxNumber
        );
      },
      [
        grossKrw,
        feeNumber,
        taxNumber,
        tradeType
      ]
    );


  const actualSettlement =
    useMemo(
      () => {
        if (
          !settlementKrw.trim()
        ) {
          return null;
        }

        const value =
          Number(
            settlementKrw
          );

        return Number.isFinite(
          value
        )
          ? value
          : null;
      },
      [
        settlementKrw
      ]
    );


  const settlementForDisplay =
    actualSettlement !==
      null &&
    actualSettlement >
      0
      ? actualSettlement
      : estimatedSettlement;


  const cashAfterTrade =
    account.currentCashKrw !==
      null &&
    account.currentCashKrw !==
      undefined &&
    settlementForDisplay >
      0
      ? tradeType ===
          "매수"
        ? account.currentCashKrw -
          settlementForDisplay
        : account.currentCashKrw +
          settlementForDisplay
      : null;


  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      saving
    ) {
      return;
    }

    setError("");
    setSuccess("");


    if (
      !account.cashBaselineConfigured
    ) {
      setError(
        "먼저 이 투자계좌의 현재 예수금을 설정해주세요."
      );

      return;
    }


    if (
      !tradeDate
    ) {
      setError(
        "거래일을 입력해주세요."
      );

      return;
    }


    if (
      tradeType ===
        "매도" &&
      !selectedHolding
    ) {
      setError(
        "매도할 종목을 선택해주세요."
      );

      return;
    }


    const effectiveStockCode =
      (
        selectedHolding
          ?.stockCode ??
        stockCode
      ).trim();


    if (
      !effectiveStockCode
    ) {
      setError(
        "종목코드를 입력해주세요."
      );

      return;
    }


    const parsedQuantity =
      Number(
        quantity
      );


    if (
      !Number.isFinite(
        parsedQuantity
      ) ||
      parsedQuantity <=
        0
    ) {
      setError(
        "수량은 0보다 커야 합니다."
      );

      return;
    }


    if (
      tradeType ===
        "매도" &&
      selectedHolding &&
      parsedQuantity >
        Number(
          selectedHolding.quantity
        )
    ) {
      setError(
        `보유수량 ${selectedHolding.quantity}주보다 많이 매도할 수 없습니다.`
      );

      return;
    }


    const parsedUnitPrice =
      Number(
        unitPrice
      );


    if (
      !Number.isFinite(
        parsedUnitPrice
      ) ||
      parsedUnitPrice <=
        0
    ) {
      setError(
        "체결단가는 0보다 커야 합니다."
      );

      return;
    }


    const parsedFxRate =
      isForeign
        ? Number(
            fxRate
          )
        : 1;


    if (
      isForeign &&
      (
        !Number.isFinite(
          parsedFxRate
        ) ||
        parsedFxRate <=
          0
      )
    ) {
      setError(
        "해외주식은 체결환율을 입력해주세요."
      );

      return;
    }


    const parsedFee =
      feeKrw.trim()
        ? Number(
            feeKrw
          )
        : 0;


    if (
      !Number.isFinite(
        parsedFee
      ) ||
      parsedFee <
        0
    ) {
      setError(
        "수수료는 0 이상의 금액이어야 합니다."
      );

      return;
    }


    const parsedTax =
      taxKrw.trim()
        ? Number(
            taxKrw
          )
        : 0;


    if (
      !Number.isFinite(
        parsedTax
      ) ||
      parsedTax <
        0
    ) {
      setError(
        "세금은 0 이상의 금액이어야 합니다."
      );

      return;
    }


    let parsedSettlement:
      number |
      undefined;


    if (
      settlementKrw.trim()
    ) {
      const value =
        Number(
          settlementKrw
        );

      if (
        !Number.isFinite(
          value
        ) ||
        value <=
          0
      ) {
        setError(
          "실제 결제금액은 0보다 커야 합니다."
        );

        return;
      }

      parsedSettlement =
        value;
    }


    const payload:
      CreateInvestmentTradePayload =
    {
      accountId:
        account.accountId,

      tradeType,

      tradeDate,

      stockCode:
        effectiveStockCode,

      quantity:
        parsedQuantity,

      unitPrice:
        parsedUnitPrice,

      currency:
        isForeign
          ? "USD"
          : "KRW",

      fxRate:
        parsedFxRate,

      feeKrw:
        parsedFee,

      taxKrw:
        parsedTax,

      requestId:
        makeRequestId()
    };


    if (
      parsedSettlement !==
      undefined
    ) {
      payload.settlementKrw =
        parsedSettlement;
    }


    if (
      memo.trim()
    ) {
      payload.memo =
        memo.trim();
    }


    /*
     * 신규 종목일 때만
     * 종목 생성 정보 추가
     */
    if (
      isNewHolding
    ) {
      payload.stockName =
        stockName.trim();

      payload.market =
        market;

      payload.quoteMode =
        quoteMode;

      if (
        quoteMode ===
        "수동"
      ) {
        const parsedManualPrice =
          manualPrice.trim()
            ? Number(
                manualPrice
              )
            : parsedUnitPrice;

        if (
          !Number.isFinite(
            parsedManualPrice
          ) ||
          parsedManualPrice <=
            0
        ) {
          setError(
            "수동 시세는 0보다 커야 합니다."
          );

          return;
        }

        payload.manualPrice =
          parsedManualPrice;
      }
    }


    setSaving(true);

    try {
      await createInvestmentTrade(
        payload
      );

      /*
       * AssetsPage의
       * loadDashboard() 실행
       */
      await onSaved();


      setSuccess(
        tradeType ===
          "매수"
          ? "매수 내역을 저장했습니다."
          : "매도 내역을 저장했습니다."
      );


      setQuantity("");
      setUnitPrice("");

      setSettlementKrw("");

      setFeeKrw("");
      setTaxKrw("");

      setMemo("");


      if (
        tradeType ===
          "매수" &&
        isNewHolding
      ) {
        setStockCode("");
        setStockName("");

        setMarket(
          "국내"
        );

        setQuoteMode(
          "자동"
        );

        setManualPrice("");

        setFxRate("");

        setSelectedHoldingId(
          NEW_HOLDING
        );
      }
    } catch (
      err
    ) {
      setError(
        err instanceof
          Error
          ? err.message
          : "투자거래 저장에 실패했습니다."
      );
    } finally {
      setSaving(false);
    }
  }


  if (
    !account.cashBaselineConfigured
  ) {
    return (
      <section
        className={
          styles.form
        }
      >
        <div
          className={
            styles.header
          }
        >
          <div
            className={
              styles.titleGroup
            }
          >
            <h3
              className={
                styles.title
              }
            >
              매수 · 매도
            </h3>

            <p
              className={
                styles.description
              }
            >
              매매를 입력하려면 먼저 현재 예수금을 설정해주세요.
            </p>
          </div>
        </div>
      </section>
    );
  }


  return (
    <form
      className={
        styles.form
      }
      onSubmit={
        handleSubmit
      }
    >
      <div
        className={
          styles.header
        }
      >
        <div
          className={
            styles.titleGroup
          }
        >
          <h3
            className={
              styles.title
            }
          >
            매수 · 매도
          </h3>

          <p
            className={
              styles.description
            }
          >
            실제 매매 내역을 입력하면 예수금과 보유수량이 자동으로 반영됩니다.
          </p>
        </div>

        <div
          className={
            styles.cash
          }
        >
          <span>
            현재 예수금
          </span>

          <strong>
            {
              formatCurrency(
                account.currentCashKrw
              )
            }
          </strong>
        </div>
      </div>


      <div
        className={
          styles.tradeTabs
        }
      >
        <button
          type="button"
          className={[
            styles.tradeTab,
            tradeType ===
              "매수"
              ? styles.tradeTabActive
              : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={
            () =>
              setTradeType(
                "매수"
              )
          }
        >
          매수
        </button>

        <button
          type="button"
          className={[
            styles.tradeTab,
            tradeType ===
              "매도"
              ? styles.tradeTabActive
              : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={
            () =>
              setTradeType(
                "매도"
              )
          }
        >
          매도
        </button>
      </div>


      <label
        className={
          styles.field
        }
      >
        <span
          className={
            styles.label
          }
        >
          거래일
        </span>

        <input
          className={
            styles.input
          }
          type="date"
          value={
            tradeDate
          }
          onChange={
            event =>
              setTradeDate(
                event.target.value
              )
          }
          required
        />
      </label>


      {
        tradeType ===
        "매수"
          ? (
            <label
              className={
                styles.field
              }
            >
              <span
                className={
                  styles.label
                }
              >
                종목
              </span>

              <select
                className={
                  styles.select
                }
                value={
                  selectedHoldingId
                }
                onChange={
                  event =>
                    setSelectedHoldingId(
                      event.target.value
                    )
                }
              >
                <option
                  value={
                    NEW_HOLDING
                  }
                >
                  + 신규 종목
                </option>

                {
                  activeHoldings.map(
                    holding => (
                      <option
                        key={
                          holding.holdingId
                        }
                        value={
                          holding.holdingId
                        }
                      >
                        {
                          holding.stockName ||
                          holding.stockCode
                        }
                        {" · "}
                        {
                          holding.quantity
                        }
                        주
                      </option>
                    )
                  )
                }
              </select>

              <span
                className={
                  styles.fieldHint
                }
              >
                이미 보유 중인 종목을 선택하면 추가매수로 기록됩니다.
              </span>
            </label>
          )
          : (
            <>
              {
                sellableHoldings.length >
                0
                  ? (
                    <label
                      className={
                        styles.field
                      }
                    >
                      <span
                        className={
                          styles.label
                        }
                      >
                        매도 종목
                      </span>

                      <select
                        className={
                          styles.select
                        }
                        value={
                          selectedHoldingId
                        }
                        onChange={
                          event =>
                            setSelectedHoldingId(
                              event.target.value
                            )
                        }
                      >
                        {
                          sellableHoldings.map(
                            holding => (
                              <option
                                key={
                                  holding.holdingId
                                }
                                value={
                                  holding.holdingId
                                }
                              >
                                {
                                  holding.stockName ||
                                  holding.stockCode
                                }
                                {" · "}
                                {
                                  holding.quantity
                                }
                                주
                              </option>
                            )
                          )
                        }
                      </select>
                    </label>
                  )
                  : (
                    <p
                      className={
                        styles.empty
                      }
                    >
                      현재 매도할 수 있는 보유종목이 없습니다.
                    </p>
                  )
              }
            </>
          )
      }


      {
        isNewHolding && (
          <div
            className={
              styles.newHoldingBox
            }
          >
            <p
              className={
                styles.subTitle
              }
            >
              신규 종목 정보
            </p>

            <div
              className={
                styles.grid
              }
            >
              <label
                className={
                  styles.field
                }
              >
                <span
                  className={
                    styles.label
                  }
                >
                  종목코드
                </span>

                <input
                  className={
                    styles.input
                  }
                  type="text"
                  value={
                    stockCode
                  }
                  onChange={
                    event =>
                      setStockCode(
                        event.target.value
                      )
                  }
                  placeholder="예: 005930 / AAPL"
                  autoCapitalize="characters"
                />
              </label>


              <label
                className={
                  styles.field
                }
              >
                <span
                  className={
                    styles.label
                  }
                >
                  종목명
                </span>

                <input
                  className={
                    styles.input
                  }
                  type="text"
                  value={
                    stockName
                  }
                  onChange={
                    event =>
                      setStockName(
                        event.target.value
                      )
                  }
                  placeholder="예: 삼성전자"
                />
              </label>


              <label
                className={
                  styles.field
                }
              >
                <span
                  className={
                    styles.label
                  }
                >
                  시장
                </span>

                <select
                  className={
                    styles.select
                  }
                  value={
                    market
                  }
                  onChange={
                    event =>
                      setMarket(
                        event.target
                          .value as
                          Market
                      )
                  }
                >
                  <option
                    value="국내"
                  >
                    국내
                  </option>

                  <option
                    value="해외"
                  >
                    해외
                  </option>
                </select>
              </label>


              <label
                className={
                  styles.field
                }
              >
                <span
                  className={
                    styles.label
                  }
                >
                  시세 조회
                </span>

                <select
                  className={
                    styles.select
                  }
                  value={
                    quoteMode
                  }
                  onChange={
                    event =>
                      setQuoteMode(
                        event.target
                          .value as
                          QuoteMode
                      )
                  }
                >
                  <option
                    value="자동"
                  >
                    자동
                  </option>

                  <option
                    value="수동"
                  >
                    수동
                  </option>
                </select>
              </label>
            </div>


            {
              quoteMode ===
                "수동" && (
                <label
                  className={
                    styles.field
                  }
                >
                  <span
                    className={
                      styles.label
                    }
                  >
                    현재 평가단가
                  </span>

                  <input
                    className={
                      styles.input
                    }
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={
                      manualPrice
                    }
                    onChange={
                      event =>
                        setManualPrice(
                          event.target.value
                        )
                    }
                    placeholder="비워두면 체결단가 사용"
                  />

                  <span
                    className={
                      styles.fieldHint
                    }
                  >
                    수동 시세 종목만 필요합니다. 비워두면 이번 체결단가를 최초 평가단가로 사용합니다.
                  </span>
                </label>
              )
            }
          </div>
        )
      }


      {
        selectedHolding && (
          <div
            className={
              styles.holdingPreview
            }
          >
            <div>
              <strong>
                {
                  selectedHolding.stockName ||
                  selectedHolding.stockCode
                }
              </strong>

              <span>
                {
                  selectedHolding.stockCode
                }
                {" · "}
                {
                  selectedHolding.market
                }
              </span>
            </div>

            <div
              className={
                styles.holdingQuantity
              }
            >
              보유{" "}
              {
                selectedHolding.quantity
              }
              주
            </div>
          </div>
        )
      }


      <div
        className={
          styles.grid
        }
      >
        <label
          className={
            styles.field
          }
        >
          <span
            className={
              styles.label
            }
          >
            {
              tradeType ===
                "매수"
                ? "매수 수량"
                : "매도 수량"
            }
          </span>

          <input
            className={
              styles.input
            }
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={
              quantity
            }
            onChange={
              event =>
                setQuantity(
                  event.target.value
                )
            }
            placeholder="0"
          />
        </label>


        <label
          className={
            styles.field
          }
        >
          <span
            className={
              styles.label
            }
          >
            체결단가
            {
              isForeign
                ? " (USD)"
                : " (원)"
            }
          </span>

          <input
            className={
              styles.input
            }
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={
              unitPrice
            }
            onChange={
              event =>
                setUnitPrice(
                  event.target.value
                )
            }
            placeholder="0"
          />
        </label>
      </div>


      {
        isForeign && (
          <label
            className={
              styles.field
            }
          >
            <span
              className={
                styles.label
              }
            >
              체결환율
            </span>

            <input
              className={
                styles.input
              }
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={
                fxRate
              }
              onChange={
                event =>
                  setFxRate(
                    event.target.value
                  )
              }
              placeholder="예: 1385.50"
            />

            <span
              className={
                styles.fieldHint
              }
            >
              해당 매매가 체결된 당시의 USD/KRW 환율을 입력해주세요.
            </span>
          </label>
        )
      }


      <label
        className={
          styles.field
        }
      >
        <span
          className={
            styles.label
          }
        >
          실제 결제금액
          <span
            className={
              styles.optional
            }
          >
            선택
          </span>
        </span>

        <input
          className={
            styles.input
          }
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={
            settlementKrw
          }
          onChange={
            event =>
              setSettlementKrw(
                event.target.value
              )
          }
          placeholder={
            tradeType ===
              "매수"
              ? "증권사 실제 출금액"
              : "증권사 실제 입금액"
          }
        />

        <span
          className={
            styles.fieldHint
          }
        >
          모르면 비워두세요. 수량 × 체결단가 × 환율을 기준으로 자동 계산합니다.
        </span>
      </label>


      <details
        className={
          styles.details
        }
      >
        <summary
          className={
            styles.detailsSummary
          }
        >
          상세 입력

          <span>
            수수료 · 세금
          </span>
        </summary>

        <div
          className={
            styles.detailsContent
          }
        >
          <div
            className={
              styles.grid
            }
          >
            <label
              className={
                styles.field
              }
            >
              <span
                className={
                  styles.label
                }
              >
                수수료
              </span>

              <input
                className={
                  styles.input
                }
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={
                  feeKrw
                }
                onChange={
                  event =>
                    setFeeKrw(
                      event.target.value
                    )
                }
                placeholder="0"
              />
            </label>


            <label
              className={
                styles.field
              }
            >
              <span
                className={
                  styles.label
                }
              >
                세금
              </span>

              <input
                className={
                  styles.input
                }
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={
                  taxKrw
                }
                onChange={
                  event =>
                    setTaxKrw(
                      event.target.value
                    )
                }
                placeholder="0"
              />
            </label>
          </div>

          <p
            className={
              styles.detailsHelp
            }
          >
            모르시면 둘 다 비워두면 됩니다. 실제 결제금액을 입력한 경우에는 그 금액이 최종 결제금액으로 우선 사용됩니다.
          </p>
        </div>
      </details>


      {
        estimatedSettlement >
          0 && (
          <div
            className={
              styles.settlementBox
            }
          >
            <div
              className={
                styles.settlementRow
              }
            >
              <span>
                {
                  actualSettlement !==
                    null &&
                  actualSettlement >
                    0
                    ? tradeType ===
                        "매수"
                      ? "실제 출금액"
                      : "실제 입금액"
                    : tradeType ===
                        "매수"
                      ? "예상 출금액"
                      : "예상 입금액"
                }
              </span>

              <strong>
                {
                  formatCurrency(
                    settlementForDisplay
                  )
                }
              </strong>
            </div>

            {
              actualSettlement !==
                null &&
              actualSettlement >
                0 && (
                <div
                  className={
                    styles.settlementSubRow
                  }
                >
                  <span>
                    단순 계산 예상
                  </span>

                  <span>
                    {
                      formatCurrency(
                        estimatedSettlement
                      )
                    }
                  </span>
                </div>
              )
            }

            {
              cashAfterTrade !==
                null && (
                <div
                  className={
                    styles.settlementSubRow
                  }
                >
                  <span>
                    거래 후 예상 예수금
                  </span>

                  <span>
                    {
                      formatCurrency(
                        cashAfterTrade
                      )
                    }
                  </span>
                </div>
              )
            }
          </div>
        )
      }


      <label
        className={
          styles.field
        }
      >
        <span
          className={
            styles.label
          }
        >
          메모
          <span
            className={
              styles.optional
            }
          >
            선택
          </span>
        </span>

        <input
          className={
            styles.input
          }
          type="text"
          value={
            memo
          }
          onChange={
            event =>
              setMemo(
                event.target.value
              )
          }
          placeholder="필요한 경우에만 입력"
        />
      </label>


      {
        error && (
          <p
            className={
              styles.error
            }
          >
            {
              error
            }
          </p>
        )
      }


      {
        success && (
          <p
            className={
              styles.success
            }
          >
            {
              success
            }
          </p>
        )
      }


      <button
        className={
          styles.submitButton
        }
        type="submit"
        disabled={
          saving ||
          (
            tradeType ===
              "매도" &&
            sellableHoldings.length ===
              0
          )
        }
      >
        {
          saving
            ? "저장 중..."
            : tradeType ===
                "매수"
              ? "매수 저장"
              : "매도 저장"
        }
      </button>
    </form>
  );
}
