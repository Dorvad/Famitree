/**
 * Applies the schema and loads the sample family. Safe to run repeatedly.
 *
 * This used to happen at boot. That was fine when boot meant one process
 * opening one file; against a shared database it is a race — a platform is free
 * to start several instances at once, and two of them seeding concurrently
 * writes the family in twice. So it is a step you run: once when the database
 * is new, and again after any schema change.
 *
 *   npm run db:migrate -w server
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applySchema, closePool } from './index.ts';
import { seedIfEmpty } from './seed.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `src/db/migrate.ts` sits beside schema.sql, and the bundle keeps that shape:
 * `dist/db/migrate.js` with the schema copied to `dist/db/schema.sql`. Probing
 * both locations keeps development and production on one code path.
 */
function findSchema(): string {
  const candidates = [path.join(here, 'schema.sql'), path.join(here, 'db', 'schema.sql')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`schema.sql not found. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

await applySchema(readFileSync(findSchema(), 'utf8'));
console.log('schema applied.');

const { seeded } = await seedIfEmpty();
console.log(seeded ? 'sample family loaded.' : 'existing data kept — nothing seeded.');

await closePool();
