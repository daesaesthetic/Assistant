import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "groq-sdk/resources/chat/completions.js";

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn(
    "[Azurion] GROQ_API_KEY is not set — AI features will be unavailable.",
  );
}

const MAX_RETRY_AFTER_MS = 2_500;
const RETRY_BACKOFF_MS = 250;

export const GROQ_TIMEOUTS = {
  text: 30_000,
  vision: 45_000,
  memory: 15_000,
} as const;

export type GroqRequestType = keyof typeof GROQ_TIMEOUTS;

export type GroqErrorCategory =
  | "configuration"
  | "rate_limit"
  | "context"
  | "transient_provider"
  | "network"
  | "timeout"
  | "empty_response"
  | "malformed_response"
  | "unknown";

type CompletionParams = ChatCompletionCreateParamsNonStreaming;
type CompletionResult = ChatCompletion;
type RequestOptions = NonNullable<
  Parameters<Groq["chat"]["completions"]["create"]>[1]
>;

export class GroqReliabilityError extends Error {
  readonly category: GroqErrorCategory;
  readonly requestType: GroqRequestType;
  readonly model: string;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly attempts: number;
  readonly elapsedMs: number;

  constructor(params: {
    category: GroqErrorCategory;
    requestType: GroqRequestType;
    model: string;
    status?: number;
    retryAfterMs?: number;
    attempts: number;
    elapsedMs: number;
    cause?: unknown;
  }) {
    super(`Groq ${params.category} failure`, { cause: params.cause });
    this.name = "GroqReliabilityError";
    this.category = params.category;
    this.requestType = params.requestType;
    this.model = params.model;
    this.status = params.status;
    this.retryAfterMs = params.retryAfterMs;
    this.attempts = params.attempts;
    this.elapsedMs = params.elapsedMs;
  }
}

const groq = new Groq({
  apiKey: apiKey ?? "no-key",
  // The application owns retries so SDK retries cannot multiply requests.
  maxRetries: 0,
});

function getErrorField(error: unknown, field: string): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>)[field];
}

function getStatus(error: unknown): number | undefined {
  const status = getErrorField(error, "status");
  return typeof status === "number" ? status : undefined;
}

function getErrorName(error: unknown): string {
  const name = getErrorField(error, "name");
  return typeof name === "string" ? name : "";
}

function getErrorMessage(error: unknown): string {
  const message = getErrorField(error, "message");
  return typeof message === "string" ? message : "";
}

function getRetryAfterMs(error: unknown): number | undefined {
  const headers = getErrorField(error, "headers");
  if (!headers) return undefined;

  let value: string | null = null;
  if (headers instanceof Headers) {
    value = headers.get("retry-after");
  } else if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const header = record["retry-after"] ?? record["Retry-After"];
    if (typeof header === "string" || typeof header === "number")
      value = String(header);
  }

  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const dateMs = Date.parse(value) - Date.now();
  return Number.isFinite(dateMs) && dateMs >= 0 ? dateMs : undefined;
}

function isContextFailure(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return /(context|token|prompt).*(length|size|limit|exceed|large)|maximum.*(context|token)/.test(
    message,
  );
}

function classifyError(error: unknown): {
  category: GroqErrorCategory;
  status?: number;
  retryAfterMs?: number;
} {
  const status = getStatus(error);
  const name = getErrorName(error).toLowerCase();
  const message = getErrorMessage(error).toLowerCase();

  if (status === 401 || status === 403) {
    return { category: "configuration", status };
  }
  if (status === 429) {
    return {
      category: "rate_limit",
      status,
      retryAfterMs: getRetryAfterMs(error),
    };
  }
  if (status === 400 && isContextFailure(error)) {
    return { category: "context", status };
  }
  if (status === 400) {
    return { category: "unknown", status };
  }
  if (
    status === 408 ||
    status === 409 ||
    (status !== undefined && status >= 500 && status <= 599)
  ) {
    return { category: "transient_provider", status };
  }
  if (
    name.includes("timeout") ||
    name.includes("timedout") ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return { category: "timeout", status };
  }
  if (
    name.includes("connection") ||
    name.includes("network") ||
    name.includes("fetch") ||
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("socket")
  ) {
    return { category: "network", status };
  }

  return { category: "unknown", status };
}

function isRetryable(category: GroqErrorCategory): boolean {
  return category === "transient_provider" || category === "network";
}

function safeLogContext(params: {
  requestType: GroqRequestType;
  model: string;
  category: GroqErrorCategory;
  status?: number;
  retryAttempted: boolean;
  retryDelayMs?: number;
  timedOut: boolean;
  elapsedMs: number;
  attempts: number;
}) {
  return {
    requestType: params.requestType,
    model: params.model,
    category: params.category,
    ...(params.status === undefined ? {} : { status: params.status }),
    retryAttempted: params.retryAttempted,
    ...(params.retryDelayMs === undefined
      ? {}
      : { retryDelayMs: params.retryDelayMs }),
    timedOut: params.timedOut,
    elapsedMs: params.elapsedMs,
    attempts: params.attempts,
  };
}

export function getGroqErrorLogContext(
  error: unknown,
): Record<string, unknown> {
  if (error instanceof GroqReliabilityError) {
    return safeLogContext({
      requestType: error.requestType,
      model: error.model,
      category: error.category,
      status: error.status,
      retryAttempted: error.attempts > 1,
      retryDelayMs: error.retryAfterMs,
      timedOut: error.category === "timeout",
      elapsedMs: error.elapsedMs,
      attempts: error.attempts,
    });
  }
  return { category: "unknown" };
}

function getRetryDelayMs(
  category: GroqErrorCategory,
  retryAfterMs: number | undefined,
  attempt: number,
): number | undefined {
  if (category === "rate_limit") {
    if (retryAfterMs === undefined || retryAfterMs > MAX_RETRY_AFTER_MS)
      return undefined;
    return retryAfterMs;
  }
  if (isRetryable(category)) {
    return (
      RETRY_BACKOFF_MS * attempt + Math.floor(Math.random() * RETRY_BACKOFF_MS)
    );
  }
  return undefined;
}

export async function createGroqCompletion(
  params: CompletionParams,
  options: {
    requestType: GroqRequestType;
    retry?: boolean;
    timeoutMs?: number;
  },
): Promise<CompletionResult> {
  if (!apiKey) {
    const error = new GroqReliabilityError({
      category: "configuration",
      requestType: options.requestType,
      model: String(params.model),
      attempts: 0,
      elapsedMs: 0,
    });
    console.error(
      "[Azurion] Groq request failed",
      getGroqErrorLogContext(error),
    );
    throw error;
  }

  const timeoutMs = options.timeoutMs ?? GROQ_TIMEOUTS[options.requestType];
  const shouldRetry = options.retry ?? true;
  const startedAt = Date.now();
  let attempts = 0;
  let retryAttempted = false;
  let lastError: unknown;

  while (attempts < (shouldRetry ? 2 : 1)) {
    attempts += 1;
    try {
      const requestOptions: RequestOptions = {
        timeout: timeoutMs,
        maxRetries: 0,
      };
      const result = await groq.chat.completions.create(params, requestOptions);
      return result;
    } catch (error) {
      lastError = error;
      const classified = classifyError(error);
      const retryDelayMs = getRetryDelayMs(
        classified.category,
        classified.retryAfterMs,
        attempts,
      );
      const canRetry =
        attempts === 1 &&
        shouldRetry &&
        retryDelayMs !== undefined &&
        (isRetryable(classified.category) ||
          classified.category === "rate_limit");

      if (!canRetry) {
        const reliabilityError = new GroqReliabilityError({
          category: classified.category,
          requestType: options.requestType,
          model: String(params.model),
          status: classified.status,
          retryAfterMs: classified.retryAfterMs,
          attempts,
          elapsedMs: Date.now() - startedAt,
          cause: lastError,
        });
        console.error(
          "[Azurion] Groq request failed",
          safeLogContext({
            requestType: options.requestType,
            model: String(params.model),
            category: classified.category,
            status: classified.status,
            retryAttempted,
            retryDelayMs: classified.retryAfterMs,
            timedOut: classified.category === "timeout",
            elapsedMs: reliabilityError.elapsedMs,
            attempts,
          }),
        );
        throw reliabilityError;
      }

      retryAttempted = true;
      console.warn(
        "[Azurion] Groq request retrying",
        safeLogContext({
          requestType: options.requestType,
          model: String(params.model),
          category: classified.category,
          status: classified.status,
          retryAttempted,
          retryDelayMs,
          timedOut: false,
          elapsedMs: Date.now() - startedAt,
          attempts,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
}

/** Best general-purpose model for text generation */
export const TEXT_MODEL = "openai/gpt-oss-120b";

/** Vision-capable model for image analysis */
export const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
