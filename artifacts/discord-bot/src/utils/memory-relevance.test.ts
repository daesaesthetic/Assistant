import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CONTEXT_MEMORIES,
  MEMORY_FALLBACK_COUNT,
  selectRelevantMemoryRecords,
  selectRelevantMemories,
} from "./memory-relevance.js";

test("ranks exact meaningful term matches first", () => {
  const selected = selectRelevantMemories(
    ["works in finance", "likes cats", "builds Discord bots"],
    "Can you help me improve my Discord bot?",
  );

  assert.equal(selected[0], "builds Discord bots");
});

test("recognizes multi-word overlap and ignores stopwords", () => {
  const selected = selectRelevantMemories(
    ["likes tea", "lives in Tokyo", "is a person"],
    "What do you know about living in Tokyo?",
  );

  assert.equal(selected[0], "lives in Tokyo");
  assert.equal(selected.includes("is a person"), false);
});

test("excludes irrelevant memories when relevant memories exist", () => {
  const selected = selectRelevantMemories(
    ["works as a nurse", "likes jazz", "owns a red bicycle"],
    "Tell me more about jazz music.",
  );

  assert.deepEqual(selected, ["likes jazz"]);
});

test("relevance outranks recency", () => {
  const selected = selectRelevantMemories(
    ["has a dog named Miso", "likes cooking", "works in finance"],
    "What recipes would suit my cooking hobby?",
  );

  assert.equal(selected[0], "likes cooking");
  assert.equal(selected.includes("works in finance"), false);
});

test("omits memories when there is no meaningful lexical match", () => {
  const memories = Array.from({ length: 10 }, (_, index) => `fact ${index}`);
  const selected = selectRelevantMemories(
    memories,
    "Tell me something unrelated.",
  );

  assert.equal(selected.length, MEMORY_FALLBACK_COUNT);
  assert.deepEqual(selected, []);
});

test("deduplicates memories and never exceeds the selection limit", () => {
  const memories = Array.from(
    { length: 20 },
    (_, index) => `likes item ${index}`,
  );
  memories.push("likes item 1");

  const selected = selectRelevantMemories(
    memories,
    "Which memories likes item 1?",
  );

  assert.equal(selected.length, MAX_CONTEXT_MEMORIES);
  assert.equal(
    new Set(selected.map((memory) => memory.toLowerCase())).size,
    selected.length,
  );
});

test("handles empty memories and empty messages", () => {
  assert.deepEqual(selectRelevantMemories([], "hello"), []);
  assert.deepEqual(selectRelevantMemories(["first fact", "second fact"], ""), []);
});

test("metadata strengthens relevant memories without making unrelated ones relevant", () => {
  const selected = selectRelevantMemoryRecords(
    [
      {
        id: 1,
        content: "User is building a Discord bot",
        memoryType: "project",
        confidence: 0.95,
        source: "conversation",
        createdAt: 1,
        updatedAt: 10,
      },
      {
        id: 2,
        content: "User likes jazz",
        memoryType: "interest",
        confidence: 0.99,
        source: "conversation",
        createdAt: 1,
        updatedAt: 99,
      },
    ],
    "How should I structure my Discord bot?",
  );

  assert.deepEqual(selected.map((memory) => memory.id), [1]);
});
