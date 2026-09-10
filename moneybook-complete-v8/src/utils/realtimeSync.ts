import { apiRequest } from "../api/client";
import { clearBootstrapMemoryCache } from "../api/bootstrapCache";
import { clearInvestmentPrefetchCache } from "../api/investments";
import { clearManagedSettingsCache } from "../api/settingsManagement";
import { markLedgerChanged } from "./ledgerEvents";

export interface RealtimeChange {
  changeSeq: number;
  entityType: string;
  entityId: string;
  action: string;
  entityVersion: number | null;
  changedBy: string | null;
  changedAt: string | null;
  payload: unknown;
}

interface ChangesData {
  latestSeq: number;
  changes: RealtimeChange[];
  hasMore: boolean;
}

interface ChangesResponse {
  success: true;
  apiVersion: string;
  data: ChangesData;
}

interface StartRealtimeSyncOptions {
  userName: string;
  onRemoteChange?: (changes: RealtimeChange[]) => void;
}

const LAST_SEQ_KEY = "moneybook:realtime:last-seq:v1";
const ACTIVE_POLL_MS = 2000;
const SOCKET_POLL_MS = 30000;
const SOCKET_RETRY_MS = 60000;

const MASTER_ENTITY_TYPES = new Set([
  "account",
  "category",
  "input_preferences",
  "ledger_config"
]);

const INVESTMENT_ENTITY_TYPES = new Set([
  "account",
  "holding",
  "investment_trade"
]);

function readLastSeq() {
  try {
    const raw = window.localStorage.getItem(LAST_SEQ_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : null;
  } catch {
    return null;
  }
}

function writeLastSeq(value: number) {
  try {
    window.localStorage.setItem(
      LAST_SEQ_KEY,
      String(Math.max(0, Math.floor(value)))
    );
  } catch {
  }
}

function makeRealtimeUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/realtime`;
}

function applyChanges(
  changes: RealtimeChange[],
  onRemoteChange?: (changes: RealtimeChange[]) => void
) {
  if (!changes.length) return;

  if (
    changes.some(change =>
      MASTER_ENTITY_TYPES.has(change.entityType)
    )
  ) {
    clearBootstrapMemoryCache();
    clearManagedSettingsCache();
  }

  if (
    changes.some(change =>
      INVESTMENT_ENTITY_TYPES.has(change.entityType)
    )
  ) {
    clearInvestmentPrefetchCache();
  }

  markLedgerChanged();
  onRemoteChange?.(changes);
}

export function startRealtimeSync({
  userName: _userName,
  onRemoteChange
}: StartRealtimeSyncOptions) {
  if (typeof window === "undefined") {
    return () => {};
  }

  let stopped = false;
  let initialized = false;
  let pollInFlight: Promise<void> | null = null;
  let pollTimer: number | null = null;
  let socketRetryTimer: number | null = null;
  let socket: WebSocket | null = null;

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function clearSocketRetryTimer() {
    if (socketRetryTimer !== null) {
      window.clearTimeout(socketRetryTimer);
      socketRetryTimer = null;
    }
  }

  async function initializeSequence() {
    const existing = readLastSeq();
    if (existing !== null) {
      initialized = true;
      return;
    }

    const response = await apiRequest<ChangesResponse>(
      "/api/changes?head=1"
    );

    writeLastSeq(response.data.latestSeq || 0);
    initialized = true;
  }

  async function pullChanges() {
    if (stopped || navigator.onLine === false) return;

    if (pollInFlight) {
      return pollInFlight;
    }

    pollInFlight = (async () => {
      try {
        if (!initialized) {
          await initializeSequence();
        }

        let after = readLastSeq() ?? 0;
        let loops = 0;

        while (!stopped && loops < 10) {
          loops += 1;

          const response = await apiRequest<ChangesResponse>(
            `/api/changes?after=${encodeURIComponent(String(after))}&limit=100`
          );

          const { latestSeq, changes, hasMore } = response.data;

          if (latestSeq < after) {
            after = latestSeq;
            writeLastSeq(after);
            markLedgerChanged();
            onRemoteChange?.([]);
            break;
          }

          if (changes.length) {
            const last = changes[changes.length - 1];
            after = Math.max(after, last.changeSeq);
            writeLastSeq(after);
            applyChanges(changes, onRemoteChange);
          } else if (latestSeq > after) {
            after = latestSeq;
            writeLastSeq(after);
          }

          if (!hasMore || !changes.length) {
            break;
          }
        }
      } catch {
      } finally {
        pollInFlight = null;
      }
    })();

    return pollInFlight;
  }

  function schedulePoll(delay?: number) {
    if (stopped) return;
    clearPollTimer();

    const socketOpen =
      socket?.readyState === WebSocket.OPEN;

    const nextDelay =
      delay ?? (socketOpen ? SOCKET_POLL_MS : ACTIVE_POLL_MS);

    pollTimer = window.setTimeout(async () => {
      if (stopped) return;

      if (document.visibilityState === "visible") {
        await pullChanges();
      }

      schedulePoll();
    }, nextDelay);
  }

  function scheduleSocketRetry() {
    if (stopped) return;
    clearSocketRetryTimer();
    socketRetryTimer = window.setTimeout(
      connectSocket,
      SOCKET_RETRY_MS
    );
  }

  function connectSocket() {
    if (
      stopped ||
      navigator.onLine === false ||
      socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    clearSocketRetryTimer();

    try {
      socket = new WebSocket(makeRealtimeUrl());
    } catch {
      socket = null;
      scheduleSocketRetry();
      return;
    }

    socket.addEventListener("open", () => {
      void pullChanges();
      schedulePoll(SOCKET_POLL_MS);
    });

    socket.addEventListener("message", () => {
      void pullChanges();
    });

    socket.addEventListener("close", () => {
      socket = null;
      schedulePoll(250);
      scheduleSocketRetry();
    });

    socket.addEventListener("error", () => {
      try {
        socket?.close();
      } catch {
      }
    });
  }

  function refreshNow() {
    if (stopped || document.visibilityState !== "visible") return;
    void pullChanges();
    connectSocket();
    schedulePoll();
  }

  const visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      refreshNow();
    }
  };

  const onlineHandler = () => {
    refreshNow();
  };

  window.addEventListener("online", onlineHandler);
  window.addEventListener("focus", refreshNow);
  document.addEventListener("visibilitychange", visibilityHandler);

  void initializeSequence()
    .then(() => pullChanges())
    .finally(() => {
      if (!stopped) {
        connectSocket();
        schedulePoll(250);
      }
    });

  return () => {
    stopped = true;
    clearPollTimer();
    clearSocketRetryTimer();

    window.removeEventListener("online", onlineHandler);
    window.removeEventListener("focus", refreshNow);
    document.removeEventListener("visibilitychange", visibilityHandler);

    if (socket) {
      try {
        socket.close();
      } catch {
      }
      socket = null;
    }
  };
}
