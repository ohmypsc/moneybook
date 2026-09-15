import test from "node:test";
import assert from "node:assert/strict";

import { createBackupDocument } from "../src/api/dataBackupFormat.ts";

const payload = {
  bootstrap: {
    backendVersion: "test",
    transactionTypes: ["지출" as const],
    investmentTradeTypes: [],
    members: ["A"],
    spendingTargets: ["공동"],
    accounts: [],
    categories: [],
    investmentAccounts: [],
    ledgerConfig: { ledgerStartDate: null }
  },
  categories: [],
  accounts: [],
  transactions: [],
  assetSnapshots: [],
  investmentHoldings: [],
  investmentTrades: [],
  investmentCash: null
};

test("backup document carries a stable format/version envelope", () => {
  const backup = createBackupDocument(payload, "2026-09-15T00:00:00.000Z");

  assert.equal(backup.format, "moneybook-backup");
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, "2026-09-15T00:00:00.000Z");
  assert.equal(backup.payload.bootstrap.backendVersion, "test");
});
