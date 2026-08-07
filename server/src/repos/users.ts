import type { SessionUser, UserRole } from '../../../shared/types.ts';

import { db, nowIso } from '../db/index.ts';
import { generationIdForYear } from '../lib/generations.ts';
import { newId } from '../lib/ids.ts';

interface UserRow {
  id: string;
  display_name: string;
  birth_year: number | null;
  person_id: string | null;
  role: UserRole;
}

function toUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    displayName: row.display_name,
    birthYear: row.birth_year,
    personId: row.person_id,
    role: row.role,
    generationId: row.birth_year != null ? generationIdForYear(row.birth_year) : null,
  };
}

export function getUser(id: string): SessionUser | null {
  const row = db
    .prepare('SELECT id, display_name, birth_year, person_id, role FROM users WHERE id = ?')
    .get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function createUser(input: {
  displayName: string;
  birthYear: number | null;
  personId: string | null;
}): SessionUser {
  const id = newId('u');
  const at = nowIso();

  // The person who sets the archive up looks after it. Everyone who joins
  // afterwards is an ordinary member until a steward promotes them.
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  const role: UserRole = count === 0 ? 'steward' : 'member';

  db.prepare(
    `INSERT INTO users (id, display_name, birth_year, person_id, role, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.displayName, input.birthYear, input.personId, role, at, at);

  const created = getUser(id);
  if (!created) throw new Error('user insert did not round-trip');
  return created;
}

export function touchUser(id: string): void {
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), id);
}

export function setUserRole(id: string, role: UserRole): SessionUser | null {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  return getUser(id);
}

export function bindUserToPerson(id: string, personId: string | null): SessionUser | null {
  db.prepare('UPDATE users SET person_id = ? WHERE id = ?').run(personId, id);
  return getUser(id);
}
