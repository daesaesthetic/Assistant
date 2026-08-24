import { Client, Events, ActivityType } from "discord.js";
import type { Event } from "../types.js";

export default {
  name: Events.ClientReady,
  once: true,
  execute(client: Client) {
    console.log(`[Assistant ₯] Online as ${client.user?.tag}`);
    console.log(`[Assistant ₯] Serving ${client.guilds.cache.size} guild(s)`);

    client.user?.setPresence({
      activities: [
        { name: "the silence between thoughts", type: ActivityType.Listening },
      ],
      status: "idle",
    });
  },
} satisfies Event;
