import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { generateReply } from "../utils/conversation.js";
import {
  getAiUserFacingMessage,
  getSafeAiErrorLogContext,
} from "../utils/ai-errors.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("talk")
    .setDescription(
      "Have a conversation — Azurion remembers your exchanges over time",
    )
    .addStringOption((opt) =>
      opt.setName("message").setDescription("Your message").setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("reset")
        .setDescription("Clear your conversation history and start fresh")
        .setRequired(false),
    ),
  cooldown: 5,
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();
    } catch {
      console.error("[/talk]", {
        operation: "discord_delivery",
        category: "delivery",
      });
      return;
    }

    const content = interaction.options.getString("message", true);
    const reset = interaction.options.getBoolean("reset") ?? false;
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";

    let result: Awaited<ReturnType<typeof generateReply>>;
    try {
      result = await generateReply({
        userId,
        guildId,
        content,
        resetHistory: reset,
      });
    } catch (err) {
      console.error("[/talk]", getSafeAiErrorLogContext("/talk", err));
      try {
        await interaction.editReply({
          embeds: [createErrorEmbed(getAiUserFacingMessage(err))],
        });
      } catch {
        console.error("[/talk]", {
          operation: "discord_delivery",
          category: "delivery",
        });
      }
      return;
    }

    const embed = createEmbed(result.botName, result.text.slice(0, 4096));

    if (reset) {
      embed.setFooter({ text: "Conversation history cleared." });
    } else if (result.personaLabel) {
      embed.setFooter({ text: `Persona: ${result.personaLabel}` });
    }

    try {
      await interaction.editReply({ embeds: [embed] });
    } catch {
      console.error("[/talk]", {
        operation: "discord_delivery",
        category: "delivery",
      });
    }
  },
} satisfies Command;
