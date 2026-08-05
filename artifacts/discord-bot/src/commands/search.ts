import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { searchDuckDuckGo } from "../utils/search.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search the web and return summarized results")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("What to search for").setRequired(true)
    ),
  cooldown: 10,
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const query = interaction.options.getString("query", true);

    try {
      const results = await searchDuckDuckGo(query);

      if (results.length === 0) {
        await interaction.editReply({
          embeds: [createErrorEmbed("No results found. Try rephrasing your query.")],
        });
        return;
      }

      const embed = createEmbed(`Search — ${query.slice(0, 60)}`).setFooter({
        text: "Results via DuckDuckGo · Source accuracy not guaranteed",
      });

      for (const result of results.slice(0, 5)) {
        const urlDisplay = result.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
        embed.addFields({
          name: result.title.slice(0, 256),
          value: `${result.snippet.slice(0, 280)}\n↗ [${urlDisplay}](${result.url})`,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[/search]", err);
      await interaction.editReply({
        embeds: [createErrorEmbed("Search failed. Please try again.")],
      });
    }
  },
} satisfies Command;
