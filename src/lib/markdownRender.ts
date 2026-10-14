// Rendering support for the rich markdown editor (MarkdownEditor).
//
// A markdown document is split into segments using the SAME mdast-based block
// extraction as the embedded-diagram save path (lib/markdown), so the preview
// shows exactly the blocks that are editable through diagram selection — the
// mermaid segment indexes match the `diagram` URL param and the
// /api/markdown/diagram?index=N API. Text segments are rendered to HTML with
// marked; mermaid segments are rendered to SVG by the component (mermaid is
// async, so it cannot run in this pure helper).

import { marked } from 'marked';
import { extractMermaidBlocks } from './markdown';

export type MarkdownSegment =
  | { type: 'markdown'; text: string }
  | {
      type: 'mermaid';
      index: number;      // 0-based position among the mermaid blocks (matches the diagram URL param)
      content: string;    // inner source of the fenced block
      title: string;      // first meaningful line (for the block header)
      startLine: number;  // 1-based line of the opening fence
      endLine: number;    // 1-based line of the closing fence
    };

// Split a markdown document into alternating text/mermaid segments, in
// document order. Whitespace-only text segments are dropped.
export function splitMarkdownSegments(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let cursor = 0;
  for (const block of extractMermaidBlocks(markdown)) {
    if (block.startOffset > cursor) {
      const text = markdown.slice(cursor, block.startOffset);
      if (text.trim()) segments.push({ type: 'markdown', text });
    }
    segments.push({
      type: 'mermaid',
      index: block.index,
      content: block.content,
      title: block.title,
      startLine: block.startLine,
      endLine: block.endLine,
    });
    cursor = block.endOffset;
  }
  if (cursor < markdown.length) {
    const text = markdown.slice(cursor);
    if (text.trim()) segments.push({ type: 'markdown', text });
  }
  return segments;
}

// Render one text segment to HTML. GFM is on (tables, strikethrough); hard
// line breaks are off (standard markdown semantics).
export function renderMarkdownSegment(text: string): string {
  if (!text.trim()) return '';
  return marked.parse(text, { gfm: true, breaks: false, async: false });
}
