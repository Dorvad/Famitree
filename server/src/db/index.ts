import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `src/db/index.ts` sits beside schema.sql; the esbuild bundle collapses to
 * `dist/index.js` with the schema copied to `dist/db/schema.sql`. Probing both
 * keeps dev and production on one code path.
 */
function findSchema(): string {
  const candidates = [
    path.join(here, 'schema.sql'),
    path.join(here, 'db', 'schema.sql'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`schema.sql not found. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

mkdirSync(env.dataDir, { recursive: true });
mkdirSync(env.uploadDir, { recursive: true });

export const db = new Database(env.dbFile);

// WAL lets reads proceed during writes, which matters as soon as more than one
// relative is browsing while somebody uploads. NORMAL synchronous is the
// standard companion setting: durable across process crashes, and only at risk
// from an OS-level crash mid-write.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(readFileSync(findSchema(), 'utf8'));

export function nowIso(): string {
  return new Date().toISOString();
}

/** Wraps a function so every statement inside runs in one transaction. */
export function transact<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
