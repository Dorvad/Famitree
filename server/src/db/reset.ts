/**
 * Drops the database file and rebuilds it from schema + seed.
 *
 * Destructive by design, so it refuses to run in production and asks for
 * `--yes` everywhere else. Anything already uploaded to data/uploads is left
 * alone: the point is to reset structure, not to shred originals.
 */
import { existsSync, rmSync } from 'node:fs';

import { env } from '../env.ts';

if (env.isProduction) {
  console.error('Refusing to reset the database with NODE_ENV=production.');
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  console.error(
    [
      'This deletes every person, memory and archive entry in:',
      `  ${env.dbFile}`,
      '',
      'Uploaded files in data/uploads are NOT touched.',
      'Re-run with --yes if that is what you want.',
    ].join('\n'),
  );
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  const file = `${env.dbFile}${suffix}`;
  if (existsSync(file)) {
    rmSync(file);
    console.log(`removed ${file}`);
  }
}

// Importing these after the delete recreates the file, applies the schema and
// reloads the sample family.
const { seedIfEmpty } = await import('./seed.ts');
const { seeded } = seedIfEmpty();
console.log(seeded ? 'database rebuilt and seeded.' : 'database rebuilt (nothing to seed).');
