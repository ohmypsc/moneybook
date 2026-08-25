const LEDGER_CHANGED_EVENT = "moneybook:ledger-changed";

let ledgerDirty = false;
let ledgerChangeVersion = 0;

/**
 * 거래/투자 데이터가 변경되었음을 앱 전체에 알립니다.
 * HomePage가 현재 열려 있지 않아도 dirty 상태는 메모리에 남습니다.
 */
export function markLedgerChanged() {
  ledgerDirty = true;
  ledgerChangeVersion += 1;

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new Event(
        LEDGER_CHANGED_EVENT
      )
    );
  }
}

export function isLedgerDirty() {
  return ledgerDirty;
}

export function clearLedgerDirty() {
  ledgerDirty = false;
}

export function getLedgerChangeVersion() {
  return ledgerChangeVersion;
}

export function subscribeLedgerChanges(
  listener: () => void
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => {
    listener();
  };

  window.addEventListener(
    LEDGER_CHANGED_EVENT,
    handler
  );

  return () => {
    window.removeEventListener(
      LEDGER_CHANGED_EVENT,
      handler
    );
  };
}
