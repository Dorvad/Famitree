import type { Request } from 'express';

import { ApiError } from '../middleware/errors.js';

/**
 * Express 5 types route params as `string | string[] | undefined`, which is
 * honest — a malformed pattern really can yield either. Narrowing in one place
 * keeps every handler free of casts.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.badRequest(`חסר פרמטר בנתיב: ${name}`);
  }
  return value;
}
