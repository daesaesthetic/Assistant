import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("credits")
    .setDescription("View creator information"),
  async execute(interaction: ChatInputCommandInteraction) {
    const embed = createEmbed("𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯ — Credits")
      .setDescription("*Crafted with precision and intent.*")
      .addFields(
        { name: "Created by", value: "Azurion", inline: true },
        { name: "Username", value: "azurionx", inline: true },
        { name: "Version", value: "1.0.0", inline: true },
        {
          name: "Built with",
          value: "discord.js v14 · DuckDuckGo",
          inline: false,
        }
      )
      .setFooter({ text: "𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯ — precision · intelligence · presence" });

    await interaction.reply({ embeds: [embed] });
  },
} satisfies Command;
