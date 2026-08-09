import { handler } from '../server/src/vercel.js';

/**
 * `/api/tree`, `/api/people`, `/api/archive`, `/api/health`, … — and, through
 * the files nested beside this one, everything deeper.
 *
 * This ought to be a single catch-all. It cannot be: the `api` directory
 * convention has no catch-all. Vercel reads any `[name]` segment — `[...path]`
 * included, since the brackets are all it looks at — and compiles it to
 * `([^/]+)`, one segment. `api/[...path].ts` therefore served `/api/tree` and
 * left `/api/auth/session` to the platform's own HTML 404, which the client
 * could only report as "the request failed": it never reached the API to be
 * given a real message. The whole archive read as signed-out, because the
 * endpoint that says who you are is two segments deep.
 *
 * So each depth gets a file, and every dynamic segment at the same position
 * must carry the *same* name — `[a]` first, `[b]` second, and so on. Two files
 * that disagree about a position's name are rejected at build time as
 * conflicting paths, which is what a first attempt at this ran into.
 *
 * A route five segments deep needs `api/[a]/[b]/[c]/[d]/[e].ts` beside these.
 */
export default handler;
