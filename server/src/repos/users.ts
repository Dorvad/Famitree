import type { SessionUser, UserRole } from '../../../shared/types.ts';

import { exec, nowIso, one } from '../db/index.ts';
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

export async function getUser(id: string): Promise<SessionUser | null> {
  const row = await one<UserRow>(
    'SELECT id, display_name, birth_year, person_id, role FROM users WHERE id = @id',
    { id },
  );
  return row ? toUser(row) : null;
}

export async function createUser(input: {
  displayName: string;
  birthYear: number | null;
  personId: string | null;
}): Promise<SessionUser> {
  const id = newId('u');
  const at = nowIso();

  // The person who sets the archive up looks after it. Everyone who joins
  // afterwards is an ordinary member until a steward promotes them.
  // COUNT(*) is int8 and would arrive as a string; ::int keeps the comparison honest.
  const counted = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
  const role: UserRole = (counted?.count ?? 0) === 0 ? 'steward' : 'member';

  await exec(
    `INSERT INTO users (id, display_name, birth_year, person_id, role, created_at, last_seen_at)
     VALUES (@id, @displayName, @birthYear, @personId, @role, @at, @at)`,
    { id, displayName: input.displayName, birthYear: input.birthYear, personId: input.personId, role, at },
  );

  const created = await getUser(id);
  if (!created) throw new Error('user insert did not round-trip');
  return created;
}

export async function touchUser(id: string): Promise<void> {
  await exec('UPDATE users SET last_seen_at = @at WHERE id = @id', { at: nowIso(), id });
}

export async function setUserRole(id: string, role: UserRole): Promise<SessionUser | null> {
  await exec('UPDATE users SET role = @role WHERE id = @id', { role, id });
  return getUser(id);
}

export async function bindUserToPerson(
  id: string,
  personId: string | null,
): Promise<SessionUser | null> {
  await exec('UPDATE users SET person_id = @personId WHERE id = @id', { personId, id });
  return getUser(id);
}
