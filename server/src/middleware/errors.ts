import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import type { ApiErrorBody } from '../../../shared/types.js';

import { env } from '../env.js';

/** An error whose message is safe to show a user. Anything else becomes a 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: Record<string, string[]>): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'צריך להצטרף לאילן כדי לבצע את הפעולה הזו.'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'אין לכם הרשאה לפעולה הזו.'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'לא מצאנו את מה שחיפשתם.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'conflict', message);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: { code: 'not_found', message: 'הנתיב לא קיים.' },
  };
  res.status(404).json(body);
}

/** Express 5 forwards rejected async handlers here, so no wrapper is needed. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ??= []).push(issue.message);
    }
    res.status(400).json({
      error: { code: 'validation_failed', message: 'חלק מהשדות לא תקינים.', details },
    } satisfies ApiErrorBody);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    } satisfies ApiErrorBody);
    return;
  }

  // Unexpected: log the real thing, tell the caller nothing about internals.
  console.error('[shoresh] unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: env.isProduction
        ? 'משהו השתבש אצלנו. נסו שוב בעוד רגע.'
        : `Internal error: ${err instanceof Error ? err.message : String(err)}`,
    },
  } satisfies ApiErrorBody);
}
