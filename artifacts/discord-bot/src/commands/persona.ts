import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  analyst: "Precise, data-driven, methodical. Speaks with measured authority.",
  observer: "Quiet, perceptive, thoughtful. Speaks sparingly but meaningfully.",
  strategist: "Outcome-focused, strategic. Frames everything in terms of moves and positioning.",
  minimalist: "Says only what is necessary. No fluff, no filler.",
  oracle: "Cryptic, metaphorical. Hints at deeper truths without stating them plainly.",
};

export default {
  data: new SlashCommandBuilder()
    .setName("persona")
    .setDescription("Set your conversation persona — affects all /talk responses")
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("Choose a persona")
        .setRequired(true)
        .addChoices(
          { name: "Analyst", value: "analyst" },
          { name: "Observer", value: "observer" },
          { name: "Strategist", value: "strategist" },
          { name: "Minimalist", value: "minimalist" },
          { name: "Oracle", value: "oracle" },
          { name: "Custom", value: "custom" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("custom_description")
        .setDescription("If Custom is selected: describe the tone and style you want")
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString("name", true);
    const customDesc = interaction.options.getString("custom_description") ?? "";
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";

    if (name === "custom" && !customDesc.trim()) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            "Provide a description when selecting the Custom persona.\nExample: `You speak like a stoic philosopher — direct, composed, occasionally aphoristic.`"
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    await db.setPersona(userId, guildId, name, name === "custom" ? customDesc : "");

    const displayName =
      name === "custom" ? "Custom" : name.charAt(0).toUpperCase() + name.slice(1);
    const description =
      name === "custom" ? customDesc : (PERSONA_DESCRIPTIONS[name] ?? "Unknown.");

    const embed = createEmbed("Persona Activated")
      .addFields(
        { name: "Active Persona", value: displayName, inline: true },
        { name: "Style", value: description, inline: false }
      )
      .setFooter({ text: "All /talk responses will now reflect this persona." });

    await interaction.reply({ embeds: [embed] });
  },
} satisfies Command;
