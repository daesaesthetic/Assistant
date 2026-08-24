import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("name")
    .setDescription("Set the display name shown as the header in bot conversations")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set a custom display name for this server")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("New display name (e.g. Nova, Kira, Zeph)")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("reset").setDescription("Reset the display name back to Assistant")
    )
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("See the current display name for this server")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand();

    if (sub === "view") {
      const current = await db.getBotName(guildId);
      await interaction.reply({
        embeds: [createEmbed("Display Name").setDescription(`Current name: **${current}**`)],
        ephemeral: true,
      });
      return;
    }

    // Only admins can change the name
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Manage Server** permission to change the display name.")],
        ephemeral: true,
      });
      return;
    }

    if (sub === "set") {
      const name = interaction.options.getString("name", true).trim();
      if (!name) {
        await interaction.reply({ embeds: [createErrorEmbed("Name cannot be blank.")], ephemeral: true });
        return;
      }
      await db.setBotName(guildId, name);
      await interaction.reply({
        embeds: [
          createEmbed("Display Name Updated")
            .setDescription(
              `The bot's display name is now **${name}**.\nThis will appear as the header in all future conversation replies.`
            )
            .setFooter({ text: "Use /name reset to revert to 𝘼𝙨𝙨𝙞𝙨𝙩𝙖𝙣𝙩 ₯." }),
        ],
      });
    } else if (sub === "reset") {
      const prev = await db.getBotName(guildId);
      await db.setBotName(guildId, "Assistant");
      await interaction.reply({
        embeds: [
          createEmbed("Display Name Reset").setDescription(
            `Display name reset from **${prev}** back to **Assistant**.`
          ),
        ],
      });
    }
  },
} satisfies Command;
