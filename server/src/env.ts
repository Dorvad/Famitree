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

const sessionSecret = process.env.SESSION_SECRET?.trim() ?? '';
if (isProduction && sessionSecret.length < 32) {
  throw new Error(
    'SESSION_SECRET must be set to at least 32 characters in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
  );
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Point it at a Postgres database — a managed one in ' +
      'production (use the provider\'s *pooled* connection string), or a local ' +
      'server for development. See .env.example.',
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
  throw new Error(`STORAGE_DRIVER must be "disk" or "blob", got "${storageDriver}"`);
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
  databaseUrl,
  storageDriver,
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

export const inviteRequired = env.inviteCode.length > 0;
