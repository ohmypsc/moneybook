import test from "node:test";
import assert from "node:assert/strict";

import { parseThemePreference, resolveTheme } from "../src/utils/theme.ts";

test("unknown stored theme values fall back to following the device", () => {
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("purple"), "system");
});

test("system preference resolves from the device setting", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});
