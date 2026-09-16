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
