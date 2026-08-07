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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
