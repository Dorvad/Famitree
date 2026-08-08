import type { IncomingMessage, ServerResponse } from 'node:http';

import { app } from '../server/src/app.js';

/**
 * Vercel's entry point.
 *
 * Imports the TypeScript source rather than `server/dist/app.js` on purpose.
 * The bundled file is produced by the build command, and relying on it here
 * would make the deploy depend on the platform bundling functions strictly
 * after that command has run — an ordering that is easy to assume and hard to
 * verify. The source is simply in the repository, always.
 *
 * An Express app is already `(req, res) => void`, so this could be a re-export.
 * But `export { app as default } from …` is the one form module interop
 * disagrees about — it resolves to a namespace *object* under some loaders,
 * which a platform expecting a function will refuse. An explicit function is
 * unambiguous everywhere, and it is one line.
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
