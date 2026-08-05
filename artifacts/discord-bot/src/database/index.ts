/**
 * Persistent JSON store with atomic writes.
 *
 * Writes go to a `.tmp` file first, then fs.renameSync() swaps it in place.
 * rename(2) is atomic on Linux — no partial writes, no corruption if the
 * process dies mid-write. A small in-memory cache avoids repeated disk reads
 * on hot paths.
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
}

const EMPTY: DBData = { personas: {}, warnings: {}, conversations: {}, guildConfig: {} };

// In-memory cache — invalidated on every write
let cache: DBData | null = null;

function load(): DBData {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(DB_PATH, "utf8")) as DBData;
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

function save(data: DBData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  // Atomic write: write temp → rename
  writeFileSync(TMP_PATH, JSON.stringify(data, null, 2), "utf8");
  renameSync(TMP_PATH, DB_PATH);
  cache = data;
}

export const db = {
  getPersona(userId: string, guildId: string): Persona | null {
    return load().personas[`${userId}-${guildId}`] ?? null;
  },

  setPersona(userId: string, guildId: string, personaName: string, customDescription: string): void {
    const data = load();
    data.personas[`${userId}-${guildId}`] = { personaName, customDescription };
    save(data);
  },

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

  getGuildConfig(guildId: string): GuildConfig | null {
    return load().guildConfig[guildId] ?? null;
  },

  setGuildConfig(guildId: string, config: Partial<GuildConfig>): void {
    const data = load();
    const existing = data.guildConfig[guildId];
    data.guildConfig[guildId] = {
      blacklistedWords: existing?.blacklistedWords ?? [],
      modLogChannelId: existing?.modLogChannelId,
      ...config,
    };
    save(data);
  },
};
