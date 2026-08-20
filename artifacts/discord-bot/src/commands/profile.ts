import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a user's server profile and tracked stats")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to inspect (defaults to yourself)").setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target = interaction.options.getUser("user") ?? interaction.user;
    const guildId = interaction.guildId ?? "dm";

    try {
      const member = interaction.guild
        ? await interaction.guild.members.fetch(target.id).catch(() => null)
        : null;

      const warnings = await db.getWarnings(target.id, guildId);
      const persona = await db.getPersona(target.id, guildId);

      const embed = createEmbed(
        member?.displayName ?? target.username,
        `<@${target.id}>`
      )
        .setThumbnail(target.displayAvatarURL({ size: 256 }))
        .addFields(
          {
            name: "Account Created",
            value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`,
            inline: true,
          },
          {
            name: "Automod Warnings",
            value: String(warnings?.count ?? 0),
            inline: true,
          }
        );

      if (member) {
        if (member.joinedTimestamp) {
          embed.addFields({
            name: "Joined Server",
            value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,
            inline: true,
          });
        }
        if (member.nickname) {
          embed.addFields({ name: "Nickname", value: member.nickname, inline: true });
        }

        const topRoles = member.roles.cache
          .filter((r) => r.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .first(4)
          .map((r) => r.toString())
          .join(" ");

        if (topRoles) {
          embed.addFields({ name: "Roles", value: topRoles, inline: false });
        }
      }

      if (persona) {
        const label =
          persona.personaName === "custom"
            ? "Custom"
            : persona.personaName.charAt(0).toUpperCase() + persona.personaName.slice(1);
        embed.addFields({ name: "Active Persona", value: label, inline: true });
      }

      embed.setFooter({ text: `ID: ${target.id}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[/profile]", err);
      await interaction.editReply({
        embeds: [createErrorEmbed("Failed to fetch profile. Make sure the bot has the Members intent enabled.")],
      });
    }
  },
} satisfies Command;
