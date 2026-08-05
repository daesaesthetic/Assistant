import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js";
import { groq, VISION_MODEL } from "../utils/groq.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import type { Command } from "../types.js";

export default {
  data: new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Transform or modify an image using AI instructions")
    .addAttachmentOption((opt) =>
      opt.setName("image").setDescription("The image to edit").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("instructions")
        .setDescription("What to change — e.g. 'make it look like a night scene' or 'add fog'")
        .setRequired(true)
    ),
  cooldown: 30,
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const image = interaction.options.getAttachment("image", true);
    const instructions = interaction.options.getString("instructions", true);

    try {
      // Step 1: Use Groq vision to describe the image in detail
      const analysis = await groq.chat.completions.create({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content: [
              {
                type: "text",
                text: "Describe this image in precise detail suitable for an image generation prompt. Cover: subject, composition, lighting, colors, mood, style, and all notable elements. Be specific, not generic. Output only the description — no preamble.",
              },
              { type: "image_url", image_url: { url: image.url } },
            ] as never,
          },
        ],
        max_tokens: 500,
      });

      const imageDescription = analysis.choices[0]?.message?.content ?? "";

      // Step 2: Build a combined generation prompt
      const generationPrompt = [
        imageDescription,
        `Apply the following modification: ${instructions}.`,
        "High quality, detailed, photorealistic.",
      ]
        .filter(Boolean)
        .join(" ");

      // Step 3: Generate via Pollinations.ai (free, no API key required)
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        generationPrompt
      )}?width=1024&height=1024&nologo=true&model=flux&enhance=true`;

      const imgRes = await fetch(pollinationsUrl, { signal: AbortSignal.timeout(60_000) });
      if (!imgRes.ok) throw new Error(`Pollinations returned ${imgRes.status}`);

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const attachment = new AttachmentBuilder(buffer, { name: "edited.png" });

      const embed = createEmbed("Image Edit")
        .setDescription(`**Instructions:** ${instructions}`)
        .setImage("attachment://edited.png")
        .setFooter({ text: "Generated via Pollinations.ai · Results may vary" });

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error("[/edit]", err);
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            "Image editing failed. Try a different image or simpler instructions."
          ),
        ],
      });
    }
  },
} satisfies Command;
