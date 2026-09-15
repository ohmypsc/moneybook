import type { DashboardData } from "../types/dashboard";

const STORAGE_KEY = "moneybook:dashboard-snapshot:v1";

export interface PersistedDashboardSnapshot {
  data: DashboardData;
  fetchedAt: number;
}

export function parsePersistedDashboardSnapshot(
  value: unknown
): PersistedDashboardSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PersistedDashboardSnapshot>;
  const data = candidate.data as Partial<DashboardData> | undefined;
  const fetchedAt = Number(candidate.fetchedAt);

  if (
    !data ||
    typeof data !== "object" ||
    typeof data.month !== "string" ||
    !data.summary ||
    typeof data.summary !== "object" ||
    !Array.isArray(data.accounts) ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt <= 0
  ) {
    return null;
  }

  return {
    data: candidate.data as DashboardData,
    fetchedAt
  };
}

export function readPersistedDashboardSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw
      ? parsePersistedDashboardSnapshot(JSON.parse(raw))
      : null;
  } catch {
    return null;
  }
}

export function rememberPersistedDashboardSnapshot(
  data: DashboardData,
  fetchedAt = Date.now()
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ data, fetchedAt })
    );
  } catch {
    // 오프라인 조회 캐시 저장 실패가 실제 API 성공을 실패로 바꾸면 안 됩니다.
  }
}

export function clearPersistedDashboardSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 로그아웃 흐름을 막지 않습니다.
  }
}
