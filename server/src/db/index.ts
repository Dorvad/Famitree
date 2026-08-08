import pg from 'pg';

import { env } from '../env.ts';
import { SCHEMA } from './schema.ts';

/**
 * Postgres connection and the thin query layer everything above it uses.
 *
 * The archive used to run on SQLite, which is a fine fit for a single machine
 * with a disk and no fit at all for a platform where the filesystem does not
 * survive a restart. The schema moved across almost untouched — it was already
 * plain portable SQL — so what changed here is the shape of the calls: every
 * read and write is asynchronous now, and parameters are bound rather than
 * interpolated.
 */

/**
 * `pg` hands back a bare number for int4 but a *string* for int8, because a
 * bigint does not fit a JS number. `COUNT(*)` is int8, so an unguarded count
 * comes back as "0" and every `count === 0` test silently fails. Rather than
 * remember that at each call site, the counts in this codebase are cast to int
 * in SQL — see `COUNT(*)::int`.
 */
const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  // Serverless runs many short-lived instances, each with its own pool, so a
  // generous per-instance pool is how a connection limit gets exhausted. The
  // provider's pooled (PgBouncer) connection string does the real multiplexing.
  max: env.isProduction ? 3 : 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  // An idle client dropped by the server is normal on managed Postgres; it must
  // not take the process down.
  console.error('[shoresh] idle postgres client error:', error.message);
});

export interface Queryable {
  run<T extends object = Record<string, unknown>>(
    sql: string,
    params?: Params,
  ): Promise<T[]>;
}

export type Params = Record<string, unknown>;

/** `@name`, but not `@>` or a bare `@`. */
const NAMED = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Binds `@name` placeholders to `$1`-style positional parameters.
 *
 * `pg` only speaks positional, and converting several dozen statements — one of
 * which sets eighteen columns — to hand-counted `$n` is exactly the kind of
 * edit where a transposed pair goes unnoticed because the parameter *count*
 * still matches. Names cannot be transposed. A name with no matching parameter
 * throws here rather than binding null, and a name used twice reuses its
 * position instead of passing the value twice.
 */
export function bind(sql: string, params: Params = {}): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const positions = new Map<string, number>();

  const text = sql.replace(NAMED, (_match, name: string) => {
    let position = positions.get(name);
    if (position === undefined) {
      if (!(name in params)) {
        throw new Error(`missing bind parameter @${name} for: ${sql.trim().slice(0, 90)}…`);
      }
      values.push(params[name] ?? null);
      position = values.length;
      positions.set(name, position);
    }
    return `$${position}`;
  });

  return { text, values };
}

/** Every row the statement returned. */
export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params?: Params,
): Promise<T[]> {
  const { text, values } = bind(sql, params);
  const result = await pool.query(text, values);
  return result.rows as T[];
}

/** The first row, or null. */
export async function one<T extends object = Record<string, unknown>>(
  sql: string,
  params?: Params,
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Runs a statement for its effect, returning how many rows it touched. */
export async function exec(sql: string, params?: Params): Promise<number> {
  const { text, values } = bind(sql, params);
  const result = await pool.query(text, values);
  return result.rowCount ?? 0;
}

/**
 * Runs everything inside one transaction on one dedicated connection.
 *
 * The callback is handed its own `run`, and must use it — a statement issued
 * through the module-level `query` during a transaction goes out on a different
 * pooled connection and is therefore *not* part of it.
 */
export async function transact<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      run: async <R extends object>(sql: string, params?: Params) => {
        const { text, values } = bind(sql, params);
        const query = await client.query(text, values);
        return query.rows as R[];
      },
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Applies the schema. Safe to run repeatedly — every statement is IF NOT EXISTS. */
export async function applySchema(sql: string = SCHEMA): Promise<void> {
  await pool.query(sql);
}

/**
 * Arbitrary but fixed: any two processes using the same number contend, and
 * nothing else in this database takes advisory locks.
 */
const MIGRATION_LOCK = 8_140_231;

/** Resolves once this process has a database with tables and a family in it. */
let ready: Promise<void> | null = null;

/**
 * Brings the database up to date, at most once per process and once at a time
 * across every process.
 *
 * This started life as a step you ran by hand, precisely so that several
 * instances starting at once could not each decide the database was empty and
 * seed it. That avoided the race rather than solving it, and it assumed a
 * terminal — which is a poor assumption for someone deploying from a tablet.
 *
 * A Postgres advisory lock solves it properly: the first process through does
 * the work while the others wait, and by the time they get the lock the seed
 * has recorded its version and they do nothing. The lock lives in the database,
 * so it holds across processes, machines and cold starts alike.
 */
export function ensureReady(): Promise<void> {
  ready ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await client.query(SCHEMA);
      // Imported here rather than at the top: seed.ts imports this module, and
      // a static cycle would leave one of them half-initialised.
      const { seedIfEmpty } = await import('./seed.ts');
      await seedIfEmpty();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
      client.release();
    }
  })().catch((error: unknown) => {
    // Leave no memoised rejection behind: a database that was briefly
    // unreachable should not take this instance down until it is recycled.
    ready = null;
    throw error;
  });

  return ready;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await one<{ value: string }>('SELECT value FROM meta WHERE key = @key', { key });
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await exec(
    `INSERT INTO meta (key, value) VALUES (@key, @value)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    { key, value },
  );
}
