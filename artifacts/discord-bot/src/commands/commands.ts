import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("commands")
    .setDescription("View all available commands organized by category"),
  async execute(interaction: ChatInputCommandInteraction) {
    const embed = createEmbed("𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯ — Field Manual")
      .setDescription("A quiet edge in your pocket. Use a command below, or **@mention** me anywhere and tell me what you need.")
      .addFields(
        {
          name: "Conversation",
          value: [
            "`/talk` — Think with me; I maintain the thread and remember useful context (5s cooldown)",
            "`/suggest` — Turn a goal or dilemma into sharp recommendations — text or image (10s cooldown)",
            "`/edit` — Transform an image with written instructions (30s cooldown)",
            "`/persona` — Set your conversation style (Analyst, Observer, Strategist, Minimalist, Oracle, Custom)",
            "`/traits add` — Add a personality trait (flirty, sarcastic, blunt, etc.)",
            "`/traits remove` — Remove a trait",
            "`/traits list` — See your active traits",
            "`/memories view` — See what the bot remembers about you",
            "`/memories clear` — Wipe your stored memories",
            "`/personality view` — See all your active personality settings at a glance",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Utility",
          value: [
            "`/search` — Search the web via DuckDuckGo (10s cooldown)",
            "`/profile` — View a user's profile and stats",
            "`/say` — Make Assistant ₯ send a message",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Moderation",
          value: [
            "`/clear <amount>` — Delete recent messages (1–100)",
            "`/nuke [#channel]` — Wipe a channel and recreate it fresh",
            "`/warn` — Issue a warning to a user",
            "`/warnings` — Check a user's warning count",
            "`/clearwarnings` — Clear all warnings for a user",
            "`/config` — Server settings (mod log, blacklist)",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Server Setup",
          value: [
            "`/channel create` — Create a free-conversation channel",
            "`/channel remove` — Disable auto-response in a channel",
            "`/channel list` — List all conversation channels",
            "`/name set` — Set the bot's display name for this server",
            "`/name reset` — Reset display name to 𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Info",
          value: ["`/commands` — This list", "`/credits` — Creator information"].join("\n"),
          inline: false,
        }
      )
      .setFooter({ text: "Moderation commands require Timeout Members · Setup commands require Manage Server/Channels" });

    await interaction.reply({ embeds: [embed] });
  },
} satisfies Command;
