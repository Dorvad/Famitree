import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root, from either `src/` (tsx) or `dist/` (bundled). */
const repoRoot = path.resolve(here, '..', '..');

/**
 * Minimal .env loader. Node 20.6+ ships `--env-file`, but relying on it would
 * force every entry point to pass the flag; reading the file here keeps
 * `npm start`, `tsx`, and the test scripts consistent. Real process env always
 * wins so container-injected values are never clobbered.
 */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(repoRoot, '.env'));

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

/**
 * Misconfiguration is collected, not thrown, and sorted by what it costs.
 *
 * Throwing here happens at *import*, which on a serverless platform means the
 * function dies before it can say anything — the visitor gets an unexplained
 * 500 and the operator gets to guess which variable is missing.
 *
 * `problems` stop the API: without a database there is nothing to serve, and
 * without a real session secret anything served would be served unsafely.
 * `warnings` cost one feature and nothing else. An archive that refuses to show
 * the family tree because *uploads* are unconfigured is worse than one that
 * shows it and says so when somebody tries to add a photograph.
 */
const problems: string[] = [];
const warnings: string[] = [];

const sessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
if (isProduction && sessionSecret.length < 32) {
  problems.push(
    `SESSION_SECRET is ${sessionSecret ? `only ${sessionSecret.length} characters` : 'not set'}; ` +
      'it must be at least 32 in production. Any long random string will do.',
  );
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
if (!databaseUrl) {
  problems.push(
    'DATABASE_URL is not set. Connect a Postgres database to the project — the ' +
      'integration sets this variable for you — then redeploy.',
  );
}

/**
 * Where uploads go. `blob` keeps them in Vercel Blob, which is what production
 * needs because a serverless filesystem does not survive the request that wrote
 * to it. `disk` is the local-development driver and needs no cloud account, so
 * `npm run dev` works on a fresh clone with nothing but Postgres.
 */
const storageDriver = (process.env.STORAGE_DRIVER ?? (isProduction ? 'blob' : 'disk')) as
  | 'disk'
  | 'blob';
if (storageDriver !== 'disk' && storageDriver !== 'blob') {
  problems.push(`STORAGE_DRIVER must be "disk" or "blob", not "${storageDriver}".`);
}
/**
 * The blob token, under whatever name it arrived.
 *
 * The client library reads exactly `BLOB_READ_WRITE_TOKEN` and nothing else,
 * but a store connected with a custom prefix sets something like
 * `ARCHIVE_BLOB_READ_WRITE_TOKEN` — which looks connected in every list you
 * can see, and is invisible to the library. Accepting any name that ends in
 * the standard one, and passing it explicitly, makes the two agree.
 */
const blobTokenEntry = Object.entries(process.env).find(
  ([key, value]) => key.endsWith('BLOB_READ_WRITE_TOKEN') && value?.trim(),
);
const blobToken = blobTokenEntry?.[1]?.trim() ?? '';
const blobTokenSource = blobTokenEntry?.[0] ?? null;

if (storageDriver === 'blob' && !blobToken) {
  warnings.push(
    'STORAGE_DRIVER is "blob" but no BLOB_READ_WRITE_TOKEN is set, so uploads ' +
      'will be refused. Connect a Blob store to the project and redeploy — the ' +
      'variable is baked into a deployment when it is built, so connecting a ' +
      'store does not change one that is already running. Everything else works.',
  );
}

/**
 * Who may use the archive.
 *
 *   open   — anyone who has the link can read and contribute. No joining, no
 *            code, no roles. The default, because an archive still being built
 *            should not cost its author a login to look at.
 *   invite — the full arrangement: INVITE_CODE gates joining, PUBLIC_READ gates
 *            reading, and the first account to join becomes the steward.
 *
 * `open` is a real decision and is reported by /api/health rather than assumed:
 * it means the URL is the only thing standing between a stranger and the
 * family's records. Nothing is deleted to get it — switching to `invite`
 * restores every check exactly as it was.
 */
const accessMode = (process.env.ACCESS ?? 'open').trim() as 'open' | 'invite';
if (accessMode !== 'open' && accessMode !== 'invite') {
  problems.push(`ACCESS must be "open" or "invite", not "${accessMode}".`);
}

const dataDir = path.resolve(
  path.join(repoRoot, 'server'),
  process.env.DATA_DIR ?? './data',
);

const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!isProduction && corsOrigins.length === 0) {
  corsOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
}

export const env = {
  nodeEnv,
  isProduction,
  port: int('PORT', 4000),
  sessionSecret: sessionSecret || 'insecure-development-secret',
  accessMode,
  isOpen: accessMode === 'open',
  databaseUrl,
  storageDriver,
  /** False when the blob driver is selected but has no token to use. */
  storageReady: storageDriver !== 'blob' || Boolean(blobToken),
  blobToken,
  /** Which variable supplied the token, so /api/health can say. */
  blobTokenSource,
  dataDir,
  /** Only used by the `disk` storage driver. */
  uploadDir: path.join(dataDir, 'uploads'),
  /** Empty string means joining is open to anyone who can reach the server. */
  inviteCode: process.env.INVITE_CODE?.trim() ?? '',
  publicRead: bool('PUBLIC_READ', true),
  corsOrigins,
  maxUploadBytes: int('MAX_UPLOAD_MB', 25) * 1024 * 1024,
  /** Directory holding the built client, served in production. */
  clientDist: path.join(repoRoot, 'client', 'dist'),
  repoRoot,
} as const;

/** Only ever true in invite mode; an open archive asks for nothing. */
export const inviteRequired = !env.isOpen && env.inviteCode.length > 0;

/**
 * Faults that stop the API. Empty means it is safe to serve; anything in it
 * means every route answers 503 and says why.
 */
export const configProblems: readonly string[] = problems;

/** Faults that cost one feature. Reported, but nothing is withheld for them. */
export const configWarnings: readonly string[] = warnings;
