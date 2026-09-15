import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  deleteInvestmentTrade,
  getInvestmentTrades,
  restoreInvestmentTrade,
  updateInvestmentTrade
} from "../../../api/investments";

import type {
  InvestmentTrade
} from "../../../types/investment";

import { Button } from "../../common/Button/Button";
import { Card } from "../../common/Card/Card";
import { formatMoney } from "../../common/Money/Money";

import styles
  from "./InvestmentTradeHistory.module.css";


interface InvestmentTradeHistoryProps {
  accountId:
    string;

  refreshKey?:
    number;

  onChanged?:
    () =>
      void |
      Promise<void>;
}


type TradeFilter =
  | "전체"
  | "매수"
  | "매도";


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

  return formatMoney(value);
}


function formatSignedCurrency(
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

  return formatMoney(value, { showPlus: true });
}

function formatQuantity(
  value:
    number
) {
  return value.toLocaleString(
    "ko-KR",
    {
      maximumFractionDigits:
        8
    }
  );
}


function formatUnitPrice(
  trade:
    InvestmentTrade
) {
  const formatted =
    trade.unitPrice.toLocaleString(
      "ko-KR",
      {
        maximumFractionDigits:
          8
      }
    );

  if (
    !trade.currency ||
    trade.currency ===
      "KRW"
  ) {
    return (
      `${formatted}원`
    );
  }

  return (
    `${formatted} ${trade.currency}`
  );
}


function getAutomaticSettlement(
  trade: InvestmentTrade
) {
  const gross =
    Number(trade.quantity || 0) *
    Number(trade.unitPrice || 0) *
    Number(trade.fxRate || 1);

  const fee = Number(trade.feeKrw || 0);
  const tax = Number(trade.taxKrw || 0);

  return trade.tradeType === "매수"
    ? gross + fee + tax
    : gross - fee - tax;
}


function hasCustomSettlement(
  trade: InvestmentTrade
) {
  return Math.abs(
    Number(trade.settlementKrw || 0) -
    getAutomaticSettlement(trade)
  ) >= 0.5;
}


export default function InvestmentTradeHistory({
  accountId,
  refreshKey = 0,
  onChanged
}: InvestmentTradeHistoryProps) {
  const [
    trades,
    setTrades
  ] =
    useState<
      InvestmentTrade[]
    >([]);

  const [
    loading,
    setLoading
  ] =
    useState(
      false
    );

  const [
    error,
    setError
  ] =
    useState("");

  const [
    tradeFilter,
    setTradeFilter
  ] =
    useState<TradeFilter>(
      "전체"
    );

  const [
    showDeleted,
    setShowDeleted
  ] =
    useState(
      false
    );

  const [
    editingTradeId,
    setEditingTradeId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    editDate,
    setEditDate
  ] =
    useState("");

  const [
    editQuantity,
    setEditQuantity
  ] =
    useState("");

  const [
    editUnitPrice,
    setEditUnitPrice
  ] =
    useState("");

  const [
    editFxRate,
    setEditFxRate
  ] =
    useState("");

  const [
    editFeeKrw,
    setEditFeeKrw
  ] =
    useState("");

  const [
    editTaxKrw,
    setEditTaxKrw
  ] =
    useState("");

  const [
    editSettlementKrw,
    setEditSettlementKrw
  ] =
    useState("");

  const [
    editMemo,
    setEditMemo
  ] =
    useState("");

  const [
    actionError,
    setActionError
  ] =
    useState("");

  const [
    savingId,
    setSavingId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    deletingId,
    setDeletingId
  ] =
    useState<
      string |
      null
    >(null);

  const [
    restoringId,
    setRestoringId
  ] =
    useState<
      string |
      null
    >(null);


  async function loadTrades() {
    setLoading(
      true
    );

    setError(
      ""
    );

    try {
      const data =
        await getInvestmentTrades({
          accountId,

          includeDeleted:
            showDeleted
        });


      setTrades(
        Array.isArray(
          data.items
        )
          ? data.items
          : []
      );
    } catch (
      err
    ) {
      setError(
        err instanceof Error
          ? err.message
          : "투자 거래내역을 불러오지 못했습니다."
      );

      setTrades(
        []
      );
    } finally {
      setLoading(
        false
      );
    }
  }


  useEffect(
    () => {
      setEditingTradeId(
        null
      );

      setActionError(
        ""
      );

      void loadTrades();
    },
    [
      accountId,
      refreshKey,
      showDeleted
    ]
  );


  const orderedTrades =
    useMemo(
      () =>
        [
          ...trades
        ].sort(
          (
            a,
            b
          ) => {
            const dateCompare =
              b.date.localeCompare(
                a.date
              );


            if (
              dateCompare !==
              0
            ) {
              return dateCompare;
            }


            return (
              (
                b.createdAt ??
                ""
              ).localeCompare(
                a.createdAt ??
                ""
              )
            );
          }
        ),
      [
        trades
      ]
    );


  const visibleTrades =
    useMemo(
      () => {
        if (
          tradeFilter ===
          "전체"
        ) {
          return orderedTrades;
        }


        return orderedTrades.filter(
          trade =>
            trade.tradeType ===
            tradeFilter
        );
      },
      [
        orderedTrades,
        tradeFilter
      ]
    );


  function beginEdit(
    trade:
      InvestmentTrade
  ) {
    if (
      trade.isDeleted
    ) {
      return;
    }


    setActionError(
      ""
    );

    setEditingTradeId(
      trade.investmentTradeId
    );

    setEditDate(
      trade.date
    );

    setEditQuantity(
      String(
        trade.quantity
      )
    );

    setEditUnitPrice(
      String(
        trade.unitPrice
      )
    );

    setEditFxRate(
      trade.currency === "KRW"
        ? ""
        : String(trade.fxRate || "")
    );

    setEditFeeKrw(
      trade.feeKrw > 0
        ? String(trade.feeKrw)
        : ""
    );

    setEditTaxKrw(
      trade.taxKrw > 0
        ? String(trade.taxKrw)
        : ""
    );

    setEditSettlementKrw(
      hasCustomSettlement(trade)
        ? String(trade.settlementKrw)
        : ""
    );

    setEditMemo(
      trade.memo ??
      ""
    );
  }


  function cancelEdit() {
    setEditingTradeId(
      null
    );

    setActionError(
      ""
    );
  }


  async function notifyChanged() {
    if (
      onChanged
    ) {
      await onChanged();

      return;
    }


    await loadTrades();
  }


  async function handleSaveEdit(
    trade:
      InvestmentTrade
  ) {
    setActionError(
      ""
    );


    if (
      !editDate
    ) {
      setActionError(
        "거래일을 입력해주세요."
      );

      return;
    }


    const quantity =
      Number(
        editQuantity
      );


    if (
      !Number.isFinite(
        quantity
      ) ||
      quantity <=
        0
    ) {
      setActionError(
        "수량은 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    const unitPrice =
      Number(
        editUnitPrice
      );


    if (
      !Number.isFinite(
        unitPrice
      ) ||
      unitPrice <=
        0
    ) {
      setActionError(
        "체결단가는 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    const fxRate =
      trade.currency === "KRW"
        ? 1
        : Number(editFxRate);

    if (
      trade.currency !== "KRW" &&
      (
        !Number.isFinite(fxRate) ||
        fxRate <= 0
      )
    ) {
      setActionError(
        "해외주식 체결환율은 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    const feeKrw =
      editFeeKrw.trim() === ""
        ? 0
        : Number(editFeeKrw);

    if (
      !Number.isFinite(feeKrw) ||
      feeKrw < 0
    ) {
      setActionError(
        "수수료는 0 이상의 숫자로 입력해주세요."
      );

      return;
    }


    const taxKrw =
      editTaxKrw.trim() === ""
        ? 0
        : Number(editTaxKrw);

    if (
      !Number.isFinite(taxKrw) ||
      taxKrw < 0
    ) {
      setActionError(
        "세금은 0 이상의 숫자로 입력해주세요."
      );

      return;
    }


    const settlementText =
      editSettlementKrw.trim();


    const settlementKrw =
      settlementText ===
      ""
        ? null
        : Number(
            settlementText
          );


    if (
      settlementKrw !==
        null &&
      (
        !Number.isFinite(
          settlementKrw
        ) ||
        settlementKrw <=
          0
      )
    ) {
      setActionError(
        trade.tradeType ===
        "매수"
          ? "실제 결제금액은 0보다 큰 숫자로 입력해주세요."
          : "실제 입금금액은 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    const dateChanged =
      editDate !==
      trade.date;

    const quantityChanged =
      quantity !==
      trade.quantity;

    const unitPriceChanged =
      unitPrice !==
      trade.unitPrice;

    const fxRateChanged =
      fxRate !==
      trade.fxRate;

    const feeChanged =
      feeKrw !==
      trade.feeKrw;

    const taxChanged =
      taxKrw !==
      trade.taxKrw;

    const memoChanged =
      editMemo.trim() !==
      (
        trade.memo ??
        ""
      );


    const payload: {
      investmentTradeId:
        string;

      expectedUpdatedAtMs:
        number |
        null;

      date?:
        string;

      quantity?:
        number;

      unitPrice?:
        number;

      fxRate?:
        number;

      feeKrw?:
        number;

      taxKrw?:
        number;

      settlementKrw?:
        number;

      memo?:
        string;
    } = {
      investmentTradeId:
        trade.investmentTradeId,

      expectedUpdatedAtMs:
        trade.updatedAtMs ??
        null
    };


    if (
      dateChanged
    ) {
      payload.date =
        editDate;
    }


    if (
      quantityChanged
    ) {
      payload.quantity =
        quantity;
    }


    if (
      unitPriceChanged
    ) {
      payload.unitPrice =
        unitPrice;
    }


    if (
      fxRateChanged
    ) {
      payload.fxRate =
        fxRate;
    }


    if (
      feeChanged
    ) {
      payload.feeKrw =
        feeKrw;
    }


    if (
      taxChanged
    ) {
      payload.taxKrw =
        taxKrw;
    }


    /*
     * 수량 또는 단가를 변경했는데
     * 실제 결제금액을 비워두었다면
     * settlementKrw를 보내지 않습니다.
     *
     * 그러면 서버가 수량 × 단가 × 환율을
     * 기준으로 다시 계산합니다.
     */
    if (
      settlementKrw !==
      null &&
      (
        settlementKrw !==
          trade.settlementKrw ||
        quantityChanged ||
        unitPriceChanged ||
        fxRateChanged ||
        feeChanged ||
        taxChanged
      )
    ) {
      payload.settlementKrw =
        settlementKrw;
    }


    if (
      memoChanged
    ) {
      payload.memo =
        editMemo.trim();
    }


    if (
      Object.keys(
        payload
      ).length ===
      2
    ) {
      setEditingTradeId(
        null
      );

      return;
    }


    setSavingId(
      trade.investmentTradeId
    );


    try {
      await updateInvestmentTrade(
        payload
      );


      setEditingTradeId(
        null
      );


      await notifyChanged();
    } catch (
      err
    ) {
      setActionError(
        err instanceof Error
          ? err.message
          : "투자거래 수정에 실패했습니다."
      );
    } finally {
      setSavingId(
        null
      );
    }
  }


  async function handleDelete(
    trade:
      InvestmentTrade
  ) {
    setActionError(
      ""
    );


    const label =
      trade.stockName ||
      trade.stockCode;


    const confirmed =
      window.confirm(
        [
          `${label} ${trade.tradeType} 거래를 삭제할까요?`,
          "",
          "삭제하면 보유수량, 평단 및 예수금이 다시 계산됩니다."
        ].join(
          "\n"
        )
      );


    if (
      !confirmed
    ) {
      return;
    }


    setDeletingId(
      trade.investmentTradeId
    );


    try {
      await deleteInvestmentTrade(
        trade.investmentTradeId
      );


      if (
        editingTradeId ===
        trade.investmentTradeId
      ) {
        setEditingTradeId(
          null
        );
      }


      await notifyChanged();
    } catch (
      err
    ) {
      setActionError(
        err instanceof Error
          ? err.message
          : "투자거래 삭제에 실패했습니다."
      );
    } finally {
      setDeletingId(
        null
      );
    }
  }


  async function handleRestore(
    trade:
      InvestmentTrade
  ) {
    setActionError(
      ""
    );


    const label =
      trade.stockName ||
      trade.stockCode;


    const confirmed =
      window.confirm(
        [
          `${label} ${trade.tradeType} 거래를 복원할까요?`,
          "",
          "복원하면 보유수량, 평단 및 예수금이 다시 계산됩니다."
        ].join(
          "\n"
        )
      );


    if (
      !confirmed
    ) {
      return;
    }


    setRestoringId(
      trade.investmentTradeId
    );


    try {
      await restoreInvestmentTrade(
        trade.investmentTradeId
      );


      await notifyChanged();
    } catch (
      err
    ) {
      setActionError(
        err instanceof Error
          ? err.message
          : "투자거래 복원에 실패했습니다."
      );
    } finally {
      setRestoringId(
        null
      );
    }
  }


  return (
    <details
      className={
        styles.history
      }
    >
      <summary
        className={
          styles.summary
        }
      >
        <span
          className={
            styles.summaryTitle
          }
        >
          거래내역 · 수정/수수료 보정
        </span>


        <span
          className={
            styles.summaryCount
          }
        >
          {loading
            ? "불러오는 중"
            : tradeFilter ===
                "전체"
              ? `${visibleTrades.length}건`
              : `${visibleTrades.length}/${orderedTrades.length}건`}
        </span>
      </summary>


      <div
        className={
          styles.body
        }
      >
        <div
          className={
            styles.controls
          }
        >
          <div
            className={
              styles.filters
            }
          >
            {(
              [
                "전체",
                "매수",
                "매도"
              ] as TradeFilter[]
            ).map(
              value => (
                <button
                  key={
                    value
                  }
                  type="button"
                  className={[
                    styles.filterButton,

                    tradeFilter ===
                    value
                      ? styles.filterButtonActive
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
                      setTradeFilter(
                        value
                      )
                  }
                >
                  {value}
                </button>
              )
            )}
          </div>


          <label
            className={
              styles.deletedToggle
            }
          >
            <input
              type="checkbox"
              checked={
                showDeleted
              }
              onChange={
                event => {
                  setActionError(
                    ""
                  );

                  setShowDeleted(
                    event.target.checked
                  );
                }
              }
            />

            <span>
              삭제된 거래 포함
            </span>
          </label>
        </div>


        {actionError && (
          <p
            className={
              styles.error
            }
          >
            {actionError}
          </p>
        )}


        {loading && (
          <p
            className={
              styles.state
            }
          >
            거래내역을 불러오는 중입니다.
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
          visibleTrades.length ===
            0 && (
            <p
              className={
                styles.state
              }
            >
              표시할 투자 거래가 없습니다.
            </p>
          )}


        {!loading &&
          !error &&
          visibleTrades.length >
            0 && (
            <ul
              className={
                styles.list
              }
            >
              {visibleTrades.map(
                trade => {
                  const isBuy =
                    trade.tradeType ===
                    "매수";


                  const isEditing =
                    editingTradeId ===
                    trade.investmentTradeId;


                  const isSaving =
                    savingId ===
                    trade.investmentTradeId;


                  const isDeleting =
                    deletingId ===
                    trade.investmentTradeId;


                  const isRestoring =
                    restoringId ===
                    trade.investmentTradeId;


                  return (
                    <li
                      key={
                        trade.investmentTradeId
                      }
                      className={[
                        styles.row,

                        trade.isDeleted
                          ? styles.deletedRow
                          : ""
                      ]
                        .filter(
                          Boolean
                        )
                        .join(
                          " "
                        )}
                    >
                      <div
                        className={
                          styles.rowTop
                        }
                      >
                        <div
                          className={
                            styles.stockGroup
                          }
                        >
                          <strong
                            className={
                              styles.stockName
                            }
                          >
                            {trade.stockName ||
                              trade.stockCode}
                          </strong>


                          <span
                            className={[
                              styles.tradeType,

                              isBuy
                                ? styles.buy
                                : styles.sell
                            ]
                              .filter(
                                Boolean
                              )
                              .join(
                                " "
                              )}
                          >
                            {
                              trade.tradeType
                            }
                          </span>


                          {trade.isDeleted && (
                            <span
                              className={
                                styles.deletedBadge
                              }
                            >
                              삭제됨
                            </span>
                          )}
                        </div>


                        <strong
                          className={
                            styles.settlement
                          }
                        >
                          {isBuy
                            ? "-"
                            : "+"}

                          {formatCurrency(
                            trade.settlementKrw
                          )}
                        </strong>
                      </div>


                      <p
                        className={
                          styles.meta
                        }
                      >
                        {trade.date}
                        {" · "}
                        {formatQuantity(
                          trade.quantity
                        )}
                        주
                        {" · "}
                        {formatUnitPrice(
                          trade
                        )}
                      </p>


                      {(trade.feeKrw > 0 || trade.taxKrw > 0) && (
                        <p className={styles.meta}>
                          수수료 {formatCurrency(trade.feeKrw)}
                          {trade.taxKrw > 0 && (
                            <>
                              {" · "}
                              세금 {formatCurrency(trade.taxKrw)}
                            </>
                          )}
                        </p>
                      )}


                      {trade.tradeType ===
                        "매도" &&
                        trade.realizedPnlKrw !==
                          0 && (
                          <p
                            className={
                              styles.pnl
                            }
                          >
                            실현손익{" "}
                            {formatSignedCurrency(
                              trade.realizedPnlKrw
                            )}
                          </p>
                        )}


                      {trade.memo &&
                        !isEditing && (
                          <p
                            className={
                              styles.memo
                            }
                          >
                            {trade.memo}
                          </p>
                        )}


                      {!isEditing &&
                        !trade.isDeleted && (
                          <div
                            className={
                              styles.rowActions
                            }
                          >
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={
                                () =>
                                  beginEdit(
                                    trade
                                  )
                              }
                              disabled={
                                isDeleting
                              }
                            >
                              수정
                            </Button>


                            <Button
                              variant="dangerSoft"
                              size="sm"
                              loading={isDeleting}
                              loadingLabel="삭제 중..."
                              onClick={
                                () =>
                                  void handleDelete(
                                    trade
                                  )
                              }
                            >
                              삭제
                            </Button>
                          </div>
                        )}


                      {trade.isDeleted && (
                        <div
                          className={
                            styles.rowActions
                          }
                        >
                          <Button
                            variant="soft"
                            size="sm"
                            loading={isRestoring}
                            loadingLabel="복원 중..."
                            onClick={
                              () =>
                                void handleRestore(
                                  trade
                                )
                            }
                          >
                            거래 복원
                          </Button>
                        </div>
                      )}


                      {isEditing &&
                        !trade.isDeleted && (
                          <Card
                            padding="sm"
                            tone="soft"
                            shadow="none"
                            className={styles.editPanel}
                          >
                            <div
                              className={
                                styles.editGrid
                              }
                            >
                              <label
                                className={
                                  styles.editField
                                }
                              >
                                <span
                                  className={
                                    styles.editLabel
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
                                    editDate
                                  }
                                  onChange={
                                    event =>
                                      setEditDate(
                                        event.target.value
                                      )
                                  }
                                />
                              </label>


                              <label
                                className={
                                  styles.editField
                                }
                              >
                                <span
                                  className={
                                    styles.editLabel
                                  }
                                >
                                  수량
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
                                    editQuantity
                                  }
                                  onChange={
                                    event => {
                                      const value =
                                        event.target.value;

                                      setEditQuantity(
                                        value
                                      );

                                      if (
                                        value !==
                                        String(
                                          trade.quantity
                                        )
                                      ) {
                                        setEditSettlementKrw(
                                          ""
                                        );
                                      }
                                    }
                                  }
                                />
                              </label>


                              <label
                                className={
                                  styles.editField
                                }
                              >
                                <span
                                  className={
                                    styles.editLabel
                                  }
                                >
                                  체결단가
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
                                    editUnitPrice
                                  }
                                  onChange={
                                    event => {
                                      const value =
                                        event.target.value;

                                      setEditUnitPrice(
                                        value
                                      );

                                      if (
                                        value !==
                                        String(
                                          trade.unitPrice
                                        )
                                      ) {
                                        setEditSettlementKrw(
                                          ""
                                        );
                                      }
                                    }
                                  }
                                />
                              </label>


                              {trade.currency !== "KRW" && (
                                <label className={styles.editField}>
                                  <span className={styles.editLabel}>
                                    체결환율
                                  </span>

                                  <input
                                    className={styles.input}
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="any"
                                    value={editFxRate}
                                    onChange={event => {
                                      setEditFxRate(event.target.value);
                                      setEditSettlementKrw("");
                                    }}
                                  />
                                </label>
                              )}


                              <label className={styles.editField}>
                                <span className={styles.editLabel}>
                                  수수료
                                  <span className={styles.optional}>선택</span>
                                </span>

                                <input
                                  className={styles.input}
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  step="1"
                                  value={editFeeKrw}
                                  onChange={event =>
                                    setEditFeeKrw(event.target.value)
                                  }
                                  placeholder="0"
                                />
                              </label>


                              <label className={styles.editField}>
                                <span className={styles.editLabel}>
                                  세금 · 제세금
                                  <span className={styles.optional}>선택</span>
                                </span>

                                <input
                                  className={styles.input}
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  step="1"
                                  value={editTaxKrw}
                                  onChange={event =>
                                    setEditTaxKrw(event.target.value)
                                  }
                                  placeholder="0"
                                />
                              </label>


                              <label
                                className={
                                  styles.editField
                                }
                              >
                                <span
                                  className={
                                    styles.editLabel
                                  }
                                >
                                  {isBuy
                                    ? "실제 결제금액"
                                    : "실제 입금금액"}

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
                                  inputMode="decimal"
                                  min="0"
                                  step="any"
                                  value={
                                    editSettlementKrw
                                  }
                                  onChange={
                                    event =>
                                      setEditSettlementKrw(
                                        event.target.value
                                      )
                                  }
                                  placeholder="비워두면 자동 계산"
                                />
                              </label>
                            </div>


                            <label
                              className={
                                styles.editField
                              }
                            >
                              <span
                                className={
                                  styles.editLabel
                                }
                              >
                                메모
                              </span>

                              <textarea
                                className={
                                  styles.textarea
                                }
                                value={
                                  editMemo
                                }
                                onChange={
                                  event =>
                                    setEditMemo(
                                      event.target.value
                                    )
                                }
                                rows={
                                  2
                                }
                              />
                            </label>


                            <p
                              className={
                                styles.editHelper
                              }
                            >
                              수량·체결단가·환율·수수료·세금을 수정할 수 있습니다.
                              실제 결제금액을 따로 확인하지 못했다면 비워두세요.
                              입력한 값으로 결제금액과 예수금, 평단, 실현손익을 다시 계산합니다.
                            </p>


                            <div
                              className={
                                styles.editActions
                              }
                            >
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={
                                  cancelEdit
                                }
                                disabled={
                                  isSaving
                                }
                              >
                                취소
                              </Button>


                              <Button
                                size="sm"
                                loading={isSaving}
                                loadingLabel="저장 중..."
                                onClick={
                                  () =>
                                    void handleSaveEdit(
                                      trade
                                    )
                                }
                              >
                                수정 저장
                              </Button>
                            </div>
                          </Card>
                        )}
                    </li>
                  );
                }
              )}
            </ul>
          )}
      </div>
    </details>
  );
}
