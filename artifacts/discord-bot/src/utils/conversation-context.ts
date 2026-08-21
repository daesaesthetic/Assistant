/**
 * Builds the primary conversation request context.
 *
 * The provider tokenizer is not available locally, so this uses a conservative
 * estimator: structural message overhead plus roughly 3.5 characters/token.
 * This is a planning estimate, not a claim about exact provider tokenization.
 * Persisted history is never changed while building a request.
 */

export const CONTEXT_TOKEN_BUDGET = 12_000;
export const RESERVED_OUTPUT_TOKENS = 800;
export const INPUT_TOKEN_BUDGET = CONTEXT_TOKEN_BUDGET - RESERVED_OUTPUT_TOKENS;

const MESSAGE_OVERHEAD_TOKENS = 4;
const ESTIMATED_CHARS_PER_TOKEN = 3.5;
const STABLE_INSTRUCTIONS_MAX_TOKENS = 2_000;
const RECENT_HISTORY_MAX_TOKENS = 6_500;
const PERSONA_MAX_TOKENS = 1_200;
const TRAITS_MAX_TOKENS = 800;
const MEMORY_MAX_TOKENS = 1_400;

export type ContextChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ConversationHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationContextInput = {
  botName: string;
  persona?: {
    personaName?: string;
    customDescription?: string;
  };
  traits?: string[];
  memories?: string[];
  history: ConversationHistoryMessage[];
  currentMessage: string;
};

export type ConversationContextResult = {
  messages: ContextChatMessage[];
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  inputTokenBudget: number;
  truncatedHistory: boolean;
  truncatedContext: boolean;
  optionalContextTruncated: boolean;
  currentMessageExceedsBudget: boolean;
};

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

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

export function estimateContextTokens(message: ContextChatMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
}

function trimText(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return "";
  const maxCharacters = Math.floor(tokenBudget * ESTIMATED_CHARS_PER_TOKEN);
  if (text.length <= maxCharacters) return text;
  if (maxCharacters <= 1) return text.slice(0, maxCharacters);
  return `${text.slice(0, maxCharacters - 1)}…`;
}

function sectionMessage(
  title: string,
  content: string,
): ContextChatMessage | null {
  const trimmed = content.trim();
  return trimmed ? { role: "system", content: `${title}\n${trimmed}` } : null;
}

function boundMessage(
  message: ContextChatMessage,
  tokenBudget: number,
): { message: ContextChatMessage | null; truncated: boolean } {
  if (tokenBudget <= MESSAGE_OVERHEAD_TOKENS) {
    return { message: null, truncated: message.content.length > 0 };
  }

  const bounded = trimText(
    message.content,
    tokenBudget - MESSAGE_OVERHEAD_TOKENS,
  );
  return {
    message: bounded ? { ...message, content: bounded } : null,
    truncated: bounded.length < message.content.length,
  };
}

function buildStableInstructions(botName: string): string {
  return `You are ${botName}. You are a capable, perceptive assistant with a clean, slightly mysterious presence — never robotic, never overly enthusiastic. You are concise, context-aware, and genuine. Never break character. Never mention being an AI, a language model, or any underlying technology. Respond as ${botName} at all times.

Your capabilities — when a user asks what you can do, draw from this list naturally. Never recite it verbatim:
• Ongoing conversation with persistent memory of the user across sessions
• Suggestions: provide high-quality, reasoned suggestions on any topic (/suggest)
• Image transformation: interpret and transform images via written instructions (/edit)
• Web search: look up current information (/search)
• Personas: users can change your conversation style — Analyst, Observer, Strategist, Minimalist, Oracle, or a fully custom description (/persona)
• Traits: users can layer personality modifiers — e.g. flirty, sarcastic, blunt, warm — on top of the active persona (/traits add)
• Memory: you remember facts the user shares and surface them naturally; users can view or clear them (/memories)
• Bot name: server admins can rename you per-server (/name set)
• Conversation channels: admins can create a dedicated channel where you reply to every message freely, no command needed (/channel create)`;
}

function buildPersona(persona?: ConversationContextInput["persona"]): string {
  if (!persona?.personaName) return "";
  if (persona.personaName === "custom") {
    return persona.customDescription?.trim()
      ? `Conversation style override:\n${persona.customDescription.trim()}`
      : "";
  }
  return PERSONAS[persona.personaName]
    ? `Conversation style:\n${PERSONAS[persona.personaName]}`
    : "";
}

function buildTraits(traits: string[] = []): string {
  const values = traits.map((trait) => trait.trim()).filter(Boolean);
  return values.length
    ? `Personality traits currently active — embody these naturally and consistently. Let them shape your tone, word choice, and attitude without ever announcing them:\n${values.map((trait) => `• ${trait}`).join("\n")}`
    : "";
}

function buildMemories(memories: string[] = []): string {
  const values = memories.map((memory) => memory.trim()).filter(Boolean);
  return values.length
    ? `Things you know about this user — reference naturally when relevant, never recite the whole list:\n${values.map((memory) => `- ${memory}`).join("\n")}`
    : "";
}

function estimateMessagesTokens(messages: ContextChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateContextTokens(message),
    0,
  );
}

export function validateConversationContext(
  result: ConversationContextResult,
  currentMessage: string,
): void {
  const validRoles = new Set(["system", "user", "assistant"]);
  if (
    result.messages.some(
      (message) =>
        !validRoles.has(message.role) ||
        typeof message.content !== "string" ||
        (message.role === "system" && !message.content.trim()),
    )
  ) {
    throw new Error("Conversation context contains an invalid message");
  }

  const finalMessage = result.messages.at(-1);
  if (
    !finalMessage ||
    finalMessage.role !== "user" ||
    finalMessage.content !== currentMessage
  ) {
    throw new Error("Conversation context lost the current user message");
  }

  const estimatedInputTokens = estimateMessagesTokens(result.messages);
  if (estimatedInputTokens !== result.estimatedInputTokens) {
    throw new Error("Conversation context token estimate is inconsistent");
  }
  if (
    result.reservedOutputTokens < 0 ||
    result.inputTokenBudget + result.reservedOutputTokens !==
      CONTEXT_TOKEN_BUDGET
  ) {
    throw new Error("Conversation context output reservation is invalid");
  }
  if (
    !result.currentMessageExceedsBudget &&
    estimatedInputTokens > result.inputTokenBudget
  ) {
    throw new Error("Conversation context exceeds its input budget");
  }
}

function selectHistory(
  history: ConversationHistoryMessage[],
  availableTokens: number,
): { messages: ConversationHistoryMessage[]; truncated: boolean } {
  const selected: ConversationHistoryMessage[] = [];
  let remaining = availableTokens;
  let truncated = false;

  const validHistory = history.filter((message) => message.content.trim());

  for (let index = validHistory.length - 1; index >= 0; index -= 1) {
    const message = validHistory[index];
    const full = { role: message.role, content: message.content };
    const cost = estimateContextTokens(full);
    if (cost <= remaining) {
      selected.unshift(message);
      remaining -= cost;
      continue;
    }

    truncated = true;
    const contentBudget = Math.max(0, remaining - MESSAGE_OVERHEAD_TOKENS);
    const partial = trimText(message.content, contentBudget);
    if (partial) selected.unshift({ ...message, content: partial });
    break;
  }

  if (
    selected.length < validHistory.length ||
    validHistory.length < history.length
  ) {
    truncated = true;
  }
  return { messages: selected, truncated };
}

export function buildConversationContext(
  input: ConversationContextInput,
): ConversationContextResult {
  // The current message is intentionally never bounded or removed. If it is
  // larger than the provider budget by itself, the result reports that fact
  // and omits optional context rather than silently changing user input.
  const currentMessage: ContextChatMessage = {
    role: "user",
    content: input.currentMessage,
  };
  const currentCost = estimateContextTokens(currentMessage);
  let remaining = Math.max(0, INPUT_TOKEN_BUDGET - currentCost);

  const stable = sectionMessage(
    "Stable instructions:",
    buildStableInstructions(input.botName),
  );
  const persona = sectionMessage("Persona:", buildPersona(input.persona));
  const traits = sectionMessage("Traits:", buildTraits(input.traits));
  const memories = sectionMessage(
    "Memory context:",
    buildMemories(input.memories),
  );
  let truncatedContext = false;
  let optionalContextTruncated = false;
  const boundedStable: ContextChatMessage[] = [];

  if (stable) {
    const bounded = boundMessage(
      stable,
      Math.min(remaining, STABLE_INSTRUCTIONS_MAX_TOKENS),
    );
    if (bounded.message) {
      boundedStable.push(bounded.message);
      remaining -= estimateContextTokens(bounded.message);
    }
    truncatedContext ||= bounded.truncated;
    optionalContextTruncated ||= bounded.truncated;
  }

  // Allocation follows the reduction priority: stable instructions, newest
  // history, then persona, traits, and memory. Final message ordering remains
  // stable/persona/traits/memory/history/current for prompt compatibility.
  const historyResult = selectHistory(
    input.history,
    Math.min(remaining, RECENT_HISTORY_MAX_TOKENS),
  );
  remaining -= historyResult.messages.reduce(
    (total, message) => total + estimateContextTokens({ ...message }),
    0,
  );

  const optionalSections = [
    [persona, PERSONA_MAX_TOKENS],
    [traits, TRAITS_MAX_TOKENS],
    [memories, MEMORY_MAX_TOKENS],
  ] as const;
  const boundedOptional: ContextChatMessage[] = [];
  for (const [section, allocation] of optionalSections) {
    if (!section) continue;
    const bounded = boundMessage(section, Math.min(remaining, allocation));
    if (bounded.message) {
      boundedOptional.push(bounded.message);
      remaining -= estimateContextTokens(bounded.message);
    }
    truncatedContext ||= bounded.truncated;
    optionalContextTruncated ||= bounded.truncated;
  }

  const messages = [
    ...boundedStable,
    ...boundedOptional,
    ...historyResult.messages,
    currentMessage,
  ];
  const estimatedInputTokens = estimateMessagesTokens(messages);

  return {
    messages,
    estimatedInputTokens,
    reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
    inputTokenBudget: INPUT_TOKEN_BUDGET,
    truncatedHistory: historyResult.truncated,
    truncatedContext:
      truncatedContext ||
      historyResult.truncated ||
      estimatedInputTokens + RESERVED_OUTPUT_TOKENS > CONTEXT_TOKEN_BUDGET,
    optionalContextTruncated,
    currentMessageExceedsBudget: currentCost > INPUT_TOKEN_BUDGET,
  };
}
