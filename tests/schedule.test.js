import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  createWindowDebouncer,
  shouldOrganizeOnUpdate,
} from "../src/schedule.js";

test("tab updates react to navigation, not title noise", () => {
  assert.equal(shouldOrganizeOnUpdate({ url: "https://youtube.com" }), true);
  assert.equal(shouldOrganizeOnUpdate({ status: "complete" }), true);
  assert.equal(shouldOrganizeOnUpdate({ title: "Inbox" }), false);
  assert.equal(
    shouldOrganizeOnUpdate({ favIconUrl: "https://example.com/icon.png" }),
    false,
  );
  assert.equal(shouldOrganizeOnUpdate(null), false);
});

test("bursts of tab updates collapse to one flush per window", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const flushed = [];
    const debouncer = createWindowDebouncer({
      waitMs: 120,
      onFlush: (windowId, tabIds) => flushed.push({ windowId, tabIds }),
    });

    debouncer.push(1, 10);
    debouncer.push(1, 11);
    debouncer.push(2, 20);
    debouncer.push("nope", 5);
    assert.deepEqual(flushed, []);

    mock.timers.tick(119);
    assert.deepEqual(flushed, []);
    mock.timers.tick(1);

    assert.deepEqual(flushed, [
      { windowId: 1, tabIds: [10, 11] },
      { windowId: 2, tabIds: [20] },
    ]);
  } finally {
    mock.timers.reset();
  }
});
