import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// Load the production queue with an in-memory storage/network boundary.
const source = readFileSync(new URL("../src/utils/pendingTransactionQueue.ts", import.meta.url), "utf8")
  .replace(/import \{[\s\S]*?\} from "\.\.\/api\/transactions";/, "const createTransaction = globalThis.__queueCreateTransaction;");

test("bulk enqueue preserves all rows while background sync updates and removes rows", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const storage = new Map();
  const sent = [];
  globalThis.window = {
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    addEventListener() {}
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  globalThis.__queueCreateTransaction = async payload => {
    await new Promise(resolve => setTimeout(resolve, 1));
    sent.push(payload.requestId);
    return { success: true };
  };
  try {
    const queue = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
    queue.startPendingTransactionQueue("A");
    await Promise.all(Array.from({ length: 30 }, (_, index) => queue.enqueuePendingTransaction({
      owner: "A", label: `row ${index}`, payload: { requestId: `R${index}`, type: "수입", date: "2026-11-16", amount: 1000, categoryId: "I", toAccountId: "A1" }
    })));
    const deadline = Date.now() + 3000;
    while ((sent.length < 30 || queue.getPendingTransactions("A").length) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    queue.stopPendingTransactionQueue();
    assert.equal(sent.length, 30);
    assert.equal(new Set(sent).size, 30);
    assert.equal(queue.getPendingTransactions("A").length, 0);
    assert.deepEqual(JSON.parse(storage.get("moneybook:pending-transactions:v1")), []);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator;
    delete globalThis.__queueCreateTransaction;
  }
});
