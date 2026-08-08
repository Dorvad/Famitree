import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ensureReady } from './db/index.ts';
import { configProblems, env, inviteRequired } from './env.ts';
import { errorHandler, notFoundHandler } from './middleware/errors.ts';
import { attachUser } from './middleware/session.ts';
import { archiveRouter } from './routes/archive.ts';
import { authRouter } from './routes/auth.ts';
import { mediaRouter } from './routes/media.ts';
import { treeRouter } from './routes/tree.ts';

/**
 * Builds the Express app, and nothing else.
 *
 * Separate from the listener because the app is now mounted two ways: a long
 * running `node dist/index.js` that binds a port, and a serverless function
 * that is handed one request at a time and would hang forever on an
 * `app.listen`. Nothing here opens a socket, reads a schema or seeds — a
 * cold start has to be cheap and must never race another cold start.
 */
const app = express();

/**
 * With the blob driver, `GET /api/media/:id` checks the row and then redirects
 * to the object store — so the bytes arrive from a different origin than the
 * page, and `img-src 'self'` would block every photograph in the archive. The
 * host is added only when that driver is actually in use; the disk driver keeps
 * the tighter policy.
 */
const BLOB_HOST = 'https://*.public.blob.vercel-storage.com';
const mediaOrigins = env.storageDriver === 'blob' ? [BLOB_HOST] : [];

// Behind a reverse proxy the client IP arrives in X-Forwarded-For; the rate
// limiter needs it, and `secure` cookies need to know the request was HTTPS.
if (env.isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Fonts are self-hosted, so no third-party origin is needed here.
        // 'unsafe-inline' covers Vite's dev-time injected styles and the
        // inline custom properties the tree and archive set per element.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', ...mediaOrigins],
        mediaSrc: ["'self'", 'blob:', ...mediaOrigins],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", ...(env.isProduction ? [] : ['ws:', 'http://localhost:*'])],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // With the disk driver every byte is same-origin. With the blob driver the
    // page itself still is; the images come from the object store, which sets
    // its own policy, and 'cross-origin' here is what lets the page load them.
    crossOriginResourcePolicy: {
      policy: env.storageDriver === 'blob' ? 'cross-origin' : 'same-origin',
    },
  }),
);

/**
 * Same-origin in production, so this only opens up the Vite dev server. Origins
 * are matched against an explicit allow-list — the request's own Origin header
 * is never echoed back blindly.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser(env.sessionSecret));
app.use(attachUser);

// Broad backstop against runaway clients. Upload and join have tighter limits
// of their own.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: { code: 'rate_limited', message: 'יותר מדי בקשות. המתינו רגע.' },
    },
  }),
);

/**
 * Answers before anything can stop it — no database, no readiness check, no
 * configuration required. It is the one endpoint whose job is to explain why
 * the others are not working, so it must never be able to fail for the same
 * reason they are.
 */
app.get('/api/health', (_req, res) => {
  res.status(configProblems.length === 0 ? 200 : 503).json({
    ok: configProblems.length === 0,
    inviteRequired,
    publicRead: env.publicRead,
    storage: env.storageDriver,
    database: env.databaseUrl ? 'configured' : 'missing',
    ...(configProblems.length > 0 && { problems: configProblems }),
  });
});

/** A misconfigured deployment serves nothing, and says exactly what is wrong. */
app.use('/api', (_req, res, next) => {
  if (configProblems.length === 0) {
    next();
    return;
  }
  res.status(503).json({
    error: {
      code: 'not_configured',
      message: 'השרת עדיין לא הוגדר במלואו. ' + configProblems.join(' '),
      details: { configuration: configProblems as string[] },
    },
  });
});

/**
 * Nothing reaches a route until the database has its tables and the sample
 * family. Memoised per process and serialised across processes by an advisory
 * lock, so this is one await on a resolved promise after the first request —
 * and there is no setup command to run from a machine you may not have.
 */
app.use('/api', (_req, _res, next) => {
  ensureReady().then(() => next(), next);
});

app.use('/api/auth', authRouter);
app.use('/api', treeRouter);
app.use('/api', archiveRouter);
app.use('/api', mediaRouter);

app.use('/api', notFoundHandler);

// In production the API also serves the built client. Assets are fingerprinted
// by Vite, so they can be cached hard; index.html must not be.
if (existsSync(env.clientDist)) {
  app.use(
    express.static(env.clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // SPA fallback. Written as path-less middleware rather than a wildcard route
  // because Express 5's router rejects a bare '*' pattern.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(env.clientDist, 'index.html'));
  });
}

app.use(errorHandler);

export { app };
