import { Events, Message, TextChannel } from "discord.js";
import { db } from "../database/index.js";
import { createEmbed } from "../utils/embeds.js";
import type { Event } from "../types.js";

// Spam detection: track recent message timestamps per user per guild
const spamMap = new Map<string, number[]>();

const SPAM_WINDOW_MS = 5000;  // 5-second window
const SPAM_LIMIT = 5;          // messages before triggering
const CAPS_RATIO = 0.70;       // 70% uppercase threshold
const CAPS_MIN_LENGTH = 10;    // minimum message length to check caps
const WARNING_THRESHOLD = 3;   // warnings before timeout
const TIMEOUT_MS = 10 * 60 * 1000; // 10-minute timeout

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message: Message) {
    // Ignore bots and DMs
    if (message.author.bot) return;
    if (!message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);

    let violation: string | null = null;

    // ── 1. Spam detection ─────────────────────────────────────────────────────
    const spamKey = `${userId}:${guildId}`;
    const now = Date.now();
    const timestamps = (spamMap.get(spamKey) ?? []).filter((t) => now - t < SPAM_WINDOW_MS);
    timestamps.push(now);
    spamMap.set(spamKey, timestamps);

    if (timestamps.length >= SPAM_LIMIT) {
      violation = "spam";
      spamMap.set(spamKey, []); // reset after violation
    }

    // ── 2. Excessive capitalization ───────────────────────────────────────────
    if (!violation && message.content.length >= CAPS_MIN_LENGTH) {
      const letters = message.content.replace(/[^a-zA-Z]/g, "");
      if (letters.length >= CAPS_MIN_LENGTH) {
        const capsCount = (message.content.match(/[A-Z]/g) ?? []).length;
        if (capsCount / letters.length >= CAPS_RATIO) {
          violation = "excessive capitalization";
        }
      }
    }

    // ── 3. Blacklisted words ──────────────────────────────────────────────────
    if (!violation && guildConfig?.blacklistedWords?.length) {
      const lower = message.content.toLowerCase();
      const hit = guildConfig.blacklistedWords.find((w) => lower.includes(w.toLowerCase()));
      if (hit) violation = "blacklisted word";
    }

    if (!violation) return;

    // ── Action: delete message ────────────────────────────────────────────────
    await message.delete().catch(() => {});

    // ── Action: record warning ────────────────────────────────────────────────
    const warningData = db.addWarning(userId, guildId);
    const count = warningData.count;
    const timedOut = count >= WARNING_THRESHOLD;

    // ── Action: warn in channel (auto-delete after 8s) ────────────────────────
    const warnColor = timedOut ? 0xff4444 : 0xe0a500;
    const warnEmbed = createEmbed("Automod")
      .setColor(warnColor)
      .setDescription(
        `<@${userId}> — message removed for **${violation}**.\nWarning **${count}/${WARNING_THRESHOLD}**.${
          timedOut ? "\n\n**Timeout applied (10 minutes).**" : ""
        }`
      );

    // Cast is safe: guild messages are never from PartialGroupDMChannel (already checked message.guild)
    const warnMsg = await (message.channel as TextChannel).send({ embeds: [warnEmbed] }).catch(() => null);
    if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 8000);

    // ── Action: apply timeout if threshold reached ────────────────────────────
    if (timedOut && message.member?.moderatable) {
      await message.member
        .timeout(TIMEOUT_MS, `Automod: exceeded warning threshold (${violation})`)
        .catch(() => {});
      db.resetWarnings(userId, guildId);
    }

    // ── Action: log to mod channel ────────────────────────────────────────────
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
            {
              name: "Action",
              value: timedOut ? "10-minute timeout applied" : "Warning issued, message deleted",
              inline: true,
            }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
  },
} satisfies Event;
