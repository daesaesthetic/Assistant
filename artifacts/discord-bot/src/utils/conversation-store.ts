import { db } from "../database/index.js";

export interface ConversationContext {
  userId: string;
  guildId: string;
  /**
   * Reserved for a future channel/session scope. Phase 1.1 intentionally
   * isolates by user and guild only.
   */
  sessionId?: string;
}

export const conversationStore = {
  getHistory(context: ConversationContext) {
    return db.getConversation(context.userId, context.guildId);
  },

  async setHistory(context: ConversationContext, messages: Parameters<typeof db.setConversation>[2]) {
    await db.setConversation(context.userId, context.guildId, messages);
  },

  async reset(context: ConversationContext) {
    await db.clearConversation(context.userId, context.guildId);
  },
};