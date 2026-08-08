import type { IncomingMessage, ServerResponse } from 'node:http';

import { app } from '../server/dist/app.js';

/**
 * Vercel's entry point.
 *
 * An Express app is already `(req, res) => void`, so this could be a re-export
 * — but `export { app as default } from …` is the one form that module interop
 * disagrees about, and it resolves to a namespace *object* under some loaders,
 * which a platform expecting a function will simply refuse. An explicit
 * function is unambiguous under every scheme, and it is one line.
 *
 * `server/src/app.ts` builds the app and binds nothing. `server/src/index.ts`,
 * which calls `app.listen`, is never imported here — it would hang.
 *
 * Static assets never reach this function: vercel.json sends /api/* here and
 * everything else to the built client.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  app(req, res);
}
