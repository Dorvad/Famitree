import { handler } from '../server/src/vercel.js';

/**
 * `/api/…` — the whole API, however deep the path goes.
 *
 * This ought to be the only file in this directory, and on paper it is enough:
 * a catch-all is matched by the filesystem, needs no rewrite, and hands the
 * function the original URL. In this project's deployment it was observed to
 * match only a *single* segment — `/api/tree` reached the app while
 * `/api/auth/session` came back as the platform's own HTML 404, which the
 * client could only read as "the request failed". The sibling files
 * (`[a].ts`, `[b]/[c].ts`, …) spell out the depths the API actually uses so
 * that routing does not depend on that behaviour. They all land here.
 *
 * Keep this file: if the catch-all is honoured it covers any depth added
 * later; if it is not, the explicit files already do.
 */
export default handler;
