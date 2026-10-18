// Block-level model for the WYSIWYG markdown editor.
//
// A markdown document is parsed into an ordered list of top-level blocks.
// Each block maps 1:1 to a contiguous source range (startOffset/endOffset),
// so editing a block is a simple string splice — no HTML→markdown
// serialization needed. Mermaid fenced blocks reuse the metadata from
// lib/markdown (extractMermaidBlocks) so the block index matches the
// `diagram` URL param and the /api/markdown/diagram?index=N API.
//
// All mutation functions are pure: they take the full document and return a
// new full document string. The caller re-parses after every mutation, so
// no cross-edit offset tracking is needed.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { extractMermaidBlocks } from './markdown';

export type TextBlock = {
  kind: 'text';
  nodeType: string;        // mdast node type: 'heading' | 'paragraph' | 'list' | 'code' | 'blockquote' | 'thematicBreak' | 'html' | ...
  headingDepth?: number;   // for heading nodes
  startOffset: number;
  endOffset: number;
  source: string;          // markdown.slice(startOffset, endOffset)
};

export type MermaidBlockRef = {
  kind: 'mermaid';
  index: number;           // 0-based among mermaid blocks (matches the diagram URL param)
  content: string;         // inner source of the fenced block
  title: string;           // first meaningful line (for the block header)
  startLine: number;       // 1-based line of the opening fence
  endLine: number;         // 1-based line of the closing fence
  startOffset: number;     // offset of the opening fence
  endOffset: number;       // offset just after the closing fence
  source: string;          // the full fenced block including fences
};

export type MarkdownBlock = TextBlock | MermaidBlockRef;

// Minimal structural view of mdast nodes (avoids depending on @types/mdast
// directly, matching the pattern in lib/markdown.ts).
interface MdNode {
  type: string;
  lang?: string | null;
  depth?: number;
  position?: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  };
  children?: MdNode[];
}

// Parse a markdown document into an ordered list of blocks. Mermaid fenced
// blocks become MermaidBlockRef (with index/title/line info); every other
// top-level mdast node becomes a TextBlock. Empty/whitespace-only documents
// return [].
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  if (!markdown || !markdown.trim()) return [];

  const tree = fromMarkdown(markdown) as unknown as MdNode;
  if (!tree.children || tree.children.length === 0) return [];

  // Index mermaid blocks by their opening-fence offset for O(1) lookup.
  const mermaidByOffset = new Map<number, ReturnType<typeof extractMermaidBlocks>[number]>();
  for (const block of extractMermaidBlocks(markdown)) {
    mermaidByOffset.set(block.startOffset, block);
  }

  const blocks: MarkdownBlock[] = [];
  for (const child of tree.children) {
    if (!child.position) continue;
    const startOffset = child.position.start.offset;
    const endOffset = child.position.end.offset;

    // Mermaid fenced block: reuse the rich metadata from lib/markdown.
    if (child.type === 'code' && typeof child.lang === 'string' && child.lang.toLowerCase() === 'mermaid') {
      const mermaidBlock = mermaidByOffset.get(startOffset);
      if (mermaidBlock) {
        blocks.push({
          kind: 'mermaid',
          index: mermaidBlock.index,
          content: mermaidBlock.content,
          title: mermaidBlock.title,
          startLine: mermaidBlock.startLine,
          endLine: mermaidBlock.endLine,
          startOffset: mermaidBlock.startOffset,
          endOffset: mermaidBlock.endOffset,
          source: markdown.slice(mermaidBlock.startOffset, mermaidBlock.endOffset),
        });
        continue;
      }
    }

    // Text block: any other top-level node.
    blocks.push({
      kind: 'text',
      nodeType: child.type,
      headingDepth: child.type === 'heading' ? child.depth : undefined,
      startOffset,
      endOffset,
      source: markdown.slice(startOffset, endOffset),
    });
  }

  return blocks;
}

// Replace the source of the block at `blockIndex` with `newSource`. Returns
// the new full document. Throws RangeError when there is no block at
// `blockIndex`.
export function replaceBlockSource(markdown: string, blockIndex: number, newSource: string): string {
  const blocks = parseMarkdownBlocks(markdown);
  const block = blocks[blockIndex];
  if (!block) {
    throw new RangeError(`No block at index ${blockIndex} (document has ${blocks.length})`);
  }
  return markdown.slice(0, block.startOffset) + newSource + markdown.slice(block.endOffset);
}

// Insert a new block after the block at `blockIndex` (or at the very start
// when `blockIndex === -1`). The new source is separated from surrounding
// blocks by a blank line. Returns the new full document.
export function insertBlockAfter(markdown: string, blockIndex: number, source: string): string {
  const blocks = parseMarkdownBlocks(markdown);

  if (blockIndex === -1) {
    // Insert at the very start.
    const trimmed = source.replace(/\n+$/, '');
    return trimmed + (markdown.length > 0 ? '\n\n' + markdown.replace(/^\n+/, '') : '');
  }

  const block = blocks[blockIndex];
  if (!block) {
    throw new RangeError(`No block at index ${blockIndex} (document has ${blocks.length})`);
  }

  const trimmed = source.replace(/\n+$/, '');
  const insertAt = block.endOffset;
  const after = markdown.slice(insertAt);

  // If the block is at the end of the document, just append.
  if (after.trim() === '') {
    return markdown.slice(0, insertAt) + '\n\n' + trimmed + '\n';
  }

  // Insert between the block and whatever follows (blank lines included in
  // `after` are preserved — we insert before them).
  return markdown.slice(0, insertAt) + '\n\n' + trimmed + after;
}

// Block types for the WYSIWYG block-type switcher.
export type BlockType =
  | 'paragraph'
  | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6'
  | 'bulletList' | 'numberedList'
  | 'quote'
  | 'code';

// Convert a block's source to a different block type. The conversion is pure
// source manipulation: it strips the existing block-level prefix (heading
// markers, list markers, quote markers, code fences) to get the core content,
// then applies the target type's prefix/wrapper. Multi-line content is
// handled per-line for lists and quotes.
export function convertBlockType(source: string, targetType: BlockType): string {
  const lines = source.split('\n');
  let coreLines = lines;

  // Strip heading marker from the first line.
  if (lines[0].match(/^#{1,6}\s/)) {
    coreLines = [lines[0].replace(/^#{1,6}\s/, ''), ...lines.slice(1)];
  }
  // Strip quote markers from every line.
  else if (lines[0].startsWith('>')) {
    coreLines = lines.map(l => l.replace(/^>\s?/, ''));
  }
  // Strip bullet list markers from every line.
  else if (lines[0].match(/^[-*+]\s/)) {
    coreLines = lines.map(l => l.replace(/^[-*+]\s/, ''));
  }
  // Strip numbered list markers from every line.
  else if (lines[0].match(/^\d+\.\s/)) {
    coreLines = lines.map(l => l.replace(/^\d+\.\s/, ''));
  }
  // Strip code fences.
  else if (lines[0].startsWith('```')) {
    const endIdx = lines[lines.length - 1].startsWith('```') ? lines.length - 1 : lines.length;
    coreLines = lines.slice(1, endIdx);
  }

  const core = coreLines.join('\n').trim();
  if (!core) return '';

  switch (targetType) {
    case 'paragraph': return core;
    case 'heading1': return `# ${core}`;
    case 'heading2': return `## ${core}`;
    case 'heading3': return `### ${core}`;
    case 'heading4': return `#### ${core}`;
    case 'heading5': return `##### ${core}`;
    case 'heading6': return `###### ${core}`;
    case 'bulletList': return core.split('\n').map(l => `- ${l}`).join('\n');
    case 'numberedList': return core.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n');
    case 'quote': return core.split('\n').map(l => `> ${l}`).join('\n');
    case 'code': return '```\n' + core + '\n```';
    default: return core;
  }
}

// Diagram types that can be scaffolded as a new mermaid block.
export type DiagramInsertType = 'sequence' | 'flowchart';

// Starter content for a freshly scaffolded diagram. Also used by the
// ClientPage "+ New" dialog as the initial content of standalone .mmd files.
export const MERMAID_DIAGRAM_TEMPLATES: Record<DiagramInsertType, string> = {
  sequence: 'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    B-->>A: Hi there',
  flowchart: 'flowchart TD\n    A[Alice] --> B[Bob]\n    B -->|Reply| A',
};

// The full fenced-block source for a freshly scaffolded diagram: a valid
// ```mermaid block ready to be spliced into a markdown document.
export function scaffoldMermaidBlock(type: DiagramInsertType): string {
  return '```mermaid\n' + MERMAID_DIAGRAM_TEMPLATES[type] + '\n```';
}

// Insert a scaffolded mermaid block at block `position` (0 = before the first
// block, blocks.length = after the last — the same positions the WYSIWYG
// insert buttons report). Returns the new full document and the diagram index
// of the new block (0-based among mermaid blocks, matching the diagram URL
// param and onSelectDiagram), so the caller can open it in the diagram editor
// right away.
export function insertMermaidBlock(
  markdown: string,
  position: number,
  type: DiagramInsertType,
): { code: string; diagramIndex: number } {
  const blocks = parseMarkdownBlocks(markdown);
  if (position < 0 || position > blocks.length) {
    throw new RangeError(`No insert position ${position} (document has ${blocks.length} blocks)`);
  }
  const code = insertBlockAfter(markdown, position - 1, scaffoldMermaidBlock(type));
  const diagramIndex = blocks.slice(0, position).filter(b => b.kind === 'mermaid').length;
  return { code, diagramIndex };
}

// Delete the block at `blockIndex`. Also consumes trailing blank lines up to
// the next block (or end of document) to avoid leaving double blank lines.
// When deleting the last block, also consumes preceding blank lines back to
// the previous block. Returns the new full document.
export function deleteBlock(markdown: string, blockIndex: number): string {
  const blocks = parseMarkdownBlocks(markdown);
  const block = blocks[blockIndex];
  if (!block) {
    throw new RangeError(`No block at index ${blockIndex} (document has ${blocks.length})`);
  }

  let start = block.startOffset;
  let end = block.endOffset;

  // Consume trailing newlines up to the next block (or end of document).
  // For a middle block this removes the blank lines AFTER the deleted block;
  // the blank lines BEFORE it remain as the separator between prev and next.
  const nextBlock = blocks[blockIndex + 1];
  const maxEnd = nextBlock ? nextBlock.startOffset : markdown.length;
  while (end < maxEnd && markdown[end] === '\n') end++;

  // When deleting the LAST block, also consume preceding blank lines back to
  // the previous block so no trailing blank lines are left behind.
  if (!nextBlock && blockIndex > 0) {
    const prevBlock = blocks[blockIndex - 1];
    while (start > prevBlock.endOffset && markdown[start - 1] === '\n') start--;
  }

  let result = markdown.slice(0, start) + markdown.slice(end);

  // Trim trailing whitespace-only content (but keep a single trailing newline).
  result = result.replace(/\n{3,}$/, '\n\n');
  if (result.length > 0 && !result.endsWith('\n')) {
    result += '\n';
  }

  return result;
}
