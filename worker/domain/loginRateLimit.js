export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 8;

function normalizeFailures(record, now) {
  const failures = Array.isArray(record?.failures)
    ? record.failures
        .map(Number)
        .filter(value => Number.isFinite(value) && value > now - LOGIN_FAILURE_WINDOW_MS)
    : [];

  const lockedUntil = Number(record?.lockedUntil) || 0;
  return { failures, lockedUntil };
}

export function getLoginRateLimitStatus(record, now = Date.now()) {
  const normalized = normalizeFailures(record, now);

  if (normalized.lockedUntil > now) {
    return {
      blocked: true,
      retryAfterMs: normalized.lockedUntil - now,
      record: normalized
    };
  }

  return {
    blocked: false,
    retryAfterMs: 0,
    record: {
      failures: normalized.failures,
      lockedUntil: 0
    }
  };
}

export function recordLoginFailureState(record, now = Date.now()) {
  const current = getLoginRateLimitStatus(record, now);

  if (current.blocked) {
    return current.record;
  }

  const failures = [...current.record.failures, now];
  const lockedUntil =
    failures.length >= LOGIN_MAX_FAILURES
      ? now + LOGIN_LOCK_MS
      : 0;

  return { failures, lockedUntil };
}
