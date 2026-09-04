import {
  createTransaction,
  type CreateTransactionInput
} from "../api/transactions";

export type PendingTransactionStatus =
  | "pending"
  | "saving"
  | "failed";

export interface PendingTransactionRecord {
  id: string;
  owner: string;
  label: string;
  payload: CreateTransactionInput;
  status: PendingTransactionStatus;
  error: string;
  failureKind?: "network" | "other";
  createdAt: number;
  updatedAt: number;
}

export interface PendingTransactionCompletion {
  id: string;
  owner: string;
  label: string;
  completedAt: number;
}

type QueueListener = () => void;

const STORAGE_KEY =
  "moneybook:pending-transactions:v1";

const listeners =
  new Set<QueueListener>();

let loaded = false;
let records: PendingTransactionRecord[] = [];
let processing = false;
let processingOwner = "";
let lastCompletion: PendingTransactionCompletion | null = null;
let activeOwner = "";

function now() {
  return Date.now();
}

function getErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "저장 중 오류가 발생했습니다.";
}

function isLikelyNetworkError(error: unknown) {
  if (error instanceof TypeError) {
    return true;
  }

  const message =
    getErrorMessage(error)
      .toLowerCase();

  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network error") ||
    message.includes("load failed")
  );
}

function isValidRecord(
  value: unknown
): value is PendingTransactionRecord {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  const record =
    value as Partial<PendingTransactionRecord>;

  return !!(
    record.id &&
    record.owner &&
    record.payload &&
    typeof record.payload === "object" &&
    record.payload.requestId === record.id &&
    (
      record.status === "pending" ||
      record.status === "saving" ||
      record.status === "failed"
    )
  );
}

function ensureLoaded() {
  if (loaded) {
    return;
  }

  loaded = true;

  if (
    typeof window === "undefined"
  ) {
    records = [];
    return;
  }

  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY
      );

    if (!raw) {
      records = [];
      return;
    }

    const parsed =
      JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      records = [];
      return;
    }

    records =
      parsed
        .filter(isValidRecord)
        .map(record => ({
          ...record,

          /*
           * 앱이 닫히는 순간 요청이 진행 중이었을 수 있습니다.
           * 같은 requestId로 다시 보내면 백엔드의 멱등성 보호가
           * 중복 저장을 막으므로 안전하게 pending으로 되돌립니다.
           */
          status:
            record.status === "saving"
              ? "pending"
              : record.status,

          error:
            record.status === "saving"
              ? ""
              : record.error || ""
        }));

    persist();
  } catch {
    records = [];
  }
}

function persist() {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(records)
  );
}

function emit() {
  listeners.forEach(
    listener => {
      try {
        listener();
      } catch {
        // 한 구독자의 렌더 오류가 큐 처리를 막지 않게 합니다.
      }
    }
  );
}

function updateRecord(
  id: string,
  patch: Partial<PendingTransactionRecord>
) {
  records =
    records.map(record =>
      record.id === id
        ? {
            ...record,
            ...patch,
            updatedAt: now()
          }
        : record
    );

  persist();
  emit();
}

function removeRecord(
  id: string
) {
  records =
    records.filter(
      record =>
        record.id !== id
    );

  persist();
  emit();
}

async function processQueue(
  owner: string
) {
  ensureLoaded();

  if (
    processing
  ) {
    return;
  }

  processing = true;
  processingOwner = owner;

  try {
    while (true) {
      if (
        activeOwner !== owner
      ) {
        break;
      }

      const record =
        records.find(
          item =>
            item.owner === owner &&
            item.status === "pending"
        );

      if (!record) {
        break;
      }

      updateRecord(
        record.id,
        {
          status: "saving",
          error: "",
          failureKind: undefined
        }
      );

      try {
        await createTransaction(
          record.payload
        );

        lastCompletion = {
          id: record.id,
          owner: record.owner,
          label: record.label,
          completedAt: now()
        };

        removeRecord(
          record.id
        );
      } catch (error) {
        const networkFailure =
          isLikelyNetworkError(
            error
          );

        updateRecord(
          record.id,
          {
            status: "failed",
            error:
              getErrorMessage(
                error
              ),
            failureKind:
              networkFailure
                ? "network"
                : "other"
          }
        );

        if (
          networkFailure
        ) {
          break;
        }
      }
    }
  } finally {
    processing = false;
    processingOwner = "";

    /*
     * 처리 도중 새 항목이 들어왔을 수 있으므로 한 번 더 확인합니다.
     */
    const hasPending =
      records.some(
        item =>
          item.owner === owner &&
          item.status === "pending"
      );

    if (
      hasPending &&
      activeOwner === owner
    ) {
      void processQueue(owner);
      return;
    }

    /*
     * 처리 중 로그아웃/계정 전환이 일어나면 새 사용자의 start 호출은
     * processing=true 때문에 즉시 실행되지 못할 수 있습니다.
     * 이전 요청이 끝난 뒤 현재 활성 사용자 큐로 안전하게 넘깁니다.
     */
    if (
      activeOwner &&
      activeOwner !== owner
    ) {
      void processQueue(
        activeOwner
      );
    }
  }
}

export function subscribePendingTransactions(
  listener: QueueListener
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getPendingTransactions(
  owner: string
) {
  ensureLoaded();

  return records.filter(
    record =>
      record.owner === owner
  );
}

export function getLastPendingTransactionCompletion(
  owner: string
) {
  if (
    lastCompletion?.owner !== owner
  ) {
    return null;
  }

  return lastCompletion;
}

export function startPendingTransactionQueue(
  owner: string
) {
  ensureLoaded();

  if (!owner) {
    return;
  }

  activeOwner = owner;

  const canRetryNetwork =
    typeof navigator === "undefined" ||
    navigator.onLine !== false;

  const changed = records.some(
    record =>
      record.owner === owner &&
      (
        record.status === "saving" ||
        (
          canRetryNetwork &&
          record.status === "failed" &&
          record.failureKind === "network"
        )
      )
  );

  if (changed) {
    records =
      records.map(record =>
        record.owner === owner &&
        (
          record.status === "saving" ||
          (
            canRetryNetwork &&
            record.status === "failed" &&
            record.failureKind === "network"
          )
        )
          ? {
              ...record,
              status: "pending" as const,
              error: "",
              failureKind: undefined,
              updatedAt: now()
            }
          : record
      );

    persist();
    emit();
  }

  void processQueue(owner);
}

export function stopPendingTransactionQueue(
  owner?: string
) {
  if (
    !owner ||
    activeOwner === owner
  ) {
    activeOwner = "";
  }
}

export function enqueuePendingTransaction(
  input: {
    owner: string;
    label: string;
    payload: CreateTransactionInput;
  }
) {
  ensureLoaded();

  const requestId =
    input.payload.requestId;

  if (!requestId) {
    throw new Error(
      "저장 요청 ID가 없습니다."
    );
  }

  if (!input.owner) {
    throw new Error(
      "로그인 사용자를 확인할 수 없습니다."
    );
  }

  const existing =
    records.find(
      record =>
        record.id === requestId
    );

  if (!existing) {
    const timestamp =
      now();

    const nextRecords = [
      ...records,
      {
        id: requestId,
        owner: input.owner,
        label: input.label,
        payload: input.payload,
        status: "pending" as const,
        error: "",
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ];

    /*
     * 폼을 비우기 전에 로컬 저장이 반드시 먼저 성공해야 합니다.
     * 여기서 실패하면 메모리 큐에도 넣지 않으므로 사용자의 입력값이
     * 그대로 남아 안전하게 다시 시도할 수 있습니다.
     */
    if (
      typeof window === "undefined"
    ) {
      throw new Error(
        "브라우저 임시저장 공간을 사용할 수 없습니다."
      );
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(nextRecords)
    );

    records = nextRecords;
    emit();
  }

  void processQueue(
    input.owner
  );
}

export function retryPendingTransaction(
  owner: string,
  id: string
) {
  ensureLoaded();

  const record =
    records.find(
      item =>
        item.owner === owner &&
        item.id === id
    );

  if (!record) {
    return;
  }

  updateRecord(
    id,
    {
      status: "pending",
      error: "",
      failureKind: undefined
    }
  );

  void processQueue(owner);
}


export function discardPendingTransaction(
  owner: string,
  id: string
) {
  ensureLoaded();

  const record =
    records.find(
      item =>
        item.owner === owner &&
        item.id === id
    );

  if (!record || record.status === "saving") {
    return;
  }

  removeRecord(id);
}

export function retryAllFailedPendingTransactions(
  owner: string
) {
  ensureLoaded();

  let changed = false;

  records =
    records.map(record => {
      if (
        record.owner !== owner ||
        record.status !== "failed"
      ) {
        return record;
      }

      changed = true;

      return {
        ...record,
        status: "pending" as const,
        error: "",
        failureKind: undefined,
        updatedAt: now()
      };
    });

  if (changed) {
    persist();
    emit();
    void processQueue(owner);
  }
}

/*
 * 여러 탭에서 같은 브라우저 저장소를 쓸 때 표시 상태를 맞춥니다.
 */
if (
  typeof window !== "undefined"
) {
  window.addEventListener(
    "online",
    () => {
      ensureLoaded();

      let changed = false;

      records = records.map(
        record => {
          if (
            record.status !== "failed" ||
            record.failureKind !== "network" ||
            record.owner !== activeOwner
          ) {
            return record;
          }

          changed = true;

          return {
            ...record,
            status: "pending" as const,
            error: "",
            failureKind: undefined,
            updatedAt: now()
          };
        }
      );

      if (changed) {
        persist();
        emit();
      }

      if (activeOwner) {
        void processQueue(activeOwner);
      }
    }
  );

  window.addEventListener(
    "storage",
    event => {
      if (
        event.key !== STORAGE_KEY
      ) {
        return;
      }

      loaded = false;
      ensureLoaded();
      emit();

      if (activeOwner) {
        void processQueue(
          activeOwner
        );
      }
    }
  );
}
