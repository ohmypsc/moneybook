import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmAction,
  getConfirmActionSnapshot,
  resolveConfirmAction
} from "../src/utils/confirmAction.ts";

test("confirmAction resolves the current request", async () => {
  const promise = confirmAction({
    title: "삭제",
    message: "삭제할까요?",
    confirmLabel: "삭제",
    tone: "danger"
  });

  const snapshot = getConfirmActionSnapshot();
  assert.ok(snapshot);
  assert.equal(snapshot.title, "삭제");
  assert.equal(snapshot.tone, "danger");

  resolveConfirmAction(snapshot.id, true);
  assert.equal(await promise, true);
  assert.equal(getConfirmActionSnapshot(), null);
});

test("confirmAction queues overlapping confirmations in order", async () => {
  const firstPromise = confirmAction("첫 번째");
  const secondPromise = confirmAction("두 번째");

  const first = getConfirmActionSnapshot();
  assert.ok(first);
  assert.equal(first.message, "첫 번째");

  resolveConfirmAction(first.id, false);
  assert.equal(await firstPromise, false);

  await new Promise<void>(resolve => queueMicrotask(resolve));

  const second = getConfirmActionSnapshot();
  assert.ok(second);
  assert.equal(second.message, "두 번째");

  resolveConfirmAction(second.id, true);
  assert.equal(await secondPromise, true);
});
