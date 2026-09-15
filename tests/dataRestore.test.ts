import test from "node:test";
import assert from "node:assert/strict";

import { parseMoneybookBackupText } from "../src/api/dataBackupFormat.ts";

const base = {
  format: "moneybook-backup",
  version: 2,
  exportedAt: "2026-09-15T00:00:00.000Z",
  payload: {
    bootstrap: {},
    categories: [],
    accounts: [],
    transactions: [],
    assetSnapshots: [],
    investmentHoldings: [],
    investmentTrades: [],
    investmentCash: null,
    benefitRewardUsage: []
  }
};

test("backup text parser accepts supported backup versions", () => {
  const parsed = parseMoneybookBackupText(JSON.stringify(base));
  assert.equal(parsed.version, 2);
  assert.equal(parsed.format, "moneybook-backup");
});

test("backup text parser rejects non-moneybook json", () => {
  assert.throws(
    () => parseMoneybookBackupText('{"format":"other","version":2,"payload":{}}'),
    /Moneybook 백업 파일/
  );
});

test("backup text parser rejects unsupported versions", () => {
  assert.throws(
    () => parseMoneybookBackupText(JSON.stringify({ ...base, version: 99 })),
    /지원하지 않는 백업 버전/
  );
});
