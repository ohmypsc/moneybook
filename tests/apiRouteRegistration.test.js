import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("../worker/index.js", import.meta.url));
const source = fs.readFileSync(workerPath, "utf8");

function routeBlock(name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source);
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
  const actions = [...source.matchAll(/mbD1InsertChange\(\s*env,\s*[^,]+,\s*[^,]+,\s*"([a-z_]+)"/g)].map(match => match[1]);
  assert.ok(actions.length > 10, "should find the change log writes");
  assert.deepEqual(actions.filter(action => !allowed.has(action)), []);
});
