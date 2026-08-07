import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer, { MulterError } from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { env } from '../env.ts';
import { ApiError } from '../middleware/errors.ts';
import { pathParam } from '../lib/http.ts';
import { requireAuth, requireReadAccess } from '../middleware/session.ts';
import { getMedia, recordMedia } from '../repos/media.ts';
import { newId } from '../lib/ids.ts';

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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, env.uploadDir),
    // The stored name is fully random. The client's filename never touches the
    // filesystem, so path traversal and extension smuggling are both moot.
    filename: (_req, file, done) => {
      const ext = ALLOWED_TYPES[file.mimetype] ?? '.bin';
      done(null, `${randomUUID()}${ext}`);
    },
  }),
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
  upload.single('file')(req, res, (err: unknown) => {
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

    const media = recordMedia({
      id: newId('m'),
      storedName: req.file.filename,
      // Kept for display only; never used to build a path.
      originalName: req.file.originalname.slice(0, 200),
      mimeType: req.file.mimetype,
      byteSize: req.file.size,
      createdBy: req.user!.id,
    });

    res.status(201).json(media);
  });
});

mediaRouter.get('/media/:id', requireReadAccess, (req, res) => {
  const media = getMedia(pathParam(req, 'id'));
  if (!media) throw ApiError.notFound('הקובץ לא נמצא.');

  const absolute = path.join(env.uploadDir, media.storedName);
  // Belt and braces: storedName is generated server-side, but re-checking that
  // the resolved path stays inside the upload directory costs nothing.
  if (path.dirname(path.resolve(absolute)) !== path.resolve(env.uploadDir)) {
    throw ApiError.notFound('הקובץ לא נמצא.');
  }

  const inline = INLINE_TYPES.has(media.mimeType);
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(media.originalName)}`,
  );

  res.sendFile(absolute, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: { code: 'not_found', message: 'הקובץ לא נמצא.' } });
    }
  });
});
