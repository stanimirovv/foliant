import { describe, it, expect } from 'vitest';
import {
  parseMarkdownBlocks,
  replaceBlockSource,
  insertBlockAfter,
  insertMermaidBlock,
  scaffoldMermaidBlock,
  MERMAID_DIAGRAM_TEMPLATES,
  deleteBlock,
  convertBlockType,
  type TextBlock,
  type MermaidBlockRef,
} from './markdownBlocks';

const MD = `# Architecture Notes

Intro prose with **bold** text.

\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: First diagram
\`\`\`

Middle prose.

\`\`\`mermaid
flowchart TD
    A --> B
\`\`\`

\`\`\`js
console.log("not a diagram");
\`\`\`

Trailing prose.
`;

function textBlocks(blocks: ReturnType<typeof parseMarkdownBlocks>): TextBlock[] {
  return blocks.filter((b): b is TextBlock => b.kind === 'text');
}

function mermaidBlocks(blocks: ReturnType<typeof parseMarkdownBlocks>): MermaidBlockRef[] {
  return blocks.filter((b): b is MermaidBlockRef => b.kind === 'mermaid');
}

describe('parseMarkdownBlocks', () => {
  it('parses a document into ordered text and mermaid blocks', () => {
    const blocks = parseMarkdownBlocks(MD);
    expect(blocks.map(b => b.kind)).toEqual([
      'text',    // # Architecture Notes
      'text',    // Intro prose with **bold** text.
      'mermaid', // first diagram
      'text',    // Middle prose.
      'mermaid', // second diagram
      'text',    // ```js code block
      'text',    // Trailing prose.
    ]);
  });

  it('gives every block correct offsets: slice(start, end) === source', () => {
    const blocks = parseMarkdownBlocks(MD);
    for (const block of blocks) {
      expect(MD.slice(block.startOffset, block.endOffset)).toBe(block.source);
    }
  });

  it('identifies heading blocks with their depth', () => {
    const blocks = textBlocks(parseMarkdownBlocks('# H1\n\n## H2\n\n### H3\n'));
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ nodeType: 'heading', headingDepth: 1, source: '# H1' });
    expect(blocks[1]).toMatchObject({ nodeType: 'heading', headingDepth: 2, source: '## H2' });
    expect(blocks[2]).toMatchObject({ nodeType: 'heading', headingDepth: 3, source: '### H3' });
  });

  it('identifies paragraph, list, blockquote, code, and thematicBreak blocks', () => {
    const md = 'A paragraph.\n\n- item 1\n- item 2\n\n> a quote\n\n```js\ncode\n```\n\n---\n';
    const blocks = textBlocks(parseMarkdownBlocks(md));
    expect(blocks.map(b => b.nodeType)).toEqual([
      'paragraph',
      'list',
      'blockquote',
      'code',
      'thematicBreak',
    ]);
  });

  it('identifies mermaid blocks with index, content, title and line info', () => {
    const blocks = mermaidBlocks(parseMarkdownBlocks(MD));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: 'mermaid',
      index: 0,
      title: 'sequenceDiagram',
      startLine: 5,
      endLine: 10,
    });
    expect(blocks[0].content).toContain('A->>B: First diagram');
    expect(blocks[0].source).toContain('```mermaid');
    expect(blocks[1]).toMatchObject({
      kind: 'mermaid',
      index: 1,
      title: 'flowchart TD',
    });
  });

  it('keeps non-mermaid fenced code blocks as text blocks', () => {
    const blocks = textBlocks(parseMarkdownBlocks(MD));
    const codeBlock = blocks.find(b => b.source.includes('console.log'));
    expect(codeBlock).toBeTruthy();
    expect(codeBlock!.nodeType).toBe('code');
  });

  it('returns an empty list for an empty document', () => {
    expect(parseMarkdownBlocks('')).toEqual([]);
    expect(parseMarkdownBlocks('   \n  \n')).toEqual([]);
    expect(parseMarkdownBlocks('\n\n\n')).toEqual([]);
  });

  it('handles a document that starts with a mermaid block', () => {
    const md = '```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n\nText after.\n';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('mermaid');
    expect(blocks[1].kind).toBe('text');
  });

  it('handles a document that ends with a mermaid block', () => {
    const md = 'Text before.\n\n```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('text');
    expect(blocks[1].kind).toBe('mermaid');
  });

  it('handles a document with only a mermaid block', () => {
    const md = '```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('mermaid');
  });

  it('handles nested lists as a single block', () => {
    const md = '- outer\n  - inner\n- outer 2\n';
    const blocks = textBlocks(parseMarkdownBlocks(md));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].nodeType).toBe('list');
    expect(blocks[0].source).toBe('- outer\n  - inner\n- outer 2');
  });

  it('handles HTML blocks as text blocks', () => {
    const md = '<div>hello</div>\n';
    const blocks = textBlocks(parseMarkdownBlocks(md));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].nodeType).toBe('html');
  });

  it('handles a table as a text block (source preserved)', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const blocks = textBlocks(parseMarkdownBlocks(md));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe('| a | b |\n|---|---|\n| 1 | 2 |');
  });

  it('handles CRLF line endings', () => {
    const md = '# Heading\r\n\r\nParagraph.\r\n';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(md.slice(block.startOffset, block.endOffset)).toBe(block.source);
    }
  });

  it('round-trip: block sources + inter-block text reproduce the original', () => {
    const blocks = parseMarkdownBlocks(MD);
    let reconstructed = '';
    let cursor = 0;
    for (const block of blocks) {
      reconstructed += MD.slice(cursor, block.startOffset); // inter-block text
      reconstructed += block.source;
      cursor = block.endOffset;
    }
    reconstructed += MD.slice(cursor); // trailing text
    expect(reconstructed).toBe(MD);
  });
});

describe('replaceBlockSource', () => {
  it('replaces a text block source', () => {
    const blocks = parseMarkdownBlocks(MD);
    const heading = blocks[0];
    const result = replaceBlockSource(MD, 0, '# New Title');
    expect(result).toContain('# New Title');
    expect(result).not.toContain('# Architecture Notes');
    // surrounding content is preserved
    expect(result).toContain('Intro prose with **bold** text.');
    expect(result).toContain('```mermaid');
    expect(result).toContain('Trailing prose.');
    // offset check: the heading is the only thing that changed
    expect(heading.source).toBe('# Architecture Notes');
  });

  it('replaces a mermaid block source (full fenced block)', () => {
    const result = replaceBlockSource(MD, 2, '```mermaid\nsequenceDiagram\n    A->>B: Edited\n```');
    expect(result).toContain('A->>B: Edited');
    expect(result).not.toContain('A->>B: First diagram');
    // other blocks untouched
    expect(result).toContain('# Architecture Notes');
    expect(result).toContain('Middle prose.');
    expect(result).toContain('flowchart TD');
  });

  it('replaces a block with an empty string (effectively deletes content)', () => {
    const result = replaceBlockSource(MD, 0, '');
    expect(result).not.toContain('# Architecture Notes');
    expect(result).toContain('Intro prose with **bold** text.');
  });

  it('throws RangeError for an out-of-range index', () => {
    expect(() => replaceBlockSource(MD, 999, 'x')).toThrow(RangeError);
    expect(() => replaceBlockSource(MD, -1, 'x')).toThrow(RangeError);
  });

  it('preserves content before and after the replaced block exactly', () => {
    const md = 'Before.\n\nMiddle block.\n\nAfter.\n';
    const result = replaceBlockSource(md, 1, 'Edited middle.');
    expect(result).toBe('Before.\n\nEdited middle.\n\nAfter.\n');
  });
});

describe('insertBlockAfter', () => {
  it('inserts a block after a given block', () => {
    const md = 'First.\n\nSecond.\n';
    const result = insertBlockAfter(md, 0, 'Inserted.');
    expect(result).toBe('First.\n\nInserted.\n\nSecond.\n');
  });

  it('inserts at the very start when blockIndex is -1', () => {
    const md = 'First.\n\nSecond.\n';
    const result = insertBlockAfter(md, -1, 'New first.');
    expect(result).toBe('New first.\n\nFirst.\n\nSecond.\n');
  });

  it('inserts at the end of the document', () => {
    const md = 'First.\n\nSecond.\n';
    const result = insertBlockAfter(md, 1, 'Last.');
    expect(result).toBe('First.\n\nSecond.\n\nLast.\n');
  });

  it('inserts into an empty document', () => {
    const result = insertBlockAfter('', -1, 'Only block.');
    expect(result).toBe('Only block.');
  });

  it('inserts after a mermaid block', () => {
    const md = '```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n\nAfter.\n';
    // block 0 is the mermaid block
    const result = insertBlockAfter(md, 0, 'Inserted text.');
    expect(result).toContain('```mermaid');
    expect(result).toContain('Inserted text.');
    expect(result).toContain('After.');
    // the inserted text comes after the mermaid block and before "After."
    const mermaidEnd = result.indexOf('```', result.indexOf('```') + 3) + 3;
    const insertedPos = result.indexOf('Inserted text.');
    const afterPos = result.indexOf('After.');
    expect(insertedPos).toBeGreaterThan(mermaidEnd);
    expect(insertedPos).toBeLessThan(afterPos);
  });

  it('trims trailing newlines from the inserted source', () => {
    const md = 'First.\n';
    const result = insertBlockAfter(md, 0, 'Second.\n\n\n');
    expect(result).toBe('First.\n\nSecond.\n');
  });

  it('throws RangeError for an out-of-range index', () => {
    expect(() => insertBlockAfter(MD, 999, 'x')).toThrow(RangeError);
  });
});

describe('deleteBlock', () => {
  it('deletes a middle block and preserves surrounding content', () => {
    const md = 'First.\n\nSecond.\n\nThird.\n';
    const result = deleteBlock(md, 1);
    expect(result).toBe('First.\n\nThird.\n');
  });

  it('deletes the first block', () => {
    const md = 'First.\n\nSecond.\n\nThird.\n';
    const result = deleteBlock(md, 0);
    expect(result).toBe('Second.\n\nThird.\n');
  });

  it('deletes the last block', () => {
    const md = 'First.\n\nSecond.\n\nThird.\n';
    const result = deleteBlock(md, 2);
    expect(result).toBe('First.\n\nSecond.\n');
  });

  it('deletes the only block', () => {
    const md = 'Only block.\n';
    const result = deleteBlock(md, 0);
    expect(result.trim()).toBe('');
  });

  it('deletes a mermaid block', () => {
    const result = deleteBlock(MD, 2);
    expect(result).not.toContain('```mermaid\nsequenceDiagram\n    participant A as Alice');
    expect(result).toContain('# Architecture Notes');
    expect(result).toContain('Middle prose.');
    // the second mermaid block is still there
    expect(result).toContain('flowchart TD');
  });

  it('does not leave double blank lines after deletion', () => {
    const md = 'A.\n\nB.\n\nC.\n\nD.\n';
    const result = deleteBlock(md, 1); // delete B
    expect(result).not.toContain('\n\n\n');
    expect(result).toBe('A.\n\nC.\n\nD.\n');
  });

  it('throws RangeError for an out-of-range index', () => {
    expect(() => deleteBlock(MD, 999)).toThrow(RangeError);
    expect(() => deleteBlock(MD, -1)).toThrow(RangeError);
  });

  it('preserves content before and after exactly', () => {
    const md = '# Title\n\nPara one.\n\n```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n\nPara two.\n';
    const blocks = parseMarkdownBlocks(md);
    // delete "Para one." (block index 1)
    const result = deleteBlock(md, 1);
    expect(result).toBe('# Title\n\n```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n\nPara two.\n');
    expect(blocks).toHaveLength(4);
  });
});

describe('convertBlockType', () => {
  it('converts a paragraph to headings', () => {
    expect(convertBlockType('Hello world', 'heading1')).toBe('# Hello world');
    expect(convertBlockType('Hello world', 'heading2')).toBe('## Hello world');
    expect(convertBlockType('Hello world', 'heading6')).toBe('###### Hello world');
  });

  it('converts a heading to a paragraph (strips the marker)', () => {
    expect(convertBlockType('# Title', 'paragraph')).toBe('Title');
    expect(convertBlockType('### Subtitle', 'paragraph')).toBe('Subtitle');
  });

  it('converts between heading levels', () => {
    expect(convertBlockType('# H1', 'heading3')).toBe('### H1');
    expect(convertBlockType('### H3', 'heading1')).toBe('# H3');
  });

  it('converts a paragraph to a bullet list', () => {
    expect(convertBlockType('Item one', 'bulletList')).toBe('- Item one');
  });

  it('converts a paragraph to a numbered list', () => {
    expect(convertBlockType('First', 'numberedList')).toBe('1. First');
  });

  it('converts a multi-line paragraph to a bullet list (per-line)', () => {
    expect(convertBlockType('one\ntwo\nthree', 'bulletList')).toBe('- one\n- two\n- three');
  });

  it('converts a multi-line paragraph to a numbered list (per-line)', () => {
    expect(convertBlockType('one\ntwo', 'numberedList')).toBe('1. one\n2. two');
  });

  it('converts a paragraph to a quote', () => {
    expect(convertBlockType('A quote', 'quote')).toBe('> A quote');
  });

  it('converts a multi-line paragraph to a quote (per-line)', () => {
    expect(convertBlockType('line 1\nline 2', 'quote')).toBe('> line 1\n> line 2');
  });

  it('converts a quote to a paragraph (strips markers)', () => {
    expect(convertBlockType('> Quoted text', 'paragraph')).toBe('Quoted text');
    expect(convertBlockType('> line 1\n> line 2', 'paragraph')).toBe('line 1\nline 2');
  });

  it('converts a bullet list to a paragraph (strips markers)', () => {
    expect(convertBlockType('- one\n- two', 'paragraph')).toBe('one\ntwo');
  });

  it('converts a numbered list to a paragraph (strips markers)', () => {
    expect(convertBlockType('1. one\n2. two', 'paragraph')).toBe('one\ntwo');
  });

  it('converts a paragraph to a code block (wraps in fences)', () => {
    expect(convertBlockType('const x = 1;', 'code')).toBe('```\nconst x = 1;\n```');
  });

  it('converts a code block to a paragraph (strips fences)', () => {
    expect(convertBlockType('```js\ncode\n```', 'paragraph')).toBe('code');
  });

  it('converts a bullet list to a numbered list', () => {
    expect(convertBlockType('- one\n- two', 'numberedList')).toBe('1. one\n2. two');
  });

  it('converts a quote to a bullet list', () => {
    expect(convertBlockType('> quoted', 'bulletList')).toBe('- quoted');
  });

  it('returns empty string for empty input', () => {
    expect(convertBlockType('', 'heading1')).toBe('');
    expect(convertBlockType('   ', 'paragraph')).toBe('');
  });

  it('round-trips: paragraph → heading → paragraph', () => {
    const original = 'Some text';
    expect(convertBlockType(convertBlockType(original, 'heading2'), 'paragraph')).toBe(original);
  });
});

describe('integration: parse → mutate → re-parse', () => {
  it('editing a block produces a valid document that re-parses correctly', () => {
    const blocks = parseMarkdownBlocks(MD);
    const edited = replaceBlockSource(MD, 0, '# Edited Title');
    const reparsed = parseMarkdownBlocks(edited);
    expect(reparsed[0]).toMatchObject({ kind: 'text', nodeType: 'heading', source: '# Edited Title' });
    expect(reparsed.length).toBe(blocks.length);
  });

  it('inserting a block increases the block count by one', () => {
    const before = parseMarkdownBlocks(MD);
    const inserted = insertBlockAfter(MD, 0, 'New paragraph.');
    const after = parseMarkdownBlocks(inserted);
    expect(after.length).toBe(before.length + 1);
    expect(after[1].source).toBe('New paragraph.');
  });

  it('deleting a block decreases the block count by one', () => {
    const before = parseMarkdownBlocks(MD);
    const deleted = deleteBlock(MD, 0);
    const after = parseMarkdownBlocks(deleted);
    expect(after.length).toBe(before.length - 1);
  });

  it('edit → insert → delete chain produces the expected document', () => {
    // Edit heading
    let doc = replaceBlockSource(MD, 0, '# New Heading');
    // Insert a paragraph after the heading
    doc = insertBlockAfter(doc, 0, 'A new paragraph.');
    // Delete the original "Intro prose" block (now at index 2)
    const blocks = parseMarkdownBlocks(doc);
    const introIdx = blocks.findIndex(b => b.kind === 'text' && b.source.includes('Intro prose'));
    doc = deleteBlock(doc, introIdx);

    expect(doc).toContain('# New Heading');
    expect(doc).toContain('A new paragraph.');
    expect(doc).not.toContain('Intro prose');
    expect(doc).toContain('```mermaid');
    expect(doc).toContain('Trailing prose.');

    // The result re-parses cleanly
    const reparsed = parseMarkdownBlocks(doc);
    for (const block of reparsed) {
      expect(doc.slice(block.startOffset, block.endOffset)).toBe(block.source);
    }
  });

  it('an unclosed mermaid fence swallows the rest of the document as block content', () => {
    // Documents the scenario the MermaidBlockPreview not-a-diagram guard
    // defends against: an unclosed ```mermaid fence (e.g. typed at the top of
    // the file, or its closing fence deleted) makes mdast consume everything
    // to end-of-document as the block's inner source — including prose.
    const doc = '```mermaid\n# Title\n\nprose paragraph\n\n```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n';
    const blocks = parseMarkdownBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('mermaid');
    if (blocks[0].kind === 'mermaid') {
      expect(blocks[0].content).toContain('# Title');
      expect(blocks[0].content).toContain('prose paragraph');
      expect(blocks[0].content).toContain('sequenceDiagram');
    }
  });
});

describe('scaffoldMermaidBlock', () => {
  it('wraps the sequence template in a valid ```mermaid fence', () => {
    const source = scaffoldMermaidBlock('sequence');
    expect(source.startsWith('```mermaid\n')).toBe(true);
    expect(source.endsWith('\n```')).toBe(true);
    expect(source).toContain(MERMAID_DIAGRAM_TEMPLATES.sequence);
    // the scaffold parses as exactly one mermaid block
    const blocks = parseMarkdownBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('mermaid');
    if (blocks[0].kind === 'mermaid') {
      expect(blocks[0].content).toBe(MERMAID_DIAGRAM_TEMPLATES.sequence);
      expect(blocks[0].index).toBe(0);
    }
  });

  it('wraps the flowchart template in a valid ```mermaid fence', () => {
    const source = scaffoldMermaidBlock('flowchart');
    expect(source.startsWith('```mermaid\n')).toBe(true);
    expect(source.endsWith('\n```')).toBe(true);
    expect(source).toContain(MERMAID_DIAGRAM_TEMPLATES.flowchart);
    const blocks = parseMarkdownBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('mermaid');
  });
});

describe('insertMermaidBlock', () => {
  it('inserts into an empty document at position 0', () => {
    const { code, diagramIndex } = insertMermaidBlock('', 0, 'sequence');
    expect(code).toBe(scaffoldMermaidBlock('sequence'));
    expect(diagramIndex).toBe(0);
    expect(parseMarkdownBlocks(code).map(b => b.kind)).toEqual(['mermaid']);
  });

  it('inserts before the first block at position 0', () => {
    const { code, diagramIndex } = insertMermaidBlock(MD, 0, 'flowchart');
    expect(code.indexOf('```mermaid')).toBe(0);
    expect(code.indexOf('```mermaid')).toBeLessThan(code.indexOf('# Architecture Notes'));
    expect(diagramIndex).toBe(0);
    // the document gains exactly one mermaid block, as block 0
    const blocks = parseMarkdownBlocks(code);
    expect(blocks.length).toBe(parseMarkdownBlocks(MD).length + 1);
    expect(blocks[0].kind).toBe('mermaid');
    if (blocks[0].kind === 'mermaid') expect(blocks[0].index).toBe(0);
  });

  it('inserts between two text blocks, preserving surrounding content', () => {
    // MD blocks: 0=heading, 1=intro, 2=mermaid, 3=middle, 4=mermaid, ...
    // Position 2 = after the intro, before the first mermaid block.
    const { code, diagramIndex } = insertMermaidBlock(MD, 2, 'sequence');
    const headingPos = code.indexOf('# Architecture Notes');
    const introPos = code.indexOf('Intro prose');
    const fencePos = code.indexOf('```mermaid');
    const firstDiagramPos = code.indexOf('A->>B: First diagram');
    // heading → intro → new fence → original first mermaid
    expect(headingPos).toBeLessThan(introPos);
    expect(introPos).toBeLessThan(fencePos);
    expect(fencePos).toBeLessThan(firstDiagramPos);
    // no mermaid block sits before the insertion point → new diagram index 0
    expect(diagramIndex).toBe(0);
    const blocks = parseMarkdownBlocks(code);
    const mermaid = blocks.filter((b): b is MermaidBlockRef => b.kind === 'mermaid');
    expect(mermaid.map(b => b.index)).toEqual([0, 1, 2]);
    // the new diagram is diagram 0; the original diagrams shifted by one
    expect(mermaid[0].content).toContain('participant A as Alice');
    expect(mermaid[1].content).toContain('A->>B: First diagram');
    expect(mermaid[2].content).toContain('A --> B');
  });

  it('computes the diagram index from the mermaid blocks before the position', () => {
    // Insert after the first mermaid block (block 2) → the new diagram is
    // diagram 1; the existing second mermaid shifts to diagram 2.
    const { code, diagramIndex } = insertMermaidBlock(MD, 3, 'flowchart');
    expect(diagramIndex).toBe(1);
    const mermaid = parseMarkdownBlocks(code).filter((b): b is MermaidBlockRef => b.kind === 'mermaid');
    expect(mermaid.map(b => b.index)).toEqual([0, 1, 2]);
    // the original first diagram kept its content at index 0
    expect(mermaid[0].content).toContain('A->>B: First diagram');
    // the new flowchart scaffold is diagram 1
    expect(mermaid[1].content).toContain('B -->|Reply| A');
    // the original second flowchart shifted to index 2
    expect(mermaid[2].content).toContain('A --> B');
    expect(mermaid[2].content).not.toContain('Reply');
  });

  it('appends after the last block at position blocks.length', () => {
    const blockCount = parseMarkdownBlocks(MD).length;
    const { code, diagramIndex } = insertMermaidBlock(MD, blockCount, 'sequence');
    // MD's last block is "Trailing prose."; the second mermaid is diagram 1
    expect(diagramIndex).toBe(2);
    expect(code.lastIndexOf('```mermaid')).toBeGreaterThan(code.indexOf('Trailing prose.'));
    expect(code.trimEnd().endsWith('```')).toBe(true);
    const mermaid = parseMarkdownBlocks(code).filter((b): b is MermaidBlockRef => b.kind === 'mermaid');
    expect(mermaid.map(b => b.index)).toEqual([0, 1, 2]);
  });

  it('throws RangeError for an out-of-range position', () => {
    const blockCount = parseMarkdownBlocks(MD).length;
    expect(() => insertMermaidBlock(MD, blockCount + 1, 'sequence')).toThrow(RangeError);
    expect(() => insertMermaidBlock(MD, -1, 'sequence')).toThrow(RangeError);
  });

  it('the result re-parses with consistent offsets', () => {
    const { code } = insertMermaidBlock(MD, 4, 'flowchart');
    for (const block of parseMarkdownBlocks(code)) {
      expect(code.slice(block.startOffset, block.endOffset)).toBe(block.source);
    }
  });
});
