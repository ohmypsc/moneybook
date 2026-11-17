import { useEffect, useState } from "react";

import type { User } from "../../types/api";
import {
  getPendingTransactions,
  startPendingTransactionQueue,
  stopPendingTransactionQueue,
  subscribePendingTransactions
} from "../../utils/pendingTransactionQueue";

/**
 * 로그인된 동안 오프라인 저장 대기열을 돌리고,
 * 하단 입력 버튼에 표시할 대기·실패 건수를 돌려줍니다.
 */
export function usePendingTransactionSummary(status: string, user: User | null) {
  const [summary, setSummary] = useState({ total: 0, failed: 0 });

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      stopPendingTransactionQueue();
      setSummary({ total: 0, failed: 0 });
      return;
    }

    startPendingTransactionQueue(user.name);

    const updateSummary = () => {
      const pendingTransactions = getPendingTransactions(user.name);
      setSummary({
        total: pendingTransactions.length,
        failed: pendingTransactions.filter(transaction => transaction.status === "failed").length
      });
    };

    updateSummary();
    const unsubscribe = subscribePendingTransactions(updateSummary);

    return () => {
      unsubscribe();
      stopPendingTransactionQueue(user.name);
    };
  }, [status, user]);

  return summary;
}
