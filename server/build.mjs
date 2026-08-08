import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

// Two entry points: the long-running server, and the migration step that
// applies the schema and loads the sample family. Everything is bundled, so
// `node dist/index.js` runs with no resolution step at boot — there is no
// native addon left to keep external now that the database is Postgres.
//
// The serverless function is not built here. Vercel compiles api/index.ts
// itself, from source, so that a deploy never depends on this having run first.
await build({
  entryPoints: ['src/index.ts', 'src/db/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  minify: false,
  // esbuild's ESM output does not define these, but bundled CJS deps expect them.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});

// schema.sql is read at runtime, so it has to sit next to the bundle.
await mkdir('dist/db', { recursive: true });
await cp('src/db/schema.sql', 'dist/db/schema.sql');

console.log('server bundled -> dist/index.js, dist/db/migrate.js');
