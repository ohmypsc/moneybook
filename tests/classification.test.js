import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTags } from "../shared/classification.js";

test("tag normalization and limits", () => {
  assert.deepEqual(normalizeTags(" #여행, 여행, Family, family "), ["여행", "Family"]);
  assert.throws(() => normalizeTags(["가".repeat(31)]));
  assert.throws(() => normalizeTags(Array.from({ length: 11 }, (_, i) => String(i))));
});
