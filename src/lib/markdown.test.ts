import { describe, it, expect } from 'vitest';
import {
  extractMermaidBlocks,
  replaceMermaidBlock,
  assertOnlyMermaidBlockChanged,
} from './markdown';

const PROSE_MD = `# Notes

Some prose here.

\`\`\`js
console.log("not a diagram");
\`\`\`

More prose.
`;

const TWO_BLOCK_MD = `# Doc

Intro text.

\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: First
\`\`\`

Middle text.

\`\`\`mermaid
flowchart TD
    A[Start] --> B[End]
\`\`\`

Outro text.
`;

describe('extractMermaidBlocks', () => {
  it('returns no blocks for markdown without mermaid fences', () => {
    expect(extractMermaidBlocks(PROSE_MD)).toEqual([]);
    expect(extractMermaidBlocks('')).toEqual([]);
    expect(extractMermaidBlocks('no fences at all, just text')).toEqual([]);
  });

  it('extracts a single block with content, offsets, lines and title', () => {
    const md = `before\n\n\`\`\`mermaid\nsequenceDiagram\n    A->>B: Hi\n\`\`\`\n\nafter\n`;
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(b.index).toBe(0);
    expect(b.content).toBe('sequenceDiagram\n    A->>B: Hi');
    expect(b.fence).toBe('```');
    expect(b.lang).toBe('mermaid');
    expect(b.meta).toBeNull();
    expect(b.title).toBe('sequenceDiagram');
    expect(b.startLine).toBe(3);
    expect(b.endLine).toBe(6);
    // offsets point at the exact block source span
    expect(md.slice(b.startOffset, b.endOffset)).toBe('```mermaid\nsequenceDiagram\n    A->>B: Hi\n```');
  });

  it('extracts multiple blocks in document order and skips other languages', () => {
    const blocks = extractMermaidBlocks(TWO_BLOCK_MD);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].index).toBe(0);
    expect(blocks[0].content).toContain('A->>B: First');
    expect(blocks[0].title).toBe('sequenceDiagram');
    expect(blocks[1].index).toBe(1);
    expect(blocks[1].content).toContain('A[Start] --> B[End]');
    expect(blocks[1].title).toBe('flowchart TD');
  });

  it('matches the mermaid language tag case-insensitively', () => {
    const md = '```Mermaid\nsequenceDiagram\nA->>B: x\n```';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('Mermaid');
  });

  it('keeps the info string after the language as meta', () => {
    const md = '```mermaid Some Title\nflowchart TD\nA-->B\n```';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].meta).toBe('Some Title');
  });

  it('ignores indented (4-space) code blocks', () => {
    const md = '    sequenceDiagram\n    A->>B: x';
    expect(extractMermaidBlocks(md)).toEqual([]);
  });

  it('supports tilde fences', () => {
    const md = '~~~mermaid\nsequenceDiagram\nA->>B: x\n~~~';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fence).toBe('~~~');
    expect(blocks[0].content).toBe('sequenceDiagram\nA->>B: x');
  });

  it('supports fences longer than three characters with inner fences', () => {
    const md = '````mermaid\n```\ninner\n```\n````';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fence).toBe('````');
    expect(blocks[0].content).toBe('```\ninner\n```');
  });

  it('supports a block at the end of the file without a trailing newline', () => {
    const md = 'text\n\n```mermaid\nsequenceDiagram\nA->>B: x\n```';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('sequenceDiagram\nA->>B: x');
    expect(md.slice(blocks[0].startOffset, blocks[0].endOffset)).toBe('```mermaid\nsequenceDiagram\nA->>B: x\n```');
  });

  it('preserves CRLF line endings in the content', () => {
    const md = '```mermaid\r\nsequenceDiagram\r\n    A->>B: x\r\n```\r\n';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('sequenceDiagram\r\n    A->>B: x');
  });

  it('de-containers blocks nested in a blockquote', () => {
    const md = '> ```mermaid\n> sequenceDiagram\n> A->>B: x\n> ```';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('sequenceDiagram\nA->>B: x');
  });

  it('keeps the %% CONFIG comment as the first line of the content', () => {
    const config = '%% CONFIG: {"version":1,"actors":{"A":{"color":"#e11d48"}}}';
    const md = `\`\`\`mermaid\n${config}\nsequenceDiagram\n    A->>B: Hi\n\`\`\``;
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content.split('\n')[0]).toBe(config);
    // the config line is not used as the title
    expect(blocks[0].title).toBe('sequenceDiagram');
  });

  it('titles an empty block as (empty diagram)', () => {
    const md = '```mermaid\n```';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('(empty diagram)');
  });
});

describe('replaceMermaidBlock', () => {
  it('replaces only the target block; everything else is byte-identical', () => {
    const updated = replaceMermaidBlock(TWO_BLOCK_MD, 1, 'flowchart LR\n    X[One] --> Y[Two]');
    expect(updated).toContain('```mermaid\nflowchart LR\n    X[One] --> Y[Two]\n```');
    // first block and all prose untouched
    expect(updated).toContain('A->>B: First');
    expect(updated.startsWith('# Doc\n\nIntro text.\n\n')).toBe(true);
    expect(updated).toContain('\nMiddle text.\n');
    expect(updated.endsWith('\nOutro text.\n')).toBe(true);
    // block count unchanged
    expect(extractMermaidBlocks(updated)).toHaveLength(2);
  });

  it('replacing a block with its own content returns the identical document', () => {
    const blocks = extractMermaidBlocks(TWO_BLOCK_MD);
    expect(replaceMermaidBlock(TWO_BLOCK_MD, 0, blocks[0].content)).toBe(TWO_BLOCK_MD);
    expect(replaceMermaidBlock(TWO_BLOCK_MD, 1, blocks[1].content)).toBe(TWO_BLOCK_MD);
  });

  it('throws a RangeError when the index is out of range', () => {
    expect(() => replaceMermaidBlock(TWO_BLOCK_MD, 2, 'x')).toThrow(RangeError);
    expect(() => replaceMermaidBlock(TWO_BLOCK_MD, -1, 'x')).toThrow(RangeError);
    expect(() => replaceMermaidBlock('no blocks', 0, 'x')).toThrow(RangeError);
  });

  it('keeps the config comment as the first line when saving an edited diagram', () => {
    const config = '%% CONFIG: {"version":1,"actors":{"A":{"color":"#e11d48"}}}';
    const md = `prose\n\n\`\`\`mermaid\n${config}\nsequenceDiagram\n    A->>B: Hi\n\`\`\`\n`;
    const updated = replaceMermaidBlock(md, 0, `${config}\nsequenceDiagram\n    A->>B: Edited`);
    const blocks = extractMermaidBlocks(updated);
    expect(blocks[0].content.split('\n')[0]).toBe(config);
    expect(blocks[0].content).toContain('A->>B: Edited');
    expect(updated.startsWith('prose\n\n')).toBe(true);
  });

  it('preserves CRLF line endings inside the block', () => {
    const md = '```mermaid\r\nsequenceDiagram\r\n    A->>B: x\r\n```\r\ntail\r\n';
    const updated = replaceMermaidBlock(md, 0, 'sequenceDiagram\n    A->>B: y');
    expect(updated).toBe('```mermaid\r\nsequenceDiagram\r\n    A->>B: y\r\n```\r\ntail\r\n');
  });

  it('strips trailing blank lines from the new content', () => {
    const md = '```mermaid\nsequenceDiagram\nA->>B: x\n```';
    const updated = replaceMermaidBlock(md, 0, 'sequenceDiagram\nA->>B: y\n\n\n');
    expect(updated).toBe('```mermaid\nsequenceDiagram\nA->>B: y\n```');
  });

  it('preserves blockquote prefixes on every line', () => {
    const md = '> ```mermaid\n> sequenceDiagram\n> A->>B: x\n> ```\nafter\n';
    const updated = replaceMermaidBlock(md, 0, 'sequenceDiagram\nA->>B: y\nB-->>A: z');
    expect(updated).toBe('> ```mermaid\n> sequenceDiagram\n> A->>B: y\n> B-->>A: z\n> ```\nafter\n');
    // still parses as one block inside the blockquote
    const blocks = extractMermaidBlocks(updated);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('sequenceDiagram\nA->>B: y\nB-->>A: z');
  });

  it('preserves list-item indentation on every line', () => {
    const md = '- item\n\n  ```mermaid\n  sequenceDiagram\n  A->>B: x\n  ```\n';
    const updated = replaceMermaidBlock(md, 0, 'sequenceDiagram\nA->>B: y\nB-->>A: z');
    expect(updated).toBe('- item\n\n  ```mermaid\n  sequenceDiagram\n  A->>B: y\n  B-->>A: z\n  ```\n');
    const blocks = extractMermaidBlocks(updated);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('sequenceDiagram\nA->>B: y\nB-->>A: z');
  });

  it('extends the fence when the new content would terminate the block early', () => {
    const md = '```mermaid\nsequenceDiagram\nA->>B: x\n```\n';
    const updated = replaceMermaidBlock(md, 0, 'note over A\n```\nend\n```');
    // the fence grew so the ``` line stays inside the block
    expect(updated.startsWith('````mermaid\n')).toBe(true);
    expect(updated.endsWith('\n````\n')).toBe(true);
    const blocks = extractMermaidBlocks(updated);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('note over A\n```\nend\n```');
    expect(blocks[0].fence).toBe('````');
  });

  it('does not extend a tilde fence for backtick content lines', () => {
    const md = '~~~mermaid\nsequenceDiagram\nA->>B: x\n~~~\n';
    const updated = replaceMermaidBlock(md, 0, 'note over A\n```\nend note');
    expect(updated.startsWith('~~~mermaid\n')).toBe(true);
    expect(extractMermaidBlocks(updated)[0].content).toBe('note over A\n```\nend note');
  });

  it('replacing with empty content empties the block but keeps it valid', () => {
    const md = 'before\n\n```mermaid\nsequenceDiagram\nA->>B: x\n```\n\nafter\n';
    const updated = replaceMermaidBlock(md, 0, '');
    expect(updated).toBe('before\n\n```mermaid\n```\n\nafter\n');
    expect(extractMermaidBlocks(updated)).toHaveLength(1);
    expect(extractMermaidBlocks(updated)[0].content).toBe('');
  });

  it('preserves the info string and fence indentation', () => {
    const md = 'text\n\n ```mermaid A Title\nsequenceDiagram\nA->>B: x\n ```\n';
    const updated = replaceMermaidBlock(md, 0, 'sequenceDiagram\nA->>B: y');
    expect(updated).toBe('text\n\n ```mermaid A Title\nsequenceDiagram\nA->>B: y\n ```\n');
  });
});

describe('assertOnlyMermaidBlockChanged', () => {
  it('accepts a valid single-block replacement', () => {
    const newContent = 'flowchart LR\n    X[One] --> Y[Two]';
    const updated = replaceMermaidBlock(TWO_BLOCK_MD, 1, newContent);
    expect(() =>
      assertOnlyMermaidBlockChanged(TWO_BLOCK_MD, updated, 1, newContent)
    ).not.toThrow();
  });

  it('accepts a replacement whose line endings were normalized to LF', () => {
    const md = '```mermaid\r\nsequenceDiagram\r\nA->>B: x\r\n```\r\n';
    const updated = replaceMermaidBlock(md, 0, 'sequenceDiagram\nA->>B: y');
    expect(() =>
      assertOnlyMermaidBlockChanged(md, updated, 0, 'sequenceDiagram\nA->>B: y')
    ).not.toThrow();
  });

  it('rejects when an unrelated block changed', () => {
    const updated = replaceMermaidBlock(TWO_BLOCK_MD, 1, 'flowchart LR\nX-->Y');
    // tamper: also change block 0
    const tampered = updated.replace('A->>B: First', 'A->>B: TAMPERED');
    expect(() =>
      assertOnlyMermaidBlockChanged(TWO_BLOCK_MD, tampered, 1, 'flowchart LR\nX-->Y')
    ).toThrow(/Unrelated block 0 changed/);
  });

  it('rejects when prose outside the blocks changed', () => {
    const updated = replaceMermaidBlock(TWO_BLOCK_MD, 0, 'sequenceDiagram\nA->>B: Changed');
    const tampered = updated.replace('Middle text.', 'Middle text!');
    expect(() =>
      assertOnlyMermaidBlockChanged(TWO_BLOCK_MD, tampered, 0, 'sequenceDiagram\nA->>B: Changed')
    ).toThrow(/outside the mermaid blocks changed/);
  });

  it('rejects when the target block does not hold the expected content', () => {
    const updated = replaceMermaidBlock(TWO_BLOCK_MD, 0, 'sequenceDiagram\nA->>B: Changed');
    expect(() =>
      assertOnlyMermaidBlockChanged(TWO_BLOCK_MD, updated, 0, 'something else entirely')
    ).toThrow(/does not match the expected replacement/);
  });

  it('rejects when the block count changed', () => {
    const md = '```mermaid\nsequenceDiagram\nA->>B: x\n```\n';
    const withTwo = `${md}\n\`\`\`mermaid\nflowchart TD\nX-->Y\n\`\`\`\n`;
    expect(() =>
      assertOnlyMermaidBlockChanged(md, withTwo, 0, 'sequenceDiagram\nA->>B: x')
    ).toThrow(/Block count changed/);
  });
});
