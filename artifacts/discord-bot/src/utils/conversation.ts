/**
 * Shared conversation engine used by both /talk and the messageCreate
 * mention / bot-channel handler.
 *
 * Handles persona resolution, trait injection, capability awareness,
 * memory injection, history management, and background memory extraction.
 */
import {
  createGroqCompletion,
  getGroqErrorLogContext,
  GroqReliabilityError,
  TEXT_MODEL,
} from "./groq.js";
import { db, DEFAULT_BOT_NAME } from "../database/index.js";
import { conversationStore } from "./conversation-store.js";
import {
  buildConversationContext,
  validateConversationContext,
  type ConversationHistoryMessage,
} from "./conversation-context.js";
import {
  inferConversationMode,
} from "./conversation-mode.js";
import {
  detectPreferenceSignals,
} from "./user-adaptation.js";
import type { MemoryCandidate, MemoryType } from "../database/index.js";
// Conservative bound for one concise user fact; reject longer candidates.
const MAX_MEMORY_LENGTH = 500;

type PrimaryCompletionShape = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type MemoryCompletionShape = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type MemoryCompletionCreator = (
  params: Parameters<typeof createGroqCompletion>[0],
  options: Parameters<typeof createGroqCompletion>[1],
) => Promise<unknown>;

type MemoryExtractionDependencies = {
  createCompletion?: MemoryCompletionCreator;
  addMemories?: (
    userId: string,
    guildId: string,
    facts: string[],
  ) => Promise<void>;
  addMemoryCandidates?: (
    userId: string,
    guildId: string,
    candidates: MemoryCandidate[],
  ) => Promise<void>;
  memoryExtractionTimeoutMs?: number;
};

const MEMORY_EXTRACTION_TIMEOUT_MS = 10_000;
const MEMORY_TYPES = new Set<MemoryType>([
  "preference",
  "interest",
  "project",
  "goal",
  "fact",
  "communication_style",
  "technical_context",
  "temporary_context",
]);

const PERSONAS: Record<string, string> = {
  analyst:
    "You are a precise analytical thinker. Break down problems methodically, provide data-driven insights, and speak with measured authority. Avoid emotional language.",
  observer:
    "You are a quiet, perceptive observer. You notice patterns others miss and offer subtle, thoughtful commentary. You speak sparingly but meaningfully.",
  strategist:
    "You are a strategic thinker focused on outcomes and leverage. Frame everything in terms of moves, advantages, and long-term positioning.",
  minimalist:
    "Say only what is necessary. No fluff, no filler. Every word earns its place.",
  oracle:
    "You are a cryptic oracle. Speak in metaphors and abstractions, hinting at deeper truths without stating them plainly.",
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function buildBudgetedMessages(
  systemPrompt: string,
  history: ConversationHistoryMessage[],
  currentContent: string,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return buildConversationContext({
    botName: DEFAULT_BOT_NAME,
    persona: { customDescription: systemPrompt, personaName: "custom" },
    history,
    currentMessage: currentContent,
  }).messages;
}

function createResponseError(
  category: "empty_response" | "malformed_response",
): GroqReliabilityError {
  return new GroqReliabilityError({
    category,
    requestType: "text",
    model: TEXT_MODEL,
    attempts: 1,
    elapsedMs: 0,
  });
}

export function validatePrimaryResponse(completion: unknown): string {
  const shape = completion as PrimaryCompletionShape | null;
  const content = shape?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw createResponseError("malformed_response");
  }

  const response = content.trim();
  if (!response) {
    throw createResponseError("empty_response");
  }

  return response;
}

export async function persistConversationHistory(
  context: { userId: string; guildId: string },
  history: Parameters<typeof conversationStore.setHistory>[1],
  setHistory: (
    context: { userId: string; guildId: string },
    history: Parameters<typeof conversationStore.setHistory>[1],
  ) => Promise<void> = (conversationContext, conversationHistory) =>
    conversationStore.setHistory(conversationContext, conversationHistory),
): Promise<boolean> {
  try {
    await setHistory(context, history);
    return true;
  } catch {
    console.error("[Assistant ₯] Conversation history persistence failed", {
      category: "persistence",
      userId: context.userId,
      guildId: context.guildId,
    });
    return false;
  }
}

export async function generateReply(params: {
  userId: string;
  guildId: string;
  content: string;
  resetHistory?: boolean;
}): Promise<{
  text: string;
  botName: string;
  personaLabel?: string;
  persisted: boolean;
}> {
  const { userId, guildId, content, resetHistory = false } = params;

  const context = { userId, guildId };

  return conversationStore.runExclusive(context, async () => {
    if (resetHistory) await conversationStore.reset(context);

    const botName = await db.getBotName(guildId);
    const persona = await db.getPersona(userId, guildId);
    const memories = await db.getMemoryRecords(userId, guildId);
    const userPreferences = await db.getPreferences(userId, guildId);
    const traits = await db.getTraits(userId, guildId);
    const conversationMode = inferConversationMode(content).mode;

    const history = await conversationStore.getHistory(context);
    const contextResult = buildConversationContext({
      botName,
      persona: persona
        ? {
            personaName: persona.personaName,
            customDescription: persona.customDescription,
          }
        : undefined,
      traits,
      userPreferences,
      conversationMode,
      memories,
      history,
      currentMessage: content,
    });
    validateConversationContext(contextResult, content);

    const completion = await createGroqCompletion(
      {
        model: TEXT_MODEL,
        messages: contextResult.messages,
        max_tokens: 1_200,
      },
      { requestType: "text" },
    );

    const response = validatePrimaryResponse(completion);

    if (contextResult.selectedMemoryIds.length > 0) {
      void db
        .markMemoriesUsed(userId, guildId, contextResult.selectedMemoryIds)
        .catch(() => {});
    }

    // Persist updated history (cap at 20 messages = 10 exchanges)
    const updatedHistory = [
      ...history,
      { role: "user" as const, content },
      { role: "assistant" as const, content: response },
    ].slice(-20);
    const persisted = await persistConversationHistory(context, updatedHistory);

    // Fire memory extraction in the background — never blocks the reply
    void extractMemories(userId, guildId, content, response);
    void db
      .recordPreferenceSignals(
        userId,
        guildId,
        detectPreferenceSignals(content),
      )
      .catch((error) => {
        console.error("[Assistant ₯] Preference adaptation failed", {
          operation: "preference_adaptation",
          category: "persistence",
          error: error instanceof Error ? error.message : "unknown",
        });
      });

    let personaLabel: string | undefined;
    if (persona) {
      personaLabel =
        persona.personaName === "custom"
          ? "Custom"
          : persona.personaName.charAt(0).toUpperCase() +
            persona.personaName.slice(1);
    }

    return { text: response, botName, personaLabel, persisted };
  });
}

function createMemoryResponseError(
  category: "empty_response" | "malformed_response",
): GroqReliabilityError {
  return new GroqReliabilityError({
    category,
    requestType: "memory",
    model: TEXT_MODEL,
    attempts: 1,
    elapsedMs: 0,
  });
}

export function parseMemoryCandidates(raw: unknown): string[] {
  return parseMemoryCandidateRecords(raw).map((candidate) => candidate.content);
}

function normalizeMemoryType(value: unknown): MemoryType {
  return typeof value === "string" && MEMORY_TYPES.has(value as MemoryType)
    ? (value as MemoryType)
    : "fact";
}

export function parseMemoryCandidateRecords(raw: unknown): MemoryCandidate[] {
  if (typeof raw !== "string") {
    throw createMemoryResponseError("malformed_response");
  }

  const trimmedRaw = raw.trim();
  if (!trimmedRaw) {
    throw createMemoryResponseError("empty_response");
  }

  const match = trimmedRaw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw createMemoryResponseError("malformed_response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw createMemoryResponseError("malformed_response");
  }

  if (!Array.isArray(parsed)) {
    throw createMemoryResponseError("malformed_response");
  }

  return parsed.flatMap((value): MemoryCandidate[] => {
    const candidate =
      typeof value === "string"
        ? { content: value }
        : typeof value === "object" && value !== null
          ? {
              content: (value as { content?: unknown }).content,
              memoryType: normalizeMemoryType(
                (value as { memoryType?: unknown }).memoryType ??
                  (value as { type?: unknown }).type,
              ),
              confidence: (value as { confidence?: unknown }).confidence,
            }
          : null;
    if (!candidate || typeof candidate.content !== "string") return [];

    const fact = candidate.content.trim();
    if (!fact || fact === "..." || fact.length > MAX_MEMORY_LENGTH) {
      return [];
    }

    const confidence =
      typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence)
        ? Math.max(0.1, Math.min(0.99, candidate.confidence))
        : undefined;
    return [
      {
        content: fact,
        memoryType: candidate.memoryType,
        confidence,
        source: "conversation",
      },
    ];
  });
}

function logMemoryFailure(error: unknown, fallbackCategory: string): void {
  const context =
    error instanceof GroqReliabilityError ? getGroqErrorLogContext(error) : {};
  const category =
    error instanceof GroqReliabilityError ? error.category : fallbackCategory;

  console.error("[Assistant ₯] Memory extraction failed", {
    operation: "memory_extraction",
    ...context,
    category,
  });
}

export async function extractMemories(
  userId: string,
  guildId: string,
  userMsg: string,
  assistantMsg: string,
  dependencies: MemoryExtractionDependencies = {},
): Promise<void> {
  const createCompletion =
    dependencies.createCompletion ?? createGroqCompletion;
  const extractionTimeoutMs =
    dependencies.memoryExtractionTimeoutMs ?? MEMORY_EXTRACTION_TIMEOUT_MS;

  let completion: unknown;
  try {
    completion = await Promise.race([
      createCompletion(
        {
          model: TEXT_MODEL,
          messages: [
            {
              role: "system",
              content:
                'You maintain a small, useful memory of the user. Extract only concrete, durable personal facts the user explicitly stated about themselves or explicitly asked the assistant to remember. Return ONLY a valid JSON array. Each item may be a short string or an object with content, memoryType, and confidence. Use memoryType values preference, interest, project, goal, fact, communication_style, technical_context, or temporary_context. Prefer confidence from 0.5 to 0.95. Do not save questions, one-off tasks, sensitive personal data, guesses, assistant claims, temporary moods, secrets, or facts about other people. If nothing concrete was learned, return [].',
            },
            {
              role: "user",
              content: `User said: "${userMsg}"\nAssistant replied: "${assistantMsg}"`,
            },
          ],
          max_tokens: 180,
        },
        { requestType: "memory" },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Memory extraction timed out")),
          extractionTimeoutMs,
        ),
      ),
    ]);
  } catch (error) {
    logMemoryFailure(error, "unknown");
    return;
  }

  let candidates: MemoryCandidate[];
  try {
    const shape = completion as MemoryCompletionShape | null;
    const raw = shape?.choices?.[0]?.message?.content;
    candidates = parseMemoryCandidateRecords(raw);
  } catch (error) {
    logMemoryFailure(error, "malformed_response");
    return;
  }

  if (candidates.length === 0) return;

  try {
    if (dependencies.addMemoryCandidates) {
      await dependencies.addMemoryCandidates(userId, guildId, candidates);
    } else if (dependencies.addMemories) {
      await dependencies.addMemories(
        userId,
        guildId,
        candidates.map((candidate) => candidate.content),
      );
    } else {
      await db.addMemoryCandidates(userId, guildId, candidates);
    }
  } catch (error) {
    logMemoryFailure(error, "persistence");
  }
}
