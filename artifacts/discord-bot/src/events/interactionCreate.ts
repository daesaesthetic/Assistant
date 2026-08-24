import { Events, Interaction } from "discord.js";
import { checkCooldown, setCooldown } from "../utils/cooldown.js";
import { createErrorEmbed } from "../utils/embeds.js";
import {
  getAiUserFacingMessage,
  getSafeAiErrorLogContext,
} from "../utils/ai-errors.js";
import type { Event, ExtendedClient } from "../types.js";

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;

    const client = interaction.client as ExtendedClient;
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            "That command doesn't exist or hasn't been registered.",
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    // Cooldown check
    if (command.cooldown) {
      const remaining = checkCooldown(
        interaction.user.id,
        interaction.commandName,
        command.cooldown,
      );
      if (remaining > 0) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              `This command is on cooldown. Try again in **${remaining.toFixed(1)}s**.`,
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      setCooldown(interaction.user.id, interaction.commandName);
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(
        `[Assistant ₯] Error in /${interaction.commandName}`,
        getSafeAiErrorLogContext(`/${interaction.commandName}`, err),
      );
      const errorEmbed = createErrorEmbed(getAiUserFacingMessage(err));
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {
          console.error("[interactionCreate]", {
            operation: "discord_delivery",
            category: "delivery",
          });
        });
      } else {
        await interaction
          .reply({ embeds: [errorEmbed], ephemeral: true })
          .catch(() => {
            console.error("[interactionCreate]", {
              operation: "discord_delivery",
              category: "delivery",
            });
          });
      }
    }
  },
} satisfies Event;
