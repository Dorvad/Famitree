import { app } from './app.js';
import { env, inviteRequired } from './env.js';

/**
 * The long-running server: binds a port and serves the built client alongside
 * the API. On Vercel this file is not used at all — `api/index.ts` imports the
 * same app and lets the platform do the listening.
 *
 * The schema and the seed are deliberately *not* applied here. They used to run
 * at boot, which was free when boot happened once against a local file; against
 * a shared database, with a platform free to start several instances at once,
 * it is a race that writes the family in twice. `npm run db:migrate` owns that
 * now, and it is a step you run, not a side effect of starting up.
 */
app.listen(env.port, () => {
  console.log(`שורשים API  →  http://localhost:${env.port}`);
  console.log(`  database    ${describe(env.databaseUrl)}`);
  console.log(`  uploads     ${env.storageDriver === 'blob' ? 'Vercel Blob' : env.uploadDir}`);
  console.log(`  invite code ${inviteRequired ? 'required' : 'not required (open joining)'}`);
  console.log(`  public read ${env.publicRead ? 'on' : 'off (archive is private)'}`);
  if (!env.isProduction) console.log(`  client dev  http://localhost:5173`);
});

/** Host and database only — a connection string carries a password. */
function describe(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}
