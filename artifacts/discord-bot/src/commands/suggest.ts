import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import {
  createGroqCompletion,
  TEXT_MODEL,
  VISION_MODEL,
} from "../utils/groq.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import {
  getAiUserFacingMessage,
  getSafeAiErrorLogContext,
  validateCompletionText,
} from "../utils/ai-errors.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Get intelligent, high-quality suggestions for any query")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("What do you need suggestions for?")
        .setRequired(true),
    )
    .addAttachmentOption((opt) =>
      opt
        .setName("image")
        .setDescription("Optional image for visual context")
        .setRequired(false),
    ),
  cooldown: 10,
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();
    } catch {
      console.error("[/suggest]", {
        operation: "discord_delivery",
        category: "delivery",
      });
      return;
    }

    const query = interaction.options.getString("query", true);
    const image = interaction.options.getAttachment("image");

    try {
      const systemPrompt =
        "You are a precise, thoughtful advisor. Provide high-quality, relevant suggestions as clear bullet points. After the bullets, include a brief 'Reasoning' section explaining your logic. Be concise and avoid filler.";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let userContent: any;

      if (image) {
        userContent = [
          {
            type: "text",
            text: `Analyze this image and provide suggestions for: ${query}`,
          },
          {
            type: "image_url",
            image_url: { url: image.url },
          },
        ];
      } else {
        userContent = `Provide suggestions for: ${query}`;
      }

      const completion = await createGroqCompletion(
        {
          model: image ? VISION_MODEL : TEXT_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: 900,
        },
        { requestType: image ? "vision" : "text" },
      );

      const response = validateCompletionText(
        completion,
        image ? "vision" : "text",
        image ? VISION_MODEL : TEXT_MODEL,
      );

      const embed = createEmbed("Suggestions", response.slice(0, 4096));
      if (image) embed.setThumbnail(image.url);

      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {
        console.error("[/suggest]", {
          operation: "discord_delivery",
          category: "delivery",
        });
      }
    } catch (err) {
      console.error("[/suggest]", getSafeAiErrorLogContext("/suggest", err));
      try {
        await interaction.editReply({
          embeds: [createErrorEmbed(getAiUserFacingMessage(err))],
        });
      } catch {
        console.error("[/suggest]", {
          operation: "discord_delivery",
          category: "delivery",
        });
      }
    }
  },
} satisfies Command;
