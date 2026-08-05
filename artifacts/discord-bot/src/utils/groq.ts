import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn("[Azurion] GROQ_API_KEY is not set — AI features will be unavailable.");
}

export const groq = new Groq({ apiKey: apiKey ?? "no-key" });

/** Best general-purpose model for text generation */
export const TEXT_MODEL = "llama-3.3-70b-versatile";

/** Vision-capable model for image analysis */
export const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
