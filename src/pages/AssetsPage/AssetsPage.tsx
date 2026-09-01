import {
  Fragment,
  useEffect,
  useState
} from "react";

import {
  getDashboard
} from "../../api/dashboard";

import {
  setInvestmentCashBaseline,
  updateHoldingManualPrice
} from "../../api/investments";

import InvestmentTradeForm
  from "../../components/investment/InvestmentTradeForm/InvestmentTradeForm";

import InvestmentTradeHistory
  from "../../components/investment/InvestmentTradeHistory/InvestmentTradeHistory";

import type {
  DashboardData
} from "../../types/dashboard";

import styles
  from "./AssetsPage.module.css";


type AssetsTab =
  | "cash"
  | "investment";


function formatCurrency(
  value:
    number |
    undefined |
    null
) {
  if (
    value === undefined ||
    value === null ||
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


function formatSignedCurrency(
  value:
    number |
    undefined |
    null
) {
  if (
    value === undefined ||
    value === null ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  const sign =
    value > 0
      ? "+"
      : "";

  return (
    sign +
    Math.round(value)
      .toLocaleString("ko-KR") +
    "원"
  );
}


function formatPercent(
  value:
    number |
    undefined |
    null
) {
  if (
    value === undefined ||
    value === null ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  const sign =
    value > 0
      ? "+"
      : "";

  return (
    sign +
    (
      value *
      100
    ).toFixed(2) +
    "%"
  );
}


function formatQuantity(
  value:
    number |
    undefined |
    null
) {
  if (
    value === undefined ||
    value === null ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  return value.toLocaleString(
    "ko-KR",
    {
      maximumFractionDigits:
        8
    }
  );
}


function formatPrice(
  value:
    number |
    undefined |
    null,
  market:
    string
) {
  if (
    value === undefined ||
    value === null ||
    !Number.isFinite(value)
  ) {
    return "-";
  }

  const formatted =
    value.toLocaleString(
      "ko-KR",
      {
        maximumFractionDigits:
          8
      }
    );

  return market ===
    "국내"
    ? `${formatted}원`
    : formatted;
}


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


export default function AssetsPage() {
  const [
    activeTab,
    setActiveTab
  ] =
    useState<AssetsTab>(
      "cash"
    );

  const [
    dashboard,
    setDashboard
  ] =
    useState<
      DashboardData |
      null
    >(null);

  const [
    loading,
    setLoading
  ] =
    useState(
      true
    );

  const [
    error,
    setError
  ] =
    useState("");

  const [
    selectedAccountId,
    setSelectedAccountId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    cashInput,
    setCashInput
  ] =
    useState("");

  const [
    cashSaving,
    setCashSaving
  ] =
    useState(
      false
    );

  const [
    cashError,
    setCashError
  ] =
    useState("");

  const [
    tradeHistoryRefreshKey,
    setTradeHistoryRefreshKey
  ] =
    useState(
      0
    );


  const [
    manualPriceDrafts,
    setManualPriceDrafts
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    manualPriceSavingId,
    setManualPriceSavingId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    manualPriceErrors,
    setManualPriceErrors
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    manualPriceFeedbackId,
    setManualPriceFeedbackId
  ] =
    useState<
      string |
      null
    >(null);


  async function loadDashboard() {
    setLoading(
      true
    );

    setError(
      ""
    );

    try {
      const data =
        await getDashboard();

      setDashboard(
        data
      );
    } catch (
      err
    ) {
      setError(
        err instanceof Error
          ? err.message
          : "자산 정보를 불러오지 못했습니다."
      );
    } finally {
      setLoading(
        false
      );
    }
  }


  async function handleInvestmentSaved() {
    setTradeHistoryRefreshKey(
      current =>
        current +
        1
    );

    await loadDashboard();
  }


  useEffect(
    () => {
      void loadDashboard();
    },
    []
  );


  const summary =
    dashboard?.summary;


  const cashLikeAccounts =
    dashboard?.accounts.filter(
      account =>
        account.accountType ===
          "자산" &&
        account.balanceMethod !==
          "평가입력"
    ) || [];


  const investmentAccounts =
    dashboard
      ?.investments
      .accounts ||
    [];


  const investmentHoldings =
    dashboard
      ?.investments
      .holdings ||
    [];


  const selectedAccount =
    investmentAccounts.find(
      account =>
        account.accountId ===
        selectedAccountId
    );


  const holdingsForSelected =
    investmentHoldings.filter(
      holding =>
        holding.accountId ===
        selectedAccountId
    );


  useEffect(
    () => {
      if (
        !selectedAccount
      ) {
        setCashInput(
          ""
        );

        return;
      }

      setCashInput(
        selectedAccount
          .cashBaselineKrw !==
          null
          ? String(
              selectedAccount
                .cashBaselineKrw
            )
          : ""
      );
    },
    [
      selectedAccountId,
      selectedAccount
        ?.cashBaselineKrw
    ]
  );


  async function handleSaveCashBaseline() {
    if (
      !selectedAccountId
    ) {
      return;
    }


    const parsed =
      Number(
        cashInput
      );


    if (
      !Number.isFinite(
        parsed
      ) ||
      parsed <
        0
    ) {
      setCashError(
        "올바른 금액을 입력해주세요."
      );

      return;
    }


    setCashSaving(
      true
    );

    setCashError(
      ""
    );


    try {
      await setInvestmentCashBaseline({
        accountId:
          selectedAccountId,

        cashBaselineKrw:
          parsed,

        force:
          true
      });


      await loadDashboard();
    } catch (
      err
    ) {
      setCashError(
        err instanceof Error
          ? err.message
          : "예수금 기준값 저장에 실패했습니다."
      );
    } finally {
      setCashSaving(
        false
      );
    }
  }


  function getManualPriceInput(
    holdingId: string,
    manualPrice:
      number |
      null |
      undefined,
    currentPrice:
      number |
      null |
      undefined
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          manualPriceDrafts,
          holdingId
        )
    ) {
      return manualPriceDrafts[
        holdingId
      ];
    }

    const value =
      manualPrice ??
      currentPrice;

    return (
      value !== null &&
      value !== undefined &&
      Number.isFinite(value)
    )
      ? String(value)
      : "";
  }


  function handleManualPriceChange(
    holdingId: string,
    value: string
  ) {
    setManualPriceDrafts(
      current => ({
        ...current,
        [holdingId]: value
      })
    );

    setManualPriceErrors(
      current => ({
        ...current,
        [holdingId]: ""
      })
    );

    setManualPriceFeedbackId(
      null
    );
  }


  async function handleSaveManualPrice(
    holdingId: string,
    manualPrice:
      number |
      null |
      undefined,
    currentPrice:
      number |
      null |
      undefined
  ) {
    const input =
      getManualPriceInput(
        holdingId,
        manualPrice,
        currentPrice
      );

    const parsed =
      Number(input);

    if (
      !Number.isFinite(parsed) ||
      parsed <= 0
    ) {
      setManualPriceErrors(
        current => ({
          ...current,
          [holdingId]:
            "수동 시세는 0보다 큰 숫자로 입력해주세요."
        })
      );

      return;
    }

    setManualPriceSavingId(
      holdingId
    );

    setManualPriceErrors(
      current => ({
        ...current,
        [holdingId]: ""
      })
    );

    setManualPriceFeedbackId(
      null
    );

    try {
      await updateHoldingManualPrice({
        holdingId,
        manualPrice:
          parsed,
        lastUpdated:
          getToday()
      });

      setManualPriceDrafts(
        current => ({
          ...current,
          [holdingId]:
            String(parsed)
        })
      );

      await loadDashboard();

      setManualPriceFeedbackId(
        holdingId
      );
    } catch (
      err
    ) {
      setManualPriceErrors(
        current => ({
          ...current,
          [holdingId]:
            err instanceof Error
              ? err.message
              : "수동 시세 저장에 실패했습니다."
        })
      );
    } finally {
      setManualPriceSavingId(
        null
      );
    }
  }


  return (
    <main
      className={
        styles.page
      }
    >
      <header
        className={
          styles.header
        }
      >
        <p
          className={
            styles.eyebrow
          }
        >
          자산
        </p>

        <h1
          className={
            styles.title
          }
        >
          우리 가계부 자산
        </h1>
      </header>


      <section
        className={
          styles.summaryCard
        }
      >
        {loading && (
          <p
            className={
              styles.loading
            }
          >
            순자산 요약을 불러오는 중입니다.
          </p>
        )}


        {!loading &&
          error && (
            <p
              className={
                styles.error
              }
            >
              {error}
            </p>
          )}


        {!loading &&
          !error &&
          summary && (
            <div
              className={
                styles.summaryGrid
              }
            >
              <div
                className={
                  styles.summaryItem
                }
              >
                <span
                  className={
                    styles.summaryLabel
                  }
                >
                  총자산
                </span>

                <strong
                  className={
                    styles.summaryValue
                  }
                >
                  {formatCurrency(
                    summary.assets
                  )}
                </strong>
              </div>


              <div
                className={
                  styles.summaryItem
                }
              >
                <span
                  className={
                    styles.summaryLabel
                  }
                >
                  총부채
                </span>

                <strong
                  className={
                    styles.summaryValue
                  }
                >
                  {formatCurrency(
                    summary.liabilities
                  )}
                </strong>
              </div>


              <div
                className={
                  styles.summaryItem
                }
              >
                <span
                  className={
                    styles.summaryLabel
                  }
                >
                  순자산
                </span>

                <strong
                  className={
                    styles.summaryValue
                  }
                  style={{
                    color:
                      summary.netWorth <
                      0
                        ? "var(--color-error)"
                        : undefined
                  }}
                >
                  {formatCurrency(
                    summary.netWorth
                  )}
                </strong>
              </div>
            </div>
          )}
      </section>


      <div
        className={
          styles.tabs
        }
      >
        <button
          type="button"
          className={[
            styles.tabButton,

            activeTab ===
            "cash"
              ? styles
                  .tabButtonActive
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
              setActiveTab(
                "cash"
              )
          }
        >
          현금성자산
        </button>


        <button
          type="button"
          className={[
            styles.tabButton,

            activeTab ===
            "investment"
              ? styles
                  .tabButtonActive
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
              setActiveTab(
                "investment"
              )
          }
        >
          투자
        </button>
      </div>


      {activeTab ===
        "cash" && (
        <section
          className={
            styles.section
          }
        >
          <h2
            className={
              styles.sectionTitle
            }
          >
            현금성자산
          </h2>


          {!loading &&
            summary && (
              <div
                className={
                  styles.cashSummary
                }
              >
                <span
                  className={
                    styles.summaryLabel
                  }
                >
                  현금성자산 합계
                </span>

                <strong
                  className={
                    styles.summaryValue
                  }
                >
                  {formatCurrency(
                    summary
                      .cashLikeValue
                  )}
                </strong>
              </div>
            )}


          {loading && (
            <p
              className={
                styles.loading
              }
            >
              불러오는 중입니다.
            </p>
          )}


          {!loading &&
            cashLikeAccounts
              .length ===
              0 && (
              <p
                className={
                  styles.emptyState
                }
              >
                표시할 현금성 계좌가 없습니다.
              </p>
            )}


          {!loading &&
            cashLikeAccounts
              .length >
              0 && (
              <ul
                className={
                  styles.cashAccountList
                }
              >
                {cashLikeAccounts.map(
                  account => (
                    <li
                      key={
                        account.accountId
                      }
                      className={
                        styles.cashAccountRow
                      }
                    >
                      <div
                        className={
                          styles.cashAccountInfo
                        }
                      >
                        <strong
                          className={
                            styles.cashAccountName
                          }
                        >
                          {
                            account.displayName
                          }
                        </strong>

                        <span
                          className={
                            styles.cashAccountMeta
                          }
                        >
                          {
                            account.subType
                          }
                        </span>
                      </div>


                      <strong
                        className={
                          styles.cashAccountValue
                        }
                      >
                        {formatCurrency(
                          account.currentBalance
                        )}
                      </strong>
                    </li>
                  )
                )}
              </ul>
            )}
        </section>
      )}


      {activeTab ===
        "investment" && (
        <section
          className={
            styles.section
          }
        >
          <div
            className={
              styles.sectionHeading
            }
          >
            <h2
              className={
                styles.sectionTitle
              }
            >
              투자자산
            </h2>

            {!loading &&
              investmentAccounts
                .length >
                0 && (
                <span
                  className={
                    styles.sectionCount
                  }
                >
                  {
                    investmentAccounts
                      .length
                  }
                  개 계좌
                </span>
              )}
          </div>


          {!loading &&
            summary && (
              <div
                className={
                  styles.investmentSummary
                }
              >
                <div>
                  <span
                    className={
                      styles.summaryLabel
                    }
                  >
                    투자자산 합계
                  </span>

                  <strong
                    className={
                      styles.investmentSummaryValue
                    }
                  >
                    {formatCurrency(
                      summary
                        .investmentValue
                    )}
                  </strong>
                </div>


                <div
                  className={
                    styles.investmentSummarySub
                  }
                >
                  <span>
                    예수금{" "}
                    <strong>
                      {formatCurrency(
                        dashboard
                          ?.investments
                          .cashTotal
                      )}
                    </strong>
                  </span>

                  <span>
                    실현손익{" "}
                    <strong
                      style={{
                        color:
                          (
                            dashboard
                              ?.investments
                              .realizedPnlTotal ??
                            0
                          ) <
                          0
                            ? "var(--color-error)"
                            : undefined
                      }}
                    >
                      {formatSignedCurrency(
                        dashboard
                          ?.investments
                          .realizedPnlTotal
                      )}
                    </strong>
                  </span>
                </div>
              </div>
            )}


          {loading && (
            <p
              className={
                styles.loading
              }
            >
              투자계좌를 불러오는 중입니다.
            </p>
          )}


          {!loading &&
            investmentAccounts
              .length ===
              0 && (
              <p
                className={
                  styles.emptyState
                }
              >
                등록된 투자계좌가 없습니다.
              </p>
            )}


          {!loading &&
            investmentAccounts
              .length >
              0 && (
              <div
                className={
                  styles.accountList
                }
              >
                {investmentAccounts.map(
                  account => {
                    const isSelected =
                      selectedAccountId ===
                      account.accountId;


                    const holdingCount =
                      investmentHoldings.filter(
                        holding =>
                          holding.accountId ===
                          account.accountId
                      ).length;


                    return (
                      <Fragment
                        key={
                          account.accountId
                        }
                      >
                        <button
                          type="button"
                          className={[
                            styles.accountCard,

                            isSelected
                              ? styles
                                  .accountCardActive
                              : ""
                          ]
                            .filter(
                              Boolean
                            )
                            .join(
                              " "
                            )}
                          onClick={
                            () => {
                              setCashError(
                                ""
                              );

                              setSelectedAccountId(
                                isSelected
                                  ? null
                                  : account.accountId
                              );
                            }
                          }
                        >
                          <div
                            className={
                              styles.accountCardTop
                            }
                          >
                            <div
                              className={
                                styles.accountIdentity
                              }
                            >
                              <strong
                                className={
                                  styles.accountName
                                }
                              >
                                {
                                  account.accountName
                                }
                              </strong>

                              <span
                                className={
                                  styles.accountSub
                                }
                              >
                                {
                                  account.subType
                                }
                                {" · "}
                                {
                                  holdingCount
                                }
                                종목
                              </span>
                            </div>


                            <div
                              className={
                                styles.accountTotal
                              }
                            >
                              <strong>
                                {formatCurrency(
                                  account.accountValueKrw
                                )}
                              </strong>

                              <span>
                                총 평가
                              </span>
                            </div>
                          </div>


                          <div
                            className={
                              styles.accountMetrics
                            }
                          >
                            <div
                              className={
                                styles.accountMetric
                              }
                            >
                              <span>
                                예수금
                              </span>

                              <strong>
                                {account.cashBaselineConfigured
                                  ? formatCurrency(
                                      account.currentCashKrw
                                    )
                                  : "미설정"}
                              </strong>
                            </div>


                            <div
                              className={
                                styles.accountMetric
                              }
                            >
                              <span>
                                실현손익
                              </span>

                              <strong
                                style={{
                                  color:
                                    account.realizedPnlKrw <
                                    0
                                      ? "var(--color-error)"
                                      : undefined
                                }}
                              >
                                {formatSignedCurrency(
                                  account.realizedPnlKrw
                                )}
                              </strong>
                            </div>
                          </div>
                        </button>


                        {isSelected &&
                          selectedAccount && (
                            <div
                              className={
                                styles.detailCard
                              }
                            >
                              <div
                                className={
                                  styles.detailHeader
                                }
                              >
                                <div>
                                  <span
                                    className={
                                      styles.detailEyebrow
                                    }
                                  >
                                    투자계좌
                                  </span>

                                  <h3
                                    className={
                                      styles.detailTitle
                                    }
                                  >
                                    {
                                      selectedAccount.accountName
                                    }
                                  </h3>
                                </div>


                                <strong
                                  className={
                                    styles.detailTotal
                                  }
                                >
                                  {formatCurrency(
                                    selectedAccount.accountValueKrw
                                  )}
                                </strong>
                              </div>


                              <div
                                className={
                                  styles.detailMetrics
                                }
                              >
                                <div
                                  className={
                                    styles.detailMetric
                                  }
                                >
                                  <span>
                                    현재 예수금
                                  </span>

                                  <strong>
                                    {selectedAccount.cashBaselineConfigured
                                      ? formatCurrency(
                                          selectedAccount.currentCashKrw
                                        )
                                      : "미설정"}
                                  </strong>
                                </div>


                                <div
                                  className={
                                    styles.detailMetric
                                  }
                                >
                                  <span>
                                    보유종목
                                  </span>

                                  <strong>
                                    {formatCurrency(
                                      selectedAccount.holdingValueKrw
                                    )}
                                  </strong>
                                </div>


                                <div
                                  className={
                                    styles.detailMetric
                                  }
                                >
                                  <span>
                                    실현손익
                                  </span>

                                  <strong
                                    style={{
                                      color:
                                        selectedAccount.realizedPnlKrw <
                                        0
                                          ? "var(--color-error)"
                                          : undefined
                                    }}
                                  >
                                    {formatSignedCurrency(
                                      selectedAccount.realizedPnlKrw
                                    )}
                                  </strong>
                                </div>
                              </div>


                              {!selectedAccount
                                .cashBaselineConfigured && (
                                <div
                                  className={
                                    styles.cashSetupCard
                                  }
                                >
                                  <div
                                    className={
                                      styles.cashSetupHeading
                                    }
                                  >
                                    <strong>
                                      예수금 설정
                                    </strong>

                                    <span>
                                      증권사 앱의 현재 예수금을 한 번 입력해주세요.
                                    </span>
                                  </div>


                                  <div
                                    className={
                                      styles.cashForm
                                    }
                                  >
                                    <input
                                      className={
                                        styles.cashInput
                                      }
                                      type="number"
                                      inputMode="numeric"
                                      min="0"
                                      value={
                                        cashInput
                                      }
                                      onChange={
                                        event =>
                                          setCashInput(
                                            event.target.value
                                          )
                                      }
                                      placeholder="예: 327500"
                                    />

                                    <button
                                      type="button"
                                      className={
                                        styles.cashButton
                                      }
                                      onClick={
                                        handleSaveCashBaseline
                                      }
                                      disabled={
                                        cashSaving
                                      }
                                    >
                                      {cashSaving
                                        ? "저장 중..."
                                        : "설정"}
                                    </button>
                                  </div>
                                </div>
                              )}


                              {selectedAccount
                                .cashBaselineConfigured && (
                                <details
                                  className={
                                    styles.baselineDetails
                                  }
                                >
                                  <summary
                                    className={
                                      styles.baselineSummary
                                    }
                                  >
                                    예수금 기준값 다시 설정
                                  </summary>


                                  <div
                                    className={
                                      styles.baselineBody
                                    }
                                  >
                                    <p
                                      className={
                                        styles.helperText
                                      }
                                    >
                                      현재 예수금과 다른 값입니다.
                                      투자거래 계산의 시작점이 되는 기준값입니다.
                                    </p>


                                    <div
                                      className={
                                        styles.cashForm
                                      }
                                    >
                                      <input
                                        className={
                                          styles.cashInput
                                        }
                                        type="number"
                                        inputMode="numeric"
                                        min="0"
                                        value={
                                          cashInput
                                        }
                                        onChange={
                                          event =>
                                            setCashInput(
                                              event.target.value
                                            )
                                        }
                                      />

                                      <button
                                        type="button"
                                        className={
                                          styles.cashButton
                                        }
                                        onClick={
                                          handleSaveCashBaseline
                                        }
                                        disabled={
                                          cashSaving
                                        }
                                      >
                                        {cashSaving
                                          ? "저장 중..."
                                          : "저장"}
                                      </button>
                                    </div>
                                  </div>
                                </details>
                              )}


                              {cashError && (
                                <p
                                  className={
                                    styles.error
                                  }
                                >
                                  {cashError}
                                </p>
                              )}


                              <div
                                className={
                                  styles.holdingsHeader
                                }
                              >
                                <h4
                                  className={
                                    styles.holdingsTitle
                                  }
                                >
                                  보유종목
                                </h4>

                                <span
                                  className={
                                    styles.holdingsCount
                                  }
                                >
                                  {
                                    holdingsForSelected.length
                                  }
                                  종목
                                </span>
                              </div>


                              {holdingsForSelected
                                .length ===
                                0 && (
                                <p
                                  className={
                                    styles.emptyState
                                  }
                                >
                                  보유 중인 종목이 없습니다.
                                </p>
                              )}


                              {holdingsForSelected
                                .length >
                                0 && (
                                <ul
                                  className={
                                    styles.investmentHoldingList
                                  }
                                >
                                  {holdingsForSelected.map(
                                    holding => {
                                      const evaluationPnl =
                                        holding.valueKrw -
                                        holding.costKrw;


                                      return (
                                        <li
                                          key={
                                            holding.holdingId
                                          }
                                          className={
                                            styles.investmentHoldingRow
                                          }
                                        >
                                          <div
                                            className={
                                              styles.investmentHoldingTop
                                            }
                                          >
                                            <div
                                              className={
                                                styles.investmentHoldingIdentity
                                              }
                                            >
                                              <div
                                                className={
                                                  styles.stockNameRow
                                                }
                                              >
                                                <strong
                                                  className={
                                                    styles.holdingName
                                                  }
                                                >
                                                  {
                                                    holding.stockName
                                                  }
                                                </strong>


                                                {holding.quoteMode ===
                                                  "수동" && (
                                                  <span
                                                    className={
                                                      styles.manualBadge
                                                    }
                                                  >
                                                    수동시세
                                                  </span>
                                                )}
                                              </div>


                                              <span
                                                className={
                                                  styles.holdingMeta
                                                }
                                              >
                                                {
                                                  holding.stockCode
                                                }
                                                {" · "}
                                                {
                                                  holding.market
                                                }
                                                {" · "}
                                                {formatQuantity(
                                                  holding.quantity
                                                )}
                                                주
                                              </span>
                                            </div>


                                            <div
                                              className={
                                                styles.holdingResult
                                              }
                                            >
                                              <strong
                                                className={
                                                  styles.holdingValue
                                                }
                                              >
                                                {formatCurrency(
                                                  holding.valueKrw
                                                )}
                                              </strong>

                                              <span
                                                className={
                                                  styles.holdingReturn
                                                }
                                                style={{
                                                  color:
                                                    holding.returnRate <
                                                    0
                                                      ? "var(--color-error)"
                                                      : undefined
                                                }}
                                              >
                                                {formatPercent(
                                                  holding.returnRate
                                                )}
                                              </span>
                                            </div>
                                          </div>


                                          <div
                                            className={
                                              styles.holdingDetails
                                            }
                                          >
                                            <div
                                              className={
                                                styles.holdingDetailItem
                                              }
                                            >
                                              <span>
                                                평단
                                              </span>

                                              <strong>
                                                {formatPrice(
                                                  holding.avgBuyPrice,
                                                  holding.market
                                                )}
                                              </strong>
                                            </div>


                                            <div
                                              className={
                                                styles.holdingDetailItem
                                              }
                                            >
                                              <span>
                                                현재가
                                              </span>

                                              <strong>
                                                {formatPrice(
                                                  holding.currentPrice,
                                                  holding.market
                                                )}
                                              </strong>
                                            </div>


                                            <div
                                              className={
                                                styles.holdingDetailItem
                                              }
                                            >
                                              <span>
                                                평가손익
                                              </span>

                                              <strong
                                                style={{
                                                  color:
                                                    evaluationPnl <
                                                    0
                                                      ? "var(--color-error)"
                                                      : undefined
                                                }}
                                              >
                                                {formatSignedCurrency(
                                                  evaluationPnl
                                                )}
                                              </strong>
                                            </div>
                                          </div>


                                          {holding.quoteMode ===
                                            "수동" && (
                                            <details
                                              className={
                                                styles.baselineDetails
                                              }
                                            >
                                              <summary
                                                className={
                                                  styles.baselineSummary
                                                }
                                              >
                                                수동시세 수정
                                              </summary>

                                              <div
                                                className={
                                                  styles.baselineBody
                                                }
                                              >
                                                <p
                                                  className={
                                                    styles.helperText
                                                  }
                                                >
                                                  자동 시세 대신 이 평가단가를 사용합니다.
                                                </p>

                                                <div
                                                  className={
                                                    styles.cashForm
                                                  }
                                                >
                                                  <input
                                                    className={
                                                      styles.cashInput
                                                    }
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0"
                                                    step="any"
                                                    value={
                                                      getManualPriceInput(
                                                        holding.holdingId,
                                                        holding.manualPrice,
                                                        holding.currentPrice
                                                      )
                                                    }
                                                    onChange={
                                                      event =>
                                                        handleManualPriceChange(
                                                          holding.holdingId,
                                                          event.target.value
                                                        )
                                                    }
                                                    placeholder={
                                                      holding.market ===
                                                        "국내"
                                                        ? "평가단가(원)"
                                                        : "평가단가"
                                                    }
                                                  />

                                                  <button
                                                    type="button"
                                                    className={
                                                      styles.cashButton
                                                    }
                                                    disabled={
                                                      manualPriceSavingId ===
                                                        holding.holdingId
                                                    }
                                                    onClick={
                                                      () =>
                                                        void handleSaveManualPrice(
                                                          holding.holdingId,
                                                          holding.manualPrice,
                                                          holding.currentPrice
                                                        )
                                                    }
                                                  >
                                                    {manualPriceSavingId ===
                                                      holding.holdingId
                                                      ? "저장 중..."
                                                      : "시세 저장"}
                                                  </button>
                                                </div>

                                                {manualPriceErrors[
                                                  holding.holdingId
                                                ] && (
                                                  <p
                                                    className={
                                                      styles.error
                                                    }
                                                  >
                                                    {manualPriceErrors[
                                                      holding.holdingId
                                                    ]}
                                                  </p>
                                                )}

                                                {manualPriceFeedbackId ===
                                                  holding.holdingId && (
                                                  <p
                                                    className={
                                                      styles.helperText
                                                    }
                                                  >
                                                    수동시세를 저장했습니다.
                                                  </p>
                                                )}
                                              </div>
                                            </details>
                                          )}


                                          {holding.market ===
                                            "해외" &&
                                            holding.fx >
                                              0 && (
                                              <p
                                                className={
                                                  styles.fxMeta
                                                }
                                              >
                                                적용환율{" "}
                                                {formatCurrency(
                                                  holding.fx
                                                )}
                                              </p>
                                            )}
                                        </li>
                                      );
                                    }
                                  )}
                                </ul>
                              )}


                              <InvestmentTradeForm
                                account={
                                  selectedAccount
                                }
                                holdings={
                                  holdingsForSelected
                                }
                                onSaved={
                                  handleInvestmentSaved
                                }
                              />


                              <InvestmentTradeHistory
                                accountId={
                                  selectedAccount.accountId
                                }
                                refreshKey={
                                  tradeHistoryRefreshKey
                                }
                                onChanged={
                                  handleInvestmentSaved
                                }
                              />
                            </div>
                          )}
                      </Fragment>
                    );
                  }
                )}
              </div>
            )}
        </section>
      )}
    </main>
  );
}
