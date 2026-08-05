import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Check how many warnings a user has")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to check (defaults to yourself)").setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const isSelf = !interaction.options.getUser("user");
    const target = interaction.options.getUser("user") ?? interaction.user;
    const guildId = interaction.guildId!;

    // Non-mods can only check their own warnings
    if (!isSelf && !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({
        embeds: [createErrorEmbed("You need the **Timeout Members** permission to check other users' warnings.")],
        ephemeral: true,
      });
      return;
    }

    const data = db.getWarnings(target.id, guildId);
    const count = data?.count ?? 0;
    const lastWarned = data?.lastWarned
      ? `<t:${Math.floor(data.lastWarned / 1000)}:R>`
      : "Never";

    const bar = "█".repeat(count) + "░".repeat(Math.max(0, 3 - count));

    const embed = createEmbed(`Warnings — ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ size: 64 }))
      .addFields(
        { name: "Warning Count", value: `${bar}  **${count}/3**`, inline: true },
        { name: "Last Warning", value: lastWarned, inline: true }
      )
      .setFooter({ text: count >= 3 ? "Threshold reached — next warning triggers a timeout." : `${3 - count} warning(s) before timeout.` });

    await interaction.reply({ embeds: [embed], ephemeral: isSelf });
  },
} satisfies Command;
