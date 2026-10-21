const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const standaloneDir = path.join(rootDir, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  console.error('[prepare-standalone] .next/standalone not found. Did next build run?');
  process.exit(1);
}

// 1. Copy public -> .next/standalone/public
const publicSrc = path.join(rootDir, 'public');
const publicDest = path.join(standaloneDir, 'public');
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true });
  console.log('[prepare-standalone] Copied public/ -> .next/standalone/public/');
}

// 2. Copy .next/static -> .next/standalone/.next/static
const staticSrc = path.join(rootDir, '.next', 'static');
const staticDest = path.join(standaloneDir, '.next', 'static');
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDest, { recursive: true });
  console.log('[prepare-standalone] Copied .next/static/ -> .next/standalone/.next/static/');
}

// 3. Copy diagrams -> .next/standalone/diagrams (if present)
const diagramsSrc = path.join(rootDir, 'diagrams');
const diagramsDest = path.join(standaloneDir, 'diagrams');
if (fs.existsSync(diagramsSrc)) {
  fs.cpSync(diagramsSrc, diagramsDest, { recursive: true });
  console.log('[prepare-standalone] Copied diagrams/ -> .next/standalone/diagrams/');
}

console.log('[prepare-standalone] Standalone build prepared successfully.');
