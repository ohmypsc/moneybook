/*
 * 마지막으로 성공한 /api/bootstrap 응답(계좌·카테고리·입력 설정 등)을 기기에 보관합니다.
 * 인터넷 없이 앱을 열어도 거래 입력 화면을 띄우고, 입력한 거래는 저장 대기열에
 * 넣었다가 온라인이 되면 서버에 저장하기 위해서입니다.
 *
 * 두 사람이 한 기기를 번갈아 쓸 수 있으므로 사용자 이름과 함께 저장하고,
 * 같은 사용자일 때만 꺼내 씁니다. 로그아웃·세션 만료 때는 삭제합니다.
 */
const STORAGE_KEY = "moneybook:bootstrap-snapshot:v1";

export interface PersistedBootstrapSnapshot {
  owner: string;
  payload: unknown;
  fetchedAt: number;
}

export function parsePersistedBootstrapSnapshot(value: unknown): PersistedBootstrapSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PersistedBootstrapSnapshot>;
  const payload = candidate.payload as { success?: unknown; data?: Record<string, unknown> } | null;
  const fetchedAt = Number(candidate.fetchedAt);

  if (
    typeof candidate.owner !== "string" ||
    !candidate.owner ||
    !payload ||
    typeof payload !== "object" ||
    payload.success !== true ||
    !payload.data ||
    typeof payload.data !== "object" ||
    !Array.isArray(payload.data.accounts) ||
    !Array.isArray(payload.data.categories) ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt <= 0
  ) {
    return null;
  }

  return { owner: candidate.owner, payload, fetchedAt };
}

/** 성공한 bootstrap 응답의 data.userName을 주인으로 저장합니다. */
export function rememberPersistedBootstrapSnapshot(payload: unknown, fetchedAt = Date.now()) {
  if (typeof window === "undefined") {
    return;
  }

  const owner = (payload as { data?: { userName?: unknown } } | null)?.data?.userName;
  const snapshot = parsePersistedBootstrapSnapshot({ owner, payload, fetchedAt });

  if (!snapshot) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 오프라인 대비 저장 실패가 실제 API 성공을 실패로 바꾸면 안 됩니다.
  }
}

export function readPersistedBootstrapSnapshot(owner: string | null | undefined) {
  if (typeof window === "undefined" || !owner) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const snapshot = raw ? parsePersistedBootstrapSnapshot(JSON.parse(raw)) : null;
    return snapshot && snapshot.owner === owner ? snapshot : null;
  } catch {
    return null;
  }
}

export function clearPersistedBootstrapSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 로그아웃 흐름을 막지 않습니다.
  }
}
