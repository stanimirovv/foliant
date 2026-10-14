import { describe, it, expect } from 'vitest';
import { splitMarkdownSegments, renderMarkdownSegment } from './markdownRender';

const MD = `# Notes

Some prose with **bold**.

\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: First
\`\`\`

Middle text.

\`\`\`mermaid
flowchart TD
    A --> B
\`\`\`

\`\`\`js
console.log("not a diagram");
\`\`\`

Trailing prose.
`;

describe('splitMarkdownSegments', () => {
  it('splits a document into alternating text and mermaid segments', () => {
    const segments = splitMarkdownSegments(MD);
    expect(segments.map(s => s.type)).toEqual([
      'markdown',
      'mermaid',
      'markdown',
      'mermaid',
      'markdown',
    ]);
  });

  it('numbers mermaid segments like the diagram URL param (0-based, document order)', () => {
    const segments = splitMarkdownSegments(MD);
    const mermaidSegs = segments.filter(s => s.type === 'mermaid');
    expect(mermaidSegs).toHaveLength(2);
    expect(mermaidSegs[0]).toMatchObject({
      index: 0,
      content: 'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: First',
      title: 'sequenceDiagram',
    });
    expect(mermaidSegs[1]).toMatchObject({
      index: 1,
      content: 'flowchart TD\n    A --> B',
      title: 'flowchart TD',
    });
  });

  it('keeps non-mermaid fenced blocks inside the text segments', () => {
    const segments = splitMarkdownSegments(MD);
    const text = segments
      .filter(s => s.type === 'markdown')
      .map(s => s.text)
      .join('');
    expect(text).toContain('console.log("not a diagram")');
    expect(text).toContain('Trailing prose.');
    // the mermaid fences are not part of any text segment
    expect(text).not.toContain('```mermaid');
  });

  it('returns the whole document as one text segment when there are no mermaid blocks', () => {
    const segments = splitMarkdownSegments('# Plain\n\nNo diagrams here.\n');
    expect(segments).toEqual([{ type: 'markdown', text: '# Plain\n\nNo diagrams here.\n' }]);
  });

  it('returns an empty list for an empty document', () => {
    expect(splitMarkdownSegments('')).toEqual([]);
    expect(splitMarkdownSegments('   \n  \n')).toEqual([]);
  });

  it('handles a document that starts or ends with a mermaid block', () => {
    const md = '```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n';
    const segments = splitMarkdownSegments(md);
    expect(segments).toEqual([
      {
        type: 'mermaid',
        index: 0,
        content: 'sequenceDiagram\n    A->>B: Hi',
        title: 'sequenceDiagram',
        startLine: 1,
        endLine: 4,
      },
    ]);
  });
});

describe('renderMarkdownSegment', () => {
  it('renders headings, emphasis and lists', () => {
    const html = renderMarkdownSegment('# Title\n\nSome **bold** and *italic*.\n\n- one\n- two\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<li>one</li>');
  });

  it('renders fenced code blocks with the language class', () => {
    const html = renderMarkdownSegment('```js\nconsole.log(1);\n```\n');
    expect(html).toContain('<pre>');
    expect(html).toContain('language-js');
  });

  it('renders GFM tables', () => {
    const html = renderMarkdownSegment('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
  });

  it('returns an empty string for whitespace-only text', () => {
    expect(renderMarkdownSegment('   \n\n  ')).toBe('');
  });
});
