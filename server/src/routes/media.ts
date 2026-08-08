import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { MulterError } from 'multer';
import { randomUUID } from 'node:crypto';

import { env } from '../env.js';
import { ApiError } from '../middleware/errors.js';
import { pathParam } from '../lib/http.js';
import { requireAuth, requireReadAccess } from '../middleware/session.js';
import { getMedia, recordMedia } from '../repos/media.js';
import { newId } from '../lib/ids.js';
import { storage } from '../lib/storage.js';

export const mediaRouter = Router();

/**
 * Allowed upload types, mapped to the extension we give the stored file.
 *
 * SVG is deliberately absent: it can carry script, and it would be served from
 * the same origin as the app. Everything here is either an inert raster image,
 * an audio container, or a PDF (which is sent as a download, never inline).
 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/tiff': '.tiff',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
  'application/pdf': '.pdf',
};

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
