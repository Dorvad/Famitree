import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../env.js';

/**
 * Where uploaded originals live.
 *
 * A family archive's photographs and recordings used to sit in a directory next
 * to the database, which is the obvious thing to do right up until the app runs
 * somewhere the filesystem does not outlive the request that wrote to it. Two
 * drivers behind one interface:
 *
 *   disk  — a real directory. What `npm run dev` uses, so a fresh clone needs
 *           nothing but Postgres to work end to end.
 *   blob  — Vercel Blob. What production uses.
 *
 * `stored` is what goes in the media table, and each driver decides what it
 * means: a filename for `disk`, the object's URL for `blob`. Nothing outside
 * this module interprets it — the route asks for a way to serve it and gets
 * back either bytes on disk or a URL to redirect to.
 */

export interface StoredUpload {
  /** Opaque to every caller; only the driver that wrote it can read it back. */
  stored: string;
}

export type Served =
  | { kind: 'file'; absolutePath: string }
  | { kind: 'redirect'; url: string };

export interface Storage {
  readonly driver: 'disk' | 'blob';
  put(input: {
    /** Random, server-generated. Never derived from the upload's own name. */
    name: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredUpload>;
  serve(stored: string): Served | null;
  remove(stored: string): Promise<void>;
}

/* ------------------------------------------------------------------- disk */

const diskStorage: Storage = {
  driver: 'disk',

  async put({ name, body }) {
    await mkdir(env.uploadDir, { recursive: true });
    await writeFile(path.join(env.uploadDir, name), body);
    return { stored: name };
  },

  serve(stored) {
    const absolutePath = path.join(env.uploadDir, stored);
    // The name is generated server-side, but re-checking that the resolved path
    // stays inside the upload directory costs nothing and closes the whole
    // class of traversal bugs rather than one instance of it.
    if (path.dirname(path.resolve(absolutePath)) !== path.resolve(env.uploadDir)) {
      return null;
    }
    return { kind: 'file', absolutePath };
  },

  async remove(stored) {
    const target = this.serve(stored);
    if (target?.kind !== 'file') return;
    await unlink(target.absolutePath).catch(() => undefined);
  },
};

/* ------------------------------------------------------------------- blob */

/**
 * True for a URL the blob driver could have written: an object on this app's
 * public store host. Anything else — another host, a relative path, a row
 * written by the disk driver — is not this driver's to serve.
 */
export function isBlobStoreUrl(stored: string): boolean {
  return /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(stored);
}

const blobStorage: Storage = {
  driver: 'blob',

  async put({ name, body, contentType }) {
    const { put } = await import('@vercel/blob');
    const result = await put(`uploads/${name}`, body, {
      access: 'public',
      contentType,
      // Passed rather than left to the library's own lookup, which only ever
      // reads the unprefixed name — see env.ts.
      token: env.blobToken,
      // The name already carries a UUID; a second random suffix would only make
      // the stored URL harder to match against the row that points at it.
      addRandomSuffix: false,
    });
    return { stored: result.url };
  },

  serve(stored) {
    // Only ever a URL this driver wrote. Anything else is a row from a
    // different driver and must not become an open redirect.
    if (!isBlobStoreUrl(stored)) return null;
    return { kind: 'redirect', url: stored };
  },

  async remove(stored) {
    const { del } = await import('@vercel/blob');
    await del(stored, { token: env.blobToken }).catch(() => undefined);
  },
};

export const storage: Storage = env.storageDriver === 'blob' ? blobStorage : diskStorage;
