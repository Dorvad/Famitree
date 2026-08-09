/**
 * Allowed upload types, mapped to the extension the stored file is given.
 *
 * Shared between client and server so the browser can refuse an unsupported
 * file before any bytes leave the machine, while the server stays the
 * authority: the multipart route filters by this map itself, and the
 * client-upload token embeds the same list so the blob store enforces it.
 *
 * SVG is deliberately absent: it can carry script, and it would be served from
 * the same origin as the app. Everything here is either an inert raster image,
 * an audio container, or a PDF (which is sent as a download, never inline).
 */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
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

/** The one refusal message, worded once for both sides. */
export const UNSUPPORTED_TYPE_MESSAGE =
  'סוג הקובץ לא נתמך. אפשר להעלות תמונות, הקלטות או PDF.';
