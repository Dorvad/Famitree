import type { MediaRef } from '../../../shared/types.ts';

import { db, nowIso } from '../db/index.ts';

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

export function recordMedia(input: {
  id: string;
  storedName: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  createdBy: string | null;
}): MediaRef {
  db.prepare(
    `INSERT INTO media (id, stored_name, original_name, mime_type, byte_size, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.storedName,
    input.originalName,
    input.mimeType,
    input.byteSize,
    input.createdBy,
    nowIso(),
  );
  return {
    id: input.id,
    originalName: input.originalName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    createdAt: nowIso(),
  };
}

export function getMedia(id: string): StoredMedia | null {
  const row = db
    .prepare(
      'SELECT id, stored_name, original_name, mime_type, byte_size, created_at FROM media WHERE id = ?',
    )
    .get(id) as MediaRow | undefined;
  return row ? toStored(row) : null;
}
