import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { generateReply } from "../utils/conversation.js";
import {
  getAiUserFacingMessage,
  getSafeAiErrorLogContext,
} from "../utils/ai-errors.js";
import type { Command } from "../types.js";

function getDiscordDeliveryMetadata(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return {};
  const value = error as Record<string, unknown>;
  const rawError =
    typeof value.rawError === "object" && value.rawError !== null
      ? (value.rawError as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof value.name === "string" ? { errorName: value.name } : {}),
    ...(typeof value.code === "string" || typeof value.code === "number"
      ? { errorCode: value.code }
      : {}),
    ...(typeof value.status === "number" ? { httpStatus: value.status } : {}),
    ...(typeof rawError?.code === "number"
      ? { discordApiCode: rawError.code }
      : {}),
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName("talk")
    .setDescription(
      "Think out loud with Assistant ₯ — it keeps the thread and useful context",
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
    const startedAt = Date.now();
    try {
      await interaction.deferReply();
    } catch (error) {
      console.error("[/talk]", {
        operation: "discord_delivery",
        category: "delivery",
        stage: "deferReply",
        commandName: interaction.commandName,
        deferred: interaction.deferred,
        replied: interaction.replied,
        elapsedMs: Date.now() - startedAt,
        ...getDiscordDeliveryMetadata(error),
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
      } catch (error) {
        console.error("[/talk]", {
          operation: "discord_delivery",
          category: "delivery",
          stage: "editReply:error",
          commandName: interaction.commandName,
          deferred: interaction.deferred,
          replied: interaction.replied,
          responseLength: getAiUserFacingMessage(err).length,
          elapsedMs: Date.now() - startedAt,
          ...getDiscordDeliveryMetadata(error),
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
    } catch (error) {
      console.error("[/talk]", {
        operation: "discord_delivery",
        category: "delivery",
        stage: "editReply:success",
        commandName: interaction.commandName,
        deferred: interaction.deferred,
        replied: interaction.replied,
        responseLength: result.text.length,
        elapsedMs: Date.now() - startedAt,
        ...getDiscordDeliveryMetadata(error),
      });
    }
  },
} satisfies Command;
