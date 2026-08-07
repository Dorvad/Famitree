import type { Generation } from '../../../shared/types.ts';

import { db } from '../db/index.ts';

interface GenerationSeed {
  id: string;
  name: string;
  rangeLabel: string;
  color: string;
  colorLight: string;
  colorText: string;
  shadow: string;
  yearFrom: number;
  yearTo: number;
}

/**
 * Cohort palette. The colours and Hebrew names come straight from the design;
 * the boundaries follow the widely used Anglophone generational cut points,
 * which is what the design assumed.
 *
 * Two deliberate departures from the mockup:
 *
 *  - Age labels are computed from the current year rather than stored. The
 *    mockup hard-coded strings like "81–98", which silently go stale.
 *  - The youngest cohort is open-ended. The mockup stopped at 2024, so anyone
 *    born later fell through to a fallback. There is no settled Hebrew name for
 *    the cohort after דור האלפא, so rather than invent one the range simply
 *    stays open.
 */
const GENERATION_SEEDS: readonly GenerationSeed[] = [
  {
    id: 'founders',
    name: 'דור המייסדים',
    rangeLabel: 'לפני 1928',
    color: '#b08968',
    colorLight: '#efe0cf',
    colorText: '#8a6a4f',
    shadow: 'rgba(176,137,104,.32)',
    yearFrom: 0,
    yearTo: 1927,
  },
  {
    id: 'silent',
    name: 'הדור השקט',
    rangeLabel: '1928–1945',
    color: '#7c5cff',
    colorLight: '#e6e0ff',
    colorText: '#6a55c2',
    shadow: 'rgba(124,92,255,.3)',
    yearFrom: 1928,
    yearTo: 1945,
  },
  {
    id: 'boomers',
    name: 'דור הבייבי בום',
    rangeLabel: '1946–1964',
    color: '#00c2a8',
    colorLight: '#d7f6ef',
    colorText: '#00a18b',
    shadow: 'rgba(0,194,168,.3)',
    yearFrom: 1946,
    yearTo: 1964,
  },
  {
    id: 'gen-x',
    name: 'דור ה-X',
    rangeLabel: '1965–1980',
    color: '#ffb020',
    colorLight: '#fff0d4',
    colorText: '#c28a1e',
    shadow: 'rgba(255,176,32,.32)',
    yearFrom: 1965,
    yearTo: 1980,
  },
  {
    id: 'millennials',
    name: 'דור המילניום',
    rangeLabel: '1981–1996',
    color: '#ff5a5f',
    colorLight: '#ffe3e4',
    colorText: '#e04347',
    shadow: 'rgba(255,90,95,.3)',
    yearFrom: 1981,
    yearTo: 1996,
  },
  {
    id: 'gen-z',
    name: 'דור ה-Z',
    rangeLabel: '1997–2012',
    color: '#3da9f5',
    colorLight: '#dcefff',
    colorText: '#1f7fd1',
    shadow: 'rgba(61,169,245,.3)',
    yearFrom: 1997,
    yearTo: 2012,
  },
  {
    id: 'alpha',
    name: 'דור האלפא',
    rangeLabel: '2013 ואילך',
    color: '#f56bb8',
    colorLight: '#ffe0f0',
    colorText: '#d1478f',
    shadow: 'rgba(245,107,184,.32)',
    yearFrom: 2013,
    yearTo: 9999,
  },
];

/** Ages shown next to a cohort must track the calendar, not the build date. */
function ageLabel(seed: GenerationSeed): string {
  const thisYear = new Date().getFullYear();
  const youngest = Math.max(0, thisYear - seed.yearTo);
  const oldest = thisYear - seed.yearFrom;
  if (seed.yearFrom <= 0) return `${youngest}+`;
  if (seed.yearTo >= thisYear) return `0–${oldest}`;
  return `${youngest}–${oldest}`;
}

export function allGenerations(): Generation[] {
  return GENERATION_SEEDS.map((seed, index) => ({
    ...seed,
    ageLabel: ageLabel(seed),
    sortOrder: index,
  }));
}

/** Youngest cohort is open-ended, so an unknown year lands on the founders. */
export function generationIdForYear(year: number | null | undefined): string {
  if (year == null || !Number.isFinite(year)) return 'founders';
  const match = GENERATION_SEEDS.find((g) => year >= g.yearFrom && year <= g.yearTo);
  return match?.id ?? 'founders';
}

export function syncGenerations(): void {
  const upsert = db.prepare(`
    INSERT INTO generations
      (id, name, range_label, age_label, color, color_light, color_text, shadow, year_from, year_to, sort_order)
    VALUES
      (@id, @name, @rangeLabel, @ageLabel, @color, @colorLight, @colorText, @shadow, @yearFrom, @yearTo, @sortOrder)
    ON CONFLICT (id) DO UPDATE SET
      name        = excluded.name,
      range_label = excluded.range_label,
      age_label   = excluded.age_label,
      color       = excluded.color,
      color_light = excluded.color_light,
      color_text  = excluded.color_text,
      shadow      = excluded.shadow,
      year_from   = excluded.year_from,
      year_to     = excluded.year_to,
      sort_order  = excluded.sort_order
  `);
  const run = db.transaction((rows: Generation[]) => {
    for (const row of rows) upsert.run(row);
  });
  run(allGenerations());
}
