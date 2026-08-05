/**
 * Persistent JSON store with atomic writes.
 * write → temp file → rename(2) — atomic on Linux, no corruption on crash.
 * In-memory cache avoids repeated disk reads on hot paths.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const TMP_PATH = DB_PATH + ".tmp";

export interface Persona {
  personaName: string;
  customDescription: string;
}

export interface Warning {
  count: number;
  lastWarned: number;
}

export interface GuildConfig {
  modLogChannelId?: string;
  blacklistedWords: string[];
  botChannelIds: string[];
  botName: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface DBData {
  personas: Record<string, Persona>;
  warnings: Record<string, Warning>;
  conversations: Record<string, ConversationMessage[]>;
  guildConfig: Record<string, GuildConfig>;
  memories: Record<string, string[]>;
}

const EMPTY: DBData = {
  personas: {},
  warnings: {},
  conversations: {},
  guildConfig: {},
  memories: {},
};

let cache: DBData | null = null;

function load(): DBData {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(DB_PATH, "utf8")) as DBData;
    // Back-fill new keys for existing records
    if (!cache.memories) cache.memories = {};
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

function save(data: DBData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TMP_PATH, JSON.stringify(data, null, 2), "utf8");
  renameSync(TMP_PATH, DB_PATH);
  cache = data;
}

export const db = {
  // ── Personas ─────────────────────────────────────────────────────────────
  getPersona(userId: string, guildId: string): Persona | null {
    return load().personas[`${userId}-${guildId}`] ?? null;
  },
  setPersona(userId: string, guildId: string, personaName: string, customDescription: string): void {
    const data = load();
    data.personas[`${userId}-${guildId}`] = { personaName, customDescription };
    save(data);
  },

  // ── Warnings ──────────────────────────────────────────────────────────────
  getWarnings(userId: string, guildId: string): Warning | null {
    return load().warnings[`${userId}-${guildId}`] ?? null;
  },
  addWarning(userId: string, guildId: string): Warning {
    const data = load();
    const key = `${userId}-${guildId}`;
    const cur = data.warnings[key] ?? { count: 0, lastWarned: 0 };
    cur.count += 1;
    cur.lastWarned = Date.now();
    data.warnings[key] = cur;
    save(data);
    return cur;
  },
  resetWarnings(userId: string, guildId: string): void {
    const data = load();
    delete data.warnings[`${userId}-${guildId}`];
    save(data);
  },

  // ── Conversations ─────────────────────────────────────────────────────────
  getConversation(userId: string): ConversationMessage[] {
    return load().conversations[userId] ?? [];
  },
  setConversation(userId: string, messages: ConversationMessage[]): void {
    const data = load();
    data.conversations[userId] = messages;
    save(data);
  },
  clearConversation(userId: string): void {
    const data = load();
    delete data.conversations[userId];
    save(data);
  },

  // ── Memories ──────────────────────────────────────────────────────────────
  getMemories(userId: string, guildId: string): string[] {
    return load().memories[`${userId}-${guildId}`] ?? [];
  },
  addMemories(userId: string, guildId: string, facts: string[]): void {
    const data = load();
    const key = `${userId}-${guildId}`;
    const existing = data.memories[key] ?? [];
    // Merge, deduplicate (case-insensitive), cap at 30
    const seen = new Set(existing.map((s) => s.toLowerCase()));
    const fresh = facts.filter((f) => !seen.has(f.toLowerCase()));
    data.memories[key] = [...existing, ...fresh].slice(0, 30);
    save(data);
  },
  clearMemories(userId: string, guildId: string): void {
    const data = load();
    delete data.memories[`${userId}-${guildId}`];
    save(data);
  },

  // ── Guild config ──────────────────────────────────────────────────────────
  getGuildConfig(guildId: string): GuildConfig | null {
    return load().guildConfig[guildId] ?? null;
  },
  setGuildConfig(guildId: string, config: Partial<GuildConfig>): void {
    const data = load();
    const ex = data.guildConfig[guildId];
    data.guildConfig[guildId] = {
      blacklistedWords: ex?.blacklistedWords ?? [],
      botChannelIds: ex?.botChannelIds ?? [],
      botName: ex?.botName ?? "Azurion",
      modLogChannelId: ex?.modLogChannelId,
      ...config,
    };
    save(data);
  },

  // ── Bot name ──────────────────────────────────────────────────────────────
  getBotName(guildId: string): string {
    return load().guildConfig[guildId]?.botName || "Azurion";
  },
  setBotName(guildId: string, name: string): void {
    this.setGuildConfig(guildId, { botName: name });
  },

  // ── Bot channels ──────────────────────────────────────────────────────────
  getBotChannels(guildId: string): string[] {
    return load().guildConfig[guildId]?.botChannelIds ?? [];
  },
  addBotChannel(guildId: string, channelId: string): void {
    const channels = this.getBotChannels(guildId);
    if (!channels.includes(channelId)) {
      this.setGuildConfig(guildId, { botChannelIds: [...channels, channelId] });
    }
  },
  removeBotChannel(guildId: string, channelId: string): void {
    const channels = this.getBotChannels(guildId).filter((id) => id !== channelId);
    this.setGuildConfig(guildId, { botChannelIds: channels });
  },
};
