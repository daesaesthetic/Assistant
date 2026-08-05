import { Events, Message, TextChannel } from "discord.js";
import { db } from "../database/index.js";
import { createEmbed } from "../utils/embeds.js";
import { generateReply } from "../utils/conversation.js";
import type { Event } from "../types.js";

// Spam detection: track recent message timestamps per user per guild
const spamMap = new Map<string, number[]>();

const SPAM_WINDOW_MS = 5000;      // 5-second window
const SPAM_LIMIT = 5;              // messages before triggering
const CAPS_RATIO = 0.70;           // 70% uppercase threshold
const CAPS_MIN_LENGTH = 10;        // minimum message length to check caps
const WARNING_THRESHOLD = 3;       // warnings before timeout
const TIMEOUT_MS = 10 * 60 * 1000; // 10-minute timeout

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message: Message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const botUser = message.client.user;

    // ── Automod ───────────────────────────────────────────────────────────────
    let violation: string | null = null;

    // 1. Spam detection
    const spamKey = `${userId}:${guildId}`;
    const now = Date.now();
    const timestamps = (spamMap.get(spamKey) ?? []).filter((t) => now - t < SPAM_WINDOW_MS);
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
        if (capsCount / letters.length >= CAPS_RATIO) violation = "excessive capitalization";
      }
    }

    // 3. Blacklisted words
    if (!violation && guildConfig?.blacklistedWords?.length) {
      const lower = message.content.toLowerCase();
      const hit = guildConfig.blacklistedWords.find((w) => lower.includes(w.toLowerCase()));
      if (hit) violation = "blacklisted word";
    }

    if (violation) {
      // Delete, warn, possibly timeout, log
      await message.delete().catch(() => {});

      const warningData = db.addWarning(userId, guildId);
      const count = warningData.count;
      const timedOut = count >= WARNING_THRESHOLD;

      const warnEmbed = createEmbed("Automod")
        .setColor(timedOut ? 0xff4444 : 0xe0a500)
        .setDescription(
          `<@${userId}> — message removed for **${violation}**.\nWarning **${count}/${WARNING_THRESHOLD}**.${
            timedOut ? "\n\n**Timeout applied (10 minutes).**" : ""
          }`
        );
      const warnMsg = await (message.channel as TextChannel).send({ embeds: [warnEmbed] }).catch(() => null);
      if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 8000);

      if (timedOut && message.member?.moderatable) {
        await message.member
          .timeout(TIMEOUT_MS, `Automod: exceeded warning threshold (${violation})`)
          .catch(() => {});
        db.resetWarnings(userId, guildId);
      }

      const modChannelId = guildConfig?.modLogChannelId;
      if (modChannelId) {
        const logChannel = message.guild.channels.cache.get(modChannelId) as TextChannel | undefined;
        if (logChannel?.isTextBased()) {
          const logEmbed = createEmbed("Mod Log — Automod Action")
            .setColor(timedOut ? 0xff2222 : 0xff9900)
            .addFields(
              { name: "User", value: `${message.author.tag} (<@${userId}>)`, inline: true },
              { name: "Violation", value: violation, inline: true },
              { name: "Warnings", value: `${count}/${WARNING_THRESHOLD}`, inline: true },
              { name: "Channel", value: `<#${message.channelId}>`, inline: true },
              { name: "Action", value: timedOut ? "10-minute timeout applied" : "Warning issued, message deleted", inline: true }
            )
            .setTimestamp();
          await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
      return; // Do not respond conversationally to deleted messages
    }

    // ── Conversation: mention or bot channel ─────────────────────────────────
    if (!botUser) return;

    const mentioned =
      message.mentions.users.has(botUser.id) &&
      !message.content.startsWith("@everyone") &&
      !message.content.startsWith("@here");

    const inBotChannel = guildConfig?.botChannelIds?.includes(message.channelId) ?? false;

    if (!mentioned && !inBotChannel) return;

    // Strip the bot mention from message content
    let content = message.content
      .replace(new RegExp(`<@!?${botUser.id}>`, "g"), "")
      .trim();
    if (!content) content = "Hey.";
    if (content.length > 2000) content = content.slice(0, 2000);

    // Show typing indicator while processing
    await (message.channel as TextChannel).sendTyping().catch(() => {});

    try {
      const { text, botName, personaLabel } = await generateReply({
        userId,
        guildId,
        content,
      });

      const embed = createEmbed(botName, text.slice(0, 4096));
      if (personaLabel) {
        embed.setFooter({ text: `Persona: ${personaLabel}` });
      }

      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("[messageCreate:conversation]", err);
      // Don't send an error embed for unprompted bot-channel messages — too noisy
      if (mentioned) {
        await message.reply({
          embeds: [createEmbed("—", "Something went wrong. Try again in a moment.")],
        }).catch(() => {});
      }
    }
  },
} satisfies Event;
