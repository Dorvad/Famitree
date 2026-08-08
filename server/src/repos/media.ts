import type { MediaRef } from '../../../shared/types.js';

import { exec, nowIso, one } from '../db/index.js';

interface MediaRow {
  id: string;
  stored_name: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

export interface StoredMedia extends MediaRef {
  /** Random on-disk filename. Never exposed to clients. */
  storedName: string;
}

function toStored(row: MediaRow): StoredMedia {
  return {
    id: row.id,
    storedName: row.stored_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

export async function recordMedia(input: {
  id: string;
  /** For `disk` the filename; for `blob` the URL the object was stored at. */
  storedName: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  createdBy: string | null;
}): Promise<MediaRef> {
  const at = nowIso();
  await exec(
    `INSERT INTO media (id, stored_name, original_name, mime_type, byte_size, created_by, created_at)
     VALUES (@id, @storedName, @originalName, @mimeType, @byteSize, @createdBy, @at)`,
    { ...input, at },
  );
  return {
    id: input.id,
    originalName: input.originalName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    createdAt: at,
  };
}

export async function getMedia(id: string): Promise<StoredMedia | null> {
  const row = await one<MediaRow>(
    'SELECT id, stored_name, original_name, mime_type, byte_size, created_at FROM media WHERE id = @id',
    { id },
  );
  return row ? toStored(row) : null;
}
