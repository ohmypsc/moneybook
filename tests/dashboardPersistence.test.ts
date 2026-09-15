import test from "node:test";
import assert from "node:assert/strict";

import { parsePersistedDashboardSnapshot } from "../src/api/dashboardPersistence.ts";

test("persisted dashboard parser rejects malformed storage and accepts a dashboard shell", () => {
  assert.equal(parsePersistedDashboardSnapshot(null), null);
  assert.equal(parsePersistedDashboardSnapshot({ data: {}, fetchedAt: 1 }), null);

  const data = {
    month: "2026-09",
    summary: {},
    accounts: []
  };

  const parsed = parsePersistedDashboardSnapshot({ data, fetchedAt: 12345 });
  assert.equal(parsed?.fetchedAt, 12345);
  assert.equal(parsed?.data.month, "2026-09");
});

test("dashboard snapshot persists locally and is removed on explicit clear", async () => {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    }
  };

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage }
  });

  try {
    const {
      clearPersistedDashboardSnapshot,
      readPersistedDashboardSnapshot,
      rememberPersistedDashboardSnapshot
    } = await import("../src/api/dashboardPersistence.ts");

    const data = {
      month: "2026-09",
      summary: {},
      accounts: []
    } as any;

    rememberPersistedDashboardSnapshot(data, 999);
    assert.equal(readPersistedDashboardSnapshot()?.fetchedAt, 999);
    assert.equal(readPersistedDashboardSnapshot()?.data.month, "2026-09");

    clearPersistedDashboardSnapshot();
    assert.equal(readPersistedDashboardSnapshot(), null);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});
