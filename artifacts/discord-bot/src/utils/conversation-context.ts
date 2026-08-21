/**
 * Builds the primary conversation request context.
 *
 * The estimator intentionally errs high: provider tokenization is not available
 * locally, so each message includes a small structural overhead and text is
 * estimated at roughly 3.5 characters per token rather than treating chars / 4
 * as exact. Stored history is never changed by this module.
 */

export const CONTEXT_TOKEN_BUDGET = 12_000;
export const RESERVED_OUTPUT_TOKENS = 800;

const INPUT_TOKEN_BUDGET =
  CONTEXT_TOKEN_BUDGET - RESERVED_OUTPUT_TOKENS;
const MESSAGE_OVERHEAD_TOKENS = 4;
const ESTIMATED_CHARS_PER_TOKEN = 3.5;

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
};

const PERSONAS: Record<string, string> = {
  analyst:
    "You are a precise analytical thinker. Break down problems methodically, provide data-driven insights, and speak with measured authority. Avoid emotional language.",
  observer:
    "You are a quiet, perceptive observer. You notice patterns others miss and offer subtle, thoughtful commentary. You speak sparingly but meaningfully.",
  strategist:
    "You are a strategic thinker focused on outcomes and leverage. Frame everything in terms of moves, advantages, and long-term positioning.",
  minimalist: "Say only what is necessary. No fluff, no filler. Every word earns its place.",
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

function sectionMessage(title: string, content: string): ContextChatMessage | null {
  const trimmed = content.trim();
  return trimmed
    ? { role: "system", content: `${title}\n${trimmed}` }
    : null;
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

function selectHistory(
  history: ConversationHistoryMessage[],
  availableTokens: number,
): { messages: ConversationHistoryMessage[]; truncated: boolean } {
  const selected: ConversationHistoryMessage[] = [];
  let remaining = availableTokens;
  let truncated = false;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
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

  if (selected.length < history.length) truncated = true;
  return { messages: selected, truncated };
}

export function buildConversationContext(
  input: ConversationContextInput,
): ConversationContextResult {
  const rawCurrentMessage: ContextChatMessage = {
    role: "user",
    content: input.currentMessage,
  };
  const currentMessage: ContextChatMessage = {
    ...rawCurrentMessage,
    content: trimText(
      rawCurrentMessage.content,
      Math.max(0, INPUT_TOKEN_BUDGET - MESSAGE_OVERHEAD_TOKENS),
    ),
  };
  const currentCost = estimateContextTokens(currentMessage);
  const optionalBudget = Math.max(0, INPUT_TOKEN_BUDGET - currentCost);

  const stable = sectionMessage("Stable instructions:", buildStableInstructions(input.botName));
  const persona = sectionMessage("Persona:", buildPersona(input.persona));
  const traits = sectionMessage("Traits:", buildTraits(input.traits));
  const memories = sectionMessage("Memory context:", buildMemories(input.memories));
  const optionalSections = [persona, traits, memories].filter(
    (message): message is ContextChatMessage => message !== null,
  );

  // Stable instructions are protected first. Recent history gets the next
  // available capacity; lower-priority optional sections use what remains.
  let remaining = optionalBudget;
  const boundedSections: ContextChatMessage[] = [];
  let truncatedContext = false;

  if (stable) {
    const bounded = trimText(stable.content, Math.floor(optionalBudget * 0.62));
    if (bounded.length < stable.content.length) truncatedContext = true;
    if (bounded) {
      boundedSections.push({ ...stable, content: bounded });
      remaining -= estimateContextTokens({ ...stable, content: bounded });
    }
  }

  const historyResult = selectHistory(input.history, remaining);
  remaining -= historyResult.messages.reduce(
    (total, message) => total + estimateContextTokens({ ...message }),
    0,
  );

  optionalSections.forEach((section, index) => {
    const allocation = Math.floor(optionalBudget * [0.16, 0.12, 0.1][index]);
    const budget = Math.min(remaining, allocation);
    const bounded = trimText(section.content, budget);
    if (bounded.length < section.content.length) truncatedContext = true;
    if (bounded) {
      boundedSections.push({ ...section, content: bounded });
      remaining -= estimateContextTokens({ ...section, content: bounded });
    }
  });

  const orderedOptional = boundedSections.filter((message) => message !== stable);
  const messages = [
    ...(stable && boundedSections.includes(stable) ? [boundedSections[0]] : []),
    ...orderedOptional,
    ...historyResult.messages,
    currentMessage,
  ];
  const estimatedInputTokens = messages.reduce(
    (total, message) => total + estimateContextTokens(message),
    0,
  );

  return {
    messages,
    estimatedInputTokens,
    reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
    inputTokenBudget: INPUT_TOKEN_BUDGET,
    truncatedHistory: historyResult.truncated,
    truncatedContext:
      truncatedContext ||
      historyResult.truncated ||
      currentMessage.content.length < input.currentMessage.length ||
      estimatedInputTokens + RESERVED_OUTPUT_TOKENS > CONTEXT_TOKEN_BUDGET,
  };
}