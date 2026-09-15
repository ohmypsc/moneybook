import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransactionSearchWhere,
  escapeSqlLike,
  normalizeTransactionPagination
} from "../worker/domain/transactionSearch.js";

test("transaction pagination clamps limit and offset", () => {
  assert.deepEqual(normalizeTransactionPagination("5000", "-4"), {
    limit: 1000,
    offset: 0
  });
  assert.deepEqual(normalizeTransactionPagination("100", "30"), {
    limit: 100,
    offset: 30
  });
});

test("transaction search escapes SQL LIKE wildcard characters", () => {
  assert.equal(escapeSqlLike("50%_off\\memo"), "50\\%\\_off\\\\memo");
});

test("transaction search binds account filters to all three account columns", () => {
  const result = buildTransactionSearchWhere({
    householdId: "HH_MAIN",
    accountId: "A1",
    query: "카페%"
  });

  assert.match(result.whereSql, /from_account_id=\?/);
  assert.match(result.whereSql, /payment_method_id=\?/);
  assert.match(result.whereSql, /LIKE \? ESCAPE/);
  assert.deepEqual(result.binds, [
    "HH_MAIN",
    "A1",
    "A1",
    "A1",
    "%카페\\%%"
  ]);
});
