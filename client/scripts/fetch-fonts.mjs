/**
 * Downloads the Heebo and Suez One subsets the app uses and writes a local
 * @font-face sheet, so nothing is fetched from a third party at runtime.
 *
 * Both families are licensed under the SIL Open Font License 1.1, which permits
 * redistribution alongside the app.
 *
 * Run with: npm run fonts:fetch -w client
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Suez+One&family=Heebo:wght@300;400;600;700&display=swap';

// The API serves modern woff2 only when it believes the caller is a current
// browser; a bare fetch gets the legacy ttf sheet instead.
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Hebrew for the content, latin for the occasional year or place name.
const WANTED_SUBSETS = new Set(['hebrew', 'latin']);

await mkdir(OUT_DIR, { recursive: true });

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
const blocks = [...css.matchAll(/\/\* (\S+) \*\/\s*@font-face \{([^}]+)\}/g)];

const faces = [];
const seen = new Set();

for (const [, subset, body] of blocks) {
  if (!WANTED_SUBSETS.has(subset)) continue;

  const family = /font-family:\s*['"]?([^'";]+)['"]?\s*;/.exec(body)?.[1].trim();
  const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim();
  const src = /url\((https:[^)]+)\)/.exec(body)?.[1];
  if (!family || !weight || !src) continue;

  const slug = `${family.toLowerCase().replace(/\s+/g, '-')}-${weight}-${subset}.woff2`;
  if (seen.has(slug)) continue;
  seen.add(slug);

  const bytes = Buffer.from(
    await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer(),
  );
  await writeFile(path.join(OUT_DIR, slug), bytes);
  console.log(`${slug}  ${(bytes.length / 1024).toFixed(1)}kb`);

  faces.push(
    [
      '@font-face {',
      `  font-family: "${family}";`,
      '  font-style: normal;',
      `  font-weight: ${weight};`,
      '  font-display: swap;',
      `  src: url("/fonts/${slug}") format("woff2");`,
      `  unicode-range: ${range};`,
      '}',
    ].join('\n'),
  );
}

await writeFile(
  path.join(OUT_DIR, 'fonts.css'),
  [
    '/* Self-hosted subsets of Heebo and Suez One, both under the SIL Open Font',
    '   License 1.1. Generated from the Google Fonts CSS API, hebrew + latin',
    '   ranges only, so no request leaves the app at runtime.',
    '   Regenerate with: npm run fonts:fetch -w client */',
    '',
    faces.join('\n\n'),
    '',
  ].join('\n'),
);

console.log(`\nwrote fonts.css with ${faces.length} faces`);
