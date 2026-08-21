import {
  getGroqErrorLogContext,
  GroqReliabilityError,
  type GroqErrorCategory,
  type GroqRequestType,
} from "./groq.js";

export type AiErrorCategory = GroqErrorCategory | "persistence";

const USER_MESSAGES: Record<AiErrorCategory, string> = {
  configuration: "The AI service isn't configured correctly right now.",
  rate_limit:
    "The AI service is currently rate-limited. Please try again shortly.",
  context:
    "That request is too large for the AI context. Try shortening your message or starting a new conversation.",
  transient_provider:
    "The AI service is temporarily unavailable. Please try again shortly.",
  network: "I couldn't reach the AI service. Please try again shortly.",
  timeout: "The AI request took too long to complete. Please try again.",
  empty_response: "The AI returned an empty response. Please try again.",
  malformed_response: "The AI returned an invalid response. Please try again.",
  persistence:
    "Your response was generated, but conversation history may not have been saved.",
  unknown:
    "Something went wrong while processing your request. Please try again.",
};

export function getAiErrorCategory(
  error: unknown,
  fallback: AiErrorCategory = "unknown",
): AiErrorCategory {
  return error instanceof GroqReliabilityError ? error.category : fallback;
}

export function getAiUserFacingMessage(
  error: unknown,
  fallback: AiErrorCategory = "unknown",
): string {
  return USER_MESSAGES[getAiErrorCategory(error, fallback)];
}

export function getSafeAiErrorLogContext(
  operation: string,
  error: unknown,
  fallback: AiErrorCategory = "unknown",
): Record<string, unknown> {
  const category = getAiErrorCategory(error, fallback);
  return {
    operation,
    ...getGroqErrorLogContext(error),
    category,
  };
}

type CompletionShape = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export function validateCompletionText(
  completion: unknown,
  requestType: GroqRequestType,
  model: string,
): string {
  const shape = completion as CompletionShape | null;
  const content = shape?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new GroqReliabilityError({
      category: "malformed_response",
      requestType,
      model,
      attempts: 1,
      elapsedMs: 0,
    });
  }

  const text = content.trim();
  if (!text) {
    throw new GroqReliabilityError({
      category: "empty_response",
      requestType,
      model,
      attempts: 1,
      elapsedMs: 0,
    });
  }

  return text;
}
