import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOwnerTabs,
  moveSubsetToIndex
} from "../src/pages/SettingsPage/settingsShared.ts";

test("buildOwnerTabs follows bootstrap members and keeps shared owner last", () => {
  assert.deepEqual(
    buildOwnerTabs(["미영", "승철"], ["공동", "승철", "가족"]),
    ["미영", "승철", "가족", "공동"]
  );
});

test("moveSubsetToIndex reorders only the selected subset in the full order", () => {
  assert.deepEqual(
    moveSubsetToIndex(
      ["A", "hidden", "B", "C"],
      ["A", "B", "C"],
      2,
      0
    ),
    ["C", "hidden", "A", "B"]
  );
});
