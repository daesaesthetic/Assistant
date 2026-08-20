/**
 * Persistent JSON store with atomic writes.
 * write → temp file → rename(2) — atomic on Linux, no corruption on crash.
 * In-memory cache avoids repeated disk reads on hot paths.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from "fs";
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
  traits: Record<string, string[]>;
  /**
   * Conversations are keyed as `userId::guildId`.
   * Legacy user-only histories are retained here because their guild cannot
   * be determined safely from the old data.
   */
  legacyConversations: Record<string, ConversationMessage[]>;
  conversationSchemaVersion: 2;
}

const EMPTY: DBData = {
  personas: {},
  warnings: {},
  conversations: {},
  guildConfig: {},
  memories: {},
  traits: {},
  legacyConversations: {},
  conversationSchemaVersion: 2,
};

let cache: DBData | null = null;

const CONVERSATION_SEPARATOR = "::";
const LEGACY_BACKUP_PATH = DB_PATH + ".pre-conversation-scope.bak";

function conversationKey(userId: string, guildId: string): string {
  return `${userId}${CONVERSATION_SEPARATOR}${guildId}`;
}

function normalizeMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (message): message is ConversationMessage =>
      typeof message === "object" &&
      message !== null &&
      ((message as ConversationMessage).role === "user" ||
        (message as ConversationMessage).role === "assistant") &&
      typeof (message as ConversationMessage).content === "string"
  );
}

function normalizeDatabase(parsed: Partial<DBData>): { data: DBData; migrated: boolean } {
  const data = {
    ...structuredClone(EMPTY),
    ...parsed,
    legacyConversations: parsed.legacyConversations ?? {},
    conversationSchemaVersion: parsed.conversationSchemaVersion ?? 1,
  } as DBData;

  let migrated = false;

  if (!data.memories) data.memories = {};
  if (!data.traits) data.traits = {};
  if (!data.guildConfig) data.guildConfig = {};
  if (!data.personas) data.personas = {};
  if (!data.warnings) data.warnings = {};

  // Old records used only the user ID. They are ambiguous because the
  // previous schema did not store a guild ID, so preserve them separately
  // instead of assigning them to an arbitrary guild.
  if (data.conversationSchemaVersion < 2) {
    const oldConversations = data.conversations;
    data.conversations = {};

    if (oldConversations && typeof oldConversations === "object") {
      for (const [userId, messages] of Object.entries(oldConversations)) {
        data.legacyConversations[userId] = normalizeMessages(messages);
      }
    }

    data.conversationSchemaVersion = 2;
    migrated = true;
  } else {
    data.conversations = Object.fromEntries(
      Object.entries(data.conversations ?? {}).filter(([key, messages]) => {
        return key.includes(CONVERSATION_SEPARATOR) && normalizeMessages(messages).length > 0;
      })
    );
  }

  return { data, migrated };
}

function load(): DBData {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<DBData>;
    const normalized = normalizeDatabase(parsed);
    cache = normalized.data;

    if (normalized.migrated) {
      // Keep the original file before the first schema normalization. This
      // backup is intentionally never overwritten by later bot writes.
      if (!existsSync(LEGACY_BACKUP_PATH)) {
        copyFileSync(DB_PATH, LEGACY_BACKUP_PATH);
      }
      save(cache);
      console.log(
        `[Azurion] Preserved ${Object.keys(cache.legacyConversations).length} ambiguous legacy conversation(s).`
      );
    }
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
  getConversation(userId: string, guildId: string): ConversationMessage[] {
    return load().conversations[conversationKey(userId, guildId)] ?? [];
  },
  setConversation(userId: string, guildId: string, messages: ConversationMessage[]): void {
    const data = load();
    data.conversations[conversationKey(userId, guildId)] = normalizeMessages(messages);
    save(data);
  },
  clearConversation(userId: string, guildId: string): void {
    const data = load();
    delete data.conversations[conversationKey(userId, guildId)];
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
      botName: ex?.botName ?? "Assistant",
      modLogChannelId: ex?.modLogChannelId,
      ...config,
    };
    save(data);
  },

  // ── Traits ────────────────────────────────────────────────────────────────
  getTraits(userId: string, guildId: string): string[] {
    return load().traits[`${userId}-${guildId}`] ?? [];
  },
  addTrait(userId: string, guildId: string, trait: string): void {
    const data = load();
    const key = `${userId}-${guildId}`;
    const existing = data.traits[key] ?? [];
    if (!existing.includes(trait)) {
      data.traits[key] = [...existing, trait].slice(0, 10);
      save(data);
    }
  },
  removeTrait(userId: string, guildId: string, trait: string): void {
    const data = load();
    const key = `${userId}-${guildId}`;
    data.traits[key] = (data.traits[key] ?? []).filter((t) => t !== trait);
    save(data);
  },
  clearTraits(userId: string, guildId: string): void {
    const data = load();
    delete data.traits[`${userId}-${guildId}`];
    save(data);
  },

  // ── Bot name ──────────────────────────────────────────────────────────────
  getBotName(guildId: string): string {
    return load().guildConfig[guildId]?.botName || "Assistant";
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
