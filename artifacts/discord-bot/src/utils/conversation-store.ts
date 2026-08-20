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

  setHistory(context: ConversationContext, messages: Parameters<typeof db.setConversation>[2]) {
    db.setConversation(context.userId, context.guildId, messages);
  },

  reset(context: ConversationContext) {
    db.clearConversation(context.userId, context.guildId);
  },
};