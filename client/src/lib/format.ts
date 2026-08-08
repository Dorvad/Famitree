import type { Generation, Person } from '../../../shared/types.ts';

/** First word of a full name — what the design uses for chips and headings. */
export function givenName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Cohort name plus branch, e.g. "הדור השקט · ברלין → חיפה". */
export function cohortLine(person: Person, generation: Generation | undefined): string {
  const parts = [generation?.name, person.branch].filter(Boolean);
  return parts.join(' · ');
}

/**
 * CSS custom properties carrying a person's cohort colours, so a component can
 * style itself with `var(--gen)` instead of threading four props through.
 */
export function generationVars(generation: Generation | undefined): React.CSSProperties {
  return {
    '--gen': generation?.color ?? 'var(--accent)',
    '--gen-wash': generation?.colorLight ?? 'var(--accent-wash)',
    '--gen-text': generation?.colorText ?? 'var(--accent-strong)',
    '--gen-shadow': generation?.shadow ?? 'var(--accent-shadow)',
  } as React.CSSProperties;
}

/** Colours the archive uses per item kind, mirroring the prototype's map. */
export const KIND_COLOURS: Record<string, { wash: string; text: string }> = {
  תצלום: { wash: 'var(--accent-wash)', text: 'var(--accent-strong)' },
  מכתב: { wash: 'var(--violet-wash)', text: 'var(--violet-strong)' },
  קול: { wash: 'var(--teal-wash)', text: 'var(--teal-strong)' },
  מסמך: { wash: 'var(--amber-wash)', text: 'var(--amber-strong)' },
  חפץ: { wash: 'var(--clay-wash)', text: 'var(--clay)' },
  סיפור: { wash: 'var(--rose-wash)', text: 'var(--rose)' },
};

export function kindColours(kind: string): { wash: string; text: string } {
  return KIND_COLOURS[kind] ?? { wash: 'var(--bg)', text: 'var(--muted)' };
}

/** Small stable hash, so per-item visual variation survives a re-render. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A resting angle for a card, derived from its id.
 *
 * A feed of loose prints should not line up into a grid, but a random angle per
 * render would make the page twitch on every state change. Seeding from the id
 * gives each item its own permanent tilt.
 */
export function restTilt(seed: string, spread = 1.7): string {
  const normalised = (hash(seed) % 1000) / 1000; // 0..1
  return `${((normalised * 2 - 1) * spread).toFixed(2)}deg`;
}

/** Sideways drift for a confetti piece, seeded so a burst is varied but stable. */
export function driftFor(index: number): string {
  const normalised = (hash(`drift-${index}`) % 1000) / 1000;
  return `${Math.round((normalised * 2 - 1) * 70)}px`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
