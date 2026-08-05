import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("commands")
    .setDescription("View all available commands organized by category"),
  async execute(interaction: ChatInputCommandInteraction) {
    const embed = createEmbed("Azurion — Commands")
      .setDescription("All available commands. Heavy commands enforce per-user cooldowns.")
      .addFields(
        {
          name: "AI",
          value: [
            "`/talk` — Converse with Azurion (maintains memory, 5s cooldown)",
            "`/suggest` — Get suggestions — text or image (10s cooldown)",
            "`/edit` — Transform an image with AI instructions (30s cooldown)",
            "`/persona` — Set your conversation style",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Utility",
          value: [
            "`/search` — Search the web via DuckDuckGo (10s cooldown)",
            "`/profile` — View a user's profile and stats",
            "`/say` — Make Azurion send a message",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Moderation",
          value: [
            "`/warn` — Issue a warning to a user",
            "`/warnings` — Check a user's warning count",
            "`/clearwarnings` — Clear all warnings for a user",
            "`/config` — Configure bot settings for this server",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Info",
          value: ["`/commands` — This list", "`/credits` — Creator information"].join("\n"),
          inline: false,
        }
      )
      .setFooter({ text: "Azurion Assistant · Moderation commands require Timeout Members permission" });

    await interaction.reply({ embeds: [embed] });
  },
} satisfies Command;
