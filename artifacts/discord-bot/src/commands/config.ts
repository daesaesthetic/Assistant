import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

function requireAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    void interaction.reply({
      embeds: [createErrorEmbed("You need the **Manage Server** permission to use this command.")],
      ephemeral: true,
    });
    return false;
  }
  return true;
}

export default {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure Assistant ₯ settings for this server (admins only)")
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("View current server configuration")
    )
    .addSubcommand((sub) =>
      sub
        .setName("modlog")
        .setDescription("Set the channel where automod actions are logged")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel for mod logs")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("blacklist")
        .setDescription("Manage the list of blocked words")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Add a word to the blocklist")
            .addStringOption((opt) =>
              opt.setName("word").setDescription("Word to block").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Remove a word from the blocklist")
            .addStringOption((opt) =>
              opt.setName("word").setDescription("Word to unblock").setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("Show all currently blocked words")
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!requireAdmin(interaction)) return;

    const guildId = interaction.guildId!;
    const sub = interaction.options.getSubcommand(false);
    const group = interaction.options.getSubcommandGroup(false);

    // ── /config view ─────────────────────────────────────────────────────────
    if (sub === "view") {
      const cfg = await db.getGuildConfig(guildId);
      const modlog = cfg?.modLogChannelId ? `<#${cfg.modLogChannelId}>` : "Not set";
      const words = cfg?.blacklistedWords?.length
        ? cfg.blacklistedWords.map((w) => `\`${w}\``).join(", ")
        : "None";

      const embed = createEmbed("Server Configuration")
        .addFields(
          { name: "Mod Log Channel", value: modlog, inline: true },
          { name: "Blacklisted Words", value: words, inline: false }
        )
        .setFooter({ text: "Use /config modlog and /config blacklist to change settings." });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // ── /config modlog ────────────────────────────────────────────────────────
    if (sub === "modlog") {
      const channel = interaction.options.getChannel("channel", true);
      await db.setGuildConfig(guildId, { modLogChannelId: channel.id });

      await interaction.reply({
        embeds: [
          createEmbed("Config Updated").setDescription(
            `Mod log channel set to <#${channel.id}>.\nAll automod actions will be recorded there.`
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    // ── /config blacklist ────────────────────────────────────────────────────
    if (group === "blacklist") {
      const cfg = await db.getGuildConfig(guildId);
      const words: string[] = cfg?.blacklistedWords ?? [];

      if (sub === "add") {
        const word = interaction.options.getString("word", true).toLowerCase().trim();
        if (words.includes(word)) {
          await interaction.reply({
            embeds: [createErrorEmbed(`\`${word}\` is already on the blocklist.`)],
            ephemeral: true,
          });
          return;
        }
        words.push(word);
        await db.setGuildConfig(guildId, { blacklistedWords: words });
        await interaction.reply({
          embeds: [createEmbed("Blocklist Updated").setDescription(`Added \`${word}\` to the blocklist.`)],
          ephemeral: true,
        });
      } else if (sub === "remove") {
        const word = interaction.options.getString("word", true).toLowerCase().trim();
        const idx = words.indexOf(word);
        if (idx === -1) {
          await interaction.reply({
            embeds: [createErrorEmbed(`\`${word}\` is not on the blocklist.`)],
            ephemeral: true,
          });
          return;
        }
        words.splice(idx, 1);
        await db.setGuildConfig(guildId, { blacklistedWords: words });
        await interaction.reply({
          embeds: [createEmbed("Blocklist Updated").setDescription(`Removed \`${word}\` from the blocklist.`)],
          ephemeral: true,
        });
      } else if (sub === "list") {
        const display = words.length ? words.map((w) => `\`${w}\``).join(", ") : "No words are currently blocked.";
        await interaction.reply({
          embeds: [createEmbed("Blocked Words", display)],
          ephemeral: true,
        });
      }
    }
  },
} satisfies Command;
