import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  deleteInvestmentTrade,
  getInvestmentTrades,
  updateInvestmentTrade
} from "../../../api/investments";

import type {
  InvestmentTrade
} from "../../../types/investment";

import styles
  from "./InvestmentTradeHistory.module.css";


interface InvestmentTradeHistoryProps {
  accountId: string;
  refreshKey?: number;

  onChanged?:
    () =>
      void |
      Promise<void>;
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


function formatQuantity(
  value: number
) {
  return value.toLocaleString(
    "ko-KR",
    {
      maximumFractionDigits: 8
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
        maximumFractionDigits: 8
      }
    );

  if (
    !trade.currency ||
    trade.currency === "KRW"
  ) {
    return `${formatted}원`;
  }

  return (
    `${formatted} ${trade.currency}`
  );
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
    useState(false);

  const [
    error,
    setError
  ] =
    useState("");

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


  async function loadTrades() {
    setLoading(true);
    setError("");

    try {
      const data =
        await getInvestmentTrades({
          accountId
        });

      setTrades(
        Array.isArray(
          data.items
        )
          ? data.items
          : []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "투자 거래내역을 불러오지 못했습니다."
      );

      setTrades([]);
    } finally {
      setLoading(false);
    }
  }


  useEffect(
    () => {
      setEditingTradeId(
        null
      );

      setActionError("");

      void loadTrades();
    },
    [
      accountId,
      refreshKey
    ]
  );


  const orderedTrades =
    useMemo(
      () =>
        [...trades].sort(
          (
            a,
            b
          ) => {
            const dateCompare =
              b.date.localeCompare(
                a.date
              );

            if (
              dateCompare !== 0
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


  function beginEdit(
    trade:
      InvestmentTrade
  ) {
    setActionError("");

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

    setEditSettlementKrw(
      String(
        trade.settlementKrw
      )
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

    setActionError("");
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
    setActionError("");

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
      quantity <= 0
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
      unitPrice <= 0
    ) {
      setActionError(
        "체결단가는 0보다 큰 숫자로 입력해주세요."
      );

      return;
    }


    const settlementText =
      editSettlementKrw.trim();

    const settlementKrw =
      settlementText === ""
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
        settlementKrw <= 0
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


    const payload: {
      investmentTradeId:
        string;

      date?: string;

      quantity?:
        number;

      unitPrice?:
        number;

      settlementKrw?:
        number;

      memo?: string;
    } = {
      investmentTradeId:
        trade.investmentTradeId
    };


    if (
      editDate !==
      trade.date
    ) {
      payload.date =
        editDate;
    }


    if (
      quantity !==
      trade.quantity
    ) {
      payload.quantity =
        quantity;
    }


    if (
      unitPrice !==
      trade.unitPrice
    ) {
      payload.unitPrice =
        unitPrice;
    }


    if (
      settlementKrw !==
        null &&
      settlementKrw !==
        trade.settlementKrw
    ) {
      payload.settlementKrw =
        settlementKrw;
    }


    const trimmedMemo =
      editMemo.trim();

    if (
      trimmedMemo !==
      (trade.memo ?? "")
    ) {
      payload.memo =
        trimmedMemo;
    }


    if (
      Object.keys(
        payload
      ).length === 1
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
    } catch (err) {
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
    setActionError("");

    const label =
      trade.stockName ||
      trade.stockCode;

    const confirmed =
      window.confirm(
        [
          `${label} ${trade.tradeType} 거래를 삭제할까요?`,
          "",
          "삭제하면 보유수량, 평단 및 예수금이 다시 계산됩니다."
        ].join("\n")
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
    } catch (err) {
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
          거래내역
        </span>

        <span
          className={
            styles.summaryCount
          }
        >
          {loading
            ? "불러오는 중"
            : `${orderedTrades.length}건`}
        </span>
      </summary>


      <div
        className={
          styles.body
        }
      >
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
          orderedTrades.length ===
            0 && (
            <p
              className={
                styles.state
              }
            >
              아직 등록된 투자 거래가 없습니다.
            </p>
          )}


        {!loading &&
          !error &&
          orderedTrades.length >
            0 && (
            <ul
              className={
                styles.list
              }
            >
              {orderedTrades.map(
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


                  return (
                    <li
                      key={
                        trade.investmentTradeId
                      }
                      className={
                        styles.row
                      }
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


                      {!isEditing && (
                        <div
                          className={
                            styles.rowActions
                          }
                        >
                          <button
                            type="button"
                            className={
                              styles.editButton
                            }
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
                          </button>

                          <button
                            type="button"
                            className={
                              styles.deleteButton
                            }
                            onClick={
                              () =>
                                void handleDelete(
                                  trade
                                )
                            }
                            disabled={
                              isDeleting
                            }
                          >
                            {isDeleting
                              ? "삭제 중..."
                              : "삭제"}
                          </button>
                        </div>
                      )}


                      {isEditing && (
                        <div
                          className={
                            styles.editPanel
                          }
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
                                {" "}
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
                            수량이나 체결단가를 바꾸면 기존 실제 결제금액은
                            자동으로 비워집니다. 실제 금액을 모르면 그대로
                            비워두면 서버에서 다시 계산합니다.
                          </p>


                          <div
                            className={
                              styles.editActions
                            }
                          >
                            <button
                              type="button"
                              className={
                                styles.cancelButton
                              }
                              onClick={
                                cancelEdit
                              }
                              disabled={
                                isSaving
                              }
                            >
                              취소
                            </button>

                            <button
                              type="button"
                              className={
                                styles.saveButton
                              }
                              onClick={
                                () =>
                                  void handleSaveEdit(
                                    trade
                                  )
                              }
                              disabled={
                                isSaving
                              }
                            >
                              {isSaving
                                ? "저장 중..."
                                : "수정 저장"}
                            </button>
                          </div>
                        </div>
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
