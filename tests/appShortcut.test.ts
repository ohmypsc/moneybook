import test from "node:test";
import assert from "node:assert/strict";

import { parseAppShortcut } from "../src/utils/appShortcut.ts";

test("PWA shortcuts resolve to input modes or history", () => {
  assert.deepEqual(parseAppShortcut("?shortcut=expense"), {
    navigation: "input",
    mode: "expense"
  });
  assert.deepEqual(parseAppShortcut("?shortcut=income"), {
    navigation: "input",
    mode: "income"
  });
  assert.deepEqual(parseAppShortcut("?shortcut=transfer"), {
    navigation: "input",
    mode: "transfer"
  });
  assert.deepEqual(parseAppShortcut("?shortcut=history"), {
    navigation: "calendar"
  });
  assert.equal(parseAppShortcut("?shortcut=unknown"), null);
});
