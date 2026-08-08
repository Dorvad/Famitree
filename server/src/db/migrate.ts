/**
 * Applies the schema and loads the sample family, then exits.
 *
 * The server does this for itself on first use, so this script is for the times
 * you want it to happen on your terms — before a deploy goes live, or against a
 * database you are setting up by hand. Running it is never required.
 *
 *   npm run db:migrate
 */
import { closePool, ensureReady } from './index.js';

await ensureReady();
console.log('schema applied, sample family loaded if the database was empty.');
await closePool();
