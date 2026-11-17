import { useEffect, useState } from "react";

import { processRecurringTransactions } from "../../api/automation";
import { invalidateDashboardCache } from "../../api/dashboard";
import type { User } from "../../types/api";
import { markLedgerChanged } from "../../utils/ledgerEvents";
import { startRealtimeSync } from "../../utils/realtimeSync";

/** 이 종류가 바뀌면 설정 화면이 데이터를 다시 불러와야 합니다. */
const SETTINGS_ENTITY_TYPES = new Set([
  "account",
  "category",
  "input_preferences",
  "household_overview",
  "ledger_config",
  "automation_settings",
  "classification_rules",
  "backup_restore"
]);

/**
 * 로그인된 동안의 백그라운드 동기화.
 * - 앱을 열 때 이번 달 정기 거래 생성 확인
 * - 배우자 기기의 변경을 실시간으로 받아 설정 화면 갱신 번호(remoteRevision) 증가
 */
export function useLedgerBackgroundSync(status: string, user: User | null) {
  const [remoteRevision, setRemoteRevision] = useState(0);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      return;
    }

    let cancelled = false;

    void processRecurringTransactions()
      .then(result => {
        if (cancelled || result.created.length === 0) {
          return;
        }

        invalidateDashboardCache();
        markLedgerChanged();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [status, user]);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      return;
    }

    return startRealtimeSync({
      userName: user.name,
      onRemoteChange: changes => {
        if (
          changes.length === 0 ||
          changes.some(change => SETTINGS_ENTITY_TYPES.has(change.entityType))
        ) {
          setRemoteRevision(value => value + 1);
        }
      }
    });
  }, [status, user]);

  return remoteRevision;
}
