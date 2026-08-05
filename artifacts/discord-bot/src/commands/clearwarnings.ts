import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Clear all warnings for a user (mods only)")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to clear warnings for").setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Timeout Members** permission to clear warnings.")],
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const guildId = interaction.guildId!;

    const before = db.getWarnings(target.id, guildId);
    if (!before || before.count === 0) {
      await interaction.reply({
        embeds: [createErrorEmbed(`<@${target.id}> has no warnings to clear.`)],
        ephemeral: true,
      });
      return;
    }

    db.resetWarnings(target.id, guildId);

    await interaction.reply({
      embeds: [
        createEmbed("Warnings Cleared").setDescription(
          `Cleared **${before.count}** warning(s) for <@${target.id}>.`
        ).addFields({ name: "Cleared by", value: interaction.user.tag, inline: true }),
      ],
    });

    // Log to mod channel
    const cfg = db.getGuildConfig(guildId);
    if (cfg?.modLogChannelId) {
      const logCh = interaction.guild?.channels.cache.get(cfg.modLogChannelId) as TextChannel | undefined;
      if (logCh?.isTextBased()) {
        const log = createEmbed("Mod Log — Warnings Cleared")
          .setColor(0x00aa88)
          .addFields(
            { name: "User", value: `${target.tag} (<@${target.id}>)`, inline: true },
            { name: "Moderator", value: interaction.user.tag, inline: true },
            { name: "Warnings Cleared", value: String(before.count), inline: true }
          )
          .setTimestamp();
        await logCh.send({ embeds: [log] }).catch(() => {});
      }
    }
  },
} satisfies Command;
