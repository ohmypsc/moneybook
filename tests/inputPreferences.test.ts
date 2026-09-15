import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCategoryPreferences,
  createDefaultInputPreferences,
  normalizeInputPreferences,
  parseInputPreferences,
  sortAccountsByPreferences
} from "../src/utils/inputPreferences.ts";

const categories = [
  { categoryId: "EXP_B", type: "지출" as const, name: "교통" },
  { categoryId: "EXP_A", type: "지출" as const, name: "식비" },
  { categoryId: "INC_A", type: "수입" as const, name: "급여" }
];

const accounts = [
  {
    accountId: "BANK",
    displayName: "생활비 통장",
    accountType: "자산",
    subType: "입출금"
  },
  {
    accountId: "STOCK",
    displayName: "증권 계좌",
    accountType: "투자",
    subType: "주식"
  }
];

test("default input preferences hide investment accounts", () => {
  const preferences = createDefaultInputPreferences(categories, accounts);

  assert.deepEqual(preferences.accountOrder, ["BANK", "STOCK"]);
  assert.deepEqual(preferences.hiddenAccountIds, ["STOCK"]);
});

test("normalization keeps saved order and appends newly created items", () => {
  const stored = {
    version: 1 as const,
    categoryOrder: {
      지출: ["EXP_A"],
      수입: ["INC_A"],
      이체: []
    },
    accountOrder: ["BANK"],
    hiddenAccountIds: []
  };

  const normalized = normalizeInputPreferences(stored, categories, accounts);

  assert.deepEqual(normalized.categoryOrder.지출, ["EXP_A", "EXP_B"]);
  assert.deepEqual(normalized.accountOrder, ["BANK", "STOCK"]);
  assert.deepEqual(normalized.hiddenAccountIds, ["STOCK"]);
});

test("category and account sorting follows saved preferences", () => {
  const preferences = {
    version: 1 as const,
    categoryOrder: {
      지출: ["EXP_A", "EXP_B"],
      수입: ["INC_A"],
      이체: []
    },
    accountOrder: ["STOCK", "BANK"],
    hiddenAccountIds: []
  };

  assert.deepEqual(
    applyCategoryPreferences(categories, "지출", preferences).map(item => item.categoryId),
    ["EXP_A", "EXP_B"]
  );

  assert.deepEqual(
    sortAccountsByPreferences(accounts, preferences).map(item => item.accountId),
    ["STOCK", "BANK"]
  );
});

test("parseInputPreferences rejects malformed data instead of partially accepting it", () => {
  assert.equal(parseInputPreferences(null), null);
  assert.equal(parseInputPreferences({ version: 2 }), null);
  assert.equal(
    parseInputPreferences({
      version: 1,
      categoryOrder: { 지출: [], 수입: [], 이체: [] },
      accountOrder: ["BANK", 123],
      hiddenAccountIds: []
    }),
    null
  );
});
