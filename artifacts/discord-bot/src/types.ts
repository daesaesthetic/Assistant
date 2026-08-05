import { ChatInputCommandInteraction, Client, Collection } from "discord.js";

export interface CommandData {
  name: string;
  toJSON(): object;
}

export interface Command {
  data: CommandData;
  cooldown?: number; // seconds
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ExtendedClient extends Client {
  commands: Collection<string, Command>;
}

export interface Event {
  name: string;
  once?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (...args: any[]) => Promise<void> | void;
}
