import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from "discord.js";
import { createErrorEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Make Assistant ₯ send a message in this channel")
    .addStringOption((opt) =>
      opt.setName("message").setDescription("The message to send").setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const message = interaction.options.getString("message", true);
    const hasAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
    const hasManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
    const privileged = hasAdmin || hasManage;

    // Block mass mentions for non-privileged users
    if (!privileged && (message.includes("@everyone") || message.includes("@here"))) {
      await interaction.reply({
        embeds: [createErrorEmbed("You don't have permission to use mass mentions.")],
        ephemeral: true,
      });
      return;
    }

    // Sanitize mass mentions for non-privileged users even if they sneak them in
    const sanitized = privileged
      ? message
      : message.replace(/@everyone/g, "@\u200beveryone").replace(/@here/g, "@\u200bhere");

    // Invisible acknowledgement so slash command doesn't show "thinking…"
    await interaction.reply({ content: "\u200b", ephemeral: true });
    // Cast is safe: slash commands only fire in guild/DM text channels, never PartialGroupDMChannel
    await (interaction.channel as TextChannel | null)?.send(sanitized);
  },
} satisfies Command;
