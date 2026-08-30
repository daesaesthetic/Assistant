import type { UserPreference } from "../database/index.js";

export type PreferenceKey =
  | "preferred_verbosity"
  | "technical_depth"
  | "preferred_tone"
  | "humor_tolerance"
  | "preferred_formatting"
  | "interaction_style";

export interface PreferenceSignal {
  key: PreferenceKey;
  value: string;
  confidence: number;
  source: "explicit" | "correction" | "inferred";
}

const SIGNALS: Array<{
  key: PreferenceKey;
  value: string;
  patterns: RegExp[];
  confidence: number;
  source: PreferenceSignal["source"];
}> = [
  {
    key: "preferred_verbosity",
    value: "concise",
    patterns: [
      /\b(be|keep it|make it|reply|respond) (brief|short|concise)\b/i,
      /\btoo (long|verbose)\b/i,
      /\b(get to the point|less detail)\b/i,
    ],
    confidence: 0.9,
    source: "explicit",
  },
  {
    key: "preferred_verbosity",
    value: "detailed",
    patterns: [
      /\b(more detail|go deeper|explain in depth|step by step|thorough)\b/i,
      /\bnot enough detail\b/i,
    ],
    confidence: 0.9,
    source: "explicit",
  },
  {
    key: "preferred_tone",
    value: "casual",
    patterns: [
      /\b(less formal|more casual|talk like a person|sound natural)\b/i,
      /\btoo formal|sounds robotic|stop sounding like (a )?(bot|customer support)\b/i,
    ],
    confidence: 0.88,
    source: "correction",
  },
  {
    key: "preferred_tone",
    value: "formal",
    patterns: [
      /\b(more formal|professional tone|sound professional)\b/i,
      /\btoo casual\b/i,
    ],
    confidence: 0.85,
    source: "correction",
  },
  {
    key: "preferred_formatting",
    value: "bullets",
    patterns: [
      /\b(use|give me|format (it|this) with) (bullets|bullet points|a list)\b/i,
      /\bplease use bullets\b/i,
    ],
    confidence: 0.86,
    source: "explicit",
  },
  {
    key: "preferred_formatting",
    value: "prose",
    patterns: [
      /\b(no|without) (bullets|bullet points)\b/i,
      /\bwrite it in prose\b/i,
    ],
    confidence: 0.86,
    source: "explicit",
  },
  {
    key: "humor_tolerance",
    value: "light_humor",
    patterns: [
      /\b(be funny|more humor|joke around|don't be so serious)\b/i,
      /\bbanter\b/i,
    ],
    confidence: 0.82,
    source: "explicit",
  },
  {
    key: "humor_tolerance",
    value: "serious",
    patterns: [
      /\b(no jokes|don't joke|keep it serious|be serious)\b/i,
    ],
    confidence: 0.88,
    source: "explicit",
  },
  {
    key: "technical_depth",
    value: "deep",
    patterns: [
      /\b(include the technical details|be technical|under the hood|show the reasoning)\b/i,
      /\bshow me the code\b/i,
    ],
    confidence: 0.82,
    source: "explicit",
  },
  {
    key: "technical_depth",
    value: "plain_language",
    patterns: [
      /\b(explain simply|plain english|nontechnical|no jargon)\b/i,
    ],
    confidence: 0.86,
    source: "explicit",
  },
  {
    key: "interaction_style",
    value: "direct",
    patterns: [
      /\b(be direct|just tell me|don't sugarcoat|give me the honest answer)\b/i,
    ],
    confidence: 0.84,
    source: "explicit",
  },
];

export function detectPreferenceSignals(message: string): PreferenceSignal[] {
  return SIGNALS.filter((signal) =>
    signal.patterns.some((pattern) => pattern.test(message)),
  ).map(({ key, value, confidence, source }) => ({
    key,
    value,
    confidence,
    source,
  }));
}

export function formatUserPreferences(preferences: UserPreference[] = []): string {
  const established = preferences
    .filter((preference) => preference.confidence >= 0.55)
    .sort((left, right) => right.confidence - left.confidence)
    .map(
      (preference) =>
        `• ${preference.key.replaceAll("_", " ")}: ${preference.value} (confidence ${Math.round(preference.confidence * 100)}%)`,
    );

  return established.length
    ? `Learned interaction preferences — apply subtly and only when compatible with the current request:\n${established.join("\n")}`
    : "";
}