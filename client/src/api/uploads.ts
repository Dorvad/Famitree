import type { MediaRef } from '../../../shared/types.ts';

import { ALLOWED_UPLOAD_TYPES, UNSUPPORTED_TYPE_MESSAGE } from '../../../shared/uploads.ts';
import { apiUrl, request } from './client.ts';

/**
 * Which way a file travels to storage.
 *
 *   multipart — through the API, as one POST /media request. Right for the
 *               disk driver, where the server is the storage.
 *   direct    — from the browser straight to the blob store, with the API
 *               only minting a token and recording the result. Required with
 *               the blob driver: the platform the API runs on caps a request
 *               body at about 4.5MB, which a phone photograph exceeds, so an
 *               upload routed through the API dies before the API sees it.
 */
interface UploadTarget {
  path: 'multipart' | 'direct';
  maxUploadMb: number | null;
}

let targetPromise: Promise<UploadTarget> | null = null;

/**
 * Asks /api/health which driver the server runs, once per page load. A failed
 * probe is not cached — the next upload asks again — and falls back to the
 * multipart path, whose own error reporting says what is actually wrong.
 */
async function uploadTarget(): Promise<UploadTarget> {
  if (!targetPromise) {
    targetPromise = request<{ storage: 'disk' | 'blob'; maxUploadMb?: number }>('/health').then(
      (health) => ({
        path: health.storage === 'blob' ? ('direct' as const) : ('multipart' as const),
        maxUploadMb: health.maxUploadMb ?? null,
      }),
    );
    targetPromise.catch(() => {
      targetPromise = null;
    });
  }
  try {
    return await targetPromise;
  } catch {
    return { path: 'multipart', maxUploadMb: null };
  }
}

/** File extension worth carrying into the stored name, if the file has one. */
function extensionOf(name: string): string {
  return /\.[a-z0-9]{1,8}$/i.exec(name)?.[0]?.toLowerCase() ?? '';
}

/** Longest edge kept after shrinking; ample for a full-screen portrait. */
const MAX_IMAGE_EDGE = 1600;
/** Below this the file is already cheap — not worth touching. */
const SHRINK_SKIP_BYTES = 500 * 1024;

/**
 * Shrinks a photograph before it travels.
 *
 * A phone camera writes 8–12MB, and the archive renders it in an 84px circle:
 * uploading and later re-downloading those megabytes is what made the tree
 * feel heavy on a normal connection. Down to 1600px JPEG a portrait is a few
 * hundred kilobytes and indistinguishable on screen.
 *
 * Conservative on purpose: GIFs keep their animation, small files pass
 * untouched, and anything the browser cannot decode (HEIC outside Safari) is
 * uploaded exactly as it was — the pipeline behind it accepts the original
 * either way. The shrunk copy is only used when it is actually smaller.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= SHRINK_SKIP_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const ratio = Math.min(MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height), 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(Math.round(bitmap.width * ratio), 1);
    canvas.height = Math.max(Math.round(bitmap.height * ratio), 1);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob || blob.size >= file.size) return file;

    const name = `${file.name.replace(/\.[a-z0-9]+$/i, '')}.jpg`;
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function uploadDirect(file: File): Promise<MediaRef> {
  const { upload } = await import('@vercel/blob/client');

  let stored;
  try {
    // The name is random on purpose: the original filename is display data,
    // carried alongside, never a storage path. The server enforces the
    // uploads/ prefix and adds its own random suffix on top.
    stored = await upload(`uploads/${crypto.randomUUID()}${extensionOf(file.name)}`, file, {
      access: 'public',
      handleUploadUrl: apiUrl('/media/client-upload'),
      contentType: file.type,
    });
  } catch {
    // The blob SDK's errors are English and terse; the limits that matter
    // were already checked before the upload began, so what is left is
    // genuinely "it did not go through".
    throw new Error('העלאת הקובץ נכשלה. בדקו את החיבור ונסו שוב.');
  }

  return request<MediaRef>('/media/record', {
    method: 'POST',
    body: { url: stored.url, originalName: file.name },
  });
}

/**
 * Uploads one file and resolves to its media record, whichever way the bytes
 * travel. The type and size gates run here, before any upload starts, with
 * the same limits the server enforces — a 20MB file that is going to be
 * refused should be refused in milliseconds, not after a minute of uploading.
 */
export async function uploadMedia(original: File): Promise<MediaRef> {
  if (!ALLOWED_UPLOAD_TYPES[original.type]) {
    throw new Error(UNSUPPORTED_TYPE_MESSAGE);
  }

  const file = await shrinkImage(original);

  const target = await uploadTarget();
  if (target.maxUploadMb !== null && file.size > target.maxUploadMb * 1024 * 1024) {
    throw new Error(`הקובץ גדול מדי. המקסימום הוא ${target.maxUploadMb}MB.`);
  }

  if (target.path === 'direct') return uploadDirect(file);

  const formData = new FormData();
  formData.append('file', file);
  return request<MediaRef>('/media', { method: 'POST', formData });
}
