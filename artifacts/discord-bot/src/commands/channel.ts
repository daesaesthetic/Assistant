import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  OverwriteType,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Manage bot conversation channels")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a channel where the bot converses freely with everyone")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Channel name (default: assistant)")
            .setRequired(false)
            .setMaxLength(32)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Stop the bot from auto-responding in a channel")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to remove from bot channels")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all active bot conversation channels")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Manage Channels** permission to use this command.")],
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guildId!;
    const guild = interaction.guild!;
    const sub = interaction.options.getSubcommand();

    // ── create ────────────────────────────────────────────────────────────────
    if (sub === "create") {
      const rawName = interaction.options.getString("name") ?? "assistant";
      const channelName = rawName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

      await interaction.deferReply({ ephemeral: true });

      const channel = await guild.channels
        .create({
          name: channelName || "assistant",
          type: ChannelType.GuildText,
          topic: `${await db.getBotName(guildId)}'s space — chat freely here.`,
          permissionOverwrites: [
            {
              id: guild.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            },
          ],
        })
        .catch((err: unknown) => {
          console.error("[/channel create]", err);
          return null;
        });

      if (!channel) {
        await interaction.editReply({
          embeds: [createErrorEmbed("Failed to create channel. Make sure the bot has **Manage Channels** permission.")],
        });
        return;
      }

      await db.addBotChannel(guildId, channel.id);

      await interaction.editReply({
        embeds: [
          createEmbed("Channel Created")
            .setDescription(
              `<#${channel.id}> is now a conversation channel.\n${await db.getBotName(guildId)} will respond to every message sent there — no commands needed.`
            )
            .setFooter({ text: "Use /channel remove to revert." }),
        ],
      });
    }

    // ── remove ────────────────────────────────────────────────────────────────
    else if (sub === "remove") {
      const target = interaction.options.getChannel("channel", true);
      const current = await db.getBotChannels(guildId);
      if (!current.includes(target.id)) {
        await interaction.reply({
          embeds: [createErrorEmbed(`<#${target.id}> is not a bot conversation channel.`)],
          ephemeral: true,
        });
        return;
      }
      await db.removeBotChannel(guildId, target.id);
      await interaction.reply({
        embeds: [
          createEmbed("Channel Removed").setDescription(
            `<#${target.id}> removed from bot channels. The bot will no longer auto-respond there.`
          ),
        ],
        ephemeral: true,
      });
    }

    // ── list ──────────────────────────────────────────────────────────────────
    else if (sub === "list") {
      const channels = await db.getBotChannels(guildId);
      const display = channels.length
        ? channels.map((id) => `<#${id}>`).join("\n")
        : "No conversation channels configured.\nUse `/channel create` to set one up.";
      await interaction.reply({
        embeds: [createEmbed("Bot Conversation Channels", display)],
        ephemeral: true,
      });
    }
  },
} satisfies Command;
