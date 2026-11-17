import test from "node:test";
import assert from "node:assert/strict";

import {
  createHistoryState,
  createInputPresetFromTransaction,
  isPrimaryNavigation,
  isSameHistoryDestination
} from "../src/app/navigation.ts";

test("only the five bottom tabs are primary navigation keys", () => {
  for (const key of ["home", "calendar", "input", "assets", "settings"]) {
    assert.equal(isPrimaryNavigation(key), true);
  }
  assert.equal(isPrimaryNavigation("admin"), false);
  assert.equal(isPrimaryNavigation(undefined), false);
  assert.equal(isPrimaryNavigation(1), false);
});

test("history state keeps input date and preset only for the input screen", () => {
  const preset = { mode: "income" as const, amount: 1000 };
  assert.deepEqual(createHistoryState("input", "2026-11-17", preset), {
    moneybook: true,
    navigation: "input",
    inputInitialDate: "2026-11-17",
    inputPreset: preset
  });
  assert.deepEqual(createHistoryState("home", "2026-11-17", preset), {
    moneybook: true,
    navigation: "home",
    inputInitialDate: null,
    inputPreset: null
  });
});

test("same destination skips pushState, different input preset does not", () => {
  const preset = { mode: "expense" as const };
  const state = createHistoryState("input", null, preset);
  assert.equal(isSameHistoryDestination(state, "input", null, { mode: "expense" }), true);
  assert.equal(isSameHistoryDestination(state, "input", null, { mode: "income" }), false);
  assert.equal(isSameHistoryDestination(state, "input", "2026-11-17", preset), false);
  assert.equal(isSameHistoryDestination(state, "home", null, null), false);
  assert.equal(isSameHistoryDestination(createHistoryState("assets"), "assets", null, null), true);
  assert.equal(isSameHistoryDestination({}, "home", null, null), false);
  assert.equal(isSameHistoryDestination(null, "home", null, null), false);
});

test("copying a transaction maps its type to the input mode", () => {
  const base = {
    amount: 12000,
    categoryId: "C1",
    fromAccountId: null,
    toAccountId: null,
    paymentMethodId: "A1",
    spendingTarget: "공동",
    description: "점심",
    memo: ""
  };
  const modeOf = (type: string) =>
    createInputPresetFromTransaction({ ...base, type } as never).mode;

  assert.equal(modeOf("지출"), "expense");
  assert.equal(modeOf("수입"), "income");
  assert.equal(modeOf("이체"), "transfer");
  assert.deepEqual(createInputPresetFromTransaction({ ...base, type: "지출" } as never), {
    mode: "expense",
    ...base
  });
});
