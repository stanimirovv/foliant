// Build wrapper for static export (GitHub Pages / CDN).
// Next.js `output: 'export'` does not support API route handlers, so this
// script temporarily moves src/app/api out of the way, runs the static build,
// then restores it. In static demo mode the client never calls the API — all
// data comes from the bundled staticDemoData.ts module.
//
// Usage: node scripts/build-static.mjs [base-path]
//   base-path: optional, e.g. /mermaid-sequence-viewer for GitHub Pages

import { renameSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const apiDir = join(root, 'src', 'app', 'api');
// Move outside src/app so Next.js doesn't pick it up as a route.
const apiBak = join(root, '.api-static-bak');

const basePath = process.argv[2] || '';
const env = {
  ...process.env,
  STATIC_EXPORT: '1',
  NEXT_PUBLIC_STATIC_DEMO: '1',
  ...(basePath ? { BASE_PATH: basePath } : {}),
};

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: root, env });
}

// 1. Generate the static data module.
run('node scripts/generate-static-demo.mjs');

// 2. Move API routes out of the way (static export can't have them).
let apiMoved = false;
if (existsSync(apiDir)) {
  renameSync(apiDir, apiBak);
  apiMoved = true;
}

// 3. Build (always restore API routes, even on failure).
try {
  run('npx next build');
} finally {
  if (apiMoved && existsSync(apiBak)) {
    renameSync(apiBak, apiDir);
  }
}

// 4. Add .nojekyll for GitHub Pages (so _next/ is served correctly).
try {
  writeFileSync(join(root, 'out', '.nojekyll'), '');
} catch {
  // non-fatal
}

console.log('\nStatic build complete → out/');
if (basePath) {
  console.log(`Deploy to GitHub Pages at: https://<username>.github.io${basePath}/`);
}
