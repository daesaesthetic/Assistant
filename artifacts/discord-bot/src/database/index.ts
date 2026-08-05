import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

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

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDB(): DBData {
  ensureDir();
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf8")) as DBData;
  } catch {
    return { personas: {}, warnings: {}, conversations: {}, guildConfig: {} };
  }
}

function saveDB(data: DBData): void {
  ensureDir();
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

export const db = {
  getPersona(userId: string, guildId: string): Persona | null {
    const data = loadDB();
    return data.personas[`${userId}-${guildId}`] ?? null;
  },

  setPersona(userId: string, guildId: string, personaName: string, customDescription: string): void {
    const data = loadDB();
    data.personas[`${userId}-${guildId}`] = { personaName, customDescription };
    saveDB(data);
  },

  getWarnings(userId: string, guildId: string): Warning | null {
    const data = loadDB();
    return data.warnings[`${userId}-${guildId}`] ?? null;
  },

  addWarning(userId: string, guildId: string): Warning {
    const data = loadDB();
    const key = `${userId}-${guildId}`;
    const current = data.warnings[key] ?? { count: 0, lastWarned: 0 };
    current.count += 1;
    current.lastWarned = Date.now();
    data.warnings[key] = current;
    saveDB(data);
    return current;
  },

  resetWarnings(userId: string, guildId: string): void {
    const data = loadDB();
    delete data.warnings[`${userId}-${guildId}`];
    saveDB(data);
  },

  getConversation(userId: string): ConversationMessage[] {
    const data = loadDB();
    return data.conversations[userId] ?? [];
  },

  setConversation(userId: string, messages: ConversationMessage[]): void {
    const data = loadDB();
    data.conversations[userId] = messages;
    saveDB(data);
  },

  clearConversation(userId: string): void {
    const data = loadDB();
    delete data.conversations[userId];
    saveDB(data);
  },

  getGuildConfig(guildId: string): GuildConfig | null {
    const data = loadDB();
    return data.guildConfig[guildId] ?? null;
  },

  setGuildConfig(guildId: string, config: Partial<GuildConfig>): void {
    const data = loadDB();
    const existing = data.guildConfig[guildId];
    data.guildConfig[guildId] = {
      blacklistedWords: existing?.blacklistedWords ?? [],
      modLogChannelId: existing?.modLogChannelId,
      ...config,
    };
    saveDB(data);
  },
};
