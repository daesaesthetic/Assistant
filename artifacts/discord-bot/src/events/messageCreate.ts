import { Events, Message, TextChannel } from "discord.js";
import { db } from "../database/index.js";
import { createEmbed } from "../utils/embeds.js";
import { generateReply } from "../utils/conversation.js";
import {
  getAiUserFacingMessage,
  getSafeAiErrorLogContext,
} from "../utils/ai-errors.js";
import type { Event } from "../types.js";

// Spam detection: track recent message timestamps per user per guild
const spamMap = new Map<string, number[]>();

const SPAM_WINDOW_MS = 5000; // 5-second window
const SPAM_LIMIT = 5; // messages before triggering
const CAPS_RATIO = 0.7; // 70% uppercase threshold
const CAPS_MIN_LENGTH = 10; // minimum message length to check caps
const WARNING_THRESHOLD = 3; // warnings before timeout
const TIMEOUT_MS = 10 * 60 * 1000; // 10-minute timeout

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message: Message) {
    if (message.author.bot) return;

    const userId = message.author.id;
    const guildId = message.guild?.id ?? "dm";
    let guildConfig: Awaited<ReturnType<typeof db.getGuildConfig>> = null;
    try {
      if (message.guild) guildConfig = await db.getGuildConfig(guildId);
    } catch (error) {
      console.error("[Assistant ₯] Message configuration lookup failed", {
        operation: "guild_config",
        category: "persistence",
        error: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
    const botUser = message.client.user;

    // ── Automod ───────────────────────────────────────────────────────────────
    let violation: string | null = null;

    if (message.guild) {

    // 1. Spam detection
    const spamKey = `${userId}:${guildId}`;
    const now = Date.now();
    const timestamps = (spamMap.get(spamKey) ?? []).filter(
      (t) => now - t < SPAM_WINDOW_MS,
    );
    timestamps.push(now);
    spamMap.set(spamKey, timestamps);
    if (timestamps.length >= SPAM_LIMIT) {
      violation = "spam";
      spamMap.set(spamKey, []);
    }

    // 2. Excessive capitalization
    if (!violation && message.content.length >= CAPS_MIN_LENGTH) {
      const letters = message.content.replace(/[^a-zA-Z]/g, "");
      if (letters.length >= CAPS_MIN_LENGTH) {
        const capsCount = (message.content.match(/[A-Z]/g) ?? []).length;
        if (capsCount / letters.length >= CAPS_RATIO)
          violation = "excessive capitalization";
      }
    }

    // 3. Blacklisted words
    if (!violation && guildConfig?.blacklistedWords?.length) {
      const lower = message.content.toLowerCase();
      const hit = guildConfig.blacklistedWords.find((w) =>
        lower.includes(w.toLowerCase()),
      );
      if (hit) violation = "blacklisted word";
    }

    if (violation) {
      // Delete, warn, possibly timeout, log
      await message.delete().catch(() => {});

      const warningData = await db.addWarning(userId, guildId);
      const count = warningData.count;
      const timedOut = count >= WARNING_THRESHOLD;

      const warnEmbed = createEmbed("Automod")
        .setColor(timedOut ? 0xff4444 : 0xe0a500)
        .setDescription(
          `<@${userId}> — message removed for **${violation}**.\nWarning **${count}/${WARNING_THRESHOLD}**.${
            timedOut ? "\n\n**Timeout applied (10 minutes).**" : ""
          }`,
        );
      const warnMsg = await (message.channel as TextChannel)
        .send({ embeds: [warnEmbed] })
        .catch(() => null);
      if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 8000);

      if (timedOut && message.member?.moderatable) {
        await message.member
          .timeout(
            TIMEOUT_MS,
            `Automod: exceeded warning threshold (${violation})`,
          )
          .catch(() => {});
        await db.resetWarnings(userId, guildId);
      }

      const modChannelId = guildConfig?.modLogChannelId;
      if (modChannelId) {
        const logChannel = message.guild.channels.cache.get(modChannelId) as
          TextChannel | undefined;
        if (logChannel?.isTextBased()) {
          const logEmbed = createEmbed("Mod Log — Automod Action")
            .setColor(timedOut ? 0xff2222 : 0xff9900)
            .addFields(
              {
                name: "User",
                value: `${message.author.tag} (<@${userId}>)`,
                inline: true,
              },
              { name: "Violation", value: violation, inline: true },
              {
                name: "Warnings",
                value: `${count}/${WARNING_THRESHOLD}`,
                inline: true,
              },
              {
                name: "Channel",
                value: `<#${message.channelId}>`,
                inline: true,
              },
              {
                name: "Action",
                value: timedOut
                  ? "10-minute timeout applied"
                  : "Warning issued, message deleted",
                inline: true,
              },
            )
            .setTimestamp();
          await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
      return; // Do not respond conversationally to deleted messages
    }
    }

    // ── Conversation: mention or bot channel ─────────────────────────────────
    if (!botUser) return;

    const mentioned =
      !message.guild ||
      (message.mentions.users.has(botUser.id) &&
        !message.content.startsWith("@everyone") &&
        !message.content.startsWith("@here"));

    const inBotChannel =
      guildConfig?.botChannelIds?.includes(message.channelId) ?? false;

    if (!mentioned && !inBotChannel) return;

    // Strip the bot mention from message content
    let content = message.content
      .replace(new RegExp(`<@!?${botUser.id}>`, "g"), "")
      .trim();
    if (!content) content = "Hey.";
    if (content.length > 2000) content = content.slice(0, 2000);

    // Show typing indicator while processing
    if ("sendTyping" in message.channel) {
      await (message.channel as TextChannel).sendTyping().catch(() => {});
    }

    let result: Awaited<ReturnType<typeof generateReply>>;
    try {
      result = await generateReply({
        userId,
        guildId,
        content,
      });
    } catch (err) {
      console.error(
        "[messageCreate:conversation]",
        getSafeAiErrorLogContext("conversation", err),
      );
      // Don't send an error embed for unprompted bot-channel messages — too noisy
      if (mentioned) {
        try {
          await message.reply({
            embeds: [createEmbed("—", getAiUserFacingMessage(err))],
          });
        } catch {
          console.error("[messageCreate:conversation]", {
            operation: "discord_delivery",
            category: "delivery",
          });
        }
      }
      return;
    }

    try {
      const chunks = splitDiscordResponse(result.text);
      for (const [index, chunk] of chunks.entries()) {
        const embed = createEmbed(result.botName, chunk);
        if (result.personaLabel) {
          embed.setFooter({ text: `Persona: ${result.personaLabel}` });
        }
        if (index === 0) {
          await message.reply({ embeds: [embed] });
        } else if ("send" in message.channel) {
          await message.channel.send({ embeds: [embed] });
        }
      }
    } catch {
      console.error("[messageCreate:conversation]", {
        operation: "discord_delivery",
        category: "delivery",
      });
    }
  },
} satisfies Event;

export function splitDiscordResponse(
  text: string,
  maxLength = 4096,
): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const boundary = remaining.lastIndexOf("\n", maxLength);
    const splitAt = boundary > Math.floor(maxLength * 0.6) ? boundary : maxLength;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
