import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMemories,
  parseMemoryCandidateRecords,
  parseMemoryCandidates,
} from "./conversation.js";

function completion(content: unknown) {
  return {
    choices: [{ message: { content } }],
  };
}

test("accepts valid memory arrays and normalizes whitespace", () => {
  assert.deepEqual(
    parseMemoryCandidates('```json\n["  likes cats  ", "builds bots"]\n```'),
    ["likes cats", "builds bots"],
  );
});

test("preserves structured memory type and confidence metadata", () => {
  assert.deepEqual(
    parseMemoryCandidateRecords(
      '[{"content":"building a Discord bot","memoryType":"project","confidence":0.91}]',
    ),
    [
      {
        content: "building a Discord bot",
        memoryType: "project",
        confidence: 0.91,
        source: "conversation",
      },
    ],
  );
});

test("rejects malformed memory JSON and non-array JSON", () => {
  assert.throws(() => parseMemoryCandidates("not json"));
  assert.throws(() => parseMemoryCandidates('{"fact":"bad"}'));
  assert.throws(() => parseMemoryCandidates("["));
});

test("filters invalid, blank, placeholder, and overlong memory values", () => {
  assert.deepEqual(
    parseMemoryCandidates(
      JSON.stringify([
        "valid fact",
        123,
        null,
        { fact: "bad" },
        "",
        "   ",
        "...",
        "x".repeat(501),
      ]),
    ),
    ["valid fact"],
  );
});

test("stores valid extracted memories and does not write an empty array", async () => {
  const stored: string[][] = [];
  const addMemories = async (
    _userId: string,
    _guildId: string,
    facts: string[],
  ) => {
    stored.push(facts);
  };

  await extractMemories(
    "user-b4",
    "guild-b4",
    "I like cats",
    "That is useful to know.",
    {
      createCompletion: async () =>
        completion('["likes cats", "builds Discord bots"]'),
      addMemories,
    },
  );
  await extractMemories(
    "user-b4",
    "guild-b4",
    "Nothing personal",
    "Understood.",
    {
      createCompletion: async () => completion("[]"),
      addMemories,
    },
  );

  assert.deepEqual(stored, [["likes cats", "builds Discord bots"]]);
});

test("memory extraction failures never reject or alter the primary flow", async () => {
  await assert.doesNotReject(
    extractMemories(
      "user-b4",
      "guild-b4",
      "I like cats",
      "That is useful to know.",
      {
        createCompletion: async () => {
          throw new Error("provider unavailable");
        },
        addMemories: async () => {
          throw new Error("should not run");
        },
      },
    ),
  );

  await assert.doesNotReject(
    extractMemories(
      "user-b4",
      "guild-b4",
      "I like cats",
      "That is useful to know.",
      {
        createCompletion: async () => completion('["valid fact"]'),
        addMemories: async () => {
          throw new Error("database unavailable");
        },
      },
    ),
  );
});

test("memory extraction has a bounded timeout", async () => {
  await assert.doesNotReject(
    extractMemories(
      "user-timeout",
      "guild-timeout",
      "I like cats",
      "Noted.",
      {
        createCompletion: () => new Promise(() => {}),
        memoryExtractionTimeoutMs: 5,
      },
    ),
  );
});

test("memory persistence receives only valid candidates from mixed output", async () => {
  let stored: string[] = [];

  await extractMemories(
    "user-b4",
    "guild-b4",
    "I like cats",
    "That is useful to know.",
    {
      createCompletion: async () =>
        completion(
          JSON.stringify([" likes cats ", 42, null, { fact: "bad" }, ""]),
        ),
      addMemories: async (_userId, _guildId, facts) => {
        stored = facts;
      },
    },
  );

  assert.deepEqual(stored, ["likes cats"]);
});
