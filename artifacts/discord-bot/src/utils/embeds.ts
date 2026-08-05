import { EmbedBuilder } from "discord.js";

// Deep midnight — dark, minimal, slightly mysterious
const EMBED_COLOR = 0x1e1e2e;
const ERROR_COLOR = 0x8b0000;
const WARN_COLOR = 0xe0a500;

export function createEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setTimestamp();
  if (description) embed.setDescription(description);
  return embed;
}

export function createErrorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle("Error")
    .setDescription(message)
    .setTimestamp();
}

export function createWarnEmbed(title: string, message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(WARN_COLOR)
    .setTitle(title)
    .setDescription(message)
    .setTimestamp();
}
