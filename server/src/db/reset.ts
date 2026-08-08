/**
 * Drops every table and rebuilds from schema + seed.
 *
 * Destructive by design, so it refuses to run in production and asks for
 * `--yes` everywhere else. Uploaded originals are left alone: the point is to
 * reset structure, not to shred the photographs.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../env.ts';
import { applySchema, closePool, exec } from './index.ts';
import { seedIfEmpty } from './seed.ts';

if (env.isProduction) {
  console.error('Refusing to reset the database with NODE_ENV=production.');
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  console.error(
    [
      'This deletes every person, memory and archive entry in:',
      `  ${env.databaseUrl.replace(/:\/\/[^@]*@/, '://***@')}`,
      '',
      'Uploaded files are NOT touched.',
      'Re-run with --yes if that is what you want.',
    ].join('\n'),
  );
  process.exit(1);
}

// Order matters only because of the foreign keys; CASCADE handles the rest.
await exec(`
  DROP TABLE IF EXISTS
    meta, users, timeline_events, archive_items, milestones,
    relationships, people, media, generations
  CASCADE
`);
console.log('tables dropped.');

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = [path.join(here, 'schema.sql'), path.join(here, 'db', 'schema.sql')].find(
  (candidate) => existsSync(candidate),
);
if (!schema) throw new Error('schema.sql not found next to the reset script.');

await applySchema(readFileSync(schema, 'utf8'));
const { seeded } = await seedIfEmpty();
console.log(seeded ? 'database rebuilt and seeded.' : 'database rebuilt (nothing to seed).');

await closePool();
