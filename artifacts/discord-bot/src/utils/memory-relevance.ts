/**
 * Selects persistent memories locally before they enter the AI context.
 *
 * Memory order is oldest-to-newest from the database, so recency is a small
 * tie-breaker only. Relevance remains the dominant signal.
 */

export const MAX_CONTEXT_MEMORIES = 8;
export const MEMORY_FALLBACK_COUNT = 3;

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
  content: string;
  index: number;
  score: number;
  meaningfulTermCount: number;
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
  memory: string,
  messageTerms: Set<string>,
  normalizedMessage: string,
  index: number,
  total: number,
): ScoredMemory {
  const terms = meaningfulTerms(memory);
  const normalizedMemory = normalizeText(memory);
  const overlap = terms.filter((term) => messageTerms.has(term));
  let score = overlap.length * 3;

  if (overlap.length > 1) score += overlap.length;
  if (normalizedMemory && normalizedMessage.includes(normalizedMemory)) {
    score += 4;
  }
  if (terms.length >= 3) score += 1;
  if (overlap.length > 0) score += (index + 1) / Math.max(total, 1);

  return {
    content: memory,
    index,
    score,
    meaningfulTermCount: terms.length,
  };
}

export function selectRelevantMemories(
  memories: string[] = [],
  currentMessage: string,
): string[] {
  const uniqueMemories = memories
    .map((memory) => memory.trim())
    .filter(Boolean)
    .filter(
      (memory, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.toLocaleLowerCase() === memory.toLocaleLowerCase(),
        ) === index,
    );

  if (uniqueMemories.length === 0) return [];

  const messageTerms = new Set(meaningfulTerms(currentMessage));
  const normalizedMessage = normalizeText(currentMessage);
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
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, MAX_CONTEXT_MEMORIES);

  if (relevant.length > 0) {
    return relevant.map((memory) => memory.content);
  }

  return scored
    .sort(
      (left, right) =>
        right.index - left.index ||
        right.meaningfulTermCount - left.meaningfulTermCount,
    )
    .slice(0, MEMORY_FALLBACK_COUNT)
    .reverse()
    .map((memory) => memory.content);
}
