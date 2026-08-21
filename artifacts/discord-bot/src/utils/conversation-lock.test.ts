import assert from "node:assert/strict";
import test from "node:test";
import { KeyedAsyncQueue } from "./conversation-lock.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("serializes work for the same conversation in submission order", async () => {
  const queue = new KeyedAsyncQueue();
  const events: string[] = [];

  const first = queue.run("user:guild", async () => {
    events.push("first:start");
    await wait(10);
    events.push("first:end");
  });
  const second = queue.run("user:guild", async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
  assert.equal(queue.size, 0);
});

test("allows different conversations to run concurrently", async () => {
  const queue = new KeyedAsyncQueue();
  let secondStarted = false;

  const first = queue.run("user-a:guild", async () => {
    await wait(10);
    assert.equal(secondStarted, true);
  });
  const second = queue.run("user-b:guild", async () => {
    secondStarted = true;
  });

  await Promise.all([first, second]);
  assert.equal(queue.size, 0);
});

test("releases a conversation after task failure", async () => {
  const queue = new KeyedAsyncQueue();

  await assert.rejects(
    queue.run("user:guild", async () => {
      throw new Error("expected failure");
    }),
    /expected failure/,
  );

  let ran = false;
  await queue.run("user:guild", async () => {
    ran = true;
  });

  assert.equal(ran, true);
  assert.equal(queue.size, 0);
});
