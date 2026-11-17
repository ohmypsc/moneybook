import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workerDir = fileURLToPath(new URL("../worker/", import.meta.url));
const routerSource = fs.readFileSync(`${workerDir}d1/router.js`, "utf8");
// change_log 기록은 여러 d1 모듈에 흩어져 있으므로 Worker 소스 전체를 모아서 검사합니다.
const source = fs
  .readdirSync(workerDir, { recursive: true })
  .filter(file => String(file).endsWith(".js"))
  .map(file => fs.readFileSync(`${workerDir}${file}`, "utf8"))
  .join("\n");

function routeBlock(name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(routerSource);
  assert.ok(match, `${name} block should exist`);
  return match[1];
}

test("settlement GET and POST APIs stay registered in the Worker router", () => {
  assert.match(routeBlock("getPaths"), /"\/api\/transactions\/settlement-summary"/);
  assert.match(routeBlock("postPaths"), /"\/api\/transactions\/settle"/);
});

test("push notification APIs stay registered in the Worker router", () => {
  assert.match(routeBlock("getPaths"), /"\/api\/push\/config"/);
  assert.match(routeBlock("postPaths"), /"\/api\/push\/subscribe"/);
  assert.match(routeBlock("postPaths"), /"\/api\/push\/unsubscribe"/);
  assert.match(routeBlock("postPaths"), /"\/api\/push\/test"/);
});

test("change_log actions written by the Worker are allowed by the DB CHECK constraint", () => {
  const allowed = new Set(["created", "updated", "deleted", "restored"]);
  const actions = [
    ...source.matchAll(/mbD1InsertChange\(\s*env,\s*[^,]+,\s*[^,]+,\s*"([a-z_]+)"/g)
  ].map(match => match[1]);
  assert.ok(actions.length > 10, "should find the change log writes");
  assert.deepEqual(
    actions.filter(action => !allowed.has(action)),
    []
  );
});

test("year-end tax APIs stay registered in the Worker router", () => {
  assert.match(routeBlock("getPaths"), /"\/api\/tax\/summary"/);
  assert.match(routeBlock("postPaths"), /"\/api\/tax\/profile"/);
  assert.match(routeBlock("postPaths"), /"\/api\/tax\/category"/);
  assert.match(routeBlock("postPaths"), /"\/api\/tax\/preset"/);
});
