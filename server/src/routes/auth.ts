import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { SessionResponse } from '../../../shared/types.ts';

import { env, inviteRequired } from '../env.ts';
import { ApiError } from '../middleware/errors.ts';
import { clearSession, issueSession, requireAuth } from '../middleware/session.ts';
import { createPerson, getPerson } from '../repos/people.ts';
import { bindUserToPerson, createUser } from '../repos/users.ts';

export const authRouter = Router();

/** Joining is the only unauthenticated write, so it gets its own tighter limit. */
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.' },
  },
});

/** Constant-time compare so the invite code cannot be recovered by timing. */
function inviteCodeMatches(supplied: string): boolean {
  const expected = Buffer.from(env.inviteCode, 'utf8');
  const actual = Buffer.from(supplied, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

const joinSchema = z.object({
  displayName: z.string().trim().min(1, 'צריך שם').max(60, 'השם ארוך מדי'),
  birthYear: z
    .number()
    .int()
    .min(1850, 'שנה מוקדמת מדי')
    .max(new Date().getFullYear(), 'שנה עתידית')
    .nullable()
    .optional(),
  personId: z.string().trim().min(1).max(64).nullable().optional(),
  inviteCode: z.string().max(200).optional(),
});

authRouter.get('/session', async (req, res) => {
  const body: SessionResponse = {
    user: req.user ?? null,
    inviteRequired,
    publicRead: env.publicRead,
  };
  res.json(body);
});

authRouter.post('/join', joinLimiter, async (req, res) => {
  const input = joinSchema.parse(req.body);

  if (inviteRequired && !inviteCodeMatches(input.inviteCode ?? '')) {
    throw ApiError.forbidden('קוד ההזמנה לא נכון. בקשו אותו ממי שהזמין אתכם.');
  }

  // Two ways in: claim a node that already exists on the tree, or arrive as a
  // new branch. Claiming never creates a duplicate node.
  let personId: string | null = null;

  if (input.personId) {
    const person = await getPerson(input.personId);
    if (!person || person.archivedAt) throw ApiError.notFound('לא מצאנו את בן המשפחה הזה.');
    personId = person.id;
  } else if (input.birthYear != null) {
    const person = await createPerson({
      fullName: input.displayName,
      birthYear: input.birthYear,
      place: '',
      branch: 'ענף חדש באילן',
      story:
        'הצטרפתם לאילן! הענף שלכם עדיין ריק — הוסיפו זיכרון ראשון כדי למלא אותו.',
      isProvisional: true,
    });
    personId = person.id;
  }

  const user = await createUser({
    displayName: input.displayName,
    birthYear: input.birthYear ?? null,
    personId,
  });

  issueSession(res, user.id);
  res.status(201).json({ user, inviteRequired, publicRead: env.publicRead } satisfies SessionResponse);
});

authRouter.post('/logout', async (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

const bindSchema = z.object({ personId: z.string().trim().min(1).max(64).nullable() });

/** Lets someone who joined as a guest-branch later attach to a real node. */
authRouter.post('/bind', requireAuth, async (req, res) => {
  const { personId } = bindSchema.parse(req.body);
  if (personId) {
    const person = await getPerson(personId);
    if (!person || person.archivedAt) throw ApiError.notFound('לא מצאנו את בן המשפחה הזה.');
  }
  const user = await bindUserToPerson(req.user!.id, personId);
  res.json({ user, inviteRequired, publicRead: env.publicRead } satisfies SessionResponse);
});
