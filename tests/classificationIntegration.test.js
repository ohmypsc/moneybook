import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Run the actual Worker domain functions against SQLite without production credentials.
// The adapter implements D1's atomic batch contract and asynchronous read boundaries.
// Worker 모듈을 직접 불러옵니다. (Durable Object 진입점은 Cloudflare 런타임 전용이라 제외)
const worker = {
  ...await import("../worker/d1/classification.js"),
  ...await import("../worker/d1/router.js"),
  ...await import("../worker/d1/queries.js"),
  ...await import("../worker/d1/transactions.js"),
  ...await import("../worker/d1/backup.js"),
  ...await import("../worker/d1/settings.js")
};

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

const session = {name:'A'};
const rule = {id:'CAFE',name:'카페 규칙',type:'지출',contains:'스타벅스',accountId:'A1',categoryId:'C2',tags:['제주여행'],enabled:true};
function seed(env) { env.sqlite.exec("INSERT INTO categories(category_id,household_id,type,name) VALUES('C2','HH_MAIN','지출','카페');"); }
const create = (env, overrides = {}) => worker.mbD1HandleTransactionMutation('/api/transactions', {requestId:crypto.randomUUID(),type:'지출',date:'2026-11-16',amount:5000,categoryId:'C1',categorySource:'auto',paymentMethodId:'A1',spendingTarget:'A',description:'스타벅스',...overrides},session,env);
const rules = env => worker.mbSaveClassification({version:0,rules:[rule]},session,env);

test('new transactions classify, retain manual choices and survive idempotent retry',async()=>{
 const env=database();seed(env);try {
  await rules(env);
  const a=await create(env,{requestId:'ONCE',tags:['가족']});
  assert.equal(a.transaction.categoryId,'C2');assert.deepEqual(a.transaction.tags,['가족','제주여행']);
  const retry=await create(env,{requestId:'ONCE'});assert.equal(retry.duplicate,true);
  const b=await create(env,{categorySource:'manual'});assert.equal(b.transaction.categoryId,'C1');assert.deepEqual(b.transaction.tags,['제주여행']);
  const c=await create(env,{categorySource:'manual',description:'편의점'});assert.deepEqual(c.transaction.tags,[]);
 } finally {env.sqlite.close();}
});
test('tag edit has optimistic concurrency and tag filter applies before pagination',async()=>{
 const env=database();seed(env);try {
  const a=await create(env,{description:'카페',tags:['여행']});
  await worker.mbD1HandleTransactionMutation('/api/transactions/update',{transactionId:a.transactionId,expectedUpdatedAtMs:a.transaction.updatedAtMs,tags:['가족']},session,env);
  await assert.rejects(()=>worker.mbD1HandleTransactionMutation('/api/transactions/update',{transactionId:a.transactionId,expectedUpdatedAtMs:a.transaction.updatedAtMs,tags:['오래된 수정']},session,env),/다른 기기/);
  const page=await worker.mbD1GetTransactionsData(env,new URL('https://local/api/transactions?tag='+encodeURIComponent('가족')+'&limit=1'));
  assert.equal(page.total,1);assert.equal(page.items[0].transactionId,a.transactionId);
  const empty=await worker.mbD1GetTransactionsData(env,new URL('https://local/api/transactions?tag='+encodeURIComponent("' OR 1=1 --")));
  assert.equal(empty.total,0);
 } finally {env.sqlite.close();}
});
test('preview makes no changes, old manual categories survive, stale previews are rejected',async()=>{
 const env=database();seed(env);try {
  const a=await create(env,{categorySource:'manual'});await rules(env);
  const preview=await worker.mbClassificationPreview({dateFrom:'2026-11-01',dateTo:'2026-11-30'},env);
  assert.equal(preview.items.length,1);assert.deepEqual(env.sqlite.prepare('SELECT tags_json FROM transactions WHERE transaction_id=?').get(a.transactionId).tags_json,'[]');
  assert.equal(preview.items[0].afterCategory,preview.items[0].beforeCategory);
  const result=await worker.mbApplyClassification({version:preview.version,items:preview.items,confirm:'APPLY_RULES'},session,env);
  assert.equal(result.results[0].applied,true);
  const stale=await worker.mbApplyClassification({version:preview.version,items:preview.items,confirm:'APPLY_RULES'},session,env);
  assert.equal(stale.results[0].applied,false);
 } finally {env.sqlite.close();}
});
test('concurrent settings saves cannot silently overwrite each other',async()=>{
 const env=database();seed(env);try {
  const result=await Promise.allSettled([rules(env),rules(env)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 } finally {env.sqlite.close();}
});
test('backup roundtrip preserves rules, provenance and tags; old backups keep existing metadata',async()=>{
 const env=database();const target=database();seed(env);try {
  await rules(env);const a=await create(env,{tags:['가족']});
  const backup=await worker.mbD1BuildBackupDocument(env);
  assert.equal(backup.payload.classificationSettings.rules.length,1);
  await worker.mbD1RestoreBackupMerge(backup,session,target);
  let restored=await worker.mbD1BuildBackupDocument(target);
  assert.deepEqual(restored.payload.transactions.find(t=>t.transactionId===a.transactionId).tags,['가족','제주여행']);
  assert.equal(restored.payload.transactions.find(t=>t.transactionId===a.transactionId).categorySource,'auto');
  assert.equal(restored.payload.classificationSettings.rules[0].name,'카페 규칙');
  delete backup.payload.classificationSettings;
  backup.payload.transactions.forEach(t=>{delete t.tags;delete t.categorySource;});
  await worker.mbD1RestoreBackupMerge(backup,session,target);
  restored=await worker.mbD1BuildBackupDocument(target);
  assert.deepEqual(restored.payload.transactions.find(t=>t.transactionId===a.transactionId).tags,['가족','제주여행']);
  assert.equal(restored.payload.classificationSettings.rules.length,1);
 } finally {env.sqlite.close();target.sqlite.close();}
});
test('invalid tags and invalid backup rules are rejected before writing transactions',async()=>{
 const env=database();seed(env);try {
  await assert.rejects(()=>create(env,{tags:['a'.repeat(31)]}),/30자/);
  const backup=await worker.mbD1BuildBackupDocument(env);backup.payload.classificationSettings.rules=[{...rule,contains:'',accountId:''}];
  const batches=env.state.batches;
  await assert.rejects(()=>worker.mbD1RestoreBackupMerge(backup,session,env),/조건/);
  assert.equal(env.state.batches,batches);
 } finally {env.sqlite.close();}
});
