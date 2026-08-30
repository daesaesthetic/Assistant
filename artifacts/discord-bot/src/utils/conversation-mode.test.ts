import assert from "node:assert/strict";
import test from "node:test";
import { inferConversationMode } from "./conversation-mode.js";

test("adapts naturally to technical messages", () => {
  assert.equal(
    inferConversationMode("Why is this SQL query returning duplicates?").mode,
    "technical",
  );
});

test("recognizes emotional context without requiring a command", () => {
  assert.equal(
    inferConversationMode("I'm exhausted and need to vent").mode,
    "emotional",
  );
});

test("allows banter without forcing it on ordinary messages", () => {
  assert.equal(inferConversationMode("I broke it again lol").mode, "banter");
  assert.equal(inferConversationMode("What time is it?").mode, "casual");
});