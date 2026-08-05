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
      const memories = db.getMemories(userId, guildId);

      if (memories.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed("Your Memories")
              .setDescription(
                "Nothing remembered yet.\nMemories build automatically through conversation — the more you chat, the more context is retained."
              )
              .setFooter({ text: "Memories are private and server-specific." }),
          ],
          ephemeral: true,
        });
        return;
      }

      const list = memories.map((m, i) => `**${i + 1}.** ${m}`).join("\n");

      await interaction.reply({
        embeds: [
          createEmbed("Your Memories", list.slice(0, 4000))
            .setFooter({
              text: `${memories.length} memory entry${memories.length !== 1 ? "s" : ""} · Use /memories clear to reset`,
            }),
        ],
        ephemeral: true,
      });
    } else if (sub === "clear") {
      const memories = db.getMemories(userId, guildId);
      if (memories.length === 0) {
        await interaction.reply({
          embeds: [createErrorEmbed("You have no memories to clear.")],
          ephemeral: true,
        });
        return;
      }

      db.clearMemories(userId, guildId);

      await interaction.reply({
        embeds: [
          createEmbed("Memories Cleared").setDescription(
            `Cleared **${memories.length}** memory entry${memories.length !== 1 ? "s" : ""}.\nThe bot will start learning about you fresh from now on.`
          ),
        ],
        ephemeral: true,
      });
    }
  },
} satisfies Command;
