import assert from "node:assert/strict";
import test from "node:test";
import {
  getAiUserFacingMessage,
  getSafeAiErrorLogContext,
  validateCompletionText,
} from "./ai-errors.js";
import { GroqReliabilityError } from "./groq.js";

const categories = [
  "configuration",
  "rate_limit",
  "context",
  "transient_provider",
  "network",
  "timeout",
  "empty_response",
  "malformed_response",
  "unknown",
] as const;

test("maps every Groq category to a safe user-facing message", () => {
  for (const category of categories) {
    const error = new GroqReliabilityError({
      category,
      requestType: "text",
      model: "test-model",
      attempts: 1,
      elapsedMs: 1,
    });
    const message = getAiUserFacingMessage(error);

    assert.ok(message.length > 0);
    assert.equal(message.includes("test-model"), false);
    assert.equal(message.includes("Groq"), false);
  }
});

test("maps persistence failures without exposing database details", () => {
  const message = getAiUserFacingMessage(
    new Error("SQLITE path and query"),
    "persistence",
  );
  const context = getSafeAiErrorLogContext(
    "/talk",
    new Error("SQLITE path and query"),
    "persistence",
  );

  assert.match(message, /generated/i);
  assert.equal(message.includes("SQLITE"), false);
  assert.equal(JSON.stringify(context).includes("SQLITE"), false);
  assert.equal(context.category, "persistence");
});

test("validates text and vision completion boundaries safely", () => {
  assert.equal(
    validateCompletionText(
      { choices: [{ message: { content: "  Suggestions  " } }] },
      "text",
      "test-model",
    ),
    "Suggestions",
  );

  for (const content of ["", "   ", null, 42]) {
    assert.throws(() =>
      validateCompletionText(
        { choices: [{ message: { content } }] },
        "vision",
        "test-model",
      ),
    );
  }
});
