import type { IncomingMessage, ServerResponse } from 'node:http';

import { app } from './app.js';

/**
 * The request handler every file under `api/` re-exports.
 *
 * An Express app is already `(req, res) => void`, so each entry could be a
 * re-export of `app` itself — but `export { app as default } from …` is the one
 * form module interop disagrees about, resolving to a namespace *object* under
 * some loaders, which a platform expecting a function will refuse. Wrapping it
 * once, here, keeps every entry file to two unambiguous lines.
 *
 * `server/src/app.ts` builds the app and binds nothing. `server/src/index.ts`,
 * which calls `app.listen`, is never imported from here — it would hang.
 */
export function handler(req: IncomingMessage, res: ServerResponse): void {
  // Belt and braces. The routers are mounted under /api, so if the platform
  // ever hands over the remainder of the path instead of the whole of it,
  // Express would look for `/tree` and find nothing. Cheap to make certain.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  app(req, res);
}
