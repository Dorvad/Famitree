import { Router } from 'express';
import { z } from 'zod';

import type { PersonDetail, SessionUser, TreeResponse } from '../../../shared/types.ts';

import { allGenerations } from '../lib/generations.ts';
import { getMedia } from '../repos/media.ts';
import { ApiError } from '../middleware/errors.ts';
import { pathParam } from '../lib/http.ts';
import { requireAuth, requireReadAccess, requireRole } from '../middleware/session.ts';
import {
  addMilestone,
  addRelationship,
  archiveMilestone,
  archivePerson,
  createPerson,
  getPerson,
  listMilestones,
  listPeople,
  listRelationships,
  removeRelationship,
  restorePerson,
  updateMilestone,
  updatePerson,
  wouldCreateCycle,
} from '../repos/people.ts';

export const treeRouter = Router();

const currentYear = new Date().getFullYear();

const yearField = z.number().int().min(1500).max(currentYear + 1).nullable().optional();

const mediaField = z.string().trim().min(1).max(64).nullable().optional();

const personBody = z.object({
  fullName: z.string().trim().min(1, 'צריך שם').max(120, 'השם ארוך מדי'),
  initial: z.string().trim().min(1).max(2).optional(),
  lifeSpan: z.string().trim().max(60).optional(),
  place: z.string().trim().max(120).optional(),
  story: z.string().trim().max(4000).optional(),
  birthYear: yearField,
  deathYear: yearField,
  branch: z.string().trim().max(120).nullable().optional(),
  x: z.number().int().min(-20000).max(20000).optional(),
  y: z.number().int().min(-20000).max(20000).optional(),
  // The repository has always understood these three; leaving them out of the
  // schema meant zod stripped them and a portrait could never be attached.
  portraitMediaId: mediaField,
  audioMediaId: mediaField,
  audioLabel: z.string().trim().max(200).nullable().optional(),
});

const personPatch = personBody.partial();

/** Rejects a media reference that does not resolve, rather than storing a
 *  link that would later render as a broken portrait. */
function assertMediaExists(input: {
  portraitMediaId?: string | null;
  audioMediaId?: string | null;
}): void {
  for (const id of [input.portraitMediaId, input.audioMediaId]) {
    if (id && !getMedia(id)) {
      throw ApiError.badRequest('הקובץ שצורף לא נמצא. נסו להעלות אותו שוב.');
    }
  }
}

const milestoneBody = z.object({
  yearLabel: z.string().trim().min(1, 'צריך שנה').max(40),
  title: z.string().trim().min(1, 'צריך כותרת').max(120),
  body: z.string().trim().max(2000).optional(),
});

const relationshipBody = z.object({
  personId: z.string().trim().min(1).max(64),
  relatedPersonId: z.string().trim().min(1).max(64),
  type: z.enum(['spouse', 'parent']),
});

/**
 * Stewards look after the whole tree; everyone else may edit the node bound to
 * their own account. That keeps a newcomer able to fill in their own details
 * without handing them the rest of the family's records.
 */
function assertCanEdit(user: SessionUser | undefined, personId: string): void {
  if (!user) throw ApiError.unauthorized();
  if (user.role === 'steward' || user.personId === personId) return;
  throw ApiError.forbidden('אפשר לערוך רק את הכרטיס שלכם. לשאר הרשומות צריך הרשאת מנהל ארכיון.');
}

function requirePerson(id: string) {
  const person = getPerson(id);
  if (!person || person.archivedAt) throw ApiError.notFound('לא מצאנו את בן המשפחה הזה.');
  return person;
}

/* ------------------------------------------------------------------ reads */

treeRouter.get('/generations', requireReadAccess, (_req, res) => {
  res.json(allGenerations());
});

/** One round trip for the whole tree — the map screen needs all three sets. */
treeRouter.get('/tree', requireReadAccess, (_req, res) => {
  const body: TreeResponse = {
    people: listPeople(),
    relationships: listRelationships(),
    generations: allGenerations(),
  };
  res.json(body);
});

/**
 * `?includeArchived=1` is how the editor offers a restore. It is steward-only
 * because archiving is: a member has no way to put a record back, so showing
 * them the removed ones would only be confusing.
 */
treeRouter.get('/people', requireReadAccess, (req, res) => {
  const wantsArchived = req.query['includeArchived'] === '1' ||
    req.query['includeArchived'] === 'true';
  if (wantsArchived && req.user?.role !== 'steward') {
    throw ApiError.forbidden('רק מי שמופקד על הארכיון רואה רשומות שהוסרו.');
  }
  res.json(listPeople(wantsArchived));
});

treeRouter.get('/people/:id', requireReadAccess, (req, res) => {
  const person = requirePerson(pathParam(req, 'id'));
  const body: PersonDetail = { ...person, milestones: listMilestones(person.id) };
  res.json(body);
});

/* ----------------------------------------------------------------- writes */

treeRouter.post('/people', requireAuth, (req, res) => {
  const input = personBody.parse(req.body);
  assertMediaExists(input);
  res.status(201).json(createPerson(input));
});

treeRouter.patch('/people/:id', requireAuth, (req, res) => {
  const person = requirePerson(pathParam(req, 'id'));
  assertCanEdit(req.user, person.id);
  const patch = personPatch.parse(req.body);
  assertMediaExists(patch);
  res.json(updatePerson(person.id, patch));
});

// Archiving a person hides them and their connectors from the tree but keeps
// every row, so it can always be undone.
treeRouter.post('/people/:id/archive', requireRole('steward'), (req, res) => {
  const person = requirePerson(pathParam(req, 'id'));
  res.json(archivePerson(person.id));
});

treeRouter.post('/people/:id/restore', requireRole('steward'), (req, res) => {
  const person = getPerson(pathParam(req, 'id'));
  if (!person) throw ApiError.notFound('לא מצאנו את בן המשפחה הזה.');
  res.json(restorePerson(person.id));
});

treeRouter.post('/people/:id/milestones', requireAuth, (req, res) => {
  const person = requirePerson(pathParam(req, 'id'));
  const input = milestoneBody.parse(req.body);
  res.status(201).json(addMilestone(person.id, input, req.user!.id));
});

treeRouter.patch('/people/:personId/milestones/:id', requireAuth, (req, res) => {
  const person = requirePerson(pathParam(req, 'personId'));
  const milestone = listMilestones(person.id).find((m) => m.id === pathParam(req, 'id'));
  if (!milestone) throw ApiError.notFound('לא מצאנו את הזיכרון הזה.');
  // Same rule as removal: your own contributions, or anything if you are the steward.
  if (req.user!.role !== 'steward' && milestone.createdBy !== req.user!.id) {
    throw ApiError.forbidden('אפשר לערוך רק זיכרונות שאתם הוספתם.');
  }
  res.json(updateMilestone(milestone.id, milestoneBody.partial().parse(req.body)));
});

treeRouter.delete('/people/:personId/milestones/:id', requireAuth, (req, res) => {
  const person = requirePerson(pathParam(req, 'personId'));
  const milestone = listMilestones(person.id).find((m) => m.id === pathParam(req, 'id'));
  if (!milestone) throw ApiError.notFound('לא מצאנו את הזיכרון הזה.');
  if (req.user!.role !== 'steward' && milestone.createdBy !== req.user!.id) {
    throw ApiError.forbidden('אפשר להסיר רק זיכרונות שאתם הוספתם.');
  }
  archiveMilestone(milestone.id);
  res.status(204).end();
});

treeRouter.post('/relationships', requireAuth, (req, res) => {
  const input = relationshipBody.parse(req.body);
  requirePerson(input.personId);
  requirePerson(input.relatedPersonId);

  if (input.personId === input.relatedPersonId) {
    throw ApiError.badRequest('אי אפשר לקשר אדם לעצמו.');
  }
  // Without this check a mis-click can make someone their own grandparent and
  // send the connector layout into an infinite walk.
  if (input.type === 'parent' && wouldCreateCycle(input.personId, input.relatedPersonId)) {
    throw ApiError.conflict('הקשר הזה יוצר לולאה באילן — בדקו את כיוון ההורות.');
  }

  res.status(201).json(addRelationship(input.personId, input.relatedPersonId, input.type));
});

treeRouter.delete('/relationships/:id', requireRole('steward'), (req, res) => {
  removeRelationship(pathParam(req, 'id'));
  res.status(204).end();
});
