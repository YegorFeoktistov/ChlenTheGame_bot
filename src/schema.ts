import { table, integer, text, primaryKey } from 'sdk/db';
import type { TableColumns } from './types/sdk.d.js';

// 1. Registered Telegram Chats
export const chats = table('chats', {
  id: text('id').primaryKey(), // Telegram chat ID as string
  title: text('title'),
  queueMode: integer('queue_mode').default(1), // 1 = Strict (default), 0 = Non-strict
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// 2. Registered Telegram Users
export const users = table('users', {
  id: text('id').primaryKey(), // Telegram user ID as string
  firstName: text('first_name'),
  lastName: text('last_name'),
  username: text('username'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// 3. User Statistics & Classes Per Chat (Multi-Chat Isolation)
export const chatUserStats = table(
  'chat_user_stats',
  {
    chatId: text('chat_id'),
    userId: text('user_id'),
    wins: integer('wins').default(0),
    displayName: text('display_name'),
    classIndex: integer('class_index'), // 1-5 (nullable)
  },
  (t: TableColumns) => ({
    pk: primaryKey(t.chatId, t.userId),
  })
);

// 4. Chat Subscribers for Start Notifications
export const chatSubscribers = table(
  'chat_subscribers',
  {
    chatId: text('chat_id'),
    userId: text('user_id'),
    username: text('username'), // Telegram @username handle
  },
  (t: TableColumns) => ({
    pk: primaryKey(t.chatId, t.userId),
  })
);

// 5. Current Game Session State Per Chat
export const chatGameSessions = table('chat_game_sessions', {
  chatId: text('chat_id').primaryKey(),
  isActive: integer('is_active').default(0), // 0 = false, 1 = true
  lastUserId: text('last_user_id'),
  sessionMessagesCount: integer('session_messages_count').default(0),
  sessionEndedAt: integer('session_ended_at'), // Unix timestamp in seconds for 10s cooldown
  currentTurnStartedAt: integer('current_turn_started_at'),
});

// 6. Anti-Spam Warned Users Per Active Session (1NF/3NF Relational Table)
export const chatWarnedUsers = table(
  'chat_warned_users',
  {
    chatId: text('chat_id'),
    userId: text('user_id'),
  },
  (t: TableColumns) => ({
    pk: primaryKey(t.chatId, t.userId),
  })
);

// 7. Users Who Used Skill In Active Session (1NF/3NF Relational Table)
export const chatSkillUsers = table(
  'chat_skill_users',
  {
    chatId: text('chat_id'),
    userId: text('user_id'),
  },
  (t: TableColumns) => ({
    pk: primaryKey(t.chatId, t.userId),
  })
);

// 8. Strict Queue Players Per Active Session (1NF/3NF Relational Table)
export const chatQueuePlayers = table(
  'chat_queue_players',
  {
    chatId: text('chat_id'),
    userId: text('user_id'),
    turnOrder: integer('turn_order'), // 1, 2, 3...
    skipCount: integer('skip_count').default(0),
    isExcluded: integer('is_excluded').default(0), // 0 = active, 1 = Order 69 excluded
    lastTurnAt: integer('last_turn_at'), // Unix timestamp
  },
  (t: TableColumns) => ({
    pk: primaryKey(t.chatId, t.userId),
  })
);

// 9. Status Effects Per Active Session (1NF/3NF Relational Table)
export const chatStatusEffectUsers = table(
  'chat_status_effect_users',
  {
    chatId: text('chat_id'),
    userId: text('user_id'),
    statusEffectId: text('status_effect_id'),
    count: integer('count').default(1),
  },
  (t: TableColumns) => ({
    pk: primaryKey(t.chatId, t.userId, t.statusEffectId),
  })
);

// 10. Longest Game Session Records Per Chat
export const chatLongestSessions = table('chat_longest_sessions', {
  chatId: text('chat_id').primaryKey(),
  messagesCount: integer('messages_count'),
  winnerId: text('winner_id'),
  winnerDisplayName: text('winner_display_name'),
  endedAt: text('ended_at'), // Formatted timestamp (e.g. "17.07.2026 11:13")
});
