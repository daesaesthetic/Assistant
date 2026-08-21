import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationContext,
  CONTEXT_TOKEN_BUDGET,
  INPUT_TOKEN_BUDGET,
  RESERVED_OUTPUT_TOKENS,
  estimateContextTokens,
  validateConversationContext,
} from "./conversation-context.js";

const history = [
  { role: "user" as const, content: "old question" },
  { role: "assistant" as const, content: "old answer" },
  { role: "user" as const, content: "recent question" },
  { role: "assistant" as const, content: "recent answer" },
];

test("builds sections in stable prompt order and skips empty optional sections", () => {
  const result = buildConversationContext({
    botName: "Azurion",
    persona: { personaName: "analyst" },
    traits: ["warm"],
    memories: ["likes cats"],
    history,
    currentMessage: "hello",
  });

  assert.deepEqual(
    result.messages.map((message) => message.role),
    [
      "system",
      "system",
      "system",
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ],
  );
  assert.match(result.messages[0].content, /^Stable instructions:/);
  assert.match(result.messages[1].content, /^Persona:/);
  assert.match(result.messages[2].content, /^Traits:/);
  assert.match(result.messages[3].content, /^Memory context:/);
  assert.match(
    result.messages[0].content,
    /follow-up messages and resolve short or elliptical replies in context/,
  );
  assert.match(
    result.messages[0].content,
    /Use personal context silently and only when it materially improves the answer/,
  );
  assert.match(
    result.messages[3].content,
    /^Memory context:\nRelevant personal context/,
  );
  assert.equal(result.messages.at(-1)?.content, "hello");
  assert.equal(result.truncatedContext, false);
  assert.equal(result.optionalContextTruncated, false);
  assert.equal(result.currentMessageExceedsBudget, false);
});

test("preserves the current message exactly, including when it is oversized", () => {
  const currentMessage = "x".repeat(INPUT_TOKEN_BUDGET * 4);
  const result = buildConversationContext({
    botName: "Azurion",
    history,
    currentMessage,
  });

  assert.equal(result.messages.at(-1)?.content, currentMessage);
  assert.equal(result.messages.at(-1)?.role, "user");
  assert.equal(result.truncatedContext, true);
  assert.equal(result.truncatedHistory, true);
  assert.equal(result.currentMessageExceedsBudget, true);
});

test("prefers recent history and truncates from the oldest side predictably", () => {
  const longHistory = Array.from({ length: 40 }, (_, index) => ({
    role: (index % 2 ? "assistant" : "user") as "user" | "assistant",
    content: `history-${index} ${"x".repeat(700)}`,
  }));
  const result = buildConversationContext({
    botName: "Azurion",
    history: longHistory,
    currentMessage: "current",
  });
  const contents = result.messages.map((message) => message.content);

  assert.equal(contents.at(-1), "current");
  assert.equal(
    contents.some((content) => content.includes("history-39")),
    true,
  );
  assert.equal(
    contents.some((content) => content.includes("history-0")),
    false,
  );
  assert.equal(result.truncatedHistory, true);
  assert.equal(
    contents.filter((content) => content.includes("history-")).length <
      longHistory.length,
    true,
  );
});

test("bounds memory, persona, and traits without mutating stored values", () => {
  const personaText = "persona ".repeat(8_000);
  const traits = ["trait ".repeat(2_000), "second trait"];
  const memories = Array.from(
    { length: 100 },
    (_, index) => `memory-${index} ${"m".repeat(300)}`,
  );
  const result = buildConversationContext({
    botName: "Azurion",
    persona: { personaName: "custom", customDescription: personaText },
    traits,
    memories,
    history: [],
    currentMessage: "current",
  });

  assert.equal(result.truncatedContext, true);
  assert.ok(
    result.messages.every((message) => message.content.length < 20_000),
  );
  assert.equal(traits[0], "trait ".repeat(2_000));
  assert.equal(memories.length, 100);
});

test("normal requests fit the input budget and reserve output capacity", () => {
  const result = buildConversationContext({
    botName: "Azurion",
    history,
    currentMessage: "current",
  });

  assert.ok(result.estimatedInputTokens <= result.inputTokenBudget);
  assert.equal(
    result.inputTokenBudget + result.reservedOutputTokens,
    CONTEXT_TOKEN_BUDGET,
  );
  assert.equal(result.reservedOutputTokens, RESERVED_OUTPUT_TOKENS);
  assert.equal(
    result.estimatedInputTokens + result.reservedOutputTokens <=
      CONTEXT_TOKEN_BUDGET,
    true,
  );
  validateConversationContext(result, "current");
});

test("history reduction does not change persisted input", () => {
  const original = history.map((message) => ({ ...message }));
  buildConversationContext({
    botName: "Azurion",
    history,
    currentMessage: "current",
  });
  assert.deepEqual(history, original);
});

test("context estimates include per-message overhead", () => {
  assert.equal(estimateContextTokens({ role: "user", content: "" }), 4);
  assert.ok(estimateContextTokens({ role: "user", content: "hello" }) > 4);
});

test("degrades optional context in deterministic priority order", () => {
  const result = buildConversationContext({
    botName: "Azurion",
    persona: { personaName: "custom", customDescription: "p".repeat(20_000) },
    traits: ["t".repeat(20_000)],
    memories: ["m".repeat(20_000)],
    history: Array.from({ length: 40 }, (_, index) => ({
      role: "user" as const,
      content: `history-${index} ${"h".repeat(2_000)}`,
    })),
    currentMessage: "current",
  });
  const contents = result.messages.map((message) => message.content);

  assert.equal(contents.at(-1), "current");
  assert.equal(
    contents.some((content) => content.includes("history-39")),
    true,
  );
  assert.equal(
    contents.some((content) => content.includes("history-0")),
    false,
  );
  assert.equal(result.truncatedHistory, true);
  assert.equal(result.optionalContextTruncated, true);
  validateConversationContext(result, "current");
});

test("skips empty optional sections without creating empty messages", () => {
  const result = buildConversationContext({
    botName: "Azurion",
    persona: { personaName: "custom", customDescription: "  " },
    traits: ["", "   "],
    memories: ["", "  "],
    history: [{ role: "user", content: "  " }],
    currentMessage: "current",
  });

  assert.deepEqual(
    result.messages.map((message) => message.content),
    [result.messages[0].content, "current"],
  );
  assert.equal(
    result.messages.some((message) => !message.content.trim()),
    false,
  );
  assert.equal(result.truncatedHistory, true);
  validateConversationContext(result, "current");
});

test("validator rejects a changed current message and incorrect estimate", () => {
  const result = buildConversationContext({
    botName: "Azurion",
    history: [],
    currentMessage: "current",
  });

  assert.throws(() => validateConversationContext(result, "changed"));
  assert.throws(() =>
    validateConversationContext(
      { ...result, estimatedInputTokens: result.estimatedInputTokens + 1 },
      "current",
    ),
  );
});
