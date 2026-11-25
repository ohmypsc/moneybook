import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Run the actual Worker domain functions against SQLite without production credentials.
// The adapter implements D1's atomic batch contract and asynchronous read boundaries.
// Worker 모듈을 직접 불러옵니다. (Durable Object 진입점은 Cloudflare 런타임 전용이라 제외)
const worker = {
  ...(await import("../worker/d1/router.js")),
  ...(await import("../worker/d1/queries.js")),
  ...(await import("../worker/d1/transactions.js")),
  ...(await import("../worker/d1/backup.js")),
  ...(await import("../worker/d1/settings.js"))
};

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0000_schema.sql", import.meta.url), "utf8"));
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_request_id_unique_indexes.sql", import.meta.url),
      "utf8"
    )
  );
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
        sql,
        values: [],
        bind(...values) {
          return { ...this, values };
        },
        async all() {
          return { results: sqlite.prepare(this.sql).all(...this.values) };
        },
        async first() {
          return sqlite.prepare(this.sql).get(...this.values) || null;
        },
        async run() {
          return { success: true, meta: sqlite.prepare(this.sql).run(...this.values) };
        }
      };
      return statement;
    },
    async batch(statements) {
      state.batches += 1;
      sqlite.exec("BEGIN");
      try {
        const result = statements.map(statement => {
          if (state.failSql && statement.sql.includes(state.failSql))
            throw new Error("injected write failure");
          return { success: true, results: sqlite.prepare(statement.sql).all(...statement.values) };
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { sqlite, DB, state };
}

const session = { name: "A" };
function seed(env) {
  env.sqlite.exec(
    "INSERT INTO categories(category_id,household_id,type,name) VALUES('C2','HH_MAIN','지출','카페');"
  );
}
const create = (env, overrides = {}) =>
  worker.mbD1HandleTransactionMutation(
    "/api/transactions",
    {
      requestId: crypto.randomUUID(),
      type: "지출",
      date: "2026-11-16",
      amount: 5000,
      categoryId: "C1",
      paymentMethodId: "A1",
      spendingTarget: "A",
      description: "스타벅스",
      ...overrides
    },
    session,
    env
  );

test("new transactions keep the chosen category and tags and survive idempotent retry", async () => {
  const env = database();
  seed(env);
  try {
    // 예전 자동 분류 규칙이 DB에 남아 있어도 더 이상 적용하지 않습니다.
    env.sqlite
      .exec(`INSERT INTO user_preferences(preference_id,household_id,preference_key,preference_json,version,created_at,updated_at)
      VALUES('PREF_CLASSIFICATION_HH_MAIN','HH_MAIN','classification_rules','[{"id":"R","name":"카페","type":"지출","contains":"스타벅스","accountId":"","categoryId":"C2","tags":["자동"],"enabled":true}]',1,'2026-01-01','2026-01-01');`);
    const a = await create(env, { requestId: "ONCE", tags: ["가족"], categorySource: "auto" });
    assert.equal(a.transaction.categoryId, "C1");
    assert.deepEqual(a.transaction.tags, ["가족"]);
    assert.equal(a.transaction.categorySource, "manual");
    const retry = await create(env, { requestId: "ONCE" });
    assert.equal(retry.duplicate, true);
    const b = await create(env);
    assert.deepEqual(b.transaction.tags, []);
  } finally {
    env.sqlite.close();
  }
});
test("tag edit has optimistic concurrency and tag filter applies before pagination", async () => {
  const env = database();
  seed(env);
  try {
    const a = await create(env, { description: "카페", tags: ["여행"] });
    await worker.mbD1HandleTransactionMutation(
      "/api/transactions/update",
      {
        transactionId: a.transactionId,
        expectedUpdatedAtMs: a.transaction.updatedAtMs,
        tags: ["가족"]
      },
      session,
      env
    );
    await assert.rejects(
      () =>
        worker.mbD1HandleTransactionMutation(
          "/api/transactions/update",
          {
            transactionId: a.transactionId,
            expectedUpdatedAtMs: a.transaction.updatedAtMs,
            tags: ["오래된 수정"]
          },
          session,
          env
        ),
      /다른 기기/
    );
    const page = await worker.mbD1GetTransactionsData(
      env,
      new URL("https://local/api/transactions?tag=" + encodeURIComponent("가족") + "&limit=1")
    );
    assert.equal(page.total, 1);
    assert.equal(page.items[0].transactionId, a.transactionId);
    const empty = await worker.mbD1GetTransactionsData(
      env,
      new URL("https://local/api/transactions?tag=" + encodeURIComponent("' OR 1=1 --"))
    );
    assert.equal(empty.total, 0);
  } finally {
    env.sqlite.close();
  }
});
test("backup roundtrip preserves tags; old backups with rules still restore", async () => {
  const env = database();
  const target = database();
  seed(env);
  try {
    const a = await create(env, { tags: ["가족", "여행"] });
    const backup = await worker.mbD1BuildBackupDocument(env);
    assert.equal(backup.payload.classificationSettings, undefined);
    // 예전 백업에 들어 있던 규칙(형식이 틀려도)은 무시하고 복원합니다.
    backup.payload.classificationSettings = { version: 1, rules: [{ broken: true }] };
    await worker.mbD1RestoreBackupMerge(backup, session, target);
    let restored = await worker.mbD1BuildBackupDocument(target);
    assert.deepEqual(
      restored.payload.transactions.find(t => t.transactionId === a.transactionId).tags,
      ["가족", "여행"]
    );
    delete backup.payload.classificationSettings;
    backup.payload.transactions.forEach(t => {
      delete t.tags;
      delete t.categorySource;
    });
    await worker.mbD1RestoreBackupMerge(backup, session, target);
    restored = await worker.mbD1BuildBackupDocument(target);
    assert.deepEqual(
      restored.payload.transactions.find(t => t.transactionId === a.transactionId).tags,
      ["가족", "여행"]
    );
  } finally {
    env.sqlite.close();
    target.sqlite.close();
  }
});
test("invalid tags are rejected before writing transactions", async () => {
  const env = database();
  seed(env);
  try {
    await assert.rejects(() => create(env, { tags: ["a".repeat(31)] }), /30자/);
  } finally {
    env.sqlite.close();
  }
});
