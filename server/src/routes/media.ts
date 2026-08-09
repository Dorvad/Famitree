import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { MulterError } from 'multer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { HandleUploadBody } from '@vercel/blob/client';

import { ALLOWED_UPLOAD_TYPES, UNSUPPORTED_TYPE_MESSAGE } from '../../../shared/uploads.js';
import { env } from '../env.js';
import { ApiError } from '../middleware/errors.js';
import { pathParam } from '../lib/http.js';
import { requireAuth, requireReadAccess } from '../middleware/session.js';
import { getMedia, recordMedia } from '../repos/media.js';
import { newId } from '../lib/ids.js';
import { isBlobStoreUrl, storage } from '../lib/storage.js';

export const mediaRouter = Router();

/**
 * The allowed types live in `shared/uploads.ts` so the client can refuse a
 * file with the same message before uploading a byte of it. The alias keeps
 * the route code reading the way it always has.
 */
const ALLOWED_TYPES = ALLOWED_UPLOAD_TYPES;

/** Types safe to render in the page. Anything else is served as a download. */
const INLINE_TYPES = new Set(
  Object.keys(ALLOWED_TYPES).filter(
    (m) => m.startsWith('image/') || m.startsWith('audio/'),
  ),
);

/**
 * Held in memory, then handed to whichever storage driver is configured.
 *
 * Writing to a temporary directory first would mean the serverless driver reads
 * a file back only to upload it, and the size ceiling below is what keeps a
 * buffered upload bounded.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, done) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      done(
        ApiError.badRequest(
          `סוג הקובץ ${file.mimetype} לא נתמך. אפשר להעלות תמונות, הקלטות או PDF.`,
        ),
      );
      return;
    }
    done(null, true);
  },
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'העליתם הרבה קבצים ברצף. המתינו רגע ונסו שוב.' },
  },
});

mediaRouter.post('/media', requireAuth, uploadLimiter, (req, res, next) => {
  // The one route a missing upload store actually costs. Reading the archive,
  // the tree and everything already uploaded is unaffected, so this is refused
  // here rather than by taking the whole API down.
  if (!env.storageReady) {
    next(
      ApiError.unavailable(
        'העלאת קבצים עדיין לא מוגדרת בשרת. אפשר להוסיף את שאר הפרטים בינתיים.',
      ),
    );
    return;
  }

  upload.single('file')(req, res, (err: unknown) => {
    void (async () => {
    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `הקובץ גדול מדי. המקסימום הוא ${Math.round(env.maxUploadBytes / (1024 * 1024))}MB.`
          : 'ההעלאה נכשלה. נסו שוב.';
      next(ApiError.badRequest(message));
      return;
    }
    if (err) {
      next(err);
      return;
    }
    if (!req.file) {
      next(ApiError.badRequest('לא צורף קובץ.'));
      return;
    }

    // Fully random, and generated here. The client's filename never reaches
    // storage, so traversal and extension smuggling are both moot.
    const name = `${randomUUID()}${ALLOWED_TYPES[req.file.mimetype] ?? '.bin'}`;
    const { stored } = await storage.put({
      name,
      body: req.file.buffer,
      contentType: req.file.mimetype,
    });

    const media = await recordMedia({
      id: newId('m'),
      storedName: stored,
      // Kept for display only; never used to build a path.
      originalName: req.file.originalname.slice(0, 200),
      mimeType: req.file.mimetype,
      byteSize: req.file.size,
      createdBy: req.user!.id,
    });

      res.status(201).json(media);
    })().catch(next);
  });
});

/**
 * Token handshake for direct browser→store uploads, used with the blob driver.
 *
 * The platform the API runs on caps a function's request body at about 4.5MB —
 * a modern phone photograph is bigger, and the request dies at the platform's
 * edge before this code sees a byte of it. So with the blob driver the bytes
 * go from the browser straight to the store, and the server's part shrinks to
 * this: authenticate the uploader, then mint a short-lived token carrying the
 * same type and size limits the multipart route enforces itself.
 *
 * No `onUploadCompleted` callback is registered, deliberately: the client
 * reports the finished upload to POST /media/record below, which verifies the
 * claim against the store before anything is written down. A webhook would add
 * a second, unauthenticated path into the server for the same information.
 */
mediaRouter.post('/media/client-upload', requireAuth, uploadLimiter, (req, res, next) => {
  void (async () => {
    if (storage.driver !== 'blob') {
      throw ApiError.badRequest('העלאה ישירה עובדת רק מול מחסן קבצים בענן.');
    }
    if (!env.storageReady) {
      throw ApiError.unavailable(
        'העלאת קבצים עדיין לא מוגדרת בשרת. אפשר להוסיף את שאר הפרטים בינתיים.',
      );
    }

    const { handleUpload } = await import('@vercel/blob/client');
    const result = await handleUpload({
      request: req,
      body: req.body as HandleUploadBody,
      token: env.blobToken,
      onBeforeGenerateToken: async (pathname) => {
        // The client names the object `uploads/<uuid><ext>`. The prefix is
        // enforced so a crafted request cannot scatter objects around the
        // store; everything else about the name is covered by the suffix.
        if (!pathname.startsWith('uploads/') || pathname.length > 200) {
          throw ApiError.badRequest('שם הקובץ לא תקין.');
        }
        return {
          allowedContentTypes: Object.keys(ALLOWED_TYPES),
          maximumSizeInBytes: env.maxUploadBytes,
          // The name already carries a UUID; the suffix is what stops a
          // crafted duplicate name from overwriting an existing object.
          addRandomSuffix: true,
        };
      },
    });
    res.json(result);
  })().catch((cause: unknown) => {
    if (cause instanceof ApiError) {
      next(cause);
      return;
    }
    // handleUpload throws plain errors for malformed bodies and bad
    // signatures alike; neither deserves to surface as a 500.
    console.warn('[shoresh] client-upload handshake failed:', cause);
    next(ApiError.badRequest('בקשת ההעלאה לא תקינה. נסו שוב.'));
  });
});

const recordBody = z.object({
  url: z.string().max(1000),
  originalName: z.string().max(300).optional(),
});

/**
 * Second half of a direct upload: the browser says where the store put the
 * file, and the server checks the claim against the store itself — with this
 * store's own token — before a media row exists. A URL pointing anywhere else
 * fails `isBlobStoreUrl`, and one naming an object that was never uploaded
 * fails the `head` lookup, so the row can only ever describe a real object in
 * this app's store. Type and size are re-checked from the store's metadata,
 * not from anything the client sent.
 */
mediaRouter.post('/media/record', requireAuth, uploadLimiter, (req, res, next) => {
  void (async () => {
    if (storage.driver !== 'blob' || !env.storageReady) {
      throw ApiError.badRequest('רישום העלאה ישירה עובד רק מול מחסן קבצים בענן.');
    }

    const input = recordBody.parse(req.body);
    if (!isBlobStoreUrl(input.url)) {
      throw ApiError.badRequest('הקובץ לא נמצא במחסן של הארכיון.');
    }

    const { head } = await import('@vercel/blob');
    let meta;
    try {
      meta = await head(input.url, { token: env.blobToken });
    } catch {
      throw ApiError.badRequest('הקובץ לא נמצא במחסן. נסו להעלות שוב.');
    }

    if (!ALLOWED_TYPES[meta.contentType]) {
      throw ApiError.badRequest(UNSUPPORTED_TYPE_MESSAGE);
    }
    if (meta.size > env.maxUploadBytes) {
      throw ApiError.badRequest(
        `הקובץ גדול מדי. המקסימום הוא ${Math.round(env.maxUploadBytes / (1024 * 1024))}MB.`,
      );
    }

    const fallbackName = meta.pathname.split('/').pop() || 'קובץ';
    const media = await recordMedia({
      id: newId('m'),
      storedName: meta.url,
      // Kept for display only; never used to build a path.
      originalName: (input.originalName?.trim() || fallbackName).slice(0, 200),
      mimeType: meta.contentType,
      byteSize: meta.size,
      createdBy: req.user!.id,
    });
    res.status(201).json(media);
  })().catch(next);
});

mediaRouter.get('/media/:id', requireReadAccess, async (req, res) => {
  const media = await getMedia(pathParam(req, 'id'));
  if (!media) throw ApiError.notFound('הקובץ לא נמצא.');

  const target = storage.serve(media.storedName);
  if (!target) throw ApiError.notFound('הקובץ לא נמצא.');

  const inline = INLINE_TYPES.has(media.mimeType);
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(media.originalName)}`,
  );

  if (target.kind === 'redirect') {
    // The object store serves the bytes. The row is still checked first, so
    // read access and the tombstone are enforced before the URL is handed out.
    res.redirect(302, target.url);
    return;
  }

  res.sendFile(target.absolutePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: { code: 'not_found', message: 'הקובץ לא נמצא.' } });
    }
  });
});
