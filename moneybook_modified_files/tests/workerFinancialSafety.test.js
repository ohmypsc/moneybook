import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Run the actual Worker domain functions against SQLite without production credentials.
// The adapter implements D1's atomic batch contract and asynchronous read boundaries.
const workerUrl = new URL("../worker/index.js", import.meta.url);
const source = readFileSync(workerUrl, "utf8")
  .replace('import { DurableObject } from "cloudflare:workers";', 'class DurableObject {}')
  .replace(/from "(\.\/[^\"]+)"/g, (_match, path) => `from ${JSON.stringify(new URL(path, workerUrl).href)}`);
const worker = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport { mbD1HandleTransactionMutation, mbD1RestoreBackupMerge };').toString("base64")}`);

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0000_schema.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0001_request_id_unique_indexes.sql", import.meta.url), "utf8"));
  sqlite.exec(`INSERT INTO households(household_id,name) VALUES ('HH_MAIN','Test');
    INSERT INTO members(member_id,household_id,display_name) VALUES ('MEM_A','HH_MAIN','A');
    INSERT INTO accounts(account_id,household_id,name,account_type,sub_type) VALUES ('A1','HH_MAIN','통장','자산','통장');
    INSERT INTO categories(category_id,household_id,type,name) VALUES ('C1','HH_MAIN','지출','경조사비');
    INSERT INTO transactions(transaction_id,household_id,request_id,date,type,category_id,amount,payment_method_id,updated_at)
    VALUES ('ORIGINAL','HH_MAIN','ORIGINAL_REQ','2026-11-16','지출','C1',100000,'A1','2026-11-16T00:00:00.000Z');`);
  const state = { batches: 0, failSql: "" };
  const DB = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) { return { ...this, values }; },
        async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; },
        async first() { return sqlite.prepare(this.sql).get(...this.values) || null; },
        async run() { return { success: true, meta: sqlite.prepare(this.sql).run(...this.values) }; }
      };
      return statement;
    },
    async batch(statements) {
      state.batches += 1;
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(statement => {
          if (state.failSql && statement.sql.includes(state.failSql)) throw new Error("injected write failure");
          return { success: true, results: sqlite.prepare(statement.sql).all(...statement.values) };
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
  return { sqlite, DB, state };
}
const session = { name: "A" };
const settle = (env, amount, requestId) => worker.mbD1HandleTransactionMutation("/api/transactions/settle", {
  transactionId: "ORIGINAL", amount, requestId, toAccountId: "A1", date: "2026-11-16"
}, session, env);

test("settlement retry after a full payment returns the existing result", async () => {
  const env = database();
  try {
    const first = await settle(env, 100000, "SAME");
    const retry = await settle(env, 100000, "SAME");
    assert.equal(first.created, true);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.summary.remainingAmount, 0);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS count FROM transactions WHERE reversal_of='ORIGINAL'").get().count, 1);
  } finally { env.sqlite.close(); }
});

test("two concurrent settlements cannot exceed the remaining amount", async () => {
  const env = database();
  try {
    const results = await Promise.allSettled([settle(env, 70000, "ONE"), settle(env, 70000, "TWO")]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(env.sqlite.prepare("SELECT SUM(amount) AS amount FROM transactions WHERE reversal_of='ORIGINAL'").get().amount, 70000);
  } finally { env.sqlite.close(); }
});

function backup() {
  return {
    format: "moneybook-backup", version: 3, exportedAt: "2026-11-16T00:00:00.000Z",
    payload: {
      bootstrap: { members: ["A"], ledgerConfig: { ledgerStartDate: "2026-01-01" }, inputPreferences: { configured: false }, automationSettings: { version: 1, recurringRules: [], benefitRules: [] } },
      categories: [{ categoryId: "C2", type: "수입", name: "급여", active: true }],
      accounts: [{ accountId: "A2", accountName: "새 계좌", accountType: "자산", subType: "통장", active: true }],
      transactions: [{ transactionId: "NEW", requestId: "NEW_REQ", date: "2026-11-16", type: "수입", categoryId: "C2", toAccountId: "A2", amount: 5000 }],
      assetSnapshots: [], investmentHoldings: [], investmentTrades: [], benefitRewardUsage: [], realEstateAssets: []
    }
  };
}

test("backup restore rolls back earlier writes if a later insert fails", async () => {
  const env = database();
  try {
    env.state.failSql = "INSERT INTO transactions";
    await assert.rejects(() => worker.mbD1RestoreBackupMerge(backup(), session, env), /injected write failure/);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS count FROM accounts WHERE account_id='A2'").get().count, 0);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS count FROM categories WHERE category_id='C2'").get().count, 0);
    assert.equal(env.sqlite.prepare("SELECT ledger_start_date FROM households WHERE household_id='HH_MAIN'").get().ledger_start_date, null);
    assert.equal(env.sqlite.prepare("SELECT amount FROM transactions WHERE transaction_id='ORIGINAL'").get().amount, 100000);
    env.state.failSql = "";
    await worker.mbD1RestoreBackupMerge(backup(), session, env);
    assert.equal(env.sqlite.prepare("SELECT amount FROM transactions WHERE transaction_id='NEW'").get().amount, 5000);
  } finally { env.sqlite.close(); }
});
