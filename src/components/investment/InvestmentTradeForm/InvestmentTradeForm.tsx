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
  InvestmentTradeType,
  Market,
  QuoteMode
} from "../../../types/investment";

import styles from "./InvestmentTradeForm.module.css";


interface InvestmentTradeFormProps {
  account:
    InvestmentAccountSummary;

  holdings:
    HoldingSummary[];

  onSaved:
    () => void | Promise<void>;
}


type BuyTarget =
  | "existing"
  | "new";


function todayString() {
  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}


function createRequestId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return [
    "investment",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2)
  ].join("-");
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
    !Number.isFinite(value)
  ) {
    return "-";
  }

  return (
    Math.round(value)
      .toLocaleString("ko-KR") +
    "원"
  );
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
    buyTarget,
    setBuyTarget
  ] =
    useState<BuyTarget>(
      holdings.length > 0
        ? "existing"
        : "new"
    );


  const [
    selectedHoldingId,
    setSelectedHoldingId
  ] =
    useState(
      holdings[0]
        ?.holdingId ??
        ""
    );


  const [
    tradeDate,
    setTradeDate
  ] =
    useState(
      todayString()
    );


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
    currency,
    setCurrency
  ] =
    useState(
      "KRW"
    );


  const [
    fxRate,
    setFxRate
  ] =
    useState(
      "1"
    );


  const [
    feeKrw,
    setFeeKrw
  ] =
    useState(
      "0"
    );


  const [
    taxKrw,
    setTaxKrw
  ] =
    useState(
      "0"
    );


  const [
    settlementKrwInput,
    setSettlementKrwInput
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


  const selectedHolding =
    useMemo(
      () =>
        holdings.find(
          holding =>
            holding.holdingId ===
            selectedHoldingId
        ) ??
        null,
      [
        holdings,
        selectedHoldingId
      ]
    );


  /**
   * 계좌를 바꿨을 때
   * 이전 계좌의 종목 선택값이 남지 않도록 초기화
   */
  useEffect(
    () => {
      setTradeType(
        "매수"
      );

      setBuyTarget(
        holdings.length > 0
          ? "existing"
          : "new"
      );

      setSelectedHoldingId(
        holdings[0]
          ?.holdingId ??
          ""
      );

      setStockCode("");
      setStockName("");

      setQuantity("");
      setUnitPrice("");

      setSettlementKrwInput("");
      setFeeKrw(
        "0"
      );
      setTaxKrw(
        "0"
      );

      setMemo("");
      setError("");
      setSuccess("");

      setTradeDate(
        todayString()
      );
    },
    [
      account.accountId
    ]
  );


  /**
   * holdings가 갱신되었을 때
   * 선택된 종목이 더 이상 없다면 첫 종목으로 변경
   */
  useEffect(
    () => {
      if (
        holdings.length ===
        0
      ) {
        setSelectedHoldingId(
          ""
        );

        if (
          tradeType ===
          "매수"
        ) {
          setBuyTarget(
            "new"
          );
        }

        return;
      }


      const stillExists =
        holdings.some(
          holding =>
            holding.holdingId ===
            selectedHoldingId
        );


      if (
        !stillExists
      ) {
        setSelectedHoldingId(
          holdings[0].holdingId
        );
      }
    },
    [
      holdings,
      selectedHoldingId,
      tradeType
    ]
  );


  /**
   * 기존 종목을 선택했을 때
   * 국내 / 해외 정보를 자동 반영
   */
  useEffect(
    () => {
      if (
        !selectedHolding
      ) {
        return;
      }


      const nextMarket =
        selectedHolding.market ===
        "해외"
          ? "해외"
          : "국내";


      setMarket(
        nextMarket
      );


      if (
        nextMarket ===
        "국내"
      ) {
        setCurrency(
          "KRW"
        );

        setFxRate(
          "1"
        );
      } else {
        setCurrency(
          "USD"
        );

        setFxRate(
          ""
        );
      }
    },
    [
      selectedHolding
    ]
  );


  /**
   * 신규 종목에서 시장을 변경하면
   * 기본 통화도 함께 변경
   */
  useEffect(
    () => {
      if (
        tradeType !==
          "매수" ||
        buyTarget !==
          "new"
      ) {
        return;
      }


      if (
        market ===
        "국내"
      ) {
        setCurrency(
          "KRW"
        );

        setFxRate(
          "1"
        );
      } else {
        setCurrency(
          "USD"
        );

        if (
          fxRate ===
          "1"
        ) {
          setFxRate(
            ""
          );
        }
      }
    },
    [
      market,
      buyTarget,
      tradeType
    ]
  );


  /**
   * 매도는 무조건 기존 보유종목만 가능
   */
  useEffect(
    () => {
      if (
        tradeType ===
        "매도"
      ) {
        setBuyTarget(
          "existing"
        );
      }

      setSettlementKrwInput("");
      setFeeKrw(
        "0"
      );
      setTaxKrw(
        "0"
      );

      setError("");
      setSuccess("");
    },
    [
      tradeType
    ]
  );


  const activeMarket:
    Market =
    selectedHolding &&
    buyTarget ===
      "existing"
      ? (
          selectedHolding.market ===
          "해외"
            ? "해외"
            : "국내"
        )
      : market;


  const parsedQuantity =
    Number(
      quantity
    );


  const parsedUnitPrice =
    Number(
      unitPrice
    );


  const parsedFxRate =
    activeMarket ===
    "국내"
      ? 1
      : Number(
          fxRate
        );


  const parsedFee =
    Number(
      feeKrw || 0
    );


  const parsedTax =
    Number(
      taxKrw || 0
    );


  const parsedSettlementKrw =
    settlementKrwInput
      .trim() ===
    ""
      ? null
      : Number(
          settlementKrwInput
        );


  const estimatedSettlement =
    useMemo(
      () => {
        if (
          !Number.isFinite(
            parsedQuantity
          ) ||
          parsedQuantity <= 0 ||
          !Number.isFinite(
            parsedUnitPrice
          ) ||
          parsedUnitPrice <= 0 ||
          !Number.isFinite(
            parsedFxRate
          ) ||
          parsedFxRate <= 0
        ) {
          return null;
        }


        const gross =
          parsedQuantity *
          parsedUnitPrice *
          parsedFxRate;


        if (
          tradeType ===
          "매수"
        ) {
          return (
            gross +
            (
              Number.isFinite(
                parsedFee
              )
                ? parsedFee
                : 0
            ) +
            (
              Number.isFinite(
                parsedTax
              )
                ? parsedTax
                : 0
            )
          );
        }


        return (
          gross -
          (
            Number.isFinite(
              parsedFee
            )
              ? parsedFee
              : 0
          ) -
          (
            Number.isFinite(
              parsedTax
            )
              ? parsedTax
              : 0
          )
        );
      },
      [
        parsedQuantity,
        parsedUnitPrice,
        parsedFxRate,
        parsedFee,
        parsedTax,
        tradeType
      ]
    );


  const hasManualSettlement =
    parsedSettlementKrw !==
      null &&
    Number.isFinite(
      parsedSettlementKrw
    ) &&
    parsedSettlementKrw >
      0;


  const displayedSettlement =
    hasManualSettlement
      ? parsedSettlementKrw
      : estimatedSettlement;


  const settlementForCashCheck =
    parsedSettlementKrw !==
    null
      ? parsedSettlementKrw
      : estimatedSettlement;


  function resetTradeFields() {
    setQuantity("");
    setUnitPrice("");

    setFeeKrw(
      "0"
    );

    setTaxKrw(
      "0"
    );

    setSettlementKrwInput("");

    setMemo("");

    setManualPrice("");
  }


  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setSuccess("");


    if (
      !account
        .cashBaselineConfigured
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


    let finalStockCode =
      "";


    if (
      tradeType ===
        "매도" ||
      buyTarget ===
        "existing"
    ) {
      if (
        !selectedHolding
      ) {
        setError(
          tradeType ===
            "매도"
            ? "매도할 보유종목을 선택해주세요."
            : "매수할 종목을 선택해주세요."
        );

        return;
      }


      finalStockCode =
        selectedHolding
          .stockCode;
    } else {
      finalStockCode =
        stockCode
          .trim()
          .toUpperCase();


      if (
        !finalStockCode
      ) {
        setError(
          "종목코드를 입력해주세요."
        );

        return;
      }
    }


    if (
      !Number.isFinite(
        parsedQuantity
      ) ||
      parsedQuantity <= 0
    ) {
      setError(
        "수량은 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    if (
      !Number.isFinite(
        parsedUnitPrice
      ) ||
      parsedUnitPrice <= 0
    ) {
      setError(
        "체결단가는 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    if (
      activeMarket ===
      "해외"
    ) {
      if (
        !currency.trim() ||
        currency.trim()
          .length !==
          3
      ) {
        setError(
          "해외 종목의 통화를 USD처럼 3자리 코드로 입력해주세요."
        );

        return;
      }


      if (
        !Number.isFinite(
          parsedFxRate
        ) ||
        parsedFxRate <= 0
      ) {
        setError(
          "해외 종목의 체결환율을 입력해주세요."
        );

        return;
      }
    }


    if (
      !Number.isFinite(
        parsedFee
      ) ||
      parsedFee < 0
    ) {
      setError(
        "수수료는 0 이상의 숫자로 입력해주세요."
      );

      return;
    }


    if (
      !Number.isFinite(
        parsedTax
      ) ||
      parsedTax < 0
    ) {
      setError(
        "세금은 0 이상의 숫자로 입력해주세요."
      );

      return;
    }


    if (
      parsedSettlementKrw !==
        null &&
      (
        !Number.isFinite(
          parsedSettlementKrw
        ) ||
        parsedSettlementKrw <=
          0
      )
    ) {
      setError(
        tradeType ===
          "매수"
          ? "실제 결제금액은 0보다 큰 숫자로 입력해주세요."
          : "실제 입금금액은 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    if (
      tradeType ===
        "매도" &&
      selectedHolding &&
      parsedQuantity >
        selectedHolding.quantity
    ) {
      setError(
        `현재 보유수량은 ${selectedHolding.quantity}주입니다.`
      );

      return;
    }


    if (
      tradeType ===
        "매수" &&
      settlementForCashCheck !==
        null &&
      account.currentCashKrw !==
        null &&
      settlementForCashCheck >
        account.currentCashKrw
    ) {
      setError(
        `예수금이 부족합니다. 현재 ${formatCurrency(
          account.currentCashKrw
        )}입니다.`
      );

      return;
    }


    if (
      tradeType ===
        "매수" &&
      buyTarget ===
        "new" &&
      quoteMode ===
        "수동"
    ) {
      const parsedManualPrice =
        Number(
          manualPrice
        );


      if (
        !Number.isFinite(
          parsedManualPrice
        ) ||
        parsedManualPrice <=
          0
      ) {
        setError(
          "수동 시세를 사용하는 신규 종목은 현재가를 입력해주세요."
        );

        return;
      }
    }


    setSaving(
      true
    );


    try {
      await createInvestmentTrade({
        accountId:
          account.accountId,

        tradeType,

        tradeDate,

        stockCode:
          finalStockCode,

        quantity:
          parsedQuantity,

        unitPrice:
          parsedUnitPrice,

        currency:
          activeMarket ===
          "국내"
            ? "KRW"
            : currency
                .trim()
                .toUpperCase(),

        fxRate:
          activeMarket ===
          "국내"
            ? 1
            : parsedFxRate,

        feeKrw:
          parsedFee,

        taxKrw:
          parsedTax,

        ...(
          parsedSettlementKrw !==
            null
            ? {
                settlementKrw:
                  parsedSettlementKrw
              }
            : {}
        ),

        memo:
          memo.trim(),

        requestId:
          createRequestId(),

        ...(
          tradeType ===
            "매수" &&
          buyTarget ===
            "new"
            ? {
                stockName:
                  stockName
                    .trim(),

                market,

                quoteMode,

                ...(
                  quoteMode ===
                    "수동"
                    ? {
                        manualPrice:
                          Number(
                            manualPrice
                          )
                      }
                    : {}
                )
              }
            : {}
        )
      });


      setSuccess(
        tradeType ===
          "매수"
          ? "매수 내역을 저장했습니다."
          : "매도 내역을 저장했습니다."
      );


      resetTradeFields();


      await onSaved();
    } catch (
      err
    ) {
      setError(
        err instanceof Error
          ? err.message
          : "투자거래 저장에 실패했습니다."
      );
    } finally {
      setSaving(
        false
      );
    }
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
            매수 및 매도
          </h3>

          <p
            className={
              styles.description
            }
          >
            실제 체결 내역을
            입력하세요.
          </p>
        </div>

        <div
          className={
            styles.cash
          }
        >
          예수금
          <br />

          {formatCurrency(
            account
              .currentCashKrw
          )}
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
              ? styles
                  .tradeTabActive
              : ""
          ]
            .filter(
              Boolean
            )
            .join(
              " "
            )}
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
              ? styles
                  .tradeTabActive
              : ""
          ]
            .filter(
              Boolean
            )
            .join(
              " "
            )}
          onClick={
            () =>
              setTradeType(
                "매도"
              )
          }
          disabled={
            holdings.length ===
            0
          }
        >
          매도
        </button>
      </div>


      <div
        className={
          styles.field
        }
      >
        <label
          className={
            styles.label
          }
          htmlFor="investment-trade-date"
        >
          거래일
          <span
            className={
              styles.required
            }
          >
            *
          </span>
        </label>

        <input
          id="investment-trade-date"
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
                event.target
                  .value
              )
          }
        />
      </div>


      {tradeType ===
        "매수" &&
        holdings.length >
          0 && (
          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
              htmlFor="investment-buy-target"
            >
              매수 종목
            </label>

            <select
              id="investment-buy-target"
              className={
                styles.select
              }
              value={
                buyTarget ===
                  "new"
                  ? "__NEW__"
                  : selectedHoldingId
              }
              onChange={
                event => {
                  if (
                    event
                      .target
                      .value ===
                    "__NEW__"
                  ) {
                    setBuyTarget(
                      "new"
                    );
                  } else {
                    setBuyTarget(
                      "existing"
                    );

                    setSelectedHoldingId(
                      event
                        .target
                        .value
                    );
                  }
                }
              }
            >
              {holdings.map(
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
                      holding.stockName
                    }
                    {" · "}
                    {
                      holding.stockCode
                    }
                  </option>
                )
              )}

              <option
                value="__NEW__"
              >
                + 신규 종목
              </option>
            </select>
          </div>
        )}


      {tradeType ===
        "매도" && (
        <div
          className={
            styles.field
          }
        >
          <label
            className={
              styles.label
            }
            htmlFor="investment-sell-holding"
          >
            매도 종목
            <span
              className={
                styles.required
              }
            >
              *
            </span>
          </label>

          <select
            id="investment-sell-holding"
            className={
              styles.select
            }
            value={
              selectedHoldingId
            }
            onChange={
              event =>
                setSelectedHoldingId(
                  event.target
                    .value
                )
            }
          >
            {holdings.map(
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
                    holding.stockName
                  }
                  {" · "}
                  {
                    holding.quantity
                  }
                  주
                </option>
              )
            )}
          </select>
        </div>
      )}


      {tradeType ===
        "매수" &&
        (
          buyTarget ===
            "new" ||
          holdings.length ===
            0
        ) && (
          <>
            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
                htmlFor="investment-stock-code"
              >
                종목코드
                <span
                  className={
                    styles.required
                  }
                >
                  *
                </span>
              </label>

              <input
                id="investment-stock-code"
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
                      event.target
                        .value
                    )
                }
                placeholder="예: 005930 또는 AAPL"
                autoComplete="off"
              />

              <p
                className={
                  styles.helper
                }
              >
                국내 종목도
                005930처럼 코드만
                입력합니다.
              </p>
            </div>


            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
                htmlFor="investment-stock-name"
              >
                종목명
              </label>

              <input
                id="investment-stock-name"
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
                      event.target
                        .value
                    )
                }
                placeholder="예: 삼성전자"
                autoComplete="off"
              />
            </div>


            <div
              className={
                styles.grid2
              }
            >
              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                  htmlFor="investment-market"
                >
                  시장
                </label>

                <select
                  id="investment-market"
                  className={
                    styles.select
                  }
                  value={
                    market
                  }
                  onChange={
                    event =>
                      setMarket(
                        event
                          .target
                          .value as Market
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
              </div>


              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                  htmlFor="investment-quote-mode"
                >
                  시세조회
                </label>

                <select
                  id="investment-quote-mode"
                  className={
                    styles.select
                  }
                  value={
                    quoteMode
                  }
                  onChange={
                    event =>
                      setQuoteMode(
                        event
                          .target
                          .value as QuoteMode
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
              </div>
            </div>


            {quoteMode ===
              "수동" && (
              <div
                className={
                  styles.field
                }
              >
                <label
                  className={
                    styles.label
                  }
                  htmlFor="investment-manual-price"
                >
                  현재가
                  <span
                    className={
                      styles.required
                    }
                  >
                    *
                  </span>
                </label>

                <input
                  id="investment-manual-price"
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
                        event.target
                          .value
                      )
                  }
                />
              </div>
            )}
          </>
        )}


      <div
        className={
          styles.grid2
        }
      >
        <div
          className={
            styles.field
          }
        >
          <label
            className={
              styles.label
            }
            htmlFor="investment-quantity"
          >
            수량
            <span
              className={
                styles.required
              }
            >
              *
            </span>
          </label>

          <input
            id="investment-quantity"
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
                  event.target
                    .value
                )
            }
            placeholder="0"
          />
        </div>


        <div
          className={
            styles.field
          }
        >
          <label
            className={
              styles.label
            }
            htmlFor="investment-unit-price"
          >
            체결단가
            <span
              className={
                styles.required
              }
            >
              *
            </span>
          </label>

          <input
            id="investment-unit-price"
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
                  event.target
                    .value
                )
            }
            placeholder="0"
          />
        </div>
      </div>


      {activeMarket ===
        "해외" && (
        <div
          className={
            styles.grid2
          }
        >
          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
              htmlFor="investment-currency"
            >
              체결통화
            </label>

            <input
              id="investment-currency"
              className={
                styles.input
              }
              type="text"
              maxLength={
                3
              }
              value={
                currency
              }
              onChange={
                event =>
                  setCurrency(
                    event.target
                      .value
                      .toUpperCase()
                  )
              }
              placeholder="USD"
            />
          </div>


          <div
            className={
              styles.field
            }
          >
            <label
              className={
                styles.label
              }
              htmlFor="investment-fx"
            >
              체결환율
              <span
                className={
                  styles.required
                }
              >
                *
              </span>
            </label>

            <input
              id="investment-fx"
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
                    event.target
                      .value
                  )
              }
              placeholder="예: 1375.50"
            />
          </div>
        </div>
      )}


      <div
        className={
          styles.field
        }
      >
        <label
          className={
            styles.label
          }
          htmlFor="investment-settlement"
        >
          {tradeType ===
          "매수"
            ? "실제 결제금액"
            : "실제 입금금액"}

          <span
            className={
              styles.optional
            }
          >
            선택
          </span>
        </label>

        <input
          id="investment-settlement"
          className={
            styles.input
          }
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={
            settlementKrwInput
          }
          onChange={
            event =>
              setSettlementKrwInput(
                event.target
                  .value
              )
          }
          placeholder={
            tradeType ===
            "매수"
              ? "증권사 앱의 실제 출금액"
              : "증권사 앱의 실제 입금액"
          }
        />

        <p
          className={
            styles.helper
          }
        >
          증권사 앱에 표시된 실제 원화
          금액을 알고 있을 때만 입력하세요.
          비워두면 수량, 체결단가,
          환율과 상세 입력값으로 자동
          계산합니다.
        </p>
      </div>


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
          <span>
            상세 입력
          </span>

          <span
            className={
              styles.detailsHint
            }
          >
            수수료 및 세금
          </span>
        </summary>

        <div
          className={
            styles.detailsBody
          }
        >
          <div
            className={
              styles.grid2
            }
          >
            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
                htmlFor="investment-fee"
              >
                수수료
              </label>

              <input
                id="investment-fee"
                className={
                  styles.input
                }
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={
                  feeKrw
                }
                onChange={
                  event =>
                    setFeeKrw(
                      event.target
                        .value
                    )
                }
                placeholder="0"
              />
            </div>


            <div
              className={
                styles.field
              }
            >
              <label
                className={
                  styles.label
                }
                htmlFor="investment-tax"
              >
                세금
              </label>

              <input
                id="investment-tax"
                className={
                  styles.input
                }
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={
                  taxKrw
                }
                onChange={
                  event =>
                    setTaxKrw(
                      event.target
                        .value
                    )
                }
                placeholder="0"
              />
            </div>
          </div>

          <p
            className={
              styles.helper
            }
          >
            수수료와 세금을 모르면
            0으로 두면 됩니다. 실제
            결제금액 또는 입금금액을
            입력했다면 백엔드는 그
            금액을 우선 사용합니다.
          </p>
        </div>
      </details>


      <div
        className={
          styles.field
        }
      >
        <label
          className={
            styles.label
          }
          htmlFor="investment-memo"
        >
          메모
        </label>

        <input
          id="investment-memo"
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
                event.target
                  .value
              )
          }
          placeholder="선택 입력"
        />
      </div>


      {displayedSettlement !==
        null && (
        <div
          className={
            styles.estimate
          }
        >
          <span
            className={
              styles
                .estimateLabel
            }
          >
            {hasManualSettlement
              ? (
                  tradeType ===
                  "매수"
                    ? "실제 결제금액"
                    : "실제 입금금액"
                )
              : (
                  tradeType ===
                  "매수"
                    ? "예상 결제금액"
                    : "예상 입금금액"
                )}
          </span>

          <strong
            className={
              styles
                .estimateValue
            }
          >
            {formatCurrency(
              displayedSettlement
            )}
          </strong>
        </div>
      )}


      {error && (
        <p
          className={
            styles.error
          }
        >
          {error}
        </p>
      )}


      {success && (
        <p
          className={
            styles.success
          }
        >
          {success}
        </p>
      )}


      <button
        type="submit"
        className={
          styles.submitButton
        }
        disabled={
          saving ||
          !account
            .cashBaselineConfigured
        }
      >
        {saving
          ? "저장 중..."
          : tradeType ===
              "매수"
            ? "매수 내역 저장"
            : "매도 내역 저장"}
      </button>


      {!account
        .cashBaselineConfigured && (
        <p
          className={
            styles.helper
          }
        >
          매수 및 매도 입력 전
          현재 예수금을 먼저
          설정해야 합니다.
        </p>
      )}
    </form>
  );
}
