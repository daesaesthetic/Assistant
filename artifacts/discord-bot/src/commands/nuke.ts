import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("Erase a channel entirely and recreate it fresh")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to nuke (defaults to current channel)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Manage Channels** permission to use this command.")],
        ephemeral: true,
      });
      return;
    }

    const target = (interaction.options.getChannel("channel") ?? interaction.channel) as TextChannel;
    const guildId = interaction.guildId!;

    if (!target || target.type !== ChannelType.GuildText) {
      await interaction.reply({
        embeds: [createErrorEmbed("Target must be a text channel.")],
        ephemeral: true,
      });
      return;
    }

    // Acknowledge before the channel is deleted
    await interaction.reply({ embeds: [createEmbed("Nuking…").setDescription(`Wiping <#${target.id}>…`)], ephemeral: true });

    try {
      // Clone the channel (preserves name, topic, position, permission overwrites, NSFW flag, slowmode)
      const cloned = await target.clone({
        reason: `Nuked by ${interaction.user.tag}`,
      });

      // Restore it to the same position
      await cloned.setPosition(target.position).catch(() => {});

      // If the nuked channel was a bot channel, transfer that to the new one
      const botChannels = await db.getBotChannels(guildId);
      if (botChannels.includes(target.id)) {
        await db.removeBotChannel(guildId, target.id);
        await db.addBotChannel(guildId, cloned.id);
      }

      // Delete the original
      await target.delete(`Nuked by ${interaction.user.tag}`);

      // Send a confirmation in the new channel
      const confirmEmbed = createEmbed("Channel Nuked")
        .setDescription("This channel has been wiped clean.")
        .setFooter({ text: `Actioned by ${interaction.user.tag}` })
        .setTimestamp();

      await cloned.send({ embeds: [confirmEmbed] });
    } catch (err) {
      console.error("[/nuke]", err);
      await interaction.editReply({
        embeds: [createErrorEmbed("Failed to nuke the channel. Make sure the bot has **Manage Channels** permission.")],
      });
    }
  },
} satisfies Command;
