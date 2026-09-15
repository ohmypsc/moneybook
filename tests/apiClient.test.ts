import test from "node:test";
import assert from "node:assert/strict";

import { apiRequest } from "../src/api/client.ts";
import {
  clearBootstrapMemoryCache,
  getBootstrapCacheGeneration
} from "../src/api/bootstrapCache.ts";
import { getLedgerChangeVersion } from "../src/utils/ledgerEvents.ts";

test("apiRequest reuses bootstrap memory cache and invalidates it after master-data mutation", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  clearBootstrapMemoryCache();
  const startingGeneration = getBootstrapCacheGeneration();
  const startingLedgerVersion = getLedgerChangeVersion();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount += 1;
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url === "/api/bootstrap" && method === "GET") {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            marker: fetchCount,
            inputPreferences: {
              configured: false,
              version: 1,
              preferences: null,
              updatedAt: null,
              updatedBy: null
            }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (url === "/api/accounts/update" && method === "POST") {
      return new Response(
        JSON.stringify({ success: true, data: { ok: true } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const first = await apiRequest<{ success: boolean; data: { marker: number } }>("/api/bootstrap");
    const second = await apiRequest<{ success: boolean; data: { marker: number } }>("/api/bootstrap");

    assert.equal(first.data.marker, 1);
    assert.equal(second.data.marker, 1);
    assert.equal(fetchCount, 1, "second bootstrap call should be served from memory");

    await apiRequest("/api/accounts/update", {
      method: "POST",
      body: JSON.stringify({ accountId: "A1" })
    });

    assert.ok(getBootstrapCacheGeneration() > startingGeneration);
    assert.ok(getLedgerChangeVersion() > startingLedgerVersion);

    const third = await apiRequest<{ success: boolean; data: { marker: number } }>("/api/bootstrap");
    assert.equal(third.data.marker, 3);
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    clearBootstrapMemoryCache();
  }
});

test("apiRequest does not invalidate caches when a mutation fails", async () => {
  const originalFetch = globalThis.fetch;
  clearBootstrapMemoryCache();
  const startingGeneration = getBootstrapCacheGeneration();
  const startingLedgerVersion = getLedgerChangeVersion();

  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "TEST_FAILURE",
        message: "실패"
      }
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }
  )) as typeof fetch;

  try {
    await assert.rejects(
      () => apiRequest("/api/accounts/update", {
        method: "POST",
        body: JSON.stringify({})
      }),
      /실패/
    );

    assert.equal(getBootstrapCacheGeneration(), startingGeneration);
    assert.equal(getLedgerChangeVersion(), startingLedgerVersion);
  } finally {
    globalThis.fetch = originalFetch;
    clearBootstrapMemoryCache();
  }
});

test("apiRequest aborts a request after the configured timeout", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true }
      );
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => apiRequest("/api/slow", { timeoutMs: 5 }),
      (error: unknown) => {
        return Boolean(
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: unknown }).code === "REQUEST_TIMEOUT"
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
