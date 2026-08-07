import type { ApiErrorBody } from '../../../shared/types.ts';

/**
 * Empty by default, which means same-origin requests: Vite proxies /api in
 * development and the API serves the built client in production. Set
 * VITE_API_BASE_URL only when the two are deployed to different hosts.
 */
const BASE = (import.meta.env['VITE_API_BASE_URL'] ?? '').replace(/\/$/, '');

/** An error carrying the API's own Hebrew message, safe to show a user. */
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

  /** True when the caller needs to join before this will succeed. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** First message for a field, for inline form errors. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

async function toError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    // Non-JSON error (a proxy timeout, say). Fall through to the generic text.
  }
  return new ApiError(
    response.status,
    body.error?.code ?? 'http_error',
    body.error?.message ?? 'הבקשה נכשלה. בדקו את החיבור ונסו שוב.',
    body.error?.details,
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** FormData bypasses JSON encoding so the browser sets the multipart boundary. */
  formData?: FormData;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal } = options;

  const init: RequestInit = {
    method,
    // Session lives in an httpOnly cookie, so every call must send credentials.
    credentials: 'include',
    ...(signal && { signal }),
  };

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network_error', 'אין חיבור לשרת. בדקו את הרשת ונסו שוב.');
  }

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/** URL for an uploaded original. Returns null so callers can branch on absence. */
export function mediaUrl(mediaId: string | null | undefined): string | null {
  return mediaId ? `${BASE}/api/media/${encodeURIComponent(mediaId)}` : null;
}
