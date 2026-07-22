// src/adapters/sqlite.ts
import Database from "better-sqlite3";
import path from "path";
import dotenv from "dotenv";
dotenv.config();
var dbPath = process.env.DB_PATH || path.join(process.cwd(), "chlenbot.db");
var sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS chat_user_stats (
    chat_id TEXT,
    user_id TEXT,
    wins INTEGER DEFAULT 0,
    display_name TEXT,
    class_index INTEGER,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_subscribers (
    chat_id TEXT,
    user_id TEXT,
    username TEXT,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_game_sessions (
    chat_id TEXT PRIMARY KEY,
    is_active INTEGER DEFAULT 0,
    last_user_id TEXT,
    session_messages_count INTEGER DEFAULT 0,
    session_ended_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS chat_warned_users (
    chat_id TEXT,
    user_id TEXT,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_skill_users (
    chat_id TEXT,
    user_id TEXT,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_longest_sessions (
    chat_id TEXT PRIMARY KEY,
    messages_count INTEGER,
    winner_id TEXT,
    winner_display_name TEXT,
    ended_at TEXT
  );
`);

// src/adapters/db.ts
import dotenv2 from "dotenv";
dotenv2.config();
var BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
function table(name, columns, extra) {
  const tableObj = { name, columns, ...columns };
  if (extra) {
    extra(columns);
  }
  return tableObj;
}
function integer(name, options) {
  const colObj = {
    name,
    type: "INTEGER",
    options,
    defaultVal: void 0,
    default(val) {
      colObj.defaultVal = val;
      return colObj;
    }
  };
  return colObj;
}
function text(name) {
  const colObj = {
    name,
    type: "TEXT",
    defaultVal: void 0,
    default(val) {
      colObj.defaultVal = val;
      return colObj;
    },
    primaryKey() {
      return { name, type: "TEXT", isPk: true };
    }
  };
  return colObj;
}
function primaryKey(...cols) {
  return { pk: cols };
}

// src/schema.ts
var chats = table("chats", {
  id: text("id").primaryKey(),
  // Telegram chat ID as string
  title: text("title"),
  createdAt: integer("created_at", { mode: "timestamp" })
});
var users = table("users", {
  id: text("id").primaryKey(),
  // Telegram user ID as string
  firstName: text("first_name"),
  lastName: text("last_name"),
  username: text("username"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
});
var chatUserStats = table(
  "chat_user_stats",
  {
    chatId: text("chat_id"),
    userId: text("user_id"),
    wins: integer("wins").default(0),
    displayName: text("display_name"),
    classIndex: integer("class_index")
    // 1-5 (nullable)
  },
  (t) => ({
    pk: primaryKey(t.chatId, t.userId)
  })
);
var chatSubscribers = table(
  "chat_subscribers",
  {
    chatId: text("chat_id"),
    userId: text("user_id"),
    username: text("username")
    // Telegram @username handle
  },
  (t) => ({
    pk: primaryKey(t.chatId, t.userId)
  })
);
var chatGameSessions = table("chat_game_sessions", {
  chatId: text("chat_id").primaryKey(),
  isActive: integer("is_active").default(0),
  // 0 = false, 1 = true
  lastUserId: text("last_user_id"),
  sessionMessagesCount: integer("session_messages_count").default(0),
  sessionEndedAt: integer("session_ended_at")
  // Unix timestamp in seconds for 10s cooldown
});
var chatWarnedUsers = table(
  "chat_warned_users",
  {
    chatId: text("chat_id"),
    userId: text("user_id")
  },
  (t) => ({
    pk: primaryKey(t.chatId, t.userId)
  })
);
var chatSkillUsers = table(
  "chat_skill_users",
  {
    chatId: text("chat_id"),
    userId: text("user_id")
  },
  (t) => ({
    pk: primaryKey(t.chatId, t.userId)
  })
);
var chatLongestSessions = table("chat_longest_sessions", {
  chatId: text("chat_id").primaryKey(),
  messagesCount: integer("messages_count"),
  winnerId: text("winner_id"),
  winnerDisplayName: text("winner_display_name"),
  endedAt: text("ended_at")
  // Formatted timestamp (e.g. "17.07.2026 11:13")
});
export {
  chatGameSessions,
  chatLongestSessions,
  chatSkillUsers,
  chatSubscribers,
  chatUserStats,
  chatWarnedUsers,
  chats,
  users
};
