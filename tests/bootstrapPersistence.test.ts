import test from "node:test";
import assert from "node:assert/strict";

// 브라우저 대신 쓸 최소한의 window(localStorage + 이벤트)를 준비합니다.
const store = new Map<string, string>();
const fakeWindow = Object.assign(new EventTarget(), {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key)
  }
});
(globalThis as unknown as { window: unknown }).window = fakeWindow;

const { apiRequest } = await import("../src/api/client.ts");
const { clearBootstrapMemoryCache } = await import("../src/api/bootstrapCache.ts");
const {
  clearPersistedBootstrapSnapshot,
  parsePersistedBootstrapSnapshot,
  readPersistedBootstrapSnapshot,
  rememberPersistedBootstrapSnapshot
} = await import("../src/api/bootstrapPersistence.ts");
const { saveLastAuthenticatedUser } = await import("../src/app/lastAuthenticatedUser.ts");

type Bootstrap = {
  success: boolean;
  offlineSnapshotAt?: number;
  data: { userName: string; accounts: { id: string }[]; categories: { id: string }[] };
};

function bootstrapPayload(userName: string, marker: string) {
  return {
    success: true,
    data: { userName, accounts: [{ id: marker }], categories: [{ id: "C1" }] }
  };
}

function respondWith(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function withFetch(fetchImpl: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("snapshot validation rejects incomplete or failed payloads", () => {
  const ok = { owner: "A", payload: bootstrapPayload("A", "x"), fetchedAt: 1 };
  assert.ok(parsePersistedBootstrapSnapshot(ok));
  assert.equal(parsePersistedBootstrapSnapshot({ ...ok, owner: "" }), null);
  assert.equal(parsePersistedBootstrapSnapshot({ ...ok, fetchedAt: 0 }), null);
  assert.equal(
    parsePersistedBootstrapSnapshot({ ...ok, payload: { success: false, data: {} } }),
    null
  );
  assert.equal(
    parsePersistedBootstrapSnapshot({
      ...ok,
      payload: { success: true, data: { accounts: [] } }
    }),
    null
  );
});

test("snapshot is stored per user and only read back for the same user", () => {
  store.clear();
  rememberPersistedBootstrapSnapshot(bootstrapPayload("A", "acc-A"), 1000);
  assert.equal(readPersistedBootstrapSnapshot("A")?.fetchedAt, 1000);
  assert.equal(readPersistedBootstrapSnapshot("B"), null);
  assert.equal(readPersistedBootstrapSnapshot(null), null);

  rememberPersistedBootstrapSnapshot({ success: true, data: { accounts: [] } }); // userName 없음
  assert.equal(
    readPersistedBootstrapSnapshot("A")?.fetchedAt,
    1000,
    "invalid payload must not overwrite"
  );

  clearPersistedBootstrapSnapshot();
  assert.equal(readPersistedBootstrapSnapshot("A"), null);
});

test("successful bootstrap is persisted; a later network failure falls back to it", async () => {
  store.clear();
  clearBootstrapMemoryCache();
  saveLastAuthenticatedUser({ name: "A" });

  await withFetch(
    (async () => respondWith(bootstrapPayload("A", "online"))) as typeof fetch,
    async () => {
      const online = await apiRequest<Bootstrap>("/api/bootstrap");
      assert.equal(online.data.accounts[0].id, "online");
      assert.equal(online.offlineSnapshotAt, undefined);
    }
  );
  assert.ok(readPersistedBootstrapSnapshot("A"), "online response must be stored on the device");

  // 앱을 새로 연 것처럼 메모리 캐시를 비우고 네트워크를 끊습니다.
  clearBootstrapMemoryCache();
  let calls = 0;
  await withFetch(
    (async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
    async () => {
      const offline = await apiRequest<Bootstrap>("/api/bootstrap");
      assert.equal(offline.data.accounts[0].id, "online");
      assert.equal(typeof offline.offlineSnapshotAt, "number");

      // 오프라인 저장본은 메모리 캐시에 넣지 않으므로 다음 요청은 다시 네트워크를 시도합니다.
      await apiRequest<Bootstrap>("/api/bootstrap");
      assert.equal(calls, 2);
    }
  );
});

test("no fallback for another user, for 401, or for non-bootstrap requests", async () => {
  store.clear();
  clearBootstrapMemoryCache();
  rememberPersistedBootstrapSnapshot(bootstrapPayload("A", "acc-A"), 1000);

  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  saveLastAuthenticatedUser({ name: "B" });
  await withFetch(offline, async () => {
    await assert.rejects(() => apiRequest("/api/bootstrap"), /Failed to fetch/);
  });

  saveLastAuthenticatedUser({ name: "A" });
  await withFetch(offline, async () => {
    await assert.rejects(() => apiRequest("/api/accounts"), /Failed to fetch/);
  });

  await withFetch(
    (async () =>
      respondWith(
        { success: false, error: { code: "LOGIN_REQUIRED", message: "로그인이 필요합니다." } },
        401
      )) as typeof fetch,
    async () => {
      await assert.rejects(() => apiRequest("/api/bootstrap"), /로그인이 필요합니다/);
    }
  );
});
