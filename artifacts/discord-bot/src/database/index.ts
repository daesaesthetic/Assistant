/**
 * SQLite-backed application database.
 *
 * The JSON file is imported once into SQLite and retained as the rollback
 * source. All runtime access uses parameterized async queries.
 */
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const JSON_PATH = path.join(DATA_DIR, "db.json");
const JSON_BACKUP_PATH = path.join(DATA_DIR, "db.json.pre-sqlite.bak");
const SQLITE_PATH = path.join(DATA_DIR, "azurion.sqlite");
export const DEFAULT_BOT_NAME = "𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯";

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

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface LegacyJson {
  personas?: Record<string, Persona>;
  warnings?: Record<string, Warning>;
  conversations?: Record<string, ConversationMessage[]>;
  legacyConversations?: Record<string, ConversationMessage[]>;
  guildConfig?: Record<string, GuildConfig>;
  memories?: Record<string, string[]>;
  traits?: Record<string, string[]>;
}

type SqliteDatabase = Database<sqlite3.Database, sqlite3.Statement>;

let database: SqliteDatabase | null = null;
let initialization: Promise<SqliteDatabase> | null = null;

function splitUserGuildKey(key: string): [string, string] | null {
  const separator = key.indexOf("-");
  if (separator <= 0) return null;
  return [key.slice(0, separator), key.slice(separator + 1)];
}

function validMessages(value: unknown): ConversationMessage[] {
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

async function applySchema(db: SqliteDatabase): Promise<void> {
  await db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const migrations: Array<{ version: number; apply: (database: SqliteDatabase) => Promise<void> }> = [
    {
      version: 1,
      apply: async (database) => {
        await database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS personas (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        persona_name TEXT NOT NULL,
        custom_description TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, guild_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        content TEXT NOT NULL COLLATE NOCASE,
        UNIQUE (user_id, guild_id, content),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS traits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        trait TEXT NOT NULL COLLATE NOCASE,
        UNIQUE (user_id, guild_id, trait),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL,
        last_active INTEGER NOT NULL,
        UNIQUE (user_id, guild_id, session_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        UNIQUE (conversation_id, position)
      );

      CREATE TABLE IF NOT EXISTS warnings (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        last_warned INTEGER NOT NULL,
        PRIMARY KEY (user_id, guild_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT PRIMARY KEY,
        mod_log_channel_id TEXT,
        bot_name TEXT NOT NULL DEFAULT 'Assistant',
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS guild_blacklisted_words (
        guild_id TEXT NOT NULL,
        word TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (guild_id, word),
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS guild_bot_channels (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        PRIMARY KEY (guild_id, channel_id),
        FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS legacy_conversations (
        user_id TEXT PRIMARY KEY,
        messages_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_memories_user_guild ON memories(user_id, guild_id);
      CREATE INDEX IF NOT EXISTS idx_traits_user_guild ON traits(user_id, guild_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_guild ON conversations(user_id, guild_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id, position);
      CREATE INDEX IF NOT EXISTS idx_warnings_guild ON warnings(guild_id);
      CREATE INDEX IF NOT EXISTS idx_legacy_conversations_user ON legacy_conversations(user_id);
    `);
      },
    },
    {
      version: 2,
      apply: async (database) => {
        await database.run(
          "UPDATE guild_config SET bot_name = ? WHERE bot_name IN ('Assistant', 'Azurion')",
          DEFAULT_BOT_NAME,
        );
      },
    },
  ];

  const current = (await db.get<{ version: number }>(
    "SELECT MAX(version) AS version FROM schema_migrations"
  ))?.version ?? 0;

  for (const migration of migrations.filter(({ version }) => version > current).sort((a, b) => a.version - b.version)) {
    await db.exec("BEGIN IMMEDIATE");
    try {
      await migration.apply(db);
      await db.run(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        migration.version,
        Date.now()
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }
}

async function ensureUserGuild(db: SqliteDatabase, userId: string, guildId: string): Promise<void> {
  await db.run("INSERT OR IGNORE INTO users (id) VALUES (?)", userId);
  await db.run("INSERT OR IGNORE INTO guilds (id) VALUES (?)", guildId);
}

async function importJson(db: SqliteDatabase): Promise<void> {
  const migrated = await db.get<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = ?",
    "json_data_migration"
  );
  if (migrated) return;
  if (!existsSync(JSON_PATH)) {
    await db.run(
      "INSERT INTO app_meta (key, value) VALUES (?, ?)",
      "json_data_migration",
      JSON.stringify({ imported: false, reason: "No JSON database found", importedAt: Date.now() })
    );
    return;
  }

  if (!existsSync(JSON_BACKUP_PATH)) copyFileSync(JSON_PATH, JSON_BACKUP_PATH);

  const source = JSON.parse(readFileSync(JSON_PATH, "utf8")) as LegacyJson;
  const report = {
    imported: 0,
    matched: 0,
    missing: 0,
    duplicates: 0,
    ambiguous: 0,
    failed: 0,
  };

  await db.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, persona] of Object.entries(source.personas ?? {})) {
      const pair = splitUserGuildKey(key);
      if (!pair || !persona) {
        report.failed++;
        continue;
      }
      const [userId, guildId] = pair;
      await ensureUserGuild(db, userId, guildId);
      await db.run(
        `INSERT INTO personas (user_id, guild_id, persona_name, custom_description)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET
           persona_name = excluded.persona_name,
           custom_description = excluded.custom_description`,
        userId,
        guildId,
        persona.personaName,
        persona.customDescription ?? ""
      );
      report.imported++;
    }

    for (const [key, warning] of Object.entries(source.warnings ?? {})) {
      const pair = splitUserGuildKey(key);
      if (!pair || !warning) {
        report.failed++;
        continue;
      }
      const [userId, guildId] = pair;
      await ensureUserGuild(db, userId, guildId);
      await db.run(
        `INSERT INTO warnings (user_id, guild_id, count, last_warned) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET count = excluded.count, last_warned = excluded.last_warned`,
        userId,
        guildId,
        warning.count,
        warning.lastWarned
      );
      report.imported++;
    }

    for (const [key, config] of Object.entries(source.guildConfig ?? {})) {
      if (!config) {
        report.failed++;
        continue;
      }
      await db.run("INSERT OR IGNORE INTO guilds (id) VALUES (?)", key);
      await db.run(
        `INSERT INTO guild_config (guild_id, mod_log_channel_id, bot_name) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           mod_log_channel_id = excluded.mod_log_channel_id,
           bot_name = excluded.bot_name`,
        key,
        config.modLogChannelId ?? null,
        config.botName ?? DEFAULT_BOT_NAME
      );
      for (const word of config.blacklistedWords ?? []) {
        await db.run(
          "INSERT OR IGNORE INTO guild_blacklisted_words (guild_id, word) VALUES (?, ?)",
          key,
          word
        );
      }
      for (const channelId of config.botChannelIds ?? []) {
        await db.run(
          "INSERT OR IGNORE INTO guild_bot_channels (guild_id, channel_id) VALUES (?, ?)",
          key,
          channelId
        );
      }
      report.imported++;
    }

    for (const [key, memories] of Object.entries(source.memories ?? {})) {
      const pair = splitUserGuildKey(key);
      if (!pair || !Array.isArray(memories)) {
        report.failed++;
        continue;
      }
      const [userId, guildId] = pair;
      await ensureUserGuild(db, userId, guildId);
      for (const content of memories) {
        if (typeof content !== "string") {
          report.failed++;
          continue;
        }
        const result = await db.run(
          "INSERT OR IGNORE INTO memories (user_id, guild_id, content) VALUES (?, ?, ?)",
          userId,
          guildId,
          content
        );
        result.changes ? report.imported++ : report.duplicates++;
      }
    }

    for (const [key, traits] of Object.entries(source.traits ?? {})) {
      const pair = splitUserGuildKey(key);
      if (!pair || !Array.isArray(traits)) {
        report.failed++;
        continue;
      }
      const [userId, guildId] = pair;
      await ensureUserGuild(db, userId, guildId);
      for (const trait of traits) {
        if (typeof trait !== "string") {
          report.failed++;
          continue;
        }
        const result = await db.run(
          "INSERT OR IGNORE INTO traits (user_id, guild_id, trait) VALUES (?, ?, ?)",
          userId,
          guildId,
          trait
        );
        result.changes ? report.imported++ : report.duplicates++;
      }
    }

    for (const [key, messages] of Object.entries(source.conversations ?? {})) {
      if (!key.includes("::")) {
        const valid = validMessages(messages);
        if (valid.length !== messages.length) report.failed++;
        await db.run(
          "INSERT OR IGNORE INTO users (id) VALUES (?)",
          key
        );
        const result = await db.run(
          "INSERT OR IGNORE INTO legacy_conversations (user_id, messages_json, reason, imported_at) VALUES (?, ?, ?, ?)",
          key,
          JSON.stringify(valid),
          "Legacy conversation did not contain a guild ID",
          Date.now()
        );
        result.changes ? report.ambiguous++ : report.duplicates++;
        continue;
      }
      const [userId, guildId] = key.split("::");
      const valid = validMessages(messages);
      await ensureUserGuild(db, userId, guildId);
      const conversation = await db.run(
        `INSERT OR IGNORE INTO conversations
          (user_id, guild_id, session_id, created_at, last_active)
         VALUES (?, ?, 'default', ?, ?)`,
        userId,
        guildId,
        Date.now(),
        Date.now()
      );
      const conversationRow = await db.get<{ id: number }>(
        "SELECT id FROM conversations WHERE user_id = ? AND guild_id = ? AND session_id = 'default'",
        userId,
        guildId
      );
      if (!conversationRow) {
        report.failed++;
        continue;
      }
      if (conversation.changes) {
        for (const [position, message] of valid.entries()) {
          await db.run(
            `INSERT OR IGNORE INTO conversation_messages
              (conversation_id, role, content, position, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            conversationRow.id,
            message.role,
            message.content,
            position,
            Date.now()
          );
        }
        report.imported += valid.length;
      } else {
        report.duplicates++;
      }
    }

    for (const [userId, messages] of Object.entries(source.legacyConversations ?? {})) {
      const valid = validMessages(messages);
      await db.run("INSERT OR IGNORE INTO users (id) VALUES (?)", userId);
      const result = await db.run(
        "INSERT OR IGNORE INTO legacy_conversations (user_id, messages_json, reason, imported_at) VALUES (?, ?, ?, ?)",
        userId,
        JSON.stringify(valid),
        "Legacy conversation did not contain a guild ID",
        Date.now()
      );
      result.changes ? report.ambiguous++ : report.duplicates++;
    }

    await db.run(
      "INSERT INTO app_meta (key, value) VALUES (?, ?)",
      "json_data_migration",
      JSON.stringify({ ...report, completedAt: Date.now() })
    );
    await db.exec("COMMIT");
    console.log(`[Azurion] SQLite migration complete: ${JSON.stringify(report)}`);
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function refreshMigrationReport(db: SqliteDatabase): Promise<void> {
  const meta = await db.get<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = ?",
    "json_data_migration"
  );
  if (!meta || !existsSync(JSON_PATH)) return;

  const source = JSON.parse(readFileSync(JSON_PATH, "utf8")) as LegacyJson;
  const count = async (table: string): Promise<number> => {
    const row = await db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    return row?.count ?? 0;
  };
  const expected = {
    personas: Object.keys(source.personas ?? {}).length,
    warnings: Object.keys(source.warnings ?? {}).length,
    guildConfig: Object.keys(source.guildConfig ?? {}).length,
    memories: Object.values(source.memories ?? {}).reduce(
      (total, values) => total + (Array.isArray(values) ? values.filter((value) => typeof value === "string").length : 0),
      0
    ),
    traits: Object.values(source.traits ?? {}).reduce(
      (total, values) => total + (Array.isArray(values) ? values.filter((value) => typeof value === "string").length : 0),
      0
    ),
    conversationMessages: Object.entries(source.conversations ?? {}).reduce(
      (total, [key, messages]) => total + (key.includes("::") ? validMessages(messages).length : 0),
      0
    ),
  };
  const actual = {
    personas: await count("personas"),
    warnings: await count("warnings"),
    guildConfig: await count("guild_config"),
    memories: await count("memories"),
    traits: await count("traits"),
    conversationMessages: await count("conversation_messages"),
  };

  const matched = Object.values(expected).reduce(
    (total, value, index) => total + Math.min(value, Object.values(actual)[index]),
    0
  );
  const missing = Object.values(expected).reduce(
    (total, value, index) => total + Math.max(0, value - Object.values(actual)[index]),
    0
  );
  const duplicates = Object.values(source.memories ?? {}).reduce(
    (total, values) => total + (Array.isArray(values) ? values.length - new Set(values.filter((value) => typeof value === "string").map((value) => value.toLowerCase())).size : 0),
    0
  ) + Object.values(source.traits ?? {}).reduce(
    (total, values) => total + (Array.isArray(values) ? values.length - new Set(values.filter((value) => typeof value === "string").map((value) => value.toLowerCase())).size : 0),
    0
  );
  const ambiguous =
    Object.keys(source.legacyConversations ?? {}).length +
    Object.keys(source.conversations ?? {}).filter((key) => !key.includes("::")).length;
  const previous = JSON.parse(meta.value) as Partial<typeof expected> & { imported?: number; failed?: number };
  const report = {
    imported: previous.imported ?? matched,
    matched,
    missing,
    duplicates,
    ambiguous,
    failed: previous.failed ?? 0,
    reconciledAt: Date.now(),
  };

  await db.run(
    "UPDATE app_meta SET value = ? WHERE key = ?",
    JSON.stringify(report),
    "json_data_migration"
  );
}

async function validateDatabase(db: SqliteDatabase): Promise<void> {
  const requiredTables = [
    "users",
    "guilds",
    "personas",
    "memories",
    "traits",
    "conversations",
    "conversation_messages",
    "warnings",
    "guild_config",
    "guild_blacklisted_words",
    "guild_bot_channels",
    "legacy_conversations",
  ];
  const rows = await db.all<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  );
  const actual = new Set(rows.map((row) => row.name));
  const missing = requiredTables.filter((table) => !actual.has(table));
  if (missing.length > 0) throw new Error(`SQLite schema validation failed (${missing.join(", ")})`);
}

export async function initializeDatabase(): Promise<SqliteDatabase> {
  if (database) return database;
  if (!initialization) {
    initialization = (async () => {
      mkdirSync(DATA_DIR, { recursive: true });
      const db = await open({ filename: SQLITE_PATH, driver: sqlite3.Database });
      await applySchema(db);
      await importJson(db);
      await refreshMigrationReport(db);
      await validateDatabase(db);
      database = db;
      return db;
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function getDb(): Promise<SqliteDatabase> {
  return initializeDatabase();
}

export const db = {
  async getPersona(userId: string, guildId: string): Promise<Persona | null> {
    const database = await getDb();
    return (
      (await database.get<Persona>(
        "SELECT persona_name AS personaName, custom_description AS customDescription FROM personas WHERE user_id = ? AND guild_id = ?",
        userId,
        guildId
      )) ?? null
    );
  },

  async setPersona(userId: string, guildId: string, personaName: string, customDescription: string): Promise<void> {
    const database = await getDb();
    await ensureUserGuild(database, userId, guildId);
    await database.run(
      `INSERT INTO personas (user_id, guild_id, persona_name, custom_description) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, guild_id) DO UPDATE SET persona_name = excluded.persona_name, custom_description = excluded.custom_description`,
      userId,
      guildId,
      personaName,
      customDescription
    );
  },

  async getWarnings(userId: string, guildId: string): Promise<Warning | null> {
    const database = await getDb();
    return (
      (await database.get<Warning>(
        "SELECT count, last_warned AS lastWarned FROM warnings WHERE user_id = ? AND guild_id = ?",
        userId,
        guildId
      )) ?? null
    );
  },

  async addWarning(userId: string, guildId: string): Promise<Warning> {
    const database = await getDb();
    await ensureUserGuild(database, userId, guildId);
    await database.exec("BEGIN IMMEDIATE");
    try {
      const current = await this.getWarnings(userId, guildId);
      const warning = { count: (current?.count ?? 0) + 1, lastWarned: Date.now() };
      await database.run(
        `INSERT INTO warnings (user_id, guild_id, count, last_warned) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, guild_id) DO UPDATE SET count = excluded.count, last_warned = excluded.last_warned`,
        userId,
        guildId,
        warning.count,
        warning.lastWarned
      );
      await database.exec("COMMIT");
      return warning;
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  },

  async resetWarnings(userId: string, guildId: string): Promise<void> {
    const database = await getDb();
    await database.run("DELETE FROM warnings WHERE user_id = ? AND guild_id = ?", userId, guildId);
  },

  async getConversation(userId: string, guildId: string): Promise<ConversationMessage[]> {
    const database = await getDb();
    const conversation = await database.get<{ id: number }>(
      "SELECT id FROM conversations WHERE user_id = ? AND guild_id = ? AND session_id = 'default'",
      userId,
      guildId
    );
    if (!conversation) return [];
    return database.all<ConversationMessage[]>(
      "SELECT role, content FROM conversation_messages WHERE conversation_id = ? ORDER BY position",
      conversation.id
    );
  },

  async setConversation(userId: string, guildId: string, messages: ConversationMessage[]): Promise<void> {
    const database = await getDb();
    await ensureUserGuild(database, userId, guildId);
    await database.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      await database.run(
        `INSERT INTO conversations (user_id, guild_id, session_id, created_at, last_active)
         VALUES (?, ?, 'default', ?, ?)
         ON CONFLICT(user_id, guild_id, session_id) DO UPDATE SET last_active = excluded.last_active`,
        userId,
        guildId,
        now,
        now
      );
      const conversation = await database.get<{ id: number }>(
        "SELECT id FROM conversations WHERE user_id = ? AND guild_id = ? AND session_id = 'default'",
        userId,
        guildId
      );
      if (!conversation) throw new Error("Conversation could not be created");
      await database.run("DELETE FROM conversation_messages WHERE conversation_id = ?", conversation.id);
      for (const [position, message] of messages.entries()) {
        await database.run(
          `INSERT INTO conversation_messages
            (conversation_id, role, content, position, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          conversation.id,
          message.role,
          message.content,
          position,
          now
        );
      }
      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  },

  async clearConversation(userId: string, guildId: string): Promise<void> {
    const database = await getDb();
    await database.run(
      "DELETE FROM conversations WHERE user_id = ? AND guild_id = ? AND session_id = 'default'",
      userId,
      guildId
    );
  },

  async getMemories(userId: string, guildId: string): Promise<string[]> {
    const database = await getDb();
    const rows = await database.all<{ content: string }[]>(
      "SELECT content FROM memories WHERE user_id = ? AND guild_id = ? ORDER BY id",
      userId,
      guildId
    );
    return rows.map((row) => row.content);
  },

  async addMemories(userId: string, guildId: string, facts: string[]): Promise<void> {
    const database = await getDb();
    await ensureUserGuild(database, userId, guildId);
    await database.exec("BEGIN IMMEDIATE");
    try {
      const current = await this.getMemories(userId, guildId);
      for (const fact of facts) {
        if (current.some((existing) => existing.toLowerCase() === fact.toLowerCase())) continue;
        if (current.length >= 30) break;
        await database.run(
          "INSERT OR IGNORE INTO memories (user_id, guild_id, content) VALUES (?, ?, ?)",
          userId,
          guildId,
          fact
        );
        current.push(fact);
      }
      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  },

  async clearMemories(userId: string, guildId: string): Promise<void> {
    const database = await getDb();
    await database.run("DELETE FROM memories WHERE user_id = ? AND guild_id = ?", userId, guildId);
  },

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    const database = await getDb();
    const config = await database.get<{ modLogChannelId?: string; botName: string }>(
      "SELECT mod_log_channel_id AS modLogChannelId, bot_name AS botName FROM guild_config WHERE guild_id = ?",
      guildId
    );
    if (!config) return null;
    const words = await database.all<{ word: string }[]>(
      "SELECT word FROM guild_blacklisted_words WHERE guild_id = ? ORDER BY rowid",
      guildId
    );
    const channels = await database.all<{ channelId: string }[]>(
      "SELECT channel_id AS channelId FROM guild_bot_channels WHERE guild_id = ? ORDER BY rowid",
      guildId
    );
    return {
      modLogChannelId: config.modLogChannelId,
      botName: config.botName,
      blacklistedWords: words.map((row) => row.word),
      botChannelIds: channels.map((row) => row.channelId),
    };
  },

  async setGuildConfig(guildId: string, config: Partial<GuildConfig>): Promise<void> {
    const database = await getDb();
    await database.run("INSERT OR IGNORE INTO guilds (id) VALUES (?)", guildId);
    const existing = await this.getGuildConfig(guildId);
    const next = {
      modLogChannelId: config.modLogChannelId ?? existing?.modLogChannelId,
      botName: config.botName ?? existing?.botName ?? DEFAULT_BOT_NAME,
      blacklistedWords: config.blacklistedWords ?? existing?.blacklistedWords ?? [],
      botChannelIds: config.botChannelIds ?? existing?.botChannelIds ?? [],
    };
    await database.exec("BEGIN IMMEDIATE");
    try {
      await database.run(
        `INSERT INTO guild_config (guild_id, mod_log_channel_id, bot_name) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET mod_log_channel_id = excluded.mod_log_channel_id, bot_name = excluded.bot_name`,
        guildId,
        next.modLogChannelId ?? null,
        next.botName
      );
      await database.run("DELETE FROM guild_blacklisted_words WHERE guild_id = ?", guildId);
      for (const word of next.blacklistedWords) {
        await database.run(
          "INSERT OR IGNORE INTO guild_blacklisted_words (guild_id, word) VALUES (?, ?)",
          guildId,
          word
        );
      }
      await database.run("DELETE FROM guild_bot_channels WHERE guild_id = ?", guildId);
      for (const channelId of next.botChannelIds) {
        await database.run(
          "INSERT OR IGNORE INTO guild_bot_channels (guild_id, channel_id) VALUES (?, ?)",
          guildId,
          channelId
        );
      }
      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }
  },

  async getTraits(userId: string, guildId: string): Promise<string[]> {
    const database = await getDb();
    const rows = await database.all<{ trait: string }[]>(
      "SELECT trait FROM traits WHERE user_id = ? AND guild_id = ? ORDER BY id",
      userId,
      guildId
    );
    return rows.map((row) => row.trait);
  },

  async addTrait(userId: string, guildId: string, trait: string): Promise<void> {
    const database = await getDb();
    await ensureUserGuild(database, userId, guildId);
    await database.run(
      "INSERT OR IGNORE INTO traits (user_id, guild_id, trait) VALUES (?, ?, ?)",
      userId,
      guildId,
      trait
    );
  },

  async removeTrait(userId: string, guildId: string, trait: string): Promise<void> {
    const database = await getDb();
    await database.run(
      "DELETE FROM traits WHERE user_id = ? AND guild_id = ? AND trait = ?",
      userId,
      guildId,
      trait
    );
  },

  async clearTraits(userId: string, guildId: string): Promise<void> {
    const database = await getDb();
    await database.run("DELETE FROM traits WHERE user_id = ? AND guild_id = ?", userId, guildId);
  },

  async getBotName(guildId: string): Promise<string> {
    return (await this.getGuildConfig(guildId))?.botName ?? DEFAULT_BOT_NAME;
  },

  async setBotName(guildId: string, name: string): Promise<void> {
    await this.setGuildConfig(guildId, { botName: name });
  },

  async getBotChannels(guildId: string): Promise<string[]> {
    return (await this.getGuildConfig(guildId))?.botChannelIds ?? [];
  },

  async addBotChannel(guildId: string, channelId: string): Promise<void> {
    const channels = await this.getBotChannels(guildId);
    if (!channels.includes(channelId)) {
      await this.setGuildConfig(guildId, { botChannelIds: [...channels, channelId] });
    }
  },

  async removeBotChannel(guildId: string, channelId: string): Promise<void> {
    const channels = (await this.getBotChannels(guildId)).filter((id) => id !== channelId);
    await this.setGuildConfig(guildId, { botChannelIds: channels });
  },
};