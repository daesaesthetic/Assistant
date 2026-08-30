import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("memories")
    .setDescription("View or clear what the bot remembers about you")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("See everything remembered about you in this server")
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Permanently delete all memories stored about you")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";
    const sub = interaction.options.getSubcommand();

    if (sub === "view") {
      const memories = await db.getMemories(userId, guildId);
      const preferences = await db.getPreferences(userId, guildId);

      if (memories.length === 0 && preferences.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed("Your Memories")
              .setDescription(
                "Nothing remembered yet.\nMemories and interaction preferences build automatically through conversation — the more you chat, the more context is retained."
              )
              .setFooter({ text: "Your context is private and server-specific." }),
          ],
          ephemeral: true,
        });
        return;
      }

      const sections: string[] = [];
      if (memories.length > 0) {
        sections.push(
          `**Remembered facts**\n${memories
            .map((memory, index) => `**${index + 1}.** ${memory}`)
            .join("\n")}`,
        );
      }
      if (preferences.length > 0) {
        sections.push(
          `**Learned interaction preferences**\n${preferences
            .map(
              (preference) =>
                `• ${preference.key.replaceAll("_", " ")}: ${preference.value}`,
            )
            .join("\n")}`,
        );
      }

      await interaction.reply({
        embeds: [
          createEmbed("Your Context", sections.join("\n\n").slice(0, 4000))
            .setFooter({
              text: `${memories.length} memor${memories.length !== 1 ? "ies" : "y"} · ${preferences.length} learned preference${preferences.length !== 1 ? "s" : ""} · Use /memories clear to reset`,
            }),
        ],
        ephemeral: true,
      });
    } else if (sub === "clear") {
      const memories = await db.getMemories(userId, guildId);
      const preferences = await db.getPreferences(userId, guildId);
      if (memories.length === 0 && preferences.length === 0) {
        await interaction.reply({
          embeds: [createErrorEmbed("You have no saved context to clear.")],
          ephemeral: true,
        });
        return;
      }

      await db.clearMemories(userId, guildId);
      await db.clearPreferences(userId, guildId);

      await interaction.reply({
        embeds: [
          createEmbed("Memories Cleared").setDescription(
            `Cleared **${memories.length}** memory entr${memories.length !== 1 ? "ies" : "y"} and **${preferences.length}** learned preference${preferences.length !== 1 ? "s" : ""}.\nThe bot will start learning about you fresh from now on.`
          ),
        ],
        ephemeral: true,
      });
    }
  },
} satisfies Command;
