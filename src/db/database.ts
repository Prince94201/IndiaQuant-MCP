import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

// Ensure data directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export let db: Database<sqlite3.Database, sqlite3.Statement>;

export async function initDb() {
    db = await open({
        filename: config.dbPath,
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA journal_mode = WAL');

    // Migrations
    await db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        symbol TEXT PRIMARY KEY,
        quantity INTEGER NOT NULL,
        avgPrice REAL NOT NULL,
        side TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cashBalance REAL NOT NULL
      );
    `);

    // Initialize account balance if empty
    const accountRow = await db.get('SELECT cashBalance FROM account WHERE id = 1');
    if (!accountRow) {
        await db.run('INSERT INTO account (id, cashBalance) VALUES (1, ?)', config.defaultVirtualCash);
    }
}
