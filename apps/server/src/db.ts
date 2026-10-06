/* Banco SQLite (better-sqlite3) com WAL, chaves estrangeiras e migrações numeradas
 * (docs/ARQUITETURA.md 5.2). A versão do esquema fica em PRAGMA user_version: cada migração
 * roda uma vez, em ordem, dentro de uma transação. Nunca altere uma migração já publicada:
 * acrescente a próxima. */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

export type DB = Database.Database;
export type Role = 'admin' | 'member' | 'viewer';

export interface UserRow {
  id: string; name: string; email: string; pass_hash: string; role: Role;
  disabled: number; token_version: number; created_at: string;
}
export interface InviteRow {
  code: string; role: Role; created_by: string | null; created_at: string; expires_at: string;
  used_by: string | null; used_at: string | null;
}
export interface SessionRow {
  id: string; name: string; file_name: string; kind: 'FT' | 'BUSMASTER'; size: number; sha256: string;
  uploaded_by: string | null; created_at: string; date: string | null; track_id: string | null; car_id: string | null;
  driver: string | null; tags: string; notes: string | null; summary: string | null; summary_version: number | null;
  summary_error: string | null;
}
export interface ProfileRow { id: string; name: string; params: string; created_by: string | null; updated_at: string }
export interface CommentRow { id: string; session_id: string; user_id: string | null; t: number | null; text: string; created_at: string }

/* migrações: índice + 1 = user_version depois de aplicar */
const MIGRATIONS: string[] = [
  /* 1: esquema inicial */
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    disabled INTEGER NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at TEXT
  );
  CREATE TABLE cars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    date TEXT,
    track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
    car_id TEXT REFERENCES cars(id) ON DELETE SET NULL,
    driver TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    summary TEXT,
    summary_version INTEGER,
    summary_error TEXT
  );
  CREATE INDEX sessions_sha256 ON sessions(sha256);
  CREATE INDEX sessions_date ON sessions(date);
  CREATE INDEX sessions_track ON sessions(track_id);
  CREATE INDEX sessions_car ON sessions(car_id);
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    t REAL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX comments_session ON comments(session_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Abre (ou cria) DATA_DIR/db.sqlite e aplica as migrações que faltam. */
export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'db.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    throw new Error(`O banco é de uma versão mais nova do servidor (esquema ${current}, este servidor conhece até ${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Data/hora atual em ISO (UTC). */
export const nowIso = (): string => new Date().toISOString();

/** Id novo (16 caracteres base64url). */
export const newId = (): string => randomBytes(12).toString('base64url');
