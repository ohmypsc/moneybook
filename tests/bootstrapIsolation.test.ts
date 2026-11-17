import test from "node:test";
import assert from "node:assert/strict";
import { getBootstrap } from "../src/api/bootstrap.ts";
import { clearBootstrapMemoryCache, getCachedBootstrapPayload } from "../src/api/bootstrapCache.ts";

test("switching accounts does not reuse an in-flight bootstrap from the previous login", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  let release: (value: Response) => void = () => {};
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1)
      return new Promise<Response>(resolve => {
        release = resolve;
      });
    return new Response(JSON.stringify({ success: true, data: { userName: "미영" } }));
  }) as typeof fetch;
  try {
    clearBootstrapMemoryCache();
    const oldLogin = getBootstrap<any>();
    clearBootstrapMemoryCache(); // logout/login invalidates the session cache
    const current = await getBootstrap<any>();
    assert.equal(current.data.userName, "미영");
    release(new Response(JSON.stringify({ success: true, data: { userName: "승철" } })));
    await oldLogin;
    assert.equal(getCachedBootstrapPayload<any>().data.userName, "미영");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previous;
    clearBootstrapMemoryCache();
  }
});
