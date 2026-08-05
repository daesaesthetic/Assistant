/**
 * Deploy slash commands to Discord.
 *
 * Run with:  pnpm --filter @workspace/discord-bot run deploy
 *
 * This registers commands globally (available in all guilds after ~1 hour).
 * For faster testing during development, replace Routes.applicationCommands()
 * with Routes.applicationGuildCommands(clientId, GUILD_ID) to register
 * commands to a specific guild instantly.
 */
import { REST, Routes } from "discord.js";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Command } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error("[Deploy] Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

const commands: object[] = [];
const commandsDir = path.join(__dirname, "commands");
const files = readdirSync(commandsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

for (const file of files) {
  const mod = (await import(path.join(commandsDir, file))) as { default: Command };
  const command = mod.default;
  if (command?.data?.toJSON) {
    commands.push(command.data.toJSON());
    console.log(`[Deploy] Queued: /${command.data.name}`);
  }
}

const rest = new REST({ version: "10" }).setToken(token);

// If DISCORD_GUILD_ID is set, register instantly to that guild; otherwise register globally.
const guildId = process.env.DISCORD_GUILD_ID;

let result: unknown[];
if (guildId) {
  // Clear any lingering global commands first to avoid duplicates in the UI
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log("[Deploy] Cleared global commands.");

  console.log(`\n[Deploy] Registering ${commands.length} commands to guild ${guildId} (instant)...`);
  result = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  })) as unknown[];
  console.log(`[Deploy] ✓ Registered ${result.length} command(s) to guild — visible immediately.`);
} else {
  console.log(`\n[Deploy] Registering ${commands.length} slash commands globally...`);
  result = (await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  })) as unknown[];
  console.log(`[Deploy] ✓ Registered ${result.length} command(s) globally.`);
  console.log("[Deploy] Note: Global commands can take up to 1 hour to propagate.");
}
