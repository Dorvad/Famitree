import type { IncomingMessage, ServerResponse } from 'node:http';

import { app } from '../server/src/app.js';

/**
 * Vercel's entry point: every request under /api/ arrives here.
 *
 * The filename is a catch-all on purpose. `api/index.ts` only answers the exact
 * path `/api`, so reaching `/api/tree` needed a rewrite — and a rewrite
 * *replaces* the path, handing the function `/api` and losing the part that
 * says which endpoint was wanted. Every route 404s, and because the platform's
 * own 404 is an HTML page rather than the API's JSON, the client falls back to
 * "הבקשה נכשלה" and says nothing useful. A catch-all is matched by the
 * filesystem, needs no rewrite, and keeps the original URL intact.
 *
 * An Express app is already `(req, res) => void`, so this could be a
 * re-export — but `export { app as default } from …` is the one form module
 * interop disagrees about, resolving to a namespace *object* under some
 * loaders, which a platform expecting a function will refuse.
 *
 * `server/src/app.ts` builds the app and binds nothing. `server/src/index.ts`,
 * which calls `app.listen`, is never imported here — it would hang.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  // Belt and braces. The routers are mounted under /api, so if the platform
  // ever hands over the remainder of the path instead of the whole of it,
  // Express would look for `/tree` and find nothing. Cheap to make certain.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  app(req, res);
}
