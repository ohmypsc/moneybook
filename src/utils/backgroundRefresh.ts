const lastRefreshAt = new Map<string, number>();

export function shouldBackgroundRefresh(
  key: string,
  minimumIntervalMs = 60_000
) {
  const now = Date.now();
  const previous = lastRefreshAt.get(key) || 0;

  if (now - previous < minimumIntervalMs) {
    return false;
  }

  lastRefreshAt.set(key, now);
  return true;
}

export function markBackgroundRefreshed(key: string) {
  lastRefreshAt.set(key, Date.now());
}

export function clearBackgroundRefreshMark(key?: string) {
  if (key) {
    lastRefreshAt.delete(key);
    return;
  }

  lastRefreshAt.clear();
}
