import test from "node:test";
import assert from "node:assert/strict";

import {
  LOGIN_LOCK_MS,
  LOGIN_MAX_FAILURES,
  getLoginRateLimitStatus,
  recordLoginFailureState
} from "../worker/domain/loginRateLimit.js";

test("login rate limit locks after repeated failures and reports retry time", () => {
  const now = 1_000_000;
  let state = null;

  for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) {
    state = recordLoginFailureState(state, now + index);
  }

  const status = getLoginRateLimitStatus(state, now + LOGIN_MAX_FAILURES);
  assert.equal(status.blocked, true);
  assert.ok(status.retryAfterMs > 0);
  assert.ok(status.retryAfterMs <= LOGIN_LOCK_MS);
});

test("old login failures expire instead of permanently accumulating", () => {
  const state = { failures: [1000, 2000, 3000], lockedUntil: 0 };
  const status = getLoginRateLimitStatus(state, 2_000_000);
  assert.equal(status.blocked, false);
  assert.deepEqual(status.record.failures, []);
});
