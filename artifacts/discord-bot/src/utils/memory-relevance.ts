import type { MemoryRecord } from "../database/index.js";

/**
 * Selects persistent memories locally before they enter the AI context.
 *
 * Relevance is dominant. Confidence and recency only break close ties, and
 * unrelated memories are omitted rather than injected as a fallback.
 */

export const MAX_CONTEXT_MEMORIES = 8;
// Retained as a compatibility export for callers that imported the old bound.
export const MEMORY_FALLBACK_COUNT = 0;

const MIN_RELEVANCE_SCORE = 2;
const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "with",
  "you",
  "your",
]);

type ScoredMemory = {
  memory: string | MemoryRecord;
  content: string;
  index: number;
  score: number;
  meaningfulTermCount: number;
  confidence: number;
  updatedAt: number;
};

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulTerms(value: string): string[] {
  return [
    ...new Set(
      normalizeText(value)
        .split(" ")
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
    ),
  ];
}

function scoreMemory(
  memory: string | MemoryRecord,
  messageTerms: Set<string>,
  normalizedMessage: string,
  index: number,
  total: number,
): ScoredMemory {
  const content = typeof memory === "string" ? memory : memory.content;
  const terms = meaningfulTerms(content);
  const normalizedMemory = normalizeText(content);
  const overlap = terms.filter((term) => messageTerms.has(term));
  let score = overlap.length * 3;

  if (overlap.length > 1) score += overlap.length;
  if (normalizedMemory && normalizedMessage.includes(normalizedMemory)) {
    score += 4;
  }
  if (terms.length >= 3) score += 1;
  if (overlap.length > 0) score += (index + 1) / Math.max(total, 1);
  const confidence = typeof memory === "string" ? 0.7 : memory.confidence;
  score += confidence * 0.5;

  return {
    memory,
    content,
    index,
    score,
    meaningfulTermCount: terms.length,
    confidence,
    updatedAt: typeof memory === "string" ? index : memory.updatedAt,
  };
}

export function selectRelevantMemoryRecords(
  memories: MemoryRecord[] = [],
  currentMessage: string,
): MemoryRecord[] {
  const uniqueMemories = memories
    .filter((memory) => memory.content.trim())
    .filter(Boolean)
    .filter(
      (memory, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.content.toLocaleLowerCase() ===
            memory.content.toLocaleLowerCase(),
        ) === index,
    );

  if (uniqueMemories.length === 0) return [];

  const messageTerms = new Set(meaningfulTerms(currentMessage));
  const normalizedMessage = normalizeText(currentMessage);
  if (messageTerms.size === 0) return [];

  const scored = uniqueMemories.map((memory, index) =>
    scoreMemory(
      memory,
      messageTerms,
      normalizedMessage,
      index,
      uniqueMemories.length,
    ),
  );
  const relevant = scored
    .filter(
      (memory) =>
        memory.score >= MIN_RELEVANCE_SCORE && memory.meaningfulTermCount > 0,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.confidence - left.confidence ||
        right.updatedAt - left.updatedAt ||
        right.index - left.index,
    )
    .slice(0, MAX_CONTEXT_MEMORIES);

  return relevant.map((memory) => memory.memory as MemoryRecord);
}

export function selectRelevantMemories(
  memories: string[] = [],
  currentMessage: string,
): string[] {
  const records = memories.map((content, index) => ({
    id: index,
    content,
    memoryType: "fact" as const,
    confidence: 0.7,
    source: "legacy",
    createdAt: index,
    updatedAt: index,
  }));
  return selectRelevantMemoryRecords(records, currentMessage).map(
    (memory) => memory.content,
  );
}
