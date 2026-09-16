import test from "node:test";
import assert from "node:assert/strict";

import {
  BackupValidationError,
  findRequestIdConflicts,
  validateBackupDocument
} from "../worker/domain/backupRestore.js";

function sample(version = 3) {
  return {
    format: "moneybook-backup",
    version,
    exportedAt: "2026-09-15T00:00:00.000Z",
    payload: {
      bootstrap: {
        members: ["A", "B"],
        ledgerConfig: { ledgerStartDate: "2026-01-01" },
        inputPreferences: { configured: false, version: 1, preferences: null },
        automationSettings: { version: 1, recurringRules: [], benefitRules: [] }
      },
      categories: [{ categoryId: "C1", type: "지출", name: "식비", active: true }],
      accounts: [{ accountId: "A1", accountName: "카드", displayName: "카드", paymentAccountId: null }],
      transactions: [{ transactionId: "T1", date: "2026-09-01", type: "지출", categoryId: "C1", amount: 1000, paymentMethodId: "A1" }],
      assetSnapshots: [{ month: "2026-09", assets: 100, liabilities: 0, netWorth: 100 }],
      investmentHoldings: [],
      investmentTrades: [],
      investmentCash: null,
      benefitRewardUsage: [],
      realEstateAssets: [{ propertyId: "RE1", name: "우리집", propertyType: "아파트", address: "세종", lawdCode: "36110", apartmentName: "두루마을", exclusiveAreaSqm: 84.9, valuationMode: "manual", manualValueKrw: 500000000 }]
    }
  };
}

test("valid version 3 backup returns counts", () => {
  const result = validateBackupDocument(sample());
  assert.equal(result.summary.transactions, 1);
  assert.equal(result.summary.realEstateAssets, 1);
  assert.equal(result.summary.totalRecords, 5);
  assert.deepEqual(result.warnings, []);
});

test("version 1 backup is supported with a benefit warning", () => {
  const document = sample(1);
  delete document.payload.benefitRewardUsage;
  delete document.payload.realEstateAssets;
  const result = validateBackupDocument(document);
  assert.equal(result.version, 1);
  assert.match(result.warnings[0], /혜택 사용 누계/);
});


test("version 2 backup remains supported without real estate", () => {
  const document = sample(2);
  delete document.payload.realEstateAssets;
  const result = validateBackupDocument(document);
  assert.equal(result.version, 2);
  assert.equal(result.summary.realEstateAssets, 0);
});

test("duplicate transaction ids are rejected", () => {
  const document = sample();
  document.payload.transactions.push({ ...document.payload.transactions[0] });
  assert.throws(() => validateBackupDocument(document), BackupValidationError);
});

test("missing referenced account is rejected", () => {
  const document = sample();
  document.payload.transactions[0].paymentMethodId = "MISSING";
  assert.throws(
    () => validateBackupDocument(document),
    error => error instanceof BackupValidationError && error.code === "BACKUP_REFERENCE_MISSING"
  );
});

test("request id conflict helper ignores the same item id", () => {
  const items = [{ transactionId: "T1", requestId: "REQ1" }];
  const conflicts = findRequestIdConflicts(items, "transactionId", [
    { id: "T1", request_id: "REQ1" }
  ]);
  assert.deepEqual(conflicts, []);
});

test("request id conflict helper detects another item using the same request id", () => {
  const items = [{ transactionId: "T1", requestId: "REQ1" }];
  const conflicts = findRequestIdConflicts(items, "transactionId", [
    { id: "T9", request_id: "REQ1" }
  ]);
  assert.deepEqual(conflicts, [{ requestId: "REQ1", id: "T1" }]);
});


test("invalid transaction calendar date is rejected", () => {
  const document = sample();
  document.payload.transactions[0].date = "2026-02-30";
  assert.throws(
    () => validateBackupDocument(document),
    error => error instanceof BackupValidationError && error.code === "BACKUP_TRANSACTION_DATE_INVALID"
  );
});

test("invalid billing month is rejected", () => {
  const document = sample();
  document.payload.transactions[0].billingMonth = "2026-13";
  assert.throws(
    () => validateBackupDocument(document),
    error => error instanceof BackupValidationError && error.code === "BACKUP_TRANSACTION_BILLING_MONTH_INVALID"
  );
});

test("invalid snapshot month is rejected", () => {
  const document = sample();
  document.payload.assetSnapshots[0].month = "2026-99";
  assert.throws(
    () => validateBackupDocument(document),
    error => error instanceof BackupValidationError && error.code === "BACKUP_SNAPSHOT_MONTH_INVALID"
  );
});

test("invalid investment trade date is rejected", () => {
  const document = sample();
  document.payload.investmentHoldings.push({ holdingId: "H1", accountId: "A1", stockCode: "005930" });
  document.payload.investmentTrades.push({
    investmentTradeId: "IT1",
    tradeDate: "2026-02-31",
    tradeType: "매수",
    accountId: "A1",
    holdingId: "H1"
  });
  assert.throws(
    () => validateBackupDocument(document),
    error => error instanceof BackupValidationError && error.code === "BACKUP_TRADE_DATE_INVALID"
  );
});
