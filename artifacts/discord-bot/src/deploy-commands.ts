/**
 * Deploy slash commands to Discord.
 *
 * Run with:  pnpm --filter @workspace/discord-bot run deploy
 *
 * This registers commands globally so every server can discover them.
 * Set DISCORD_DEPLOY_GUILD_ID for an explicit guild-only development deploy.
 */
import {
  ApplicationIntegrationType,
  InteractionContextType,
  REST,
  Routes,
} from "discord.js";
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

// These commands are useful when a user installs the app for themselves. They
// can run in any guild where the user can use the app, as well as DMs.
const USER_INSTALL_COMMANDS = new Set([
  "commands",
  "credits",
  "edit",
  "memories",
  "persona",
  "personality",
  "profile",
  "search",
  "suggest",
  "talk",
  "traits",
]);

for (const file of files) {
  const mod = (await import(path.join(commandsDir, file))) as { default: Command };
  const command = mod.default;
  if (command?.data?.toJSON) {
    const commandJson = command.data.toJSON() as Record<string, unknown>;
    const supportsUserInstall = USER_INSTALL_COMMANDS.has(commandJson.name as string);

    // Discord requires these fields on the global command payload for user
    // installs. Keep server administration commands guild-only.
    commandJson.integration_types = supportsUserInstall
      ? [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]
      : [ApplicationIntegrationType.GuildInstall];
    commandJson.contexts = supportsUserInstall
      ? [
          InteractionContextType.Guild,
          InteractionContextType.BotDM,
          InteractionContextType.PrivateChannel,
        ]
      : [InteractionContextType.Guild];

    commands.push(commandJson);
    console.log(`[Deploy] Queued: /${command.data.name}`);
  }
}

const rest = new REST({ version: "10" }).setToken(token);

// Global is the safe default for a public bot. Use the explicitly named
// override only when developing command changes against one test guild.
const guildId = process.env.DISCORD_DEPLOY_GUILD_ID;

let result: unknown[];
if (guildId) {
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
  console.log("[Deploy] Global commands are now available to other guild installs and eligible user installs.");
}
