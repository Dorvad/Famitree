import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

// Three entry points: the long-running server, the app on its own for the
// serverless function to import, and the migration step that applies the
// schema and loads the sample family.
//
// The function imports `dist/app.js` rather than the TypeScript source on
// purpose. The sources import each other with explicit `.ts` extensions, which
// needs `allowImportingTsExtensions` and a resolver that honours it; handing
// the platform one plain, already-bundled ESM file removes that from the list
// of things that have to be true for a deploy to work.
await build({
  entryPoints: ['src/index.ts', 'src/app.ts', 'src/db/migrate.ts'],
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

console.log('server bundled -> dist/index.js, dist/app.js, dist/db/migrate.js');
