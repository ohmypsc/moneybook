import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  getInvestmentTrades
} from "../../../api/investments";

import type {
  InvestmentTrade
} from "../../../types/investment";

import styles
  from "./InvestmentTradeHistory.module.css";


interface InvestmentTradeHistoryProps {
  accountId: string;
  refreshKey?: number;
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
  trade: InvestmentTrade
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
  refreshKey = 0
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


  useEffect(
    () => {
      let cancelled =
        false;

      async function loadTrades() {
        setLoading(true);
        setError("");

        try {
          const data =
            await getInvestmentTrades({
              accountId
            });

          if (
            cancelled
          ) {
            return;
          }

          setTrades(
            Array.isArray(
              data.items
            )
              ? data.items
              : []
          );
        } catch (err) {
          if (
            cancelled
          ) {
            return;
          }

          setError(
            err instanceof Error
              ? err.message
              : "투자 거래내역을 불러오지 못했습니다."
          );

          setTrades([]);
        } finally {
          if (
            !cancelled
          ) {
            setLoading(false);
          }
        }
      }

      void loadTrades();

      return () => {
        cancelled =
          true;
      };
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
          (a, b) => {
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


                      {trade.memo && (
                        <p
                          className={
                            styles.memo
                          }
                        >
                          {trade.memo}
                        </p>
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
