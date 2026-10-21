// Static demo mode: when NEXT_PUBLIC_STATIC_DEMO=1, the app runs as a fully
// static site (GitHub Pages, CDN) with no server or API routes. All file data
// comes from the bundled staticDemoData.ts module (generated at build time by
// scripts/generate-static-demo.mjs).
//
// In static mode:
// - File listing, file reading, and diagram extraction use bundled data
// - Saves are no-ops (the tutorial is read-only anyway)
// - SSE live reload is disabled (no disk to watch)
// - New file creation and directory switching are hidden

import { extractMermaidBlocks } from './markdown';
import type { MdDiagramMeta } from './markdownTypes';
import { STATIC_FILES, STATIC_MARKDOWN_FILES, STATIC_FILE_CONTENTS } from './staticDemoData';

export const STATIC_DEMO: boolean = process.env.NEXT_PUBLIC_STATIC_DEMO === '1';

export function getStaticFiles(): string[] {
  return STATIC_FILES;
}

export function getStaticMarkdownFiles(): string[] {
  return STATIC_MARKDOWN_FILES;
}

export function getStaticFileContent(filename: string): string | null {
  return STATIC_FILE_CONTENTS[filename] ?? null;
}

export function getStaticMarkdownDiagrams(filename: string): MdDiagramMeta[] {
  const content = getStaticFileContent(filename);
  if (content === null) return [];
  return extractMermaidBlocks(content).map(b => ({
    index: b.index,
    title: b.title,
    startLine: b.startLine,
    endLine: b.endLine,
  }));
}
