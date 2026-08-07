/**
 * Domain contract shared by the client and the API.
 *
 * Everything here is a type or a `const` used purely for narrowing, so the
 * module erases at compile time. Both packages import it with `import type`
 * across a relative path, which means there is no runtime resolution to set up
 * between the two workspaces.
 */

/** A person's cohort. Drives the colour a node is drawn in across the whole app. */
export interface Generation {
  id: string;
  name: string;
  /** Human label for the year span, e.g. "1928–1945". */
  rangeLabel: string;
  /** Human label for the age span, e.g. "81–98". */
  ageLabel: string;
  /** Primary colour: node border, buttons, accents. */
  color: string;
  /** Tinted background used behind text set in `colorText`. */
  colorLight: string;
  /** Text colour with sufficient contrast on `colorLight` and on cream. */
  colorText: string;
  /** Pre-mixed rgba drop shadow matching `color`. */
  shadow: string;
  yearFrom: number;
  yearTo: number;
  sortOrder: number;
}

export type RelationshipType = 'spouse' | 'parent';

/**
 * `parent` is directional: `personId` is the parent of `relatedPersonId`.
 * `spouse` is symmetric and stored once, with `personId` on the right-hand
 * side of the tree so connector drawing is deterministic.
 */
export interface Relationship {
  id: string;
  personId: string;
  relatedPersonId: string;
  type: RelationshipType;
}

export interface Milestone {
  id: string;
  personId: string;
  /** Free text so approximate dates ("סביב 1900", "1948–2009") stay expressible. */
  yearLabel: string;
  title: string;
  body: string;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
}

export interface Person {
  id: string;
  fullName: string;
  /** Single character drawn inside the node. Defaults to the first letter of `fullName`. */
  initial: string;
  /** Free text: "1898–1942", "נ׳ 1985". */
  lifeSpan: string;
  place: string;
  story: string;
  birthYear: number | null;
  deathYear: number | null;
  /** Branch label shown above the tree, e.g. "ענף ליבוביץ׳ · לודז׳". */
  branch: string | null;
  /** Caption for the person's oral-history recording, when one exists. */
  audioLabel: string | null;
  audioMediaId: string | null;
  portraitMediaId: string | null;
  /** Tree coordinates, top-left of the node on the canvas. */
  x: number;
  y: number;
  /** True for a node added by someone joining — drawn with a dashed outline. */
  isProvisional: boolean;
  generationId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonDetail extends Person {
  milestones: Milestone[];
}

export const ARCHIVE_KINDS = ['תצלום', 'מכתב', 'קול', 'מסמך', 'חפץ', 'סיפור'] as const;
export type ArchiveKind = (typeof ARCHIVE_KINDS)[number];

export interface ArchiveItem {
  id: string;
  kind: ArchiveKind;
  title: string;
  /** Free text so "סביב 1900" and "לא ידוע" are valid. */
  yearLabel: string;
  /** Who the item is about — a person's given name, or "כל המשפחה". */
  subject: string;
  story: string;
  /** Optional link to the person this item belongs to. */
  personId: string | null;
  mediaId: string | null;
  /** Masonry tile height in px; kept server-side so the feed is stable across reloads. */
  tileHeight: number;
  createdBy: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface TimelineEvent {
  id: string;
  year: number;
  title: string;
  personId: string | null;
}

export interface MediaRef {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export type UserRole = 'member' | 'steward';

export interface SessionUser {
  id: string;
  displayName: string;
  birthYear: number | null;
  /** The tree node this account is bound to, if any. */
  personId: string | null;
  role: UserRole;
  generationId: string | null;
}

export interface SessionResponse {
  user: SessionUser | null;
  /** True when the deployment requires an invite code to join. */
  inviteRequired: boolean;
  /** True when unauthenticated visitors may read the archive. */
  publicRead: boolean;
}

/* ---------------------------------------------------------------- requests */

export interface JoinRequest {
  displayName: string;
  birthYear?: number | null;
  /** Bind to an existing person instead of creating a new node. */
  personId?: string | null;
  inviteCode?: string;
}

export interface CreatePersonRequest {
  fullName: string;
  lifeSpan?: string;
  place?: string;
  story?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  branch?: string | null;
  initial?: string;
  x?: number;
  y?: number;
  isProvisional?: boolean;
}

export type UpdatePersonRequest = Partial<CreatePersonRequest>;

export interface CreateMilestoneRequest {
  yearLabel: string;
  title: string;
  body?: string;
}

export interface CreateArchiveItemRequest {
  kind: ArchiveKind;
  title: string;
  yearLabel?: string;
  subject?: string;
  story?: string;
  personId?: string | null;
  mediaId?: string | null;
}

export interface CreateRelationshipRequest {
  personId: string;
  relatedPersonId: string;
  type: RelationshipType;
}

/* --------------------------------------------------------------- responses */

export interface TreeResponse {
  people: Person[];
  relationships: Relationship[];
  generations: Generation[];
}

/** Shape of every non-2xx response from the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level messages, keyed by path, for validation failures. */
    details?: Record<string, string[]>;
  };
}
