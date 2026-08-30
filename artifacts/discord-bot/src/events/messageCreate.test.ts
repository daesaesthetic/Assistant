import assert from "node:assert/strict";
import test from "node:test";
import { splitDiscordResponse } from "./messageCreate.js";

test("splits long Discord responses without losing content", () => {
  const first = "a".repeat(2_500);
  const second = "b".repeat(2_500);
  const text = `${first}\n${second}`;
  const chunks = splitDiscordResponse(text, 4_096);

  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4_096));
  assert.equal(chunks.join("\n"), text);
});

test("keeps short responses as a single chunk", () => {
  assert.deepEqual(splitDiscordResponse("short"), ["short"]);
});