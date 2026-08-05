import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

const PERSONA_LABELS: Record<string, string> = {
  analyst:    "Precise, data-driven, methodical. Speaks with measured authority.",
  observer:   "Quiet, perceptive, thoughtful. Speaks sparingly but meaningfully.",
  strategist: "Outcome-focused, strategic. Frames everything in terms of moves and positioning.",
  minimalist: "Says only what is necessary. No fluff, no filler.",
  oracle:     "Cryptic, metaphorical. Hints at deeper truths without stating them plainly.",
};

export default {
  data: new SlashCommandBuilder()
    .setName("personality")
    .setDescription("View all personality settings currently applied to you")
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("See your active persona, traits, and server bot name")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";

    const botName   = db.getBotName(guildId);
    const persona   = db.getPersona(userId, guildId);
    const traits    = db.getTraits(userId, guildId);
    const memories  = db.getMemories(userId, guildId);

    const personaDisplay = persona
      ? persona.personaName === "custom"
        ? `Custom — *${persona.customDescription.slice(0, 80)}${persona.customDescription.length > 80 ? "…" : ""}*`
        : `${persona.personaName.charAt(0).toUpperCase() + persona.personaName.slice(1)} — ${PERSONA_LABELS[persona.personaName] ?? ""}`
      : "Default — clean, concise, slightly mysterious";

    const traitsDisplay = traits.length
      ? traits.map((t) => `\`${t}\``).join("  ·  ")
      : "*none*";

    const embed = createEmbed("Personality Overview")
      .addFields(
        { name: "Bot Name",  value: botName,         inline: true },
        { name: "Memories",  value: `${memories.length} stored`, inline: true },
        { name: "\u200b",    value: "\u200b",         inline: true },
        { name: "Persona",   value: personaDisplay,  inline: false },
        { name: "Traits",    value: traitsDisplay,   inline: false }
      )
      .setFooter({
        text: "Change with /name set · /persona · /traits add · /memories view",
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
} satisfies Command;
