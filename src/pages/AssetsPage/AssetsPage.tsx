import {
  Fragment,
  useEffect,
  useState
} from "react";

import {
  getDashboard,
  getDashboardSnapshot
} from "../../api/dashboard";

import {
  setInvestmentCashBaseline,
  updateHoldingManualPrice
} from "../../api/investments";

import InvestmentTradeForm
  from "../../components/investment/InvestmentTradeForm/InvestmentTradeForm";

import InvestmentTradeHistory
  from "../../components/investment/InvestmentTradeHistory/InvestmentTradeHistory";

import {
  AccountSettings
} from "../SettingsPage/SettingsPage";

import {
  updateManagedAccount
} from "../../api/settingsManagement";

import {
  markLedgerChanged
} from "../../utils/ledgerEvents";

import {
  markBackgroundRefreshed,
  shouldBackgroundRefresh
} from "../../utils/backgroundRefresh";

import {
  getSeoulDateString
} from "../../utils/dateTime";

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
  return getSeoulDateString();
}


interface AssetsPageProps {
  userName: string;
}

export default function AssetsPage({
  userName
}: AssetsPageProps) {
  const [
    activeTab,
    setActiveTab
  ] =
    useState<AssetsTab>(
      "cash"
    );

  const [
    initialDashboard
  ] =
    useState<
      DashboardData |
      null
    >(
      () =>
        getDashboardSnapshot()
    );

  const [
    dashboard,
    setDashboard
  ] =
    useState<
      DashboardData |
      null
    >(
      initialDashboard
    );

  const [
    loading,
    setLoading
  ] =
    useState(
      initialDashboard ===
        null
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
    selectedCashAccountId,
    setSelectedCashAccountId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    editingAccountId,
    setEditingAccountId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    creatingAccount,
    setCreatingAccount
  ] =
    useState(false);

  const [
    reconcileAccountId,
    setReconcileAccountId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    reconcileInput,
    setReconcileInput
  ] =
    useState("");

  const [
    reconcileSaving,
    setReconcileSaving
  ] =
    useState(false);

  const [
    reconcileError,
    setReconcileError
  ] =
    useState("");

  useEffect(
    () => {
      if (
        !editingAccountId &&
        !creatingAccount
      ) {
        return;
      }

      const previousOverflow =
        document.body.style.overflow;
      document.body.style.overflow =
        "hidden";

      function handleKeyDown(
        event: KeyboardEvent
      ) {
        if (
          event.key ===
          "Escape"
        ) {
          setEditingAccountId(
            null
          );
          setCreatingAccount(
            false
          );
        }
      }

      window.addEventListener(
        "keydown",
        handleKeyDown
      );

      return () => {
        document.body.style.overflow =
          previousOverflow;
        window.removeEventListener(
          "keydown",
          handleKeyDown
        );
      };
    },
    [
      editingAccountId,
      creatingAccount
    ]
  );


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


  async function loadDashboard(
    forceRefresh = false
  ) {
    const cachedDashboard =
      getDashboardSnapshot();

    if (
      cachedDashboard
    ) {
      setDashboard(
        cachedDashboard
      );

      setLoading(
        false
      );
    } else if (
      !dashboard
    ) {
      setLoading(
        true
      );
    }

    setError(
      ""
    );

    try {
      const data =
        await getDashboard(
          undefined,
          {
            forceRefresh
          }
        );

      setDashboard(
        data
      );

      markBackgroundRefreshed(
        "assets-dashboard"
      );
    } catch (
      err
    ) {
      if (
        !dashboard &&
        !getDashboardSnapshot()
      ) {
        setError(
          err instanceof Error
            ? err.message
            : "자산 정보를 불러오지 못했습니다."
        );
      }
    } finally {
      setLoading(
        false
      );
    }
  }


  useEffect(
    () => {
      function refreshWhenVisible() {
        if (
          document.visibilityState !==
          "visible" ||
          !shouldBackgroundRefresh(
            "assets-dashboard",
            60_000
          )
        ) {
          return;
        }

        void loadDashboard(
          true
        );
      }

      document.addEventListener(
        "visibilitychange",
        refreshWhenVisible
      );
      window.addEventListener(
        "focus",
        refreshWhenVisible
      );

      return () => {
        document.removeEventListener(
          "visibilitychange",
          refreshWhenVisible
        );
        window.removeEventListener(
          "focus",
          refreshWhenVisible
        );
      };
    },
    []
  );


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


  async function handleReconcileAccount(
    accountId: string
  ) {
    const account =
      dashboard?.accounts.find(
        item =>
          item.accountId ===
          accountId
      );

    if (
      !account
    ) {
      return;
    }

    const actualBalance =
      Number(
        reconcileInput.replace(
          /,/g,
          ""
        )
      );

    if (
      !Number.isFinite(
        actualBalance
      )
    ) {
      setReconcileError(
        "실제 잔액을 숫자로 입력해주세요."
      );
      return;
    }

    const difference =
      actualBalance -
      Number(
        account.currentBalance ||
        0
      );

    if (
      Math.abs(
        difference
      ) < 0.5
    ) {
      setReconcileAccountId(
        null
      );
      setReconcileInput("");
      setReconcileError("");
      return;
    }

    setReconcileSaving(
      true
    );
    setReconcileError("");

    try {
      await updateManagedAccount({
        accountId:
          account.accountId,
        accountName:
          account.accountName,
        accountType:
          account.accountType,
        subType:
          account.subType,
        owner:
          account.owner,
        openingBalance:
          Number(
            account.openingBalance ||
            0
          ) +
          difference,
        billingCutoffDay:
          account.billingCutoffDay,
        paymentDay:
          account.paymentDay,
        startYear:
          account.startYear,
        endYear:
          account.endYear,
        balanceMethod:
          account.balanceMethod,
        paymentAccountId:
          account.paymentAccountId,
        assetAttribution:
          account.assetAttribution
      });

      markLedgerChanged();
      await loadDashboard(
        true
      );

      setReconcileAccountId(
        null
      );
      setReconcileInput("");
    } catch (
      err
    ) {
      setReconcileError(
        err instanceof Error
          ? err.message
          : "잔액을 맞추지 못했습니다."
      );
    } finally {
      setReconcileSaving(
        false
      );
    }
  }


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


  const selectedCashAccount =
    cashLikeAccounts.find(
      account =>
        account.accountId ===
        selectedCashAccountId
    ) ||
    null;


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
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>자산</h1>
          <p className={styles.headerHint}>항목을 누르면 상세와 관리 기능이 열립니다.</p>
        </div>
        <button
          type="button"
          className={styles.addAccountButton}
          onClick={() => {
            setEditingAccountId(null);
            setCreatingAccount(true);
          }}
        >
          + 추가
        </button>
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
            <div className={styles.summaryHero}>
              <span className={styles.summaryHeroLabel}>순자산</span>
              <strong
                className={`${styles.summaryHeroValue} ${summary.netWorth < 0 ? styles.summaryHeroNegative : ""}`}
                title={formatCurrency(summary.netWorth)}
              >
                {formatCurrency(summary.netWorth)}
              </strong>

              <div className={styles.summarySecondary}>
                <div>
                  <span>총자산</span>
                  <strong title={formatCurrency(summary.assets)}>
                    {formatCurrency(summary.assets)}
                  </strong>
                </div>
                <div>
                  <span>총부채</span>
                  <strong title={formatCurrency(summary.liabilities)}>
                    {formatCurrency(summary.liabilities)}
                  </strong>
                </div>
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
          <h2 className={styles.sectionTitle}>현금성자산</h2>


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
                  합계
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
                  account => {
                    const isSelected =
                      selectedCashAccountId ===
                      account.accountId;

                    const difference =
                      isSelected &&
                      reconcileInput.trim()
                        ? Number(
                            reconcileInput.replace(
                              /,/g,
                              ""
                            )
                          ) -
                          Number(
                            account.currentBalance ||
                            0
                          )
                        : null;

                    return (
                      <Fragment
                        key={
                          account.accountId
                        }
                      >
                        <li>
                          <button
                            type="button"
                            className={[
                              styles.cashAccountRow,
                              isSelected
                                ? styles.cashAccountRowActive
                                : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={
                              () => {
                                setSelectedCashAccountId(
                                  isSelected
                                    ? null
                                    : account.accountId
                                );
                                setReconcileAccountId(
                                  null
                                );
                                setReconcileInput("");
                                setReconcileError("");
                              }
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
                                {[
                                  account.subType,
                                  account.owner
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
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
                          </button>
                        </li>

                        {
                          isSelected &&
                          selectedCashAccount && (
                            <li
                              className={
                                styles.cashDetailItem
                              }
                            >
                              <section
                                className={
                                  styles.cashDetailCard
                                }
                              >
                                <div
                                  className={
                                    styles.cashDetailHeader
                                  }
                                >
                                  <div>
                                    <span>
                                      {[
                                        selectedCashAccount.subType,
                                        selectedCashAccount.owner
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </span>
                                    <strong>
                                      {
                                        selectedCashAccount.displayName
                                      }
                                    </strong>
                                  </div>

                                  <button
                                    type="button"
                                    className={
                                      styles.editAccountButton
                                    }
                                    onClick={
                                      () =>
                                        setEditingAccountId(
                                          selectedCashAccount.accountId
                                        )
                                    }
                                  >
                                    편집
                                  </button>
                                </div>

                                <div
                                  className={
                                    styles.cashDetailMetrics
                                  }
                                >
                                  <div>
                                    <span>계산 잔액</span>
                                    <strong>
                                      {formatCurrency(
                                        selectedCashAccount.currentBalance
                                      )}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>시작 잔액</span>
                                    <strong>
                                      {formatCurrency(
                                        selectedCashAccount.openingBalance
                                      )}
                                    </strong>
                                  </div>
                                </div>

                                {
                                  reconcileAccountId !==
                                    selectedCashAccount.accountId ? (
                                    <button
                                      type="button"
                                      className={
                                        styles.reconcileButton
                                      }
                                      onClick={
                                        () => {
                                          setReconcileAccountId(
                                            selectedCashAccount.accountId
                                          );
                                          setReconcileInput(
                                            String(
                                              Math.round(
                                                selectedCashAccount.currentBalance
                                              )
                                            )
                                          );
                                          setReconcileError("");
                                        }
                                      }
                                    >
                                      실제 잔액과 맞추기
                                    </button>
                                  ) : (
                                    <div
                                      className={
                                        styles.reconcilePanel
                                      }
                                    >
                                      <label>
                                        <span>실제 잔액</span>
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          value={
                                            reconcileInput
                                          }
                                          onChange={
                                            event => {
                                              setReconcileInput(
                                                event.target.value
                                              );
                                              setReconcileError("");
                                            }
                                          }
                                        />
                                      </label>

                                      <p>
                                        차이 {
                                          difference ===
                                          null ||
                                          !Number.isFinite(
                                            difference
                                          )
                                            ? "-"
                                            : formatSignedCurrency(
                                                difference
                                              )
                                        }
                                      </p>
                                      <small>
                                        거래 내역은 건드리지 않고 시작 잔액을 차이만큼 조정합니다.
                                      </small>

                                      {
                                        reconcileError && (
                                          <p
                                            className={
                                              styles.error
                                            }
                                          >
                                            {reconcileError}
                                          </p>
                                        )
                                      }

                                      <div
                                        className={
                                          styles.reconcileActions
                                        }
                                      >
                                        <button
                                          type="button"
                                          onClick={
                                            () => {
                                              setReconcileAccountId(
                                                null
                                              );
                                              setReconcileError("");
                                            }
                                          }
                                        >
                                          취소
                                        </button>
                                        <button
                                          type="button"
                                          disabled={
                                            reconcileSaving
                                          }
                                          onClick={
                                            () =>
                                              void handleReconcileAccount(
                                                selectedCashAccount.accountId
                                              )
                                          }
                                        >
                                          {
                                            reconcileSaving
                                              ? "저장 중"
                                              : "맞추기"
                                          }
                                        </button>
                                      </div>
                                    </div>
                                  )
                                }
                              </section>
                            </li>
                          )
                        }
                      </Fragment>
                    );
                  }
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
                    합계
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
                                {[
                                  account.subType,
                                  account.owner,
                                  `${holdingCount}종목`
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
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
                                    {[
                                      "투자계좌",
                                      selectedAccount.owner
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
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


                                <div
                                  className={
                                    styles.detailHeaderActions
                                  }
                                >
                                  <strong
                                    className={
                                      styles.detailTotal
                                    }
                                  >
                                    {formatCurrency(
                                      selectedAccount.accountValueKrw
                                    )}
                                  </strong>

                                  <button
                                    type="button"
                                    className={
                                      styles.editAccountButton
                                    }
                                    onClick={
                                      () =>
                                        setEditingAccountId(
                                          selectedAccount.accountId
                                        )
                                    }
                                  >
                                    편집
                                  </button>
                                </div>
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

      {
        (editingAccountId || creatingAccount) && (
          <div
            className={
              styles.editorBackdrop
            }
            role="presentation"
            onClick={
              () => {
                setEditingAccountId(
                  null
                );
                setCreatingAccount(
                  false
                );
              }
            }
          >
            <section
              className={
                styles.editorSheet
              }
              role="dialog"
              aria-modal="true"
              aria-label="계좌 편집"
              onClick={
                event =>
                  event.stopPropagation()
              }
            >
              <AccountSettings
                initialAccountId={
                  editingAccountId || undefined
                }
                createNew={
                  creatingAccount
                }
                initialOwner={
                  userName
                }
                embedded
                onClose={
                  () => {
                    setEditingAccountId(
                      null
                    );
                    setCreatingAccount(
                      false
                    );
                  }
                }
                onSaved={
                  async () => {
                    markLedgerChanged();
                    await loadDashboard(
                      true
                    );
                  }
                }
              />
            </section>
          </div>
        )
      }
    </main>
  );
}
