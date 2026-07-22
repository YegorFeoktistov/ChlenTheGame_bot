import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, migrations } from '../src/adapters/migrations.js';

describe('Database Migration Runner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('applies all pending migrations on empty database', () => {
    runMigrations(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('chats');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('chat_queue_players');
    expect(tableNames).toContain('chat_warned_users');

    const columns = db.pragma('table_info(chats)') as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('queue_mode');
  });

  it('runs new migrations on existing database without re-running old ones', () => {
    // Run initial migration
    runMigrations(db);

    const initialApplied = db.prepare('SELECT name FROM schema_migrations').all() as {
      name: string;
    }[];
    expect(initialApplied.length).toBe(migrations.length);

    // Run migrations again -> should not throw and should be idempotent
    expect(() => runMigrations(db)).not.toThrow();

    const secondApplied = db.prepare('SELECT name FROM schema_migrations').all() as {
      name: string;
    }[];
    expect(secondApplied.length).toBe(migrations.length);
  });
});
