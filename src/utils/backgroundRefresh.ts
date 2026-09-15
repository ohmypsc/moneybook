const lastSuccessfulRefreshAt = new Map<string, number>();
const lastRefreshAttemptAt = new Map<string, number>();

const DUPLICATE_ATTEMPT_GUARD_MS = 5_000;

export function shouldBackgroundRefresh(
  key: string,
  minimumIntervalMs = 60_000
) {
  const now = Date.now();
  const previousSuccess =
    lastSuccessfulRefreshAt.get(key) || 0;

  if (now - previousSuccess < minimumIntervalMs) {
    return false;
  }

  const previousAttempt =
    lastRefreshAttemptAt.get(key) || 0;

  if (now - previousAttempt < DUPLICATE_ATTEMPT_GUARD_MS) {
    return false;
  }

  /*
   * focus + visibilitychange가 거의 동시에 발생하는 경우의
   * 중복 호출만 짧게 막습니다. 실제 성공 시각은
   * markBackgroundRefreshed()에서만 기록합니다.
   */
  lastRefreshAttemptAt.set(key, now);
  return true;
}

export function markBackgroundRefreshed(key: string) {
  lastSuccessfulRefreshAt.set(key, Date.now());
  lastRefreshAttemptAt.delete(key);
}

export function clearBackgroundRefreshMark(key?: string) {
  if (key) {
    lastSuccessfulRefreshAt.delete(key);
    lastRefreshAttemptAt.delete(key);
    return;
  }

  lastSuccessfulRefreshAt.clear();
  lastRefreshAttemptAt.clear();
}
