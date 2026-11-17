import test from "node:test";
import assert from "node:assert/strict";
import {
  getInputPreferences,
  saveInputPreferences,
  createDefaultInputPreferences,
  parseQuickEntries,
  normalizeInputPreferences
} from "../src/utils/inputPreferences.ts";
import { livingSummary, validateQuickEntry } from "../src/components/household/householdDomain.ts";
import { changeDescription } from "../src/components/household/changeDescription.ts";
import type { QuickEntry } from "../src/utils/inputPreferences.ts";

const entry: QuickEntry = {
  id: "Q",
  name: "점심",
  mode: "expense",
  categoryId: "C",
  paymentMethodId: "A",
  spendingTarget: "미영",
  fromAccountId: "",
  toAccountId: "",
  description: "점심"
};

test("local preferences are isolated by authenticated user", () => {
  const prior = globalThis.window;
  const storage = new Map();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value)
    }
  };
  try {
    const accounts = [
      { accountId: "A", displayName: "통장", accountType: "자산", subType: "통장" }
    ];
    const defaults = createDefaultInputPreferences([], accounts);
    saveInputPreferences({ ...defaults, hiddenAccountIds: ["A"], quickEntries: [entry] }, "미영");
    saveInputPreferences(defaults, "승철");
    assert.deepEqual(getInputPreferences([], accounts, "미영").hiddenAccountIds, ["A"]);
    assert.deepEqual(getInputPreferences([], accounts, "승철").hiddenAccountIds, []);
    assert.equal(getInputPreferences([], accounts, "미영").quickEntries?.[0].name, "점심");
    assert.equal(getInputPreferences([], accounts, "승철").quickEntries?.length, 0);
  } finally {
    if (prior) (globalThis as any).window = prior;
    else delete (globalThis as any).window;
  }
});

test("quick entries preserve their settings through reorder and validate unavailable accounts", () => {
  const preferences = { ...createDefaultInputPreferences([], []), quickEntries: [entry] };
  assert.equal(normalizeInputPreferences(preferences, [], []).quickEntries?.[0].name, "점심");
  assert.equal(parseQuickEntries([entry, entry, { id: "invalid" }]).length, 1);
  assert.match(
    validateQuickEntry(entry, {
      categories: [{ categoryId: "C", type: "지출", active: true }],
      accounts: [],
      spendingTargets: ["미영"]
    } as any)!,
    /계좌/
  );
});

test("shared living summary uses only selected cash accounts and shared expenses", () => {
  const account = (id: string, owner: string, balance: number) => ({
    accountId: id,
    owner,
    currentBalance: balance,
    active: true,
    isDeleted: false,
    accountType: "자산",
    subType: "통장"
  });
  const dashboard: any = {
    accounts: [
      account("A", "공동", 50000),
      account("B", "미영", 70000),
      { ...account("C", "공동", 1000000), accountType: "투자" }
    ],
    spendingTargetExpense: [
      { name: "공동", amount: 30000 },
      { name: "미영", amount: 10000 }
    ]
  };
  assert.equal(livingSummary(dashboard, null).balance, 50000);
  assert.equal(livingSummary(dashboard, ["A", "B"]).balance, 120000);
  assert.equal(livingSummary(dashboard, ["A", "B"]).expense, 30000);
  assert.equal(livingSummary(dashboard, []).accounts.length, 0);
});

test("history shows amount changes and does not invent missing old values", () => {
  assert.equal(
    changeDescription({
      entityType: "transaction",
      action: "updated",
      payload: { description: "장보기", amount: 48000, before: { amount: 52000 } }
    } as any),
    "장보기 52,000원 → 48,000원 수정"
  );
  assert.equal(
    changeDescription({ entityType: "transaction", action: "deleted", payload: null } as any),
    "거래 삭제"
  );
});
