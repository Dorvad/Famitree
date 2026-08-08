import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express';

import type { SessionUser, UserRole } from '../../../shared/types.js';

import { env } from '../env.js';
import { getUser, touchUser } from '../repos/users.js';
import { ApiError } from './errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `attachUser` when a valid signed session cookie is present. */
      user?: SessionUser;
    }
  }
}

const COOKIE_NAME = 'shoresh_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Lax still sends the cookie on top-level navigations, so a shared link to
    // a person page keeps the visitor signed in. Strict would sign them out.
    sameSite: 'lax',
    secure: env.isProduction,
    signed: true,
    maxAge: THIRTY_DAYS_MS,
    path: '/',
  };
}

export function issueSession(res: Response, userId: string): void {
  res.cookie(COOKIE_NAME, userId, cookieOptions());
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/**
 * Resolves the signed cookie to a real user row on every request. A cookie
 * naming a user who no longer exists is cleared rather than trusted.
 */
export const attachUser: RequestHandler = async (req, res, next) => {
  const raw = req.signedCookies?.[COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    next();
    return;
  }

  const user = await getUser(raw);
  if (!user) {
    clearSession(res);
    next();
    return;
  }

  req.user = user;
  await touchUser(user.id);
  next();
};

/** Guards writes. Reads use `requireReadAccess`. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(ApiError.unauthorized());
    return;
  }
  next();
}

export function requireRole(role: UserRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (req.user.role !== role) {
      next(
        ApiError.forbidden(
          'רק מי שמופקד על הארכיון יכול לשנות רשומות של בני משפחה. בקשו הרשאה ממי שפתח את האילן.',
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Reads are open when PUBLIC_READ is on — the common case for a family archive
 * shared by private link. Turning it off makes the whole archive private.
 */
export function requireReadAccess(req: Request, _res: Response, next: NextFunction): void {
  if (env.publicRead || req.user) {
    next();
    return;
  }
  next(ApiError.unauthorized('הארכיון הזה פרטי. הצטרפו כדי לצפות בו.'));
}
