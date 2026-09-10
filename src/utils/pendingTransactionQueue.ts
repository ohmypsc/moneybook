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

const LEGACY_STORAGE_KEY =
  "moneybook:pending-transactions:v1";

const DB_NAME =
  "moneybook-offline-v2";

const DB_VERSION = 1;
const STORE_NAME = "pendingTransactions";
const CHANNEL_NAME = "moneybook:pending-transactions:v2";

const listeners = new Set<QueueListener>();

let records: PendingTransactionRecord[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;
let processing = false;
let processingOwner = "";
let lastCompletion: PendingTransactionCompletion | null = null;
let activeOwner = "";
let channel: BroadcastChannel | null = null;

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
    message.includes("load failed") ||
    message.includes("offline")
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

function normalizeRecord(
  record: PendingTransactionRecord
): PendingTransactionRecord {
  if (record.status !== "saving") {
    return {
      ...record,
      error: record.error || ""
    };
  }

  return {
    ...record,
    status: "pending",
    error: "",
    failureKind: undefined,
    updatedAt: now()
  };
}

function emit() {
  listeners.forEach(
    listener => {
      try {
        listener();
      } catch {
      }
    }
  );
}

function broadcastQueueChanged() {
  try {
    channel?.postMessage({ type: "changed" });
  } catch {
  }
}

function readLegacyRecords() {
  if (typeof window === "undefined") {
    return [] as PendingTransactionRecord[];
  }

  try {
    const raw =
      window.localStorage.getItem(
        LEGACY_STORAGE_KEY
      );

    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidRecord)
      .map(normalizeRecord);
  } catch {
    return [];
  }
}

function persistLegacySnapshot(
  nextRecords: PendingTransactionRecord[]
) {
  if (typeof window === "undefined") {
    throw new Error(
      "브라우저 임시저장 공간을 사용할 수 없습니다."
    );
  }

  window.localStorage.setItem(
    LEGACY_STORAGE_KEY,
    JSON.stringify(nextRecords)
  );
}


function openQueueDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    if (
      typeof window === "undefined" ||
      !("indexedDB" in window)
    ) {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;

    try {
      request = window.indexedDB.open(
        DB_NAME,
        DB_VERSION
      );
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(
          STORE_NAME,
          { keyPath: "id" }
        );

        store.createIndex(
          "owner",
          "owner",
          { unique: false }
        );
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      resolve(null);
    };

    request.onblocked = () => {
      resolve(null);
    };
  });

  return dbPromise;
}

function idbRequest<T>(
  request: IDBRequest<T>
) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("IndexedDB 요청에 실패했습니다.")
    );
  });
}

function idbTransactionDone(
  transaction: IDBTransaction
) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error || new Error("IndexedDB 저장에 실패했습니다.")
    );
    transaction.onabort = () => reject(
      transaction.error || new Error("IndexedDB 저장이 취소되었습니다.")
    );
  });
}

async function readDbRecords() {
  const db = await openQueueDb();
  if (!db) return null;

  try {
    const transaction = db.transaction(
      STORE_NAME,
      "readonly"
    );
    const store = transaction.objectStore(STORE_NAME);
    const result = await idbRequest(store.getAll());

    return (result as unknown[])
      .filter(isValidRecord)
      .map(normalizeRecord);
  } catch {
    return null;
  }
}

async function putDbRecord(
  record: PendingTransactionRecord
) {
  const db = await openQueueDb();
  if (!db) return false;

  try {
    const transaction = db.transaction(
      STORE_NAME,
      "readwrite"
    );
    const done = idbTransactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    await idbRequest(store.put(record));
    await done;
    return true;
  } catch {
    return false;
  }
}

async function deleteDbRecord(
  id: string
) {
  const db = await openQueueDb();
  if (!db) return false;

  try {
    const transaction = db.transaction(
      STORE_NAME,
      "readwrite"
    );
    const done = idbTransactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    await idbRequest(store.delete(id));
    await done;
    return true;
  } catch {
    return false;
  }
}

async function persistRecordBestEffort(
  record: PendingTransactionRecord,
  nextRecords: PendingTransactionRecord[]
) {
  try {
    persistLegacySnapshot(nextRecords);
  } catch {
  }

  await putDbRecord(record);
}

async function removePersistentRecord(
  id: string,
  nextRecords: PendingTransactionRecord[]
) {
  try {
    persistLegacySnapshot(nextRecords);
  } catch {
  }

  await deleteDbRecord(id);
}

function mergeRecords(
  first: PendingTransactionRecord[],
  second: PendingTransactionRecord[]
) {
  const byId = new Map<string, PendingTransactionRecord>();

  for (const record of [...first, ...second]) {
    const current = byId.get(record.id);

    if (
      !current ||
      record.updatedAt >= current.updatedAt
    ) {
      byId.set(record.id, normalizeRecord(record));
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function ensureLoadedAsync() {
  if (loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const dbRecords = await readDbRecords();
    const legacyRecords = readLegacyRecords();

    records = mergeRecords(
      dbRecords || [],
      legacyRecords
    );

    if (dbRecords !== null) {
      let migrated = true;

      for (const record of records) {
        if (!(await putDbRecord(record))) {
          migrated = false;
          break;
        }
      }

      if (migrated) {
        try {
          persistLegacySnapshot(records);
        } catch {
        }
      }
    }

    loaded = true;
    emit();
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

function kickLoad() {
  if (!loaded) {
    void ensureLoadedAsync();
  }
}

async function updateRecord(
  id: string,
  patch: Partial<PendingTransactionRecord>
) {
  await ensureLoadedAsync();

  const current = records.find(record => record.id === id);
  if (!current) return;

  const updated: PendingTransactionRecord = {
    ...current,
    ...patch,
    updatedAt: now()
  };

  const nextRecords = records.map(record =>
    record.id === id ? updated : record
  );

  await persistRecordBestEffort(updated, nextRecords);
  records = nextRecords;
  emit();
  broadcastQueueChanged();
}

async function removeRecord(
  id: string
) {
  await ensureLoadedAsync();

  const nextRecords = records.filter(
    record => record.id !== id
  );

  await removePersistentRecord(id, nextRecords);
  records = nextRecords;
  emit();
  broadcastQueueChanged();
}

async function processQueue(
  owner: string
) {
  await ensureLoadedAsync();

  if (processing) {
    return;
  }

  processing = true;
  processingOwner = owner;

  try {
    while (true) {
      if (activeOwner !== owner) {
        break;
      }

      if (
        typeof navigator !== "undefined" &&
        navigator.onLine === false
      ) {
        break;
      }

      const record = records.find(
        item =>
          item.owner === owner &&
          item.status === "pending"
      );

      if (!record) {
        break;
      }

      await updateRecord(
        record.id,
        {
          status: "saving",
          error: "",
          failureKind: undefined
        }
      );

      try {
        await createTransaction(record.payload);

        lastCompletion = {
          id: record.id,
          owner: record.owner,
          label: record.label,
          completedAt: now()
        };

        await removeRecord(record.id);
      } catch (error) {
        const networkFailure =
          isLikelyNetworkError(error);

        await updateRecord(
          record.id,
          {
            status: "failed",
            error: getErrorMessage(error),
            failureKind: networkFailure
              ? "network"
              : "other"
          }
        );

        if (networkFailure) {
          break;
        }
      }
    }
  } finally {
    processing = false;
    processingOwner = "";

    const hasPending = records.some(
      item =>
        item.owner === owner &&
        item.status === "pending"
    );

    if (
      hasPending &&
      activeOwner === owner &&
      (
        typeof navigator === "undefined" ||
        navigator.onLine !== false
      )
    ) {
      void processQueue(owner);
      return;
    }

    if (
      activeOwner &&
      activeOwner !== owner
    ) {
      void processQueue(activeOwner);
    }
  }
}

async function prepareOwnerQueue(
  owner: string
) {
  await ensureLoadedAsync();

  const canRetryNetwork =
    typeof navigator === "undefined" ||
    navigator.onLine !== false;

  const targets = records.filter(
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

  for (const record of targets) {
    await updateRecord(
      record.id,
      {
        status: "pending",
        error: "",
        failureKind: undefined
      }
    );
  }
}

async function requestPersistentStorage() {
  try {
    await navigator.storage?.persist?.();
  } catch {
  }
}

export function subscribePendingTransactions(
  listener: QueueListener
) {
  listeners.add(listener);
  kickLoad();

  return () => {
    listeners.delete(listener);
  };
}

export function getPendingTransactions(
  owner: string
) {
  kickLoad();

  return records.filter(
    record => record.owner === owner
  );
}

export function getLastPendingTransactionCompletion(
  owner: string
) {
  if (lastCompletion?.owner !== owner) {
    return null;
  }

  return lastCompletion;
}

export function startPendingTransactionQueue(
  owner: string
) {
  if (!owner) return;

  activeOwner = owner;

  void requestPersistentStorage();

  void prepareOwnerQueue(owner)
    .then(() => processQueue(owner));
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
  const requestId = input.payload.requestId;

  if (!requestId) {
    throw new Error("저장 요청 ID가 없습니다.");
  }

  if (!input.owner) {
    throw new Error("로그인 사용자를 확인할 수 없습니다.");
  }

  const baseRecords = loaded
    ? records
    : mergeRecords(records, readLegacyRecords());

  const existing = baseRecords.find(
    record => record.id === requestId
  );

  if (!existing) {
    const timestamp = now();

    const record: PendingTransactionRecord = {
      id: requestId,
      owner: input.owner,
      label: input.label,
      payload: input.payload,
      status: "pending",
      error: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const nextRecords = [
      ...baseRecords,
      record
    ];

    persistLegacySnapshot(nextRecords);

    records = nextRecords;
    emit();
    broadcastQueueChanged();

    void putDbRecord(record);
  } else {
    records = baseRecords;
  }

  void ensureLoadedAsync()
    .then(() => processQueue(input.owner));
}

export function retryPendingTransaction(
  owner: string,
  id: string
) {
  void (async () => {
    await ensureLoadedAsync();

    const record = records.find(
      item =>
        item.owner === owner &&
        item.id === id
    );

    if (!record) return;

    await updateRecord(
      id,
      {
        status: "pending",
        error: "",
        failureKind: undefined
      }
    );

    void processQueue(owner);
  })();
}

export function discardPendingTransaction(
  owner: string,
  id: string
) {
  void (async () => {
    await ensureLoadedAsync();

    const record = records.find(
      item =>
        item.owner === owner &&
        item.id === id
    );

    if (
      !record ||
      record.status === "saving"
    ) {
      return;
    }

    await removeRecord(id);
  })();
}

export function retryAllFailedPendingTransactions(
  owner: string
) {
  void (async () => {
    await ensureLoadedAsync();

    const failed = records.filter(
      record =>
        record.owner === owner &&
        record.status === "failed"
    );

    for (const record of failed) {
      await updateRecord(
        record.id,
        {
          status: "pending",
          error: "",
          failureKind: undefined
        }
      );
    }

    if (failed.length) {
      void processQueue(owner);
    }
  })();
}

async function retryNetworkFailures() {
  if (!activeOwner) return;

  await prepareOwnerQueue(activeOwner);
  await processQueue(activeOwner);
}

async function reloadFromPersistentStorage() {
  if (processing) return;

  loaded = false;
  await ensureLoadedAsync();

  if (activeOwner) {
    void processQueue(activeOwner);
  }
}

if (typeof window !== "undefined") {
  if ("BroadcastChannel" in window) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", event => {
        if (event.data?.type === "changed") {
          void reloadFromPersistentStorage();
        }
      });
    } catch {
      channel = null;
    }
  }

  window.addEventListener(
    "online",
    () => {
      void retryNetworkFailures();
    }
  );

  window.addEventListener(
    "focus",
    () => {
      if (navigator.onLine !== false) {
        void retryNetworkFailures();
      }
    }
  );
}
