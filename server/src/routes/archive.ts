import { Router } from 'express';
import { z } from 'zod';

import { ARCHIVE_KINDS } from '../lib/kinds.js';
import { ApiError } from '../middleware/errors.js';
import { pathParam } from '../lib/http.js';
import { requireAuth, requireReadAccess, requireRole } from '../middleware/session.js';
import {
  archiveArchiveItem,
  archiveTimelineEvent,
  createArchiveItem,
  createTimelineEvent,
  getArchiveItem,
  getTimelineEvent,
  listArchiveItems,
  listTimelineEvents,
  updateArchiveItem,
  updateTimelineEvent,
} from '../repos/archive.js';
import { getMedia } from '../repos/media.js';
import { getPerson } from '../repos/people.js';

export const archiveRouter = Router();

const kindEnum = z.enum(ARCHIVE_KINDS);

const listQuery = z.object({
  kind: kindEnum.optional(),
  personId: z.string().trim().min(1).max(64).optional(),
});

const idField = z.string().trim().min(1).max(64);

const createBody = z.object({
  kind: kindEnum,
  title: z.string().trim().min(1, 'צריך כותרת').max(160, 'הכותרת ארוכה מדי'),
  yearLabel: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(120).optional(),
  story: z.string().trim().max(4000).optional(),
  personId: idField.nullable().optional(),
  personIds: z.array(idField).max(64).optional(),
  mediaId: idField.nullable().optional(),
});

/**
 * One link list from either request shape: `personIds` when the caller speaks
 * multi-link, the old single `personId` otherwise. Returns undefined when the
 * request said nothing about people at all — a patch must not clear links it
 * never mentioned.
 */
function requestedPeople(input: {
  personId?: string | null;
  personIds?: string[];
}): string[] | undefined {
  if (input.personIds) return [...new Set(input.personIds)];
  if ('personId' in input) return input.personId ? [input.personId] : [];
  return undefined;
}

/** Every linked person must exist and be on the board. */
async function assertPeopleExist(personIds: string[]): Promise<void> {
  for (const personId of personIds) {
    const person = await getPerson(personId);
    if (!person || person.archivedAt) throw ApiError.badRequest('בן המשפחה שנבחר לא קיים.');
  }
}

archiveRouter.get('/archive', requireReadAccess, async (req, res) => {
  const query = listQuery.parse(req.query);
  res.json(await listArchiveItems(query));
});

archiveRouter.post('/archive', requireAuth, async (req, res) => {
  const input = createBody.parse(req.body);

  // Reject dangling references up front rather than storing a link that will
  // silently render as a missing tile later.
  const personIds = requestedPeople(input) ?? [];
  await assertPeopleExist(personIds);
  if (input.mediaId && !await getMedia(input.mediaId)) {
    throw ApiError.badRequest('הקובץ שצורף לא נמצא. נסו להעלות אותו שוב.');
  }

  res.status(201).json(await createArchiveItem({ ...input, personIds }, req.user!.id));
});

/** Same rule as removal: your own contributions, or anything if you are the steward. */
function assertCanEditItem(req: Parameters<typeof requireAuth>[0], createdBy: string | null): void {
  if (req.user!.role !== 'steward' && createdBy !== req.user!.id) {
    throw ApiError.forbidden('אפשר לערוך רק אוצרות שאתם הוספתם.');
  }
}

archiveRouter.patch('/archive/:id', requireAuth, async (req, res) => {
  const item = await getArchiveItem(pathParam(req, 'id'));
  if (!item || item.archivedAt) throw ApiError.notFound('לא מצאנו את הפריט הזה.');
  assertCanEditItem(req, item.createdBy);

  const patch = createBody.partial().parse(req.body);
  const personIds = requestedPeople(patch);
  if (personIds) await assertPeopleExist(personIds);
  if (patch.mediaId && !await getMedia(patch.mediaId)) {
    throw ApiError.badRequest('הקובץ שצורף לא נמצא. נסו להעלות אותו שוב.');
  }

  res.json(await updateArchiveItem(item.id, { ...patch, personIds }));
});

archiveRouter.post('/archive/:id/archive', requireAuth, async (req, res) => {
  const item = await getArchiveItem(pathParam(req, 'id'));
  if (!item || item.archivedAt) throw ApiError.notFound('לא מצאנו את הפריט הזה.');
  if (req.user!.role !== 'steward' && item.createdBy !== req.user!.id) {
    throw ApiError.forbidden('אפשר להסיר רק אוצרות שאתם הוספתם.');
  }
  await archiveArchiveItem(item.id);
  res.status(204).end();
});

/* ---------------------------------------------------------------- timeline */

const eventBody = z.object({
  year: z.number().int().min(1500).max(new Date().getFullYear() + 1),
  title: z.string().trim().min(1, 'צריך תיאור').max(160),
  personId: idField.nullable().optional(),
  personIds: z.array(idField).max(64).optional(),
});

archiveRouter.get('/timeline', requireReadAccess, async (_req, res) => {
  res.json(await listTimelineEvents());
});

archiveRouter.post('/timeline', requireAuth, async (req, res) => {
  const input = eventBody.parse(req.body);
  const personIds = requestedPeople(input) ?? [];
  await assertPeopleExist(personIds);
  res.status(201).json(await createTimelineEvent({ ...input, personIds }));
});

/*
 * Timeline events describe the family rather than one contributor, and the
 * table carries no author, so amending or removing one is steward-only.
 * Anyone may still add.
 */
archiveRouter.patch('/timeline/:id', requireRole('steward'), async (req, res) => {
  const event = await getTimelineEvent(pathParam(req, 'id'));
  if (!event) throw ApiError.notFound('לא מצאנו את האירוע הזה.');

  const patch = eventBody.partial().parse(req.body);
  const personIds = requestedPeople(patch);
  if (personIds) await assertPeopleExist(personIds);
  res.json(await updateTimelineEvent(event.id, { ...patch, personIds }));
});

archiveRouter.delete('/timeline/:id', requireRole('steward'), async (req, res) => {
  const event = await getTimelineEvent(pathParam(req, 'id'));
  if (!event) throw ApiError.notFound('לא מצאנו את האירוע הזה.');
  await archiveTimelineEvent(event.id);
  res.status(204).end();
});
