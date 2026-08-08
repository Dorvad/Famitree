import type { ArchiveKind } from '../../../shared/types.js';

import { generationIdForYear, syncGenerations } from '../lib/generations.js';
import { newId } from '../lib/ids.js';
import { getMeta, nowIso, one, setMeta, transact } from './index.js';

/**
 * The Leibovitz–Hirsch family from the design, loaded as ordinary editable
 * rows. Nothing here is special-cased: once seeded, these records behave
 * exactly like anything a relative adds later, and the seed only ever runs
 * against an empty `people` table.
 *
 * Tree coordinates are the node's top-left on a 1900×1300 canvas; nodes are
 * 84px, so a centre is (x + 42, y + 42). Rows sit 360px apart, which is what
 * the connector geometry in the client assumes.
 */

const SEED_VERSION = '1';

interface PersonSeed {
  id: string;
  fullName: string;
  initial: string;
  lifeSpan: string;
  place: string;
  story: string;
  birthYear: number | null;
  deathYear: number | null;
  branch: string;
  audioLabel?: string;
  x: number;
  y: number;
  milestones: Array<{ yearLabel: string; title: string; body: string }>;
}

const ESTHER_RECORDING = 'אסתר מספרת: התור לתה בנמל · 1978';

const PEOPLE: readonly PersonSeed[] = [
  {
    id: 'avraham',
    fullName: 'אברהם ליבוביץ׳',
    initial: 'א',
    lifeSpan: '1898–1942',
    place: 'לודז׳',
    story:
      'נגר־רהיטים ברחוב פיוטרקובסקה. שלח את דוד דרומה ב־1940 ונשאר מאחור עם רבקה. מכתבו האחרון נשלח בינואר 1941.',
    birthYear: 1898,
    deathYear: 1942,
    branch: 'ענף ליבוביץ׳',
    x: 1140,
    y: 140,
    milestones: [
      { yearLabel: '1898', title: 'לודז׳', body: 'נולד ברחוב פיוטרקובסקה.' },
      { yearLabel: '1921', title: 'החתונה', body: 'מתחתן עם רבקה. התצלום היחיד ששרד.' },
      { yearLabel: '1940', title: 'הפרידה', body: 'שולח את דוד דרומה, לבדו.' },
      { yearLabel: '1941', title: 'המכתב האחרון', body: 'נשלח בינואר. הגיע אחרי חצי שנה.' },
    ],
  },
  {
    id: 'rivka',
    fullName: 'רבקה ליבוביץ׳',
    initial: 'ר',
    lifeSpan: '1902–1942',
    place: 'לודז׳',
    story: 'תופרת. בגלויה האחרונה כתבה לדוד: ״שמור על הידיים שלך, הן של אבא.״',
    birthYear: 1902,
    deathYear: 1942,
    branch: 'ענף ליבוביץ׳',
    x: 1320,
    y: 140,
    milestones: [
      { yearLabel: '1902', title: 'לודז׳', body: 'נולדה למשפחת חייטים.' },
      { yearLabel: '1921', title: 'החתונה', body: 'נישאת לאברהם.' },
      { yearLabel: '1938', title: 'מכונת התפירה', body: 'התצלום האחרון שלה שצולם בבית.' },
      { yearLabel: '1941', title: 'הגלויה', body: '״שמור על הידיים שלך, הן של אבא.״' },
    ],
  },
  {
    id: 'yaakov',
    fullName: 'יעקב הירש',
    initial: 'י',
    lifeSpan: '1895–1968',
    place: 'ברלין → חיפה',
    story:
      'סוחר בדים. קרא נכון את 1933 ועלה עם המשפחה ב־1936. פתח חנות בדים קטנה בהדר.',
    birthYear: 1895,
    deathYear: 1968,
    branch: 'ענף הירש',
    x: 460,
    y: 140,
    milestones: [
      { yearLabel: '1895', title: 'ברלין', body: 'נולד מעל חנות הבדים של אביו.' },
      { yearLabel: '1933', title: 'ההחלטה', body: 'קורא נכון את המפה ומתחיל לתכנן עלייה.' },
      { yearLabel: '1936', title: 'ההפלגה', body: 'המשפחה יורדת בנמל חיפה.' },
      { yearLabel: '1948', title: 'החנות בהדר', body: 'חנות בדים קטנה, שלט בשלוש שפות.' },
    ],
  },
  {
    id: 'margot',
    fullName: 'מרגוט הירש',
    initial: 'מ',
    lifeSpan: '1901–1975',
    place: 'ברלין → חיפה',
    story: 'פסנתרנית. הפסנתר נשאר בברלין; בחיפה לימדה נגינה על פסנתר שאול.',
    birthYear: 1901,
    deathYear: 1975,
    branch: 'ענף הירש',
    x: 640,
    y: 140,
    milestones: [
      { yearLabel: '1901', title: 'ברלין', body: 'נולדה למשפחת מוזיקאים.' },
      { yearLabel: '1928', title: 'ערבי הסלון', body: 'מנגנת שוברט לאורחים.' },
      { yearLabel: '1936', title: 'הפרידה מהפסנתר', body: 'הפסנתר נשאר בברלין. המפתח נשמר.' },
      { yearLabel: '1950', title: 'המורה', body: 'מלמדת נגינה על פסנתר שאול בהדר.' },
    ],
  },
  {
    id: 'david',
    fullName: 'דוד ליבוביץ׳',
    initial: 'ד',
    lifeSpan: '1924–2009',
    place: 'לודז׳ → חיפה',
    story:
      'עלה לבדו בגיל 16, ומעולם לא חזר לדבר על המסע. נגר, כמו אביו — הסדנה ברחוב הגפן פעלה עד יומו האחרון.',
    birthYear: 1924,
    deathYear: 2009,
    branch: 'לודז׳ → חיפה',
    audioLabel: ESTHER_RECORDING,
    x: 990,
    y: 500,
    milestones: [
      { yearLabel: '1924', title: 'לודז׳', body: 'נולד ברחוב פיוטרקובסקה, בן בכור.' },
      {
        yearLabel: '1940',
        title: 'היציאה',
        body: 'עוזב את הבית בן 16. הפעם האחרונה שראה את הוריו.',
      },
      { yearLabel: '1946', title: 'נמל חיפה', body: 'בתור לתה פוגש את אסתר הירש.' },
      {
        yearLabel: '1948–2009',
        title: 'רחוב הגפן',
        body: 'נגר, אב לשניים. הסדנה פעלה עד יומו האחרון.',
      },
    ],
  },
  {
    id: 'esther',
    fullName: 'אסתר ליבוביץ׳ (הירש)',
    initial: 'א',
    lifeSpan: '1928–2015',
    place: 'ברלין → חיפה',
    story:
      'הגיעה בת שמונה. ב־1946 חילקה תה לעולים בנמל — שם פגשה את דוד. ההקלטה שלה מ־1978 היא לב הארכיון.',
    birthYear: 1928,
    deathYear: 2015,
    branch: 'ברלין → חיפה',
    audioLabel: ESTHER_RECORDING,
    x: 790,
    y: 500,
    milestones: [
      { yearLabel: '1928', title: 'ברלין', body: 'נולדה ליד הפסנתר של אמה.' },
      { yearLabel: '1936', title: 'הנמל', body: 'יורדת מהאונייה בת שמונה.' },
      { yearLabel: '1946', title: 'התור לתה', body: 'מחלקת תה לעולים — ופוגשת את דוד.' },
      { yearLabel: '1978', title: 'ההקלטה', body: '12:40 דקות שהן לב הארכיון.' },
    ],
  },
  {
    id: 'miriam',
    fullName: 'מרים אלוני (ליבוביץ׳)',
    initial: 'מ',
    lifeSpan: 'נ׳ 1952',
    place: 'חיפה',
    story: 'הבכורה. מורה לספרות, שומרת המכתבים של המשפחה.',
    birthYear: 1952,
    deathYear: null,
    branch: 'חיפה',
    x: 1010,
    y: 860,
    milestones: [
      { yearLabel: '1952', title: 'חיפה', body: 'נולדת, הבכורה.' },
      { yearLabel: '1974', title: 'המורה', body: 'מתחילה ללמד ספרות.' },
      {
        yearLabel: '2010',
        title: 'שומרת המכתבים',
        body: 'יורשת את קופסת המכתבים של המשפחה.',
      },
    ],
  },
  {
    id: 'yosef',
    fullName: 'יוסף ליבוביץ׳',
    initial: 'י',
    lifeSpan: 'נ׳ 1955',
    place: 'חיפה',
    story: 'ירש את הסדנה ואת הכלים. עד היום מתקן כיסאות של חצי שכונה.',
    birthYear: 1955,
    deathYear: null,
    branch: 'חיפה',
    x: 810,
    y: 860,
    milestones: [
      { yearLabel: '1955', title: 'חיפה', body: 'נולד, שובר כלים בסדנה מגיל חמש.' },
      { yearLabel: '1971', title: 'המקצועה', body: 'מקבל מדוד את המקצועה הראשונה שלו.' },
      {
        yearLabel: '2009',
        title: 'הסדנה',
        body: 'יורש את רחוב הגפן. מתקן כיסאות של חצי שכונה.',
      },
    ],
  },
  {
    id: 'noa',
    fullName: 'נועה ליבוביץ׳',
    initial: 'נ',
    lifeSpan: 'נ׳ 1985',
    place: 'תל אביב',
    story: 'הדור הרביעי. התחילה את הארכיון הזה מקופסת נעליים אחת של סבתא אסתר.',
    birthYear: 1985,
    deathYear: null,
    branch: 'תל אביב',
    x: 1010,
    y: 1160,
    milestones: [
      { yearLabel: '1985', title: 'חיפה', body: 'נולדת. שבתות בסדנה של סבא.' },
      {
        yearLabel: '2019',
        title: 'קופסת הנעליים',
        body: 'מוצאת אצל אסתר תצלומים, מכתבים וסליל.',
      },
      { yearLabel: '2024', title: 'הארכיון', body: 'פותחת את ״שורשים״ — המסע הזה.' },
    ],
  },
];

/** `[parentA, parentB | null, child]`; spouses are derived from shared children. */
const SPOUSES: ReadonlyArray<[string, string]> = [
  ['rivka', 'avraham'],
  ['margot', 'yaakov'],
  ['david', 'esther'],
];

const PARENTS: ReadonlyArray<[parent: string, child: string]> = [
  ['avraham', 'david'],
  ['rivka', 'david'],
  ['yaakov', 'esther'],
  ['margot', 'esther'],
  ['david', 'miriam'],
  ['esther', 'miriam'],
  ['david', 'yosef'],
  ['esther', 'yosef'],
  ['miriam', 'noa'],
];

const TIMELINE: ReadonlyArray<[year: number, title: string, personId: string | null]> = [
  [1898, 'אברהם נולד בלודז׳', 'avraham'],
  [1924, 'דוד נולד, רחוב פיוטרקובסקה', 'david'],
  [1933, 'משפחת הירש עוזבת את ברלין', 'yaakov'],
  [1936, 'ההירשים יורדים בנמל חיפה', 'esther'],
  [1940, 'דוד יוצא מלודז׳, לבדו', 'david'],
  [1946, 'המפגש בתור לתה, נמל חיפה', 'esther'],
  [1948, 'החתונה על גג בהדר', 'david'],
  [1952, 'מרים נולדת', 'miriam'],
  [1978, 'אסתר מקליטה את סיפורה', 'esther'],
  [1985, 'נועה נולדת', 'noa'],
  [2009, 'דוד נפטר; הסדנה עוברת ליוסף', 'yosef'],
  [2024, 'הארכיון המשפחתי נפתח', 'noa'],
];

interface ArchiveSeed {
  kind: ArchiveKind;
  title: string;
  yearLabel: string;
  subject: string;
  personId: string | null;
  tileHeight: number;
}

const ARCHIVE: readonly ArchiveSeed[] = [
  { kind: 'תצלום', title: 'הסדנה ברחוב הגפן', yearLabel: '1962', subject: 'דוד', personId: 'david', tileHeight: 120 },
  { kind: 'מכתב', title: 'המכתב האחרון מלודז׳', yearLabel: '1941', subject: 'רבקה', personId: 'rivka', tileHeight: 150 },
  { kind: 'קול', title: 'אסתר מספרת · 12:40', yearLabel: '1978', subject: 'אסתר', personId: 'esther', tileHeight: 88 },
  { kind: 'תצלום', title: 'החתונה על הגג', yearLabel: '1948', subject: 'דוד ואסתר', personId: 'david', tileHeight: 130 },
  { kind: 'מסמך', title: 'תעודת עולה', yearLabel: '1946', subject: 'דוד', personId: 'david', tileHeight: 104 },
  { kind: 'חפץ', title: 'שעון הכיס של יעקב', yearLabel: '1920', subject: 'ענף הירש', personId: 'yaakov', tileHeight: 140 },
  { kind: 'מכתב', title: 'גלויה מברלין', yearLabel: '1935', subject: 'מרגוט', personId: 'margot', tileHeight: 96 },
  { kind: 'תצלום', title: 'מרים ויוסף בגן', yearLabel: '1959', subject: 'המשפחה', personId: null, tileHeight: 118 },
  { kind: 'חפץ', title: 'פמוטי השבת מלודז׳', yearLabel: 'סביב 1900', subject: 'רבקה', personId: 'rivka', tileHeight: 126 },
  { kind: 'מסמך', title: 'שטר הבית, רחוב הגפן', yearLabel: '1953', subject: 'דוד', personId: 'david', tileHeight: 100 },
];

export async function seedIfEmpty(): Promise<{ seeded: boolean }> {
  await syncGenerations();

  if ((await getMeta('seed_version')) === SEED_VERSION) return { seeded: false };

  const counted = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM people');
  if ((counted?.count ?? 0) > 0) {
    // Someone has already populated this database. Record the version so we
    // stop checking, but never touch their data.
    await setMeta('seed_version', SEED_VERSION);
    return { seeded: false };
  }

  await transact(async (tx) => {
    const at = nowIso();

    const INSERT_PERSON = `
      INSERT INTO people
        (id, full_name, initial, life_span, place, story, birth_year, death_year,
         branch, audio_label, x, y, is_provisional, generation_id, created_at, updated_at)
      VALUES
        (@id, @fullName, @initial, @lifeSpan, @place, @story, @birthYear, @deathYear,
         @branch, @audioLabel, @x, @y, 0, @generationId, @at, @at)
    `;
    const INSERT_MILESTONE = `
      INSERT INTO milestones (id, person_id, year_label, title, body, sort_order, created_at)
      VALUES (@id, @personId, @yearLabel, @title, @body, @sortOrder, @at)
    `;

    for (const p of PEOPLE) {
      await tx.run(INSERT_PERSON, {
        id: p.id,
        fullName: p.fullName,
        initial: p.initial,
        lifeSpan: p.lifeSpan,
        place: p.place,
        story: p.story,
        birthYear: p.birthYear,
        deathYear: p.deathYear,
        branch: p.branch,
        audioLabel: p.audioLabel ?? null,
        x: p.x,
        y: p.y,
        generationId: generationIdForYear(p.birthYear),
        at,
      });
      for (const [i, m] of p.milestones.entries()) {
        await tx.run(INSERT_MILESTONE, {
          id: newId('ms'),
          personId: p.id,
          yearLabel: m.yearLabel,
          title: m.title,
          body: m.body,
          sortOrder: i,
          at,
        });
      }
    }

    const INSERT_REL = `
      INSERT INTO relationships (id, person_id, related_person_id, type, created_at)
      VALUES (@id, @personId, @relatedPersonId, @type, @at)
    `;
    for (const [a, b] of SPOUSES) {
      await tx.run(INSERT_REL, {
        id: newId('rel'),
        personId: a,
        relatedPersonId: b,
        type: 'spouse',
        at,
      });
    }
    for (const [parent, child] of PARENTS) {
      await tx.run(INSERT_REL, {
        id: newId('rel'),
        personId: parent,
        relatedPersonId: child,
        type: 'parent',
        at,
      });
    }

    const INSERT_EVENT = `
      INSERT INTO timeline_events (id, year, title, person_id, created_at)
      VALUES (@id, @year, @title, @personId, @at)
    `;
    for (const [year, title, personId] of TIMELINE) {
      await tx.run(INSERT_EVENT, { id: newId('ev'), year, title, personId, at });
    }

    const INSERT_ARCHIVE = `
      INSERT INTO archive_items
        (id, kind, title, year_label, subject, story, person_id, tile_height, created_at)
      VALUES (@id, @kind, @title, @yearLabel, @subject, '', @personId, @tileHeight, @at)
    `;
    // Reversed so the feed's newest-first ordering matches the design's order.
    for (const [i, item] of [...ARCHIVE].reverse().entries()) {
      await tx.run(INSERT_ARCHIVE, {
        id: newId('it'),
        kind: item.kind,
        title: item.title,
        yearLabel: item.yearLabel,
        subject: item.subject,
        personId: item.personId,
        tileHeight: item.tileHeight,
        at: new Date(Date.parse(at) + i * 1000).toISOString(),
      });
    }

    // Through `tx`, not `setMeta`. The module-level helpers take a fresh
    // connection from the pool and would land outside this transaction — so a
    // rollback would leave the marker written and the archive permanently
    // unseeded, with no error to show for it.
    await tx.run(
      `INSERT INTO meta (key, value) VALUES ('seed_version', @version)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      { version: SEED_VERSION },
    );
  });

  return { seeded: true };
}
