import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Run the actual Worker domain functions against SQLite without production credentials.
// The adapter implements D1's atomic batch contract and asynchronous read boundaries.
// Worker 모듈을 직접 불러옵니다. (Durable Object 진입점은 Cloudflare 런타임 전용이라 제외)
const worker = {
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
const settle = (env, amount, requestId) =>
  worker.mbD1HandleTransactionMutation(
    "/api/transactions/settle",
    {
      transactionId: "ORIGINAL",
      amount,
      requestId,
      toAccountId: "A1",
      date: "2026-11-16"
    },
    session,
    env
  );

test("settlement retry after a full payment returns the existing result", async () => {
  const env = database();
  try {
    const first = await settle(env, 100000, "SAME");
    const retry = await settle(env, 100000, "SAME");
    assert.equal(first.created, true);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.summary.remainingAmount, 0);
    assert.equal(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM transactions WHERE reversal_of='ORIGINAL'")
        .get().count,
      1
    );
  } finally {
    env.sqlite.close();
  }
});

test("two concurrent settlements cannot exceed the remaining amount", async () => {
  const env = database();
  try {
    const results = await Promise.allSettled([
      settle(env, 70000, "ONE"),
      settle(env, 70000, "TWO")
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(
      env.sqlite
        .prepare("SELECT SUM(amount) AS amount FROM transactions WHERE reversal_of='ORIGINAL'")
        .get().amount,
      70000
    );
  } finally {
    env.sqlite.close();
  }
});

function backup() {
  return {
    format: "moneybook-backup",
    version: 3,
    exportedAt: "2026-11-16T00:00:00.000Z",
    payload: {
      bootstrap: {
        members: ["A"],
        ledgerConfig: { ledgerStartDate: "2026-01-01" },
        inputPreferences: { configured: false },
        automationSettings: { version: 1, recurringRules: [], benefitRules: [] }
      },
      categories: [{ categoryId: "C2", type: "수입", name: "급여", active: true }],
      accounts: [
        {
          accountId: "A2",
          accountName: "새 계좌",
          accountType: "자산",
          subType: "통장",
          active: true
        }
      ],
      transactions: [
        {
          transactionId: "NEW",
          requestId: "NEW_REQ",
          date: "2026-11-16",
          type: "수입",
          categoryId: "C2",
          toAccountId: "A2",
          amount: 5000
        }
      ],
      assetSnapshots: [],
      investmentHoldings: [],
      investmentTrades: [],
      benefitRewardUsage: [],
      realEstateAssets: []
    }
  };
}

test("backup restore rolls back earlier writes if a later insert fails", async () => {
  const env = database();
  try {
    env.state.failSql = "INSERT INTO transactions";
    await assert.rejects(
      () => worker.mbD1RestoreBackupMerge(backup(), session, env),
      /injected write failure/
    );
    assert.equal(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM accounts WHERE account_id='A2'").get()
        .count,
      0
    );
    assert.equal(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM categories WHERE category_id='C2'").get()
        .count,
      0
    );
    assert.equal(
      env.sqlite
        .prepare("SELECT ledger_start_date FROM households WHERE household_id='HH_MAIN'")
        .get().ledger_start_date,
      null
    );
    assert.equal(
      env.sqlite.prepare("SELECT amount FROM transactions WHERE transaction_id='ORIGINAL'").get()
        .amount,
      100000
    );
    env.state.failSql = "";
    await worker.mbD1RestoreBackupMerge(backup(), session, env);
    assert.equal(
      env.sqlite.prepare("SELECT amount FROM transactions WHERE transaction_id='NEW'").get().amount,
      5000
    );
  } finally {
    env.sqlite.close();
  }
});

const basePreferences = {
  version: 1,
  categoryOrder: { 지출: ["C1"], 수입: [], 이체: [] },
  accountOrder: ["A1"],
  hiddenAccountIds: []
};

test("personal input settings inherit legacy defaults without overwriting the partner", async () => {
  const env = database();
  try {
    env.sqlite
      .prepare(
        "INSERT INTO user_preferences(preference_id,household_id,preference_key,preference_json) VALUES ('PREF_INPUT_SHARED','HH_MAIN','input_preferences',?)"
      )
      .run(JSON.stringify(basePreferences));
    const first = await worker.mbD1InputPreferencesData(env, "미영");
    assert.equal(first.ownerName, "미영");
    assert.deepEqual(first.preferences.accountOrder, ["A1"]);
    await worker.mbD1HandleInputPreferences(
      { preferences: { ...basePreferences, hiddenAccountIds: ["A1"] }, ownerName: "승철" },
      { name: "미영" },
      env
    );
    assert.deepEqual(
      (await worker.mbD1InputPreferencesData(env, "미영")).preferences.hiddenAccountIds,
      ["A1"]
    );
    assert.deepEqual(
      (await worker.mbD1InputPreferencesData(env, "승철")).preferences.hiddenAccountIds,
      []
    );
    await worker.mbD1HandleInputPreferences(
      { preferences: { ...basePreferences, accountOrder: ["A1", "A2"] } },
      { name: "승철" },
      env
    );
    assert.deepEqual(
      (await worker.mbD1InputPreferencesData(env, "미영")).preferences.accountOrder,
      ["A1"]
    );
    assert.deepEqual(
      (await worker.mbD1InputPreferencesData(env, "승철")).preferences.accountOrder,
      ["A1", "A2"]
    );
  } finally {
    env.sqlite.close();
  }
});

test("living-account selection is shared and rejects unavailable accounts", async () => {
  const env = database();
  try {
    await worker.mbD1SaveHouseholdOverview({ livingAccountIds: ["A1", "A1"] }, session, env);
    assert.deepEqual(await worker.mbD1HouseholdOverviewData(env), { livingAccountIds: ["A1"] });
    await assert.rejects(
      () => worker.mbD1SaveHouseholdOverview({ livingAccountIds: ["missing"] }, session, env),
      /계좌/
    );
    assert.deepEqual(await worker.mbD1HouseholdOverviewData(env), { livingAccountIds: ["A1"] });
  } finally {
    env.sqlite.close();
  }
});

test("recent changes show newest financial changes, while incremental sync keeps ascending order", async () => {
  const env = database();
  try {
    env.sqlite
      .exec(`INSERT INTO change_log(household_id,entity_type,entity_id,action,payload_json) VALUES
      ('HH_MAIN','transaction','OLD','created','{"amount":1000}'),
      ('HH_MAIN','input_preferences','미영','updated',NULL),
      ('HH_MAIN','transaction','NEW','updated','{"amount":5000,"before":{"amount":1000}}');`);
    const recent = await worker.mbD1GetChangesData(
      env,
      new URL("https://example/api/changes?recent=1&limit=1")
    );
    assert.deepEqual(
      recent.changes.map(row => row.entityId),
      ["NEW"]
    );
    assert.equal(recent.hasMore, false);
    const sync = await worker.mbD1GetChangesData(
      env,
      new URL("https://example/api/changes?after=0")
    );
    assert.deepEqual(
      sync.changes.map(row => row.entityId),
      ["OLD", "미영", "NEW"]
    );
  } finally {
    env.sqlite.close();
  }
});

test("backup merge preserves both people's quick-entry settings and shared living accounts", async () => {
  const env = database();
  try {
    const document = backup();
    document.payload.userDisplayPreferences = [
      {
        key: "input_preferences:미영",
        value: { ...basePreferences, quickEntries: [{ id: "Q", name: "점심" }] }
      },
      { key: "input_preferences:승철", value: { ...basePreferences, hiddenAccountIds: ["A1"] } },
      { key: "household_overview", value: { livingAccountIds: ["A1"] } }
    ];
    await worker.mbD1RestoreBackupMerge(document, session, env);
    assert.equal(
      (await worker.mbD1InputPreferencesData(env, "미영")).preferences.quickEntries[0].name,
      "점심"
    );
    assert.deepEqual(
      (await worker.mbD1InputPreferencesData(env, "승철")).preferences.hiddenAccountIds,
      ["A1"]
    );
    const exported = await worker.mbD1BuildBackupDocument(env);
    assert.equal(exported.payload.userDisplayPreferences.length, 3);
  } finally {
    env.sqlite.close();
  }
});

const removeOriginal = (env, expectedUpdatedAtMs = Date.parse("2026-11-16T00:00:00.000Z")) =>
  worker.mbD1HandleTransactionMutation(
    "/api/transactions/delete",
    { transactionId: "ORIGINAL", expectedUpdatedAtMs },
    session,
    env
  );

test("deletion rejects a stale screen and leaves the partner's changes intact", async () => {
  const env = database();
  try {
    env.sqlite.exec(
      "UPDATE transactions SET amount=120000,updated_at='2026-11-16T00:01:00.000Z' WHERE transaction_id='ORIGINAL'"
    );
    await assert.rejects(removeOriginal(env), /다른 기기에서 수정/);
    const row = env.sqlite
      .prepare("SELECT amount,deleted_at FROM transactions WHERE transaction_id='ORIGINAL'")
      .get();
    assert.equal(row.amount, 120000);
    assert.equal(row.deleted_at, null);
  } finally {
    env.sqlite.close();
  }
});

test("deletion requires a screen version, allows a current version and is retry safe", async () => {
  const env = database();
  try {
    await assert.rejects(
      worker.mbD1HandleTransactionMutation(
        "/api/transactions/delete",
        { transactionId: "ORIGINAL" },
        session,
        env
      ),
      /최신 버전/
    );
    assert.equal((await removeOriginal(env)).deleted, true);
    assert.equal((await removeOriginal(env)).alreadyDeleted, true);
    assert.equal(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM change_log WHERE action='deleted'").get()
        .count,
      1
    );
  } finally {
    env.sqlite.close();
  }
});

test("deletion rolls back when another device edits immediately before the write", async () => {
  const env = database();
  try {
    const batch = env.DB.batch;
    env.DB.batch = async statements => {
      env.sqlite.exec(
        "UPDATE transactions SET amount=200000,updated_at='2026-11-16T00:02:00.000Z' WHERE transaction_id='ORIGINAL'"
      );
      return batch(statements);
    };
    await assert.rejects(removeOriginal(env), /変更|변경/);
    assert.equal(
      env.sqlite
        .prepare("SELECT deleted_at FROM transactions WHERE transaction_id='ORIGINAL'")
        .get().deleted_at,
      null
    );
    assert.equal(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM change_log WHERE action='deleted'").get()
        .count,
      0
    );
  } finally {
    env.sqlite.close();
  }
});

test("deletion cannot orphan a settlement added immediately before the write", async () => {
  const env = database();
  try {
    const batch = env.DB.batch;
    env.DB.batch = async statements => {
      env.sqlite
        .exec(`INSERT INTO transactions(transaction_id,household_id,request_id,date,type,amount,reversal_of)
        VALUES ('NEW_SETTLEMENT','HH_MAIN','NEW_SETTLEMENT','2026-11-16','수입',1000,'ORIGINAL')`);
      return batch(statements);
    };
    await assert.rejects(removeOriginal(env), /변경/);
    assert.equal(
      env.sqlite
        .prepare("SELECT deleted_at FROM transactions WHERE transaction_id='ORIGINAL'")
        .get().deleted_at,
      null
    );
    assert.equal(
      env.sqlite.prepare("SELECT COUNT(*) AS count FROM change_log WHERE action='deleted'").get()
        .count,
      0
    );
  } finally {
    env.sqlite.close();
  }
});

test("report drilldown matches the month, exact category name and original expenses", async () => {
  const env = database();
  try {
    env.sqlite.exec(`
      INSERT INTO categories(category_id,household_id,type,name,is_active) VALUES ('OLD_CATEGORY','HH_MAIN','지출','경조사비',0);
      INSERT INTO transactions(transaction_id,household_id,date,type,category_id,amount,description,reversal_of,deleted_at) VALUES
      ('OLD','HH_MAIN','2026-11-10','지출','OLD_CATEGORY',1000,'',NULL,NULL),
      ('OTHER_MONTH','HH_MAIN','2026-10-10','지출','C1',1000,'',NULL,NULL),
      ('INCOME','HH_MAIN','2026-11-10','수입','C1',1000,'',NULL,NULL),
      ('REVERSAL','HH_MAIN','2026-11-10','지출','C1',1000,'','INCOME',NULL),
      ('DELETED','HH_MAIN','2026-11-10','지출','C1',1000,'',NULL,'2026-11-11'),
      ('TEXT_ONLY','HH_MAIN','2026-11-10','지출',NULL,1000,'경조사비',NULL,NULL);`);
    const result = await worker.mbD1GetTransactionsData(
      env,
      new URL(
        "https://example.test/api/transactions?dateFrom=2026-11-01&dateTo=2026-11-30&expenseCategory=" +
          encodeURIComponent("경조사비")
      )
    );
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map(item => item.transactionId).sort(), ["OLD", "ORIGINAL"]);
    const page = await worker.mbD1GetTransactionsData(
      env,
      new URL(
        "https://example.test/api/transactions?dateFrom=2026-11-01&dateTo=2026-11-30&limit=1&offset=1&expenseCategory=" +
          encodeURIComponent("경조사비")
      )
    );
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].transactionId, "OLD");
  } finally {
    env.sqlite.close();
  }
});

test("report target drilldown includes only the exact target and supports uncategorized rows", async () => {
  const env = database();
  try {
    env.sqlite.exec(`UPDATE transactions SET spending_target='미영' WHERE transaction_id='ORIGINAL';
      INSERT INTO transactions(transaction_id,household_id,date,type,amount,spending_target) VALUES
      ('OTHER','HH_MAIN','2026-11-10','지출',1000,'승철'),
      ('UNCLASSIFIED','HH_MAIN','2026-11-10','지출',1000,NULL),
      ('TARGET_INCOME','HH_MAIN','2026-11-10','수입',1000,'미영');`);
    const get = (key, value) =>
      worker.mbD1GetTransactionsData(
        env,
        new URL(
          "https://example.test/api/transactions?dateFrom=2026-11-01&dateTo=2026-11-30&" +
            key +
            "=" +
            encodeURIComponent(value)
        )
      );
    assert.deepEqual(
      (await get("expenseTarget", "미영")).items.map(item => item.transactionId),
      ["ORIGINAL"]
    );
    assert.deepEqual(
      (await get("expenseTarget", "미분류")).items.map(item => item.transactionId),
      ["UNCLASSIFIED"]
    );
    assert.equal((await get("expenseCategory", "' OR 1=1 --")).total, 0);
    assert.equal((await get("expenseCategory", "미분류")).total, 2);
  } finally {
    env.sqlite.close();
  }
});

function addExpense(env, id, date, amount, settlementExpected = 1) {
  env.sqlite
    .prepare(
      `INSERT INTO transactions(transaction_id,household_id,request_id,date,type,category_id,amount,payment_method_id,updated_at,settlement_expected)
       VALUES (?,'HH_MAIN',?,?,'지출','C1',?,'A1','2026-11-16T00:00:00.000Z',?)`
    )
    .run(id, `${id}_REQ`, date, amount, settlementExpected);
}

const settleBatch = (env, items, requestId, date = "2026-11-20") =>
  worker.mbD1HandleTransactionMutation(
    "/api/transactions/settle-batch",
    { items, requestId, toAccountId: "A1", date, memo: "11월 회식비" },
    session,
    env
  );

test("settlement date can be chosen but not before the original expense", async () => {
  const env = database();
  try {
    const result = await worker.mbD1HandleTransactionMutation(
      "/api/transactions/settle",
      { transactionId: "ORIGINAL", amount: 10000, toAccountId: "A1", date: "2026-11-18" },
      session,
      env
    );
    assert.equal(result.transaction.date, "2026-11-18");
    await assert.rejects(
      worker.mbD1HandleTransactionMutation(
        "/api/transactions/settle",
        { transactionId: "ORIGINAL", amount: 10000, toAccountId: "A1", date: "2026-11-15" },
        session,
        env
      ),
      /원래 지출일/
    );
  } finally {
    env.sqlite.close();
  }
});

test("batch settlement links one settlement per expense in one group atomically", async () => {
  const env = database();
  try {
    await worker.mbD1HandleTransactionMutation(
      "/api/transactions/settle",
      { transactionId: "ORIGINAL", amount: 1, toAccountId: "A1", date: "2026-11-16" },
      session,
      env
    ); // ensures schema columns exist before raw inserts below
    addExpense(env, "E2", "2026-11-03", 60000);
    addExpense(env, "E3", "2026-11-10", 40000);
    const result = await settleBatch(
      env,
      [
        { transactionId: "E2", amount: 60000 },
        { transactionId: "E3", amount: 25000 }
      ],
      "BATCH1"
    );
    assert.equal(result.created, true);
    assert.equal(result.transactions.length, 2);
    assert.ok(result.groupId);
    assert.ok(result.transactions.every(item => item.groupId === result.groupId));
    assert.ok(result.transactions.every(item => item.date === "2026-11-20"));
    assert.deepEqual(
      result.summaries.map(summary => summary.remainingAmount),
      [0, 15000]
    );

    const retry = await settleBatch(
      env,
      [
        { transactionId: "E2", amount: 60000 },
        { transactionId: "E3", amount: 25000 }
      ],
      "BATCH1"
    );
    assert.equal(retry.duplicate, true);
    assert.equal(
      env.sqlite
        .prepare("SELECT COUNT(*) AS count FROM transactions WHERE group_id=?")
        .get(result.groupId).count,
      2
    );

    // One over-limit item rejects the whole batch.
    await assert.rejects(
      settleBatch(
        env,
        [
          { transactionId: "E3", amount: 10000 },
          { transactionId: "ORIGINAL", amount: 999999 }
        ],
        "BATCH2"
      ),
      /초과할 수 없습니다/
    );
    assert.equal(
      env.sqlite
        .prepare("SELECT SUM(amount) AS amount FROM transactions WHERE reversal_of='E3'")
        .get().amount,
      25000
    );

    const candidates = await worker.mbD1SettlementCandidatesData(
      env,
      new URL("https://local/api/transactions/settlement-candidates")
    );
    assert.deepEqual(
      candidates.items.map(item => [item.transactionId, item.remainingAmount]),
      [["E3", 15000]]
    );
    const withOpened = await worker.mbD1SettlementCandidatesData(
      env,
      new URL("https://local/api/transactions/settlement-candidates?includeTransactionId=ORIGINAL")
    );
    assert.deepEqual(
      withOpened.items.map(item => item.transactionId),
      ["E3", "ORIGINAL"]
    );
  } finally {
    env.sqlite.close();
  }
});

test("settlementExpected is saved on create and update only for expenses", async () => {
  const env = database();
  try {
    const created = await worker.mbD1HandleTransactionMutation(
      "/api/transactions",
      {
        date: "2026-11-16",
        type: "지출",
        categoryId: "C1",
        amount: 30000,
        paymentMethodId: "A1",
        spendingTarget: "A",
        description: "회식",
        settlementExpected: true,
        requestId: "NEW_EXPENSE"
      },
      session,
      env
    );
    assert.equal(created.transaction.settlementExpected, true);
    const updated = await worker.mbD1HandleTransactionMutation(
      "/api/transactions/update",
      {
        transactionId: created.transaction.transactionId,
        expectedUpdatedAtMs: created.transaction.updatedAtMs,
        settlementExpected: false
      },
      session,
      env
    );
    assert.equal(updated.transaction.settlementExpected, false);
    await assert.rejects(
      worker.mbD1HandleTransactionMutation(
        "/api/transactions/update",
        {
          transactionId: created.transaction.transactionId,
          expectedUpdatedAtMs: updated.transaction.updatedAtMs,
          settlementExpected: "yes"
        },
        session,
        env
      ),
      /true 또는 false/
    );
  } finally {
    env.sqlite.close();
  }
});
