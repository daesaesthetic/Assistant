import { Client, GatewayIntentBits, Collection } from "discord.js";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ExtendedClient, Command, Event } from "./types.js";
import { initializeDatabase } from "./database/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await initializeDatabase();

// ── Client setup ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
}) as ExtendedClient;

client.commands = new Collection<string, Command>();

// ── Load commands ─────────────────────────────────────────────────────────────
const commandsDir = path.join(__dirname, "commands");
const commandFiles = readdirSync(commandsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

for (const file of commandFiles) {
  const mod = (await import(path.join(commandsDir, file))) as { default: Command };
  const command = mod.default;
  if (command?.data?.name) {
    client.commands.set(command.data.name, command);
    console.log(`[Azurion] Loaded command: /${command.data.name}`);
  }
}

// ── Load events ───────────────────────────────────────────────────────────────
const eventsDir = path.join(__dirname, "events");
const eventFiles = readdirSync(eventsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

for (const file of eventFiles) {
  const mod = (await import(path.join(eventsDir, file))) as { default: Event };
  const event = mod.default;
  if (!event?.name) continue;

  if (event.once) {
    client.once(event.name, (...args) => void event.execute(...args));
  } else {
    client.on(event.name, (...args) => void event.execute(...args));
  }
  console.log(`[Azurion] Registered event: ${event.name}${event.once ? " (once)" : ""}`);
}

// ── Login ─────────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("[Azurion] DISCORD_BOT_TOKEN is not set. Set it in Secrets and restart.");
  process.exit(1);
}

await client.login(token);
