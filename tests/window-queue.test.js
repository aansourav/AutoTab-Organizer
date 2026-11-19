import assert from "node:assert/strict";
import { test } from "node:test";
import { createWindowQueue } from "../src/window-queue.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("the same window runs one task at a time and survives a failure", async () => {
  const queue = createWindowQueue();
  const order = [];
  const gate = deferred();

  const first = queue.enqueue(1, async () => {
    order.push("first-start");
    await gate.promise;
    order.push("first-end");
    throw new Error("boom");
  });
  const second = queue.enqueue(1, async () => {
    order.push("second");
    return "ok";
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["first-start"]);

  gate.resolve();
  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("different windows run at the same time", async () => {
  const queue = createWindowQueue();
  const release = deferred();
  let started = 0;
  const bothStarted = deferred();

  const hold = async (label) => {
    started += 1;
    if (started === 2) bothStarted.resolve();
    await release.promise;
    return label;
  };

  const first = queue.enqueue(1, () => hold("a"));
  const second = queue.enqueue(2, () => hold("b"));
  await bothStarted.promise;
  release.resolve();

  assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
});
