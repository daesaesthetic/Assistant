import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { groq, TEXT_MODEL } from "../utils/groq.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

const PERSONAS: Record<string, string> = {
  analyst:
    "You are a precise analytical thinker. You break down problems methodically, provide data-driven insights, and speak with measured authority. Avoid emotional language.",
  observer:
    "You are a quiet, perceptive observer. You notice patterns others miss and offer subtle, thoughtful commentary. You speak sparingly but meaningfully.",
  strategist:
    "You are a strategic thinker focused on outcomes and leverage. You frame everything in terms of moves, advantages, and long-term positioning.",
  minimalist:
    "You say only what is necessary. No fluff, no filler. Every word earns its place.",
  oracle:
    "You are a cryptic oracle. You speak in metaphors and abstractions, hinting at deeper truths without stating them plainly.",
};

const DEFAULT_SYSTEM =
  "You are Azurion — an intelligent assistant with a clean, minimal, slightly mysterious tone. You are not overly robotic or playful. You are concise, thoughtful, and context-aware. Never break character.";

export default {
  data: new SlashCommandBuilder()
    .setName("talk")
    .setDescription("Have a conversation with Azurion")
    .addStringOption((opt) =>
      opt.setName("message").setDescription("Your message").setRequired(true)
    )
    .addBooleanOption((opt) =>
      opt.setName("reset").setDescription("Clear your conversation history and start fresh").setRequired(false)
    ),
  cooldown: 5,
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const message = interaction.options.getString("message", true);
    const reset = interaction.options.getBoolean("reset") ?? false;
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";

    if (reset) {
      db.clearConversation(userId);
    }

    try {
      // Resolve persona → system prompt
      const persona = db.getPersona(userId, guildId);
      let systemPrompt = DEFAULT_SYSTEM;
      if (persona) {
        if (persona.personaName === "custom") {
          systemPrompt = persona.customDescription || DEFAULT_SYSTEM;
        } else {
          systemPrompt = PERSONAS[persona.personaName] ?? DEFAULT_SYSTEM;
        }
      }

      // Build message chain (keep last 20 messages = 10 exchanges)
      const history = db.getConversation(userId);
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: message },
      ];

      const completion = await groq.chat.completions.create({
        model: TEXT_MODEL,
        messages,
        max_tokens: 800,
      });

      const response = completion.choices[0]?.message?.content ?? "...";

      // Persist updated history
      const updatedHistory = [
        ...history,
        { role: "user" as const, content: message },
        { role: "assistant" as const, content: response },
      ].slice(-20);
      db.setConversation(userId, updatedHistory);

      const embed = createEmbed("Azurion", response.slice(0, 4096));

      if (persona) {
        const label =
          persona.personaName === "custom"
            ? "Custom"
            : persona.personaName.charAt(0).toUpperCase() + persona.personaName.slice(1);
        embed.setFooter({ text: `Persona: ${label}` });
      }

      if (reset) {
        embed.setFooter({ text: "Conversation history cleared." });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[/talk]", err);
      await interaction.editReply({
        embeds: [createErrorEmbed("Failed to process your message. Please try again.")],
      });
    }
  },
} satisfies Command;
