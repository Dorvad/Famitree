import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { env, inviteRequired } from './env.ts';
import { seedIfEmpty } from './db/seed.ts';
import { errorHandler, notFoundHandler } from './middleware/errors.ts';
import { attachUser } from './middleware/session.ts';
import { archiveRouter } from './routes/archive.ts';
import { authRouter } from './routes/auth.ts';
import { mediaRouter } from './routes/media.ts';
import { treeRouter } from './routes/tree.ts';

const app = express();

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
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", ...(env.isProduction ? [] : ['ws:', 'http://localhost:*'])],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // Uploaded images are served from this origin and rendered in the page.
    crossOriginResourcePolicy: { policy: 'same-origin' },
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, inviteRequired, publicRead: env.publicRead });
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

const { seeded } = seedIfEmpty();

app.listen(env.port, () => {
  console.log(`שורשים API  →  http://localhost:${env.port}`);
  console.log(`  data dir    ${env.dataDir}`);
  console.log(`  seed        ${seeded ? 'loaded the sample family' : 'existing data kept'}`);
  console.log(`  invite code ${inviteRequired ? 'required' : 'not required (open joining)'}`);
  console.log(`  public read ${env.publicRead ? 'on' : 'off (archive is private)'}`);
  if (!env.isProduction) console.log(`  client dev  http://localhost:5173`);
});
