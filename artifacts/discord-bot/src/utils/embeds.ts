import { EmbedBuilder } from "discord.js";

// Assistant ₯ palette — ink, vermilion, parchment, and a restrained gold.
export const EMBED_COLORS = {
  ink: 0x17141f,
  vermilion: 0xb6423f,
  gold: 0xd1a45b,
  parchment: 0xe8d8bc,
  sage: 0x6f8f78,
  error: 0x9e3f46,
  warning: 0xd19b45,
} as const;

const EMBED_AUTHOR = "𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯  /  AZURION";
const EMBED_FOOTER = "𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯  ·  precision with presence";

export function createEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.vermilion)
    .setAuthor({ name: EMBED_AUTHOR })
    .setTitle(title)
    .setFooter({ text: EMBED_FOOTER })
    .setTimestamp();
  if (description) embed.setDescription(description);
  return embed;
}

export function createErrorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.error)
    .setAuthor({ name: EMBED_AUTHOR })
    .setTitle("✦ A disturbance in the signal")
    .setDescription(message)
    .setFooter({ text: "𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯  ·  try again when ready" })
    .setTimestamp();
}

export function createWarnEmbed(title: string, message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.warning)
    .setAuthor({ name: EMBED_AUTHOR })
    .setTitle(title)
    .setDescription(message)
    .setFooter({ text: EMBED_FOOTER })
    .setTimestamp();
}
