import { Router } from 'express';
import { z } from 'zod';

import { ARCHIVE_KINDS } from '../../../shared/types.ts';

import { ApiError } from '../middleware/errors.ts';
import { pathParam } from '../lib/http.ts';
import { requireAuth, requireReadAccess, requireRole } from '../middleware/session.ts';
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
} from '../repos/archive.ts';
import { getMedia } from '../repos/media.ts';
import { getPerson } from '../repos/people.ts';

export const archiveRouter = Router();

const kindEnum = z.enum(ARCHIVE_KINDS);

const listQuery = z.object({
  kind: kindEnum.optional(),
  personId: z.string().trim().min(1).max(64).optional(),
});

const createBody = z.object({
  kind: kindEnum,
  title: z.string().trim().min(1, 'צריך כותרת').max(160, 'הכותרת ארוכה מדי'),
  yearLabel: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(120).optional(),
  story: z.string().trim().max(4000).optional(),
  personId: z.string().trim().min(1).max(64).nullable().optional(),
  mediaId: z.string().trim().min(1).max(64).nullable().optional(),
});

archiveRouter.get('/archive', requireReadAccess, (req, res) => {
  const query = listQuery.parse(req.query);
  res.json(listArchiveItems(query));
});

archiveRouter.post('/archive', requireAuth, (req, res) => {
  const input = createBody.parse(req.body);

  // Reject dangling references up front rather than storing a link that will
  // silently render as a missing tile later.
  if (input.personId) {
    const person = getPerson(input.personId);
    if (!person || person.archivedAt) throw ApiError.badRequest('בן המשפחה שנבחר לא קיים.');
  }
  if (input.mediaId && !getMedia(input.mediaId)) {
    throw ApiError.badRequest('הקובץ שצורף לא נמצא. נסו להעלות אותו שוב.');
  }

  res.status(201).json(createArchiveItem(input, req.user!.id));
});

/** Same rule as removal: your own contributions, or anything if you are the steward. */
function assertCanEditItem(req: Parameters<typeof requireAuth>[0], createdBy: string | null): void {
  if (req.user!.role !== 'steward' && createdBy !== req.user!.id) {
    throw ApiError.forbidden('אפשר לערוך רק אוצרות שאתם הוספתם.');
  }
}

archiveRouter.patch('/archive/:id', requireAuth, (req, res) => {
  const item = getArchiveItem(pathParam(req, 'id'));
  if (!item || item.archivedAt) throw ApiError.notFound('לא מצאנו את הפריט הזה.');
  assertCanEditItem(req, item.createdBy);

  const patch = createBody.partial().parse(req.body);
  if (patch.personId) {
    const person = getPerson(patch.personId);
    if (!person || person.archivedAt) throw ApiError.badRequest('בן המשפחה שנבחר לא קיים.');
  }
  if (patch.mediaId && !getMedia(patch.mediaId)) {
    throw ApiError.badRequest('הקובץ שצורף לא נמצא. נסו להעלות אותו שוב.');
  }

  res.json(updateArchiveItem(item.id, patch));
});

archiveRouter.post('/archive/:id/archive', requireAuth, (req, res) => {
  const item = getArchiveItem(pathParam(req, 'id'));
  if (!item || item.archivedAt) throw ApiError.notFound('לא מצאנו את הפריט הזה.');
  if (req.user!.role !== 'steward' && item.createdBy !== req.user!.id) {
    throw ApiError.forbidden('אפשר להסיר רק אוצרות שאתם הוספתם.');
  }
  archiveArchiveItem(item.id);
  res.status(204).end();
});

/* ---------------------------------------------------------------- timeline */

const eventBody = z.object({
  year: z.number().int().min(1500).max(new Date().getFullYear() + 1),
  title: z.string().trim().min(1, 'צריך תיאור').max(160),
  personId: z.string().trim().min(1).max(64).nullable().optional(),
});

archiveRouter.get('/timeline', requireReadAccess, (_req, res) => {
  res.json(listTimelineEvents());
});

archiveRouter.post('/timeline', requireAuth, (req, res) => {
  const input = eventBody.parse(req.body);
  if (input.personId) {
    const person = getPerson(input.personId);
    if (!person || person.archivedAt) throw ApiError.badRequest('בן המשפחה שנבחר לא קיים.');
  }
  res.status(201).json(createTimelineEvent(input));
});

/*
 * Timeline events describe the family rather than one contributor, and the
 * table carries no author, so amending or removing one is steward-only.
 * Anyone may still add.
 */
archiveRouter.patch('/timeline/:id', requireRole('steward'), (req, res) => {
  const event = getTimelineEvent(pathParam(req, 'id'));
  if (!event) throw ApiError.notFound('לא מצאנו את האירוע הזה.');

  const patch = eventBody.partial().parse(req.body);
  if (patch.personId) {
    const person = getPerson(patch.personId);
    if (!person || person.archivedAt) throw ApiError.badRequest('בן המשפחה שנבחר לא קיים.');
  }
  res.json(updateTimelineEvent(event.id, patch));
});

archiveRouter.delete('/timeline/:id', requireRole('steward'), (req, res) => {
  const event = getTimelineEvent(pathParam(req, 'id'));
  if (!event) throw ApiError.notFound('לא מצאנו את האירוע הזה.');
  archiveTimelineEvent(event.id);
  res.status(204).end();
});
