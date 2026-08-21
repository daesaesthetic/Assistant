import assert from "node:assert/strict";
import test from "node:test";
import {
  persistConversationHistory,
  validatePrimaryResponse,
} from "./conversation.js";
import { conversationQueue } from "./conversation-store.js";

test("accepts and trims a valid primary response", () => {
  assert.equal(
    validatePrimaryResponse({
      choices: [{ message: { content: "  Hello!  " } }],
    }),
    "Hello!",
  );
});

test("rejects empty and whitespace-only primary responses", () => {
  for (const content of ["", "   "]) {
    assert.throws(
      () =>
        validatePrimaryResponse({
          choices: [{ message: { content } }],
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "GroqReliabilityError" &&
        "category" in error &&
        error.category === "empty_response",
    );
  }
});

test("rejects missing and non-string primary response content", () => {
  for (const completion of [
    {},
    { choices: [] },
    { choices: [{ message: {} }] },
    { choices: [{ message: { content: null } }] },
    { choices: [{ message: { content: 42 } }] },
  ]) {
    assert.throws(
      () => validatePrimaryResponse(completion),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "GroqReliabilityError" &&
        "category" in error &&
        error.category === "malformed_response",
    );
  }
});

test("reports persistence success and failure without throwing", async () => {
  const context = { userId: "user-b3", guildId: "guild-b3" };
  const history = [
    { role: "user" as const, content: "Hello" },
    { role: "assistant" as const, content: "Hello!" },
  ];
  const persisted = await persistConversationHistory(
    context,
    history,
    async () => {},
  );
  const failed = await persistConversationHistory(
    context,
    history,
    async () => {
      throw new Error("expected persistence failure");
    },
  );

  assert.equal(persisted, true);
  assert.equal(failed, false);
  assert.equal(conversationQueue.size, 0);
});

test("a response validation failure releases the B2 queue", async () => {
  const key = "b3-empty:guild";

  await assert.rejects(
    conversationQueue.run(key, async () =>
      validatePrimaryResponse({ choices: [{ message: { content: " " } }] }),
    ),
  );

  const result = await conversationQueue.run(key, async () => "next request");
  assert.equal(result, "next request");
  assert.equal(conversationQueue.size, 0);
});
