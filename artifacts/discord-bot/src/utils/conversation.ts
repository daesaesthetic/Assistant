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
  TEXT_MODEL,
} from "./groq.js";
import { db } from "../database/index.js";
import { conversationStore } from "./conversation-store.js";

const CONTEXT_TOKEN_BUDGET = 12_000;
const CHARS_PER_ESTIMATED_TOKEN = 4;

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

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_ESTIMATED_TOKEN);
}

function trimToTokenBudget(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return "";
  const maxCharacters = tokenBudget * CHARS_PER_ESTIMATED_TOKEN;
  if (text.length <= maxCharacters) return text;
  if (maxCharacters <= 1) return text.slice(0, maxCharacters);
  return `${text.slice(0, maxCharacters - 1)}…`;
}

function buildSystemPrompt(
  botName: string,
  personaName?: string,
  customDesc?: string,
  traits?: string[],
): string {
  // ── Core identity (always present) ───────────────────────────────────────
  const identity = `You are ${botName}. You are a capable, perceptive assistant with a clean, slightly mysterious presence — never robotic, never overly enthusiastic. You are concise, context-aware, and genuine. Never break character. Never mention being an AI, a language model, or any underlying technology. Respond as ${botName} at all times.`;

  // ── Capabilities (so the bot can answer "what can you do?" accurately) ───
  const capabilities = `

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

  // ── Traits (layer personality modifiers, if set) ──────────────────────────
  const traitSection =
    traits && traits.length > 0
      ? `\n\nPersonality traits currently active — embody these naturally and consistently. Let them shape your tone, word choice, and attitude without ever announcing them:\n${traits.map((t) => `• ${t}`).join("\n")}`
      : "";

  // ── Persona / conversation style (applied as primary behavioral filter) ───
  let styleSection = "";
  if (personaName === "custom" && customDesc?.trim()) {
    styleSection = `\n\nConversation style override:\n${customDesc.trim()}`;
  } else if (personaName && PERSONAS[personaName]) {
    styleSection = `\n\nConversation style:\n${PERSONAS[personaName]}`;
  }

  return identity + capabilities + traitSection + styleSection;
}

export function buildBudgetedMessages(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  currentContent: string,
): ChatMessage[] {
  const currentMessage: ChatMessage = { role: "user", content: currentContent };
  const currentTokens = estimateTokens(currentContent);
  const availableForSystemAndHistory = Math.max(
    0,
    CONTEXT_TOKEN_BUDGET - currentTokens,
  );

  // The system prompt is assembled in priority order. If it is too large,
  // preserve the stable instructions and trim the lower-priority tail first.
  const systemMessage: ChatMessage = {
    role: "system",
    content: trimToTokenBudget(systemPrompt, availableForSystemAndHistory),
  };
  let remainingTokens = Math.max(
    0,
    availableForSystemAndHistory - estimateTokens(systemMessage.content),
  );

  // Select recent history first, then restore chronological ordering.
  const selectedHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];
  for (
    let index = history.length - 1;
    index >= 0 && remainingTokens > 0;
    index -= 1
  ) {
    const message = history[index];
    const messageTokens = estimateTokens(message.content);
    if (messageTokens <= remainingTokens) {
      selectedHistory.unshift(message);
      remainingTokens -= messageTokens;
      continue;
    }

    // An oversized historical message is lower priority than the current
    // request, so keep only the portion that fits and stop before older turns.
    const trimmed = trimToTokenBudget(message.content, remainingTokens);
    if (trimmed) selectedHistory.unshift({ ...message, content: trimmed });
    break;
  }

  return [systemMessage, ...selectedHistory, currentMessage];
}

export async function generateReply(params: {
  userId: string;
  guildId: string;
  content: string;
  resetHistory?: boolean;
}): Promise<{ text: string; botName: string; personaLabel?: string }> {
  const { userId, guildId, content, resetHistory = false } = params;

  const context = { userId, guildId };

  return conversationStore.runExclusive(context, async () => {
    if (resetHistory) await conversationStore.reset(context);

    const botName = await db.getBotName(guildId);
    const persona = await db.getPersona(userId, guildId);
    const memories = await db.getMemories(userId, guildId);
    const traits = await db.getTraits(userId, guildId);

    let systemPrompt = buildSystemPrompt(
      botName,
      persona?.personaName,
      persona?.customDescription,
      traits,
    );

    if (memories.length > 0) {
      systemPrompt +=
        "\n\nThings you know about this user — reference naturally when relevant, never recite the whole list:\n" +
        memories.map((m) => `- ${m}`).join("\n");
    }

    const history = await conversationStore.getHistory(context);
    const messages = buildBudgetedMessages(systemPrompt, history, content);

    const completion = await createGroqCompletion(
      {
        model: TEXT_MODEL,
        messages,
        max_tokens: 800,
      },
      { requestType: "text" },
    );

    const response = completion.choices[0]?.message?.content?.trim() ?? "...";

    // Persist updated history (cap at 20 messages = 10 exchanges)
    const updatedHistory = [
      ...history,
      { role: "user" as const, content },
      { role: "assistant" as const, content: response },
    ].slice(-20);
    await conversationStore.setHistory(context, updatedHistory);

    // Fire memory extraction in the background — never blocks the reply
    void extractMemories(userId, guildId, content, response);

    let personaLabel: string | undefined;
    if (persona) {
      personaLabel =
        persona.personaName === "custom"
          ? "Custom"
          : persona.personaName.charAt(0).toUpperCase() +
            persona.personaName.slice(1);
    }

    return { text: response, botName, personaLabel };
  });
}

async function extractMemories(
  userId: string,
  guildId: string,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  try {
    const completion = await createGroqCompletion(
      {
        model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content:
              'You extract concrete personal facts about the user from a conversation turn. Return ONLY a valid JSON array of short strings. Examples: ["prefers dark mode","works as a nurse","lives in Tokyo"]. Only include definitive personal facts the user stated about themselves — not questions they asked, not what was said to them, not vague impressions. If nothing concrete was learned, return [].',
          },
          {
            role: "user",
            content: `User said: "${userMsg}"\nAssistant replied: "${assistantMsg}"`,
          },
        ],
        max_tokens: 150,
      },
      { requestType: "memory" },
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    const facts = JSON.parse(match[0]) as unknown;
    if (Array.isArray(facts) && facts.length > 0) {
      await db.addMemories(
        userId,
        guildId,
        facts.filter((f): f is string => typeof f === "string"),
      );
    }
  } catch (error) {
    // Memory extraction is non-critical and must not affect the primary reply.
    console.error(
      "[Azurion] Memory extraction failed",
      getGroqErrorLogContext(error),
    );
  }
}
