import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { generateReply } from "../utils/conversation.js";
import { getGroqErrorLogContext } from "../utils/groq.js";
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
    await interaction.deferReply();

    const content = interaction.options.getString("message", true);
    const reset = interaction.options.getBoolean("reset") ?? false;
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";

    try {
      const { text, botName, personaLabel } = await generateReply({
        userId,
        guildId,
        content,
        resetHistory: reset,
      });

      const embed = createEmbed(botName, text.slice(0, 4096));

      if (reset) {
        embed.setFooter({ text: "Conversation history cleared." });
      } else if (personaLabel) {
        embed.setFooter({ text: `Persona: ${personaLabel}` });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[/talk]", getGroqErrorLogContext(err));
      await interaction.editReply({
        embeds: [
          createErrorEmbed("Failed to process your message. Please try again."),
        ],
      });
    }
  },
} satisfies Command;
