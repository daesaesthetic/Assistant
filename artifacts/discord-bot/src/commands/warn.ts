import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from "discord.js";
import { createEmbed, createErrorEmbed, createWarnEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

const WARNING_THRESHOLD = 3;
const TIMEOUT_MS = 10 * 60 * 1000;

export default {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Manually issue a warning to a user (mods only)")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to warn").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Reason for the warning").setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Timeout Members** permission to warn users.")],
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    const guildId = interaction.guildId!;

    if (target.bot) {
      await interaction.reply({ embeds: [createErrorEmbed("You cannot warn a bot.")], ephemeral: true });
      return;
    }

    const warningData = db.addWarning(target.id, guildId);
    const count = warningData.count;
    const timedOut = count >= WARNING_THRESHOLD;

    // Apply timeout if threshold reached
    if (timedOut && interaction.guild) {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member?.moderatable) {
        await member.timeout(TIMEOUT_MS, `Manual warn by ${interaction.user.tag}: ${reason}`).catch(() => {});
        db.resetWarnings(target.id, guildId);
      }
    }

    const embed = createWarnEmbed(
      timedOut ? "Warning Issued — Timeout Applied" : "Warning Issued",
      `<@${target.id}> has been warned.\n**Reason:** ${reason}\n**Warnings:** ${count}/${WARNING_THRESHOLD}${
        timedOut ? "\n\n**10-minute timeout has been applied.**" : ""
      }`
    ).addFields({ name: "Issued by", value: interaction.user.tag, inline: true });

    await interaction.reply({ embeds: [embed] });

    // Log to mod channel
    const cfg = db.getGuildConfig(guildId);
    if (cfg?.modLogChannelId) {
      const logCh = interaction.guild?.channels.cache.get(cfg.modLogChannelId) as TextChannel | undefined;
      if (logCh?.isTextBased()) {
        const log = createEmbed("Mod Log — Manual Warning")
          .setColor(0xe0a500)
          .addFields(
            { name: "User", value: `${target.tag} (<@${target.id}>)`, inline: true },
            { name: "Moderator", value: interaction.user.tag, inline: true },
            { name: "Reason", value: reason, inline: false },
            { name: "Warnings", value: `${count}/${WARNING_THRESHOLD}`, inline: true },
            { name: "Action", value: timedOut ? "10-minute timeout applied" : "Warning recorded", inline: true }
          )
          .setTimestamp();
        await logCh.send({ embeds: [log] }).catch(() => {});
      }
    }
  },
} satisfies Command;
