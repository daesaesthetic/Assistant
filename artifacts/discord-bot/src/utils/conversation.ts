/**
 * Shared conversation engine used by both /talk and the messageCreate
 * mention / bot-channel handler.
 *
 * Handles persona resolution, memory injection, history management,
 * and fires background memory extraction after every reply.
 */
import { groq, TEXT_MODEL } from "./groq.js";
import { db } from "../database/index.js";

const PERSONAS: Record<string, string> = {
  analyst:
    "You are a precise analytical thinker. You break down problems methodically, provide data-driven insights, and speak with measured authority. Avoid emotional language.",
  observer:
    "You are a quiet, perceptive observer. You notice patterns others miss and offer subtle, thoughtful commentary. You speak sparingly but meaningfully.",
  strategist:
    "You are a strategic thinker focused on outcomes and leverage. You frame everything in terms of moves, advantages, and long-term positioning.",
  minimalist:
    "You say only what is necessary. No fluff, no filler. Every word earns its place.",
  oracle:
    "You are a cryptic oracle. You speak in metaphors and abstractions, hinting at deeper truths without stating them plainly.",
};

function buildSystemPrompt(botName: string, personaName?: string, customDesc?: string): string {
  const base = `You are ${botName} — an assistant with a clean, minimal, slightly mysterious presence. You are not robotic or overly playful. You are concise, thoughtful, and context-aware. Never break character. Never mention being an AI, a language model, or any underlying technology.`;

  if (!personaName) return base;
  if (personaName === "custom") return customDesc?.trim() || base;
  return PERSONAS[personaName] ?? base;
}

export async function generateReply(params: {
  userId: string;
  guildId: string;
  content: string;
  resetHistory?: boolean;
}): Promise<{ text: string; botName: string; personaLabel?: string }> {
  const { userId, guildId, content, resetHistory = false } = params;

  if (resetHistory) db.clearConversation(userId);

  const botName = db.getBotName(guildId);
  const persona = db.getPersona(userId, guildId);
  const memories = db.getMemories(userId, guildId);

  let systemPrompt = buildSystemPrompt(
    botName,
    persona?.personaName,
    persona?.customDescription
  );

  if (memories.length > 0) {
    systemPrompt +=
      "\n\nThings you know about this user — reference naturally when relevant, never recite the whole list:\n" +
      memories.map((m) => `- ${m}`).join("\n");
  }

  const history = db.getConversation(userId);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content },
  ];

  const completion = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages,
    max_tokens: 800,
  });

  const response = completion.choices[0]?.message?.content?.trim() ?? "...";

  // Persist updated history (cap at 20 messages = 10 exchanges)
  const updatedHistory = [
    ...history,
    { role: "user" as const, content },
    { role: "assistant" as const, content: response },
  ].slice(-20);
  db.setConversation(userId, updatedHistory);

  // Fire memory extraction in the background — never blocks the reply
  void extractMemories(userId, guildId, content, response);

  let personaLabel: string | undefined;
  if (persona) {
    personaLabel =
      persona.personaName === "custom"
        ? "Custom"
        : persona.personaName.charAt(0).toUpperCase() + persona.personaName.slice(1);
  }

  return { text: response, botName, personaLabel };
}

async function extractMemories(
  userId: string,
  guildId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  try {
    const completion = await groq.chat.completions.create({
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
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
    // Grab the first JSON array in the response (model sometimes adds commentary)
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    const facts = JSON.parse(match[0]) as unknown;
    if (Array.isArray(facts) && facts.length > 0) {
      db.addMemories(userId, guildId, facts.filter((f): f is string => typeof f === "string"));
    }
  } catch {
    // Memory extraction is non-critical — fail silently
  }
}
