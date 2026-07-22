import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';
import { runMigrations } from './migrations.js';

dotenv.config();

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'chlenbot.db');
export const sqlite = new Database(dbPath);

sqlite.pragma('journal_mode = WAL');

// Execute universal database migration runner on startup
runMigrations(sqlite);
