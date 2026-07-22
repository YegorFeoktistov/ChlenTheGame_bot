import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'chlenbot.db');
export const sqlite = new Database(dbPath);

sqlite.pragma('journal_mode = WAL');

// Initialize database schema tables
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
    session_ended_at INTEGER,
    warned_user_ids TEXT DEFAULT '[]',
    skill_user_ids TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS chat_longest_sessions (
    chat_id TEXT PRIMARY KEY,
    messages_count INTEGER,
    winner_id TEXT,
    winner_display_name TEXT,
    ended_at TEXT
  );
`);
