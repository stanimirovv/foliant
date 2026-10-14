// Markdown support for mermaid diagrams embedded in .md/.markdown files.
//
// Detection and replacement are built on mdast (mdast-util-from-markdown), so
// a fenced block is located by its exact source offsets — never by regex over
// the raw text. Replacing a diagram splices ONLY the inner content of the
// target block: the fences, the info string, the fence indentation and any
// container prefixes (blockquote "> ", list indentation) are preserved
// byte-for-byte, and everything outside the block is untouched.

import { fromMarkdown } from 'mdast-util-from-markdown';

export interface MermaidBlock {
  index: number;        // 0-based position among the mermaid blocks of the file
  content: string;      // inner source of the block (original line endings kept)
  startOffset: number;  // offset of the opening fence
  endOffset: number;    // offset just after the closing fence
  startLine: number;    // 1-based line of the opening fence
  endLine: number;      // 1-based line of the closing fence
  fence: string;        // the fence marker, e.g. "```" or "~~~~"
  lang: string;         // the language tag as written, e.g. "mermaid"
  meta: string | null;  // info string after the language, e.g. "Some Title"
  title: string;        // human-readable first meaningful line
}

// Minimal structural view of the mdast nodes we rely on (avoids depending on
// @types/mdast directly).
interface MdNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  position?: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  };
  children?: MdNode[];
}

// Internal: a mermaid block plus everything needed to splice it safely.
interface ParsedBlock extends MermaidBlock {
  fenceChar: string;
  fenceLen: number;
  eol: '\n' | '\r\n';
  innerStart: number;   // absolute offset where the inner content begins
  innerEnd: number;     // absolute offset where the inner content ends (incl. trailing EOL)
  prefixes: string[];   // per-line container prefixes of the original inner content
}

const MERMAID_LANG = 'mermaid';
const MAX_TITLE_LENGTH = 60;

function collectCodeNodes(node: MdNode, out: MdNode[] = []): MdNode[] {
  for (const child of node.children ?? []) {
    if (child.type === 'code') out.push(child);
    collectCodeNodes(child, out);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockTitle(content: string): string {
  const truncate = (line: string) =>
    line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
  const lines = content.split('\n');
  // Prefer the first "real" line: the %% CONFIG:/%% VIEWS: comment is config,
  // not a title.
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    return truncate(line);
  }
  const firstNonEmpty = lines.find(l => l.trim())?.trim();
  return firstNonEmpty ? truncate(firstNonEmpty) : '(empty diagram)';
}

function parseBlock(markdown: string, node: MdNode, index: number): ParsedBlock {
  const start = node.position!.start;
  const end = node.position!.end;
  const startOffset = start.offset;
  const endOffset = end.offset;
  const blockSrc = markdown.slice(startOffset, endOffset);

  const fenceMatch = blockSrc.match(/^(`{3,}|~{3,})/);
  if (!fenceMatch) {
    throw new Error(`Malformed fenced code block at offset ${startOffset}`);
  }
  const fence = fenceMatch[1];
  const fenceChar = fence[0];
  const fenceLen = fence.length;

  // The node span starts at the fence itself (fence indentation and container
  // markers like "> " precede it and are not part of the span).
  const firstNl = blockSrc.indexOf('\n');
  if (firstNl === -1) {
    throw new Error(`Malformed fenced code block at offset ${startOffset}`);
  }
  const eol: '\n' | '\r\n' = blockSrc.slice(0, firstNl).endsWith('\r') ? '\r\n' : '\n';
  const innerStart = startOffset + firstNl + 1;
  const lastNl = blockSrc.lastIndexOf('\n');
  // The span includes the EOL of the last content line (the '\n' before the
  // closing fence), so a replacement always re-emits a trailing EOL.
  const innerEnd = startOffset + lastNl + 1;

  // Per-line container prefixes: mdast strips them from `value`, so the prefix
  // of each inner line is what remains when the value line is removed.
  const innerRaw = markdown.slice(innerStart, innerEnd);
  const innerLines = innerRaw.split('\n').map(l => l.replace(/\r$/, ''));
  if (innerLines.length > 0 && innerLines[innerLines.length - 1] === '') {
    innerLines.pop(); // artifact of the trailing EOL included in the span
  }
  const valueLines = (node.value ?? '').split('\n').map(l => l.replace(/\r$/, ''));
  const prefixes = innerLines.map((line, i) => {
    const valueLine = valueLines[i];
    if (valueLine === undefined || !line.endsWith(valueLine)) return '';
    return line.slice(0, line.length - valueLine.length);
  });

  return {
    index,
    content: node.value ?? '',
    startOffset,
    endOffset,
    startLine: start.line,
    endLine: end.line,
    fence,
    lang: node.lang ?? '',
    meta: node.meta ?? null,
    title: blockTitle(node.value ?? ''),
    fenceChar,
    fenceLen,
    eol,
    innerStart,
    innerEnd,
    prefixes,
  };
}

function parseMermaidBlocks(markdown: string): ParsedBlock[] {
  if (!markdown) return [];
  const tree = fromMarkdown(markdown) as unknown as MdNode;
  return collectCodeNodes(tree)
    .filter(n => typeof n.lang === 'string' && n.lang.toLowerCase() === MERMAID_LANG)
    .map((node, index) => parseBlock(markdown, node, index));
}

// All mermaid fenced code blocks of a markdown document, in document order.
// Only blocks explicitly tagged ```mermaid (any case) are detected; indented
// code blocks and other languages are ignored.
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  return parseMermaidBlocks(markdown).map(({ content, startOffset, endOffset, startLine, endLine, fence, lang, meta, title, index }) => ({
    index,
    content,
    startOffset,
    endOffset,
    startLine,
    endLine,
    fence,
    lang,
    meta,
    title,
  }));
}

// Replace the inner content of the mermaid block at `index` with `content`.
// Everything else in the document — including the fences, the info string and
// any blockquote/list prefixes — is preserved byte-for-byte. Throws a
// RangeError when there is no mermaid block at `index`.
export function replaceMermaidBlock(markdown: string, index: number, content: string): string {
  const blocks = parseMermaidBlocks(markdown);
  const block = blocks[index];
  if (!block) {
    throw new RangeError(`No mermaid block at index ${index} (document has ${blocks.length})`);
  }

  // Normalize the new content: LF line endings, no trailing blank lines.
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  const newLines = normalized === '' ? [] : normalized.split('\n');

  // Fence safety: a content line whose leading run of the fence character is
  // at least as long as the fence would terminate the block early. Extend the
  // fence (opening and closing runs only) when that would happen.
  const fenceRunRe = new RegExp(`^${escapeRegExp(block.fenceChar)}+`);
  let maxRun = 0;
  for (const line of newLines) {
    const m = line.match(fenceRunRe);
    if (m && m[0].length > maxRun) maxRun = m[0].length;
  }
  const extendFence = maxRun >= block.fenceLen;
  const newFence = extendFence ? block.fenceChar.repeat(maxRun + 1) : block.fence;

  const prefixFor = (i: number) =>
    block.prefixes[Math.min(i, block.prefixes.length - 1)] ?? '';
  const newInner = newLines.length === 0
    ? ''
    : newLines.map((line, i) => prefixFor(i) + line).join(block.eol) + block.eol;

  const spans: Array<{ start: number; end: number; text: string }> = [
    { start: block.innerStart, end: block.innerEnd, text: newInner },
  ];
  if (extendFence) {
    // Opening fence run: the block span starts at the fence itself.
    spans.push({ start: block.startOffset, end: block.startOffset + block.fenceLen, text: newFence });
    // Closing fence run: the run of fence characters on the last line of the
    // block (blockquote markers and trailing whitespace are not part of it).
    const blockSrc = markdown.slice(block.startOffset, block.endOffset);
    const lastLine = blockSrc.slice(blockSrc.lastIndexOf('\n') + 1);
    const runMatch = lastLine.match(new RegExp(`${escapeRegExp(block.fenceChar)}{3,}`));
    if (!runMatch || runMatch.index === undefined) {
      throw new Error(`Malformed closing fence at offset ${block.endOffset}`);
    }
    const lastLineStart = block.endOffset - lastLine.length;
    const closeRunStart = lastLineStart + runMatch.index;
    spans.push({ start: closeRunStart, end: closeRunStart + runMatch[0].length, text: newFence });
  }

  spans.sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += markdown.slice(cursor, span.start) + span.text;
    cursor = span.end;
  }
  result += markdown.slice(cursor);
  return result;
}

// Safety net for the save path: verifies that `newMarkdown` differs from
// `oldMarkdown` ONLY in the content of the mermaid block at `index` (which
// must equal `expectedContent` after EOL normalization). Throws otherwise, so
// a save job can refuse to write a corrupted file.
export function assertOnlyMermaidBlockChanged(
  oldMarkdown: string,
  newMarkdown: string,
  index: number,
  expectedContent: string,
): void {
  const oldBlocks = extractMermaidBlocks(oldMarkdown);
  const newBlocks = extractMermaidBlocks(newMarkdown);
  if (oldBlocks.length !== newBlocks.length) {
    throw new Error(`Block count changed: ${oldBlocks.length} -> ${newBlocks.length}`);
  }
  const normalize = (s: string) => s.replace(/\r\n/g, '\n');
  for (let i = 0; i < oldBlocks.length; i++) {
    if (i === index) {
      if (normalize(newBlocks[i].content) !== normalize(expectedContent)) {
        throw new Error(`Block ${index} content does not match the expected replacement`);
      }
    } else if (newBlocks[i].content !== oldBlocks[i].content) {
      throw new Error(`Unrelated block ${i} changed`);
    }
  }
  // Everything outside the mermaid blocks must be byte-identical.
  const segments = (md: string, blocks: MermaidBlock[]): string[] => {
    const segs: string[] = [];
    let cursor = 0;
    for (const b of blocks) {
      segs.push(md.slice(cursor, b.startOffset));
      cursor = b.endOffset;
    }
    segs.push(md.slice(cursor));
    return segs;
  };
  const oldSegs = segments(oldMarkdown, oldBlocks);
  const newSegs = segments(newMarkdown, newBlocks);
  if (oldSegs.length !== newSegs.length) {
    throw new Error('Segment count changed');
  }
  for (let i = 0; i < oldSegs.length; i++) {
    if (oldSegs[i] !== newSegs[i]) {
      throw new Error(`Content outside the mermaid blocks changed (segment ${i})`);
    }
  }
}
