import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds.js";
import { db } from "../database/index.js";
import type { Command } from "../types.js";

const MAX_TRAITS = 10;
const MAX_TRAIT_LENGTH = 32;

export default {
  data: new SlashCommandBuilder()
    .setName("traits")
    .setDescription("Add or remove personality traits that shape how the bot responds to you")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a trait (e.g. flirty, sarcastic, blunt, encouraging)")
        .addStringOption((opt) =>
          opt
            .setName("trait")
            .setDescription("The trait to add")
            .setRequired(true)
            .setMaxLength(MAX_TRAIT_LENGTH)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a trait you previously added")
        .addStringOption((opt) =>
          opt
            .setName("trait")
            .setDescription("The trait to remove (must match exactly)")
            .setRequired(true)
            .setMaxLength(MAX_TRAIT_LENGTH)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("See all traits currently applied to you")
    )
    .addSubcommand((sub) =>
      sub.setName("clear").setDescription("Remove all traits at once")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? "dm";
    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const trait = interaction.options.getString("trait", true).toLowerCase().trim();
      const current = db.getTraits(userId, guildId);

      if (current.includes(trait)) {
        await interaction.reply({
          embeds: [createErrorEmbed(`**${trait}** is already in your trait list.`)],
          ephemeral: true,
        });
        return;
      }

      if (current.length >= MAX_TRAITS) {
        await interaction.reply({
          embeds: [createErrorEmbed(`You've hit the limit of **${MAX_TRAITS} traits**. Remove one first with \`/traits remove\`.`)],
          ephemeral: true,
        });
        return;
      }

      db.addTrait(userId, guildId, trait);
      const updated = db.getTraits(userId, guildId);

      await interaction.reply({
        embeds: [
          createEmbed("Trait Added")
            .setDescription(`**${trait}** added to your personality.\nActive traits: ${updated.map((t) => `\`${t}\``).join(", ")}`)
            .setFooter({ text: "Traits apply to all conversations from now on." }),
        ],
      });
    }

    else if (sub === "remove") {
      const trait = interaction.options.getString("trait", true).toLowerCase().trim();
      const current = db.getTraits(userId, guildId);

      if (!current.includes(trait)) {
        await interaction.reply({
          embeds: [createErrorEmbed(`**${trait}** isn't in your trait list.\nCurrent traits: ${current.length ? current.map((t) => `\`${t}\``).join(", ") : "none"}`)],
          ephemeral: true,
        });
        return;
      }

      db.removeTrait(userId, guildId, trait);
      const updated = db.getTraits(userId, guildId);

      await interaction.reply({
        embeds: [
          createEmbed("Trait Removed")
            .setDescription(
              updated.length
                ? `**${trait}** removed.\nRemaining traits: ${updated.map((t) => `\`${t}\``).join(", ")}`
                : `**${trait}** removed. No traits active.`
            ),
        ],
      });
    }

    else if (sub === "list") {
      const traits = db.getTraits(userId, guildId);
      await interaction.reply({
        embeds: [
          traits.length
            ? createEmbed("Your Traits", traits.map((t, i) => `**${i + 1}.** ${t}`).join("\n"))
                .setFooter({ text: `${traits.length}/${MAX_TRAITS} traits · Use /traits remove to remove one` })
            : createEmbed("Your Traits").setDescription(
                "No traits set.\nAdd one with `/traits add <trait>` — e.g. `sarcastic`, `encouraging`, `blunt`."
              ),
        ],
        ephemeral: true,
      });
    }

    else if (sub === "clear") {
      const current = db.getTraits(userId, guildId);
      if (!current.length) {
        await interaction.reply({
          embeds: [createErrorEmbed("You have no traits to clear.")],
          ephemeral: true,
        });
        return;
      }
      db.clearTraits(userId, guildId);
      await interaction.reply({
        embeds: [
          createEmbed("Traits Cleared").setDescription(
            `Removed **${current.length}** trait${current.length !== 1 ? "s" : ""}. The bot will respond in its default style.`
          ),
        ],
      });
    }
  },
} satisfies Command;
