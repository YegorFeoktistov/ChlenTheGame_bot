import type Database from 'better-sqlite3';

export interface Migration {
  name: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [
  {
    name: '001_initial_schema',
    up: (db) => {
      db.exec(`
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

        CREATE TABLE IF NOT EXISTS chat_longest_sessions (
          chat_id TEXT PRIMARY KEY,
          messages_count INTEGER,
          winner_id TEXT,
          winner_display_name TEXT,
          ended_at TEXT
        );
      `);
    },
  },
  {
    name: '002_add_queue_mode_and_queue_tables',
    up: (db) => {
      // Safely add queue_mode column to existing chats table if missing
      const columns = db.pragma('table_info(chats)') as { name: string }[];
      const hasQueueMode = columns.some((c) => c.name === 'queue_mode');
      if (!hasQueueMode) {
        db.exec('ALTER TABLE chats ADD COLUMN queue_mode INTEGER DEFAULT 1;');
      }

      db.exec(`
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

        CREATE TABLE IF NOT EXISTS chat_queue_players (
          chat_id TEXT,
          user_id TEXT,
          turn_order INTEGER,
          skip_count INTEGER DEFAULT 0,
          is_excluded INTEGER DEFAULT 0,
          last_turn_at INTEGER,
          PRIMARY KEY (chat_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_chat_queue_players_chat_lastturn ON chat_queue_players(chat_id, last_turn_at);
        CREATE INDEX IF NOT EXISTS idx_chat_queue_players_chat_excluded ON chat_queue_players(chat_id, is_excluded);
      `);
    },
  },
  {
    name: '003_add_current_turn_started_at_to_sessions',
    up: (db) => {
      const columns = db.pragma('table_info(chat_game_sessions)') as { name: string }[];
      const hasCol = columns.some((c) => c.name === 'current_turn_started_at');
      if (!hasCol) {
        db.exec('ALTER TABLE chat_game_sessions ADD COLUMN current_turn_started_at INTEGER;');
      }
    },
  },
];

/**
 * Universal Database Migration Runner.
 * Tracks applied migrations in schema_migrations table and executes new migrations inside transactions.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[];
  const appliedNames = new Set(appliedRows.map((r) => r.name));

  for (const migration of migrations) {
    if (!appliedNames.has(migration.name)) {
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
          migration.name,
          Math.floor(Date.now() / 1000)
        );
        console.log(`[DB Migration] Applied migration: ${migration.name}`);
      })();
    }
  }
}
