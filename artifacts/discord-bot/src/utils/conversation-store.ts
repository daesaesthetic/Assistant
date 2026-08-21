import { db } from "../database/index.js";
import { KeyedAsyncQueue } from "./conversation-lock.js";

export interface ConversationContext {
  userId: string;
  guildId: string;
  /**
   * Reserved for a future channel/session scope. Phase 1.1 intentionally
   * isolates by user and guild only.
   */
  sessionId?: string;
}

export function getConversationKey(context: ConversationContext): string {
  return `${context.userId}:${context.guildId}`;
}

export const conversationQueue = new KeyedAsyncQueue();

export const conversationStore = {
  getHistory(context: ConversationContext) {
    return db.getConversation(context.userId, context.guildId);
  },

  async setHistory(
    context: ConversationContext,
    messages: Parameters<typeof db.setConversation>[2],
  ) {
    await db.setConversation(context.userId, context.guildId, messages);
  },

  async reset(context: ConversationContext) {
    await db.clearConversation(context.userId, context.guildId);
  },

  runExclusive<T>(context: ConversationContext, task: () => T | Promise<T>) {
    return conversationQueue.run(getConversationKey(context), task);
  },
};
