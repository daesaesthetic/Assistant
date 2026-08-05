import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete a number of recent messages from this channel")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Number of messages to delete (1–100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Manage Messages** permission to use this command.")],
        ephemeral: true,
      });
      return;
    }

    const amount = interaction.options.getInteger("amount", true);
    const channel = interaction.channel as TextChannel;

    await interaction.deferReply({ ephemeral: true });

    let deleted = 0;
    try {
      const result = await channel.bulkDelete(amount, true); // true = skip messages older than 14 days
      deleted = result.size;
    } catch (err) {
      console.error("[/clear]", err);
      await interaction.editReply({
        embeds: [createErrorEmbed("Failed to delete messages. Make sure the bot has **Manage Messages** permission.")],
      });
      return;
    }

    const reply = await interaction.editReply({
      embeds: [
        createEmbed("Messages Cleared").setDescription(
          deleted === amount
            ? `Deleted **${deleted}** message${deleted !== 1 ? "s" : ""}.`
            : `Deleted **${deleted}** message${deleted !== 1 ? "s" : ""}. ${amount - deleted} could not be removed (older than 14 days).`
        ),
      ],
    });

    // Auto-delete the confirmation after 5 seconds
    setTimeout(() => reply.delete().catch(() => {}), 5000);
  },
} satisfies Command;
