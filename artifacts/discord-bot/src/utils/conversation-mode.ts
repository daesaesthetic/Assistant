export type ConversationMode =
  | "casual"
  | "emotional"
  | "technical"
  | "brainstorming"
  | "creative"
  | "advice"
  | "banter";

export interface ConversationModeResult {
  mode: ConversationMode;
  instructions: string;
}

const MODE_INSTRUCTIONS: Record<ConversationMode, string> = {
  casual:
    "Respond as a relaxed conversational companion. React to what was actually said, keep the answer naturally sized, and do not turn a simple remark into a formal essay.",
  emotional:
    "Respond with socially aware warmth. Acknowledge the human meaning of the message briefly, avoid canned empathy or unnecessary diagnosis, and offer practical support only when it fits.",
  technical:
    "Respond as a precise technical collaborator. Diagnose before prescribing, state assumptions, use concrete examples or steps when useful, and preserve the user's level of technical depth.",
  brainstorming:
    "Respond as an exploratory thinking partner. Build on the idea, add useful angles, and be constructively opinionated without dismissing the premise or forcing a polished plan too early.",
  creative:
    "Respond as a collaborative creative partner. Match the requested medium and mood, offer vivid but useful ideas, and keep the work moving rather than over-explaining the process.",
  advice:
    "Respond as a thoughtful advisor. Distinguish facts from judgment, name tradeoffs, and give a clear recommendation when the situation supports one instead of hiding behind generic neutrality.",
  banter:
    "Respond conversationally with room for light humor or playful acknowledgement because the user's message signals it. Never force a joke, and switch back to seriousness immediately if the topic requires it.",
};

export function getConversationModeInstructions(
  mode: ConversationMode,
): string {
  return MODE_INSTRUCTIONS[mode];
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function inferConversationMode(message: string): ConversationModeResult {
  const normalized = message.trim().toLowerCase();

  if (
    hasAny(normalized, [
      /\b(exhausted|overwhelmed|frustrated|upset|angry|sad|anxious|worried|stressed|terrible|rough day)\b/,
      /\b(i feel|i'm feeling|im feeling|i can'?t cope|need to vent)\b/,
    ])
  ) {
    return { mode: "emotional", instructions: MODE_INSTRUCTIONS.emotional };
  }

  if (
    hasAny(normalized, [
      /\b(error|bug|debug|crash|crashing|stack trace|exception|typescript|javascript|python|sql|database|api|function|code|query|compile|runtime|deploy)\b/,
      /```/,
      /\bwhy is .* returning\b/,
    ])
  ) {
    return { mode: "technical", instructions: MODE_INSTRUCTIONS.technical };
  }

  if (
    hasAny(normalized, [
      /\b(brainstorm|ideas?|what if|imagine|possibilities|options|concepts?)\b/,
      /\b(i have a .* idea|thinking about building|should i build)\b/,
    ])
  ) {
    return {
      mode: "brainstorming",
      instructions: MODE_INSTRUCTIONS.brainstorming,
    };
  }

  if (
    hasAny(normalized, [
      /\b(write|rewrite|draft|story|poem|lyrics|design|name|brand|creative|character|scene)\b/,
      /\bmake this (sound|look)\b/,
    ])
  ) {
    return { mode: "creative", instructions: MODE_INSTRUCTIONS.creative };
  }

  if (
    hasAny(normalized, [
      /\b(should i|what should i|how do i decide|advice|recommend|worth it|pros and cons)\b/,
      /\b(dealing with|stuck on|not sure what to do)\b/,
    ])
  ) {
    return { mode: "advice", instructions: MODE_INSTRUCTIONS.advice };
  }

  if (
    hasAny(normalized, [
      /\b(lol|lmao|rofl|haha|hehe|jk|just kidding)\b/,
      /😂|🤣|😭/,
      /\b(well that went|classic me|plot twist)\b/,
    ])
  ) {
    return { mode: "banter", instructions: MODE_INSTRUCTIONS.banter };
  }

  return { mode: "casual", instructions: MODE_INSTRUCTIONS.casual };
}