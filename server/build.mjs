import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

// better-sqlite3 is a native addon and must stay external; everything else is
// bundled into a single file so `node dist/index.js` runs with no resolution
// step at boot.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  minify: false,
  external: ['better-sqlite3'],
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

console.log('server bundled -> dist/index.js');
