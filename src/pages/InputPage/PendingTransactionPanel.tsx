import { useState } from "react";
import { Button } from "../../components/common/Button/Button";
import { confirmAction } from "../../utils/confirmAction";
import {
  discardPendingTransaction,
  retryAllFailedPendingTransactions,
  retryPendingTransaction,
  type PendingTransactionRecord
} from "../../utils/pendingTransactionQueue";
import styles from "./InputPage.module.css";

interface PendingTransactionPanelProps {
  userName: string;
  savingCount: number;
  waitingCount: number;
  failedTransactions: PendingTransactionRecord[];
  onEditFailed: (item: PendingTransactionRecord) => Promise<void> | void;
}

export function PendingTransactionPanel({
  userName,
  savingCount,
  waitingCount,
  failedTransactions,
  onEditFailed
}: PendingTransactionPanelProps) {
  const [showAll, setShowAll] = useState(false);
  return (
    <>
      {waitingCount > 0 && (
        <div className={styles.queueStatus} role="status">
          <strong>기기에 보관됨 · {waitingCount}건</strong>
          <span>서버 전송을 기다리고 있어요. 오프라인이면 연결 후 자동으로 저장합니다.</span>
        </div>
      )}
      {savingCount > 0 && (
        <div className={styles.queueStatus} role="status">
          <strong>저장 중 · {savingCount}건</strong>
          <span>입력은 계속할 수 있어요. 서버 확인 후 완료됩니다.</span>
        </div>
      )}

      {failedTransactions.length > 0 && (
        <div className={styles.queueFailure} role="alert">
          <div className={styles.queueFailureHeader}>
            <strong>저장 실패 · {failedTransactions.length}건</strong>

            {failedTransactions.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => retryAllFailedPendingTransactions(userName)}
              >
                모두 다시 시도
              </Button>
            )}
          </div>

          {failedTransactions.length > 3 && (
            <Button variant="secondary" size="sm" onClick={() => setShowAll(value => !value)}>
              {showAll ? "접기" : `실패 내역 전체 ${failedTransactions.length}건 보기`}
            </Button>
          )}
          {(showAll ? failedTransactions : failedTransactions.slice(0, 3)).map(item => (
            <div key={item.id} className={styles.queueFailureItem}>
              <div>
                <span className={styles.queueFailureLabel}>{item.label}</span>
                <span className={styles.queueFailureMessage}>
                  {item.failureKind === "network"
                    ? "인터넷 연결이 돌아오면 자동으로 다시 저장합니다."
                    : item.error}
                </span>
              </div>

              <div className={styles.queueFailureActions}>
                {item.failureKind !== "network" && (
                  <Button variant="secondary" size="sm" onClick={() => void onEditFailed(item)}>
                    수정
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => retryPendingTransaction(userName, item.id)}
                >
                  다시 시도
                </Button>

                <Button
                  variant="dangerSoft"
                  size="sm"
                  onClick={() => {
                    void (async () => {
                      const confirmed = await confirmAction({
                        title: "저장 실패 항목 삭제",
                        message: "이 저장 실패 항목을 대기열에서 삭제할까요?",
                        confirmLabel: "삭제",
                        tone: "danger"
                      });

                      if (confirmed) {
                        discardPendingTransaction(userName, item.id);
                      }
                    })();
                  }}
                >
                  삭제
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
