import { randomUUID } from 'node:crypto';

/**
 * Short, URL-safe, collision-resistant id. Derived from a UUIDv4 so entropy is
 * the platform's CSPRNG rather than anything hand-rolled.
 */
export function newId(prefix?: string): string {
  const raw = randomUUID().replace(/-/g, '').slice(0, 20);
  return prefix ? `${prefix}_${raw}` : raw;
}
