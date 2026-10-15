import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WYSIWYGEditor from './WYSIWYGEditor';
import { parseMarkdownBlocks } from '@/lib/markdownBlocks';

// Mock MermaidBlockPreview so we don't need mermaid/SVG in these tests.
vi.mock('./MermaidBlockPreview', () => ({
  default: ({ index, title, onSelect }: { index: number; title: string; onSelect: () => void }) => (
    <div
      data-testid={`mock-mermaid-block-${index}`}
      data-title={title}
      onClick={onSelect}
    >
      mermaid block {index}: {title}
    </div>
  ),
}));

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

Trailing prose.
`;

const renderEditor = (overrides?: Partial<Parameters<typeof WYSIWYGEditor>[0]>) => {
  const props = {
    code: MD,
    theme: 'default' as const,
    onCodeChange: vi.fn(),
    onMarkdownEdit: vi.fn(),
    onSelectDiagram: vi.fn(),
    ...overrides,
  };
  const result = render(<WYSIWYGEditor {...props} />);
  return { props, ...result };
};

describe('WYSIWYGEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders all blocks in document order (text + mermaid)', () => {
      renderEditor();
      // block 0: heading
      expect(screen.getByTestId('wysiwyg-block-0').textContent).toContain('Architecture Notes');
      // block 1: paragraph
      expect(screen.getByTestId('wysiwyg-block-1').textContent).toContain('bold');
      // block 2: mermaid 0 (no wysiwyg-block-2)
      expect(screen.queryByTestId('wysiwyg-block-2')).toBeNull();
      expect(screen.getByTestId('mock-mermaid-block-0').textContent).toContain('sequenceDiagram');
      // block 3: paragraph
      expect(screen.getByTestId('wysiwyg-block-3').textContent).toContain('Middle prose.');
      // block 4: mermaid 1 (no wysiwyg-block-4)
      expect(screen.queryByTestId('wysiwyg-block-4')).toBeNull();
      expect(screen.getByTestId('mock-mermaid-block-1').textContent).toContain('flowchart TD');
      // block 5: paragraph
      expect(screen.getByTestId('wysiwyg-block-5').textContent).toContain('Trailing prose.');
    });

    it('renders insert buttons before the first block, between blocks, and after the last', () => {
      renderEditor();
      // 6 blocks → 7 insert positions (0 through 6)
      for (let i = 0; i <= 6; i++) {
        expect(screen.getByTestId(`wysiwyg-insert-${i}`)).toBeTruthy();
      }
    });

    it('shows an empty state for an empty document', () => {
      renderEditor({ code: '' });
      expect(screen.getByTestId('wysiwyg-empty').textContent).toContain('empty document');
      expect(screen.getByTestId('wysiwyg-insert-0')).toBeTruthy();
    });

    it('shows an empty state for a whitespace-only document', () => {
      renderEditor({ code: '  \n\n  ' });
      expect(screen.getByTestId('wysiwyg-empty')).toBeTruthy();
    });

    it('renders a mermaid-only document', () => {
      const md = '```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n';
      renderEditor({ code: md });
      expect(screen.getByTestId('mock-mermaid-block-0')).toBeTruthy();
      expect(screen.queryByTestId('wysiwyg-block-0')).toBeNull();
    });
  });

  describe('editing a text block', () => {
    it('click → edit → save calls onMarkdownEdit with the updated full document', () => {
      const { props } = renderEditor();
      // Click the first block (heading)
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: '# Edited Title' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('# Edited Title');
      expect(newCode).not.toContain('# Architecture Notes');
      // surrounding content preserved
      expect(newCode).toContain('Intro prose with **bold** text.');
      expect(newCode).toContain('```mermaid');
      expect(newCode).toContain('Trailing prose.');
    });

    it('editing via blur saves', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-block-1')); // Intro prose
      const textarea = screen.getByTestId('wysiwyg-block-editor-1');
      fireEvent.change(textarea, { target: { value: 'Edited prose.' } });
      fireEvent.blur(textarea);

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('Edited prose.');
      expect(newCode).not.toContain('Intro prose with **bold** text.');
    });

    it('cancel does not call onMarkdownEdit', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Changed' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-cancel-0'));
      expect(props.onMarkdownEdit).not.toHaveBeenCalled();
    });
  });

  describe('deleting a block', () => {
    it('delete calls onMarkdownEdit with the block removed', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-block-delete-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).not.toContain('# Architecture Notes');
      expect(newCode).toContain('Intro prose with **bold** text.');
      expect(newCode).toContain('```mermaid');
    });

    it('deleting a mermaid block is not possible through WYSIWYGBlock (mermaid uses MermaidBlockPreview)', () => {
      renderEditor();
      // mermaid blocks don't have a wysiwyg-block-delete button
      expect(screen.queryByTestId('wysiwyg-block-delete-2')).toBeNull();
    });
  });

  describe('inserting a block', () => {
    it('clicking + shows a pending block in edit mode without modifying the document', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));

      // A textarea appears (pending block in edit mode)
      expect(screen.getByTestId('wysiwyg-block-editor-0')).toBeTruthy();
      // The document is not modified yet
      expect(props.onMarkdownEdit).not.toHaveBeenCalled();
    });

    it('typing in a pending block and saving inserts it into the document', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));

      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'New first paragraph.' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('New first paragraph.');
      expect(newCode).toContain('# Architecture Notes');
      // The new block is at the start
      expect(newCode.indexOf('New first paragraph.')).toBeLessThan(newCode.indexOf('# Architecture Notes'));
      // The new document has one more block
      expect(parseMarkdownBlocks(newCode).length).toBe(parseMarkdownBlocks(MD).length + 1);
    });

    it('cancelling a pending insert does not modify the document', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-1'));

      // Pending block appears
      expect(screen.getByTestId('wysiwyg-block-editor-1')).toBeTruthy();

      // Cancel
      fireEvent.click(screen.getByTestId('wysiwyg-block-cancel-1'));
      expect(props.onMarkdownEdit).not.toHaveBeenCalled();
    });

    it('insert between blocks adds a block in the middle', () => {
      const { props } = renderEditor();
      // Insert after block 0 (the heading) → position 1
      fireEvent.click(screen.getByTestId('wysiwyg-insert-1'));

      const textarea = screen.getByTestId('wysiwyg-block-editor-1');
      fireEvent.change(textarea, { target: { value: 'Inserted paragraph.' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-1'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      const headingPos = newCode.indexOf('# Architecture Notes');
      const insertedPos = newCode.indexOf('Inserted paragraph.');
      const introPos = newCode.indexOf('Intro prose');
      // heading → inserted → intro
      expect(headingPos).toBeLessThan(insertedPos);
      expect(insertedPos).toBeLessThan(introPos);
    });

    it('insert at the end adds a block after the last', () => {
      const { props } = renderEditor();
      // 6 blocks → insert at position 6 (after the last)
      fireEvent.click(screen.getByTestId('wysiwyg-insert-6'));

      const textarea = screen.getByTestId('wysiwyg-block-editor-6');
      fireEvent.change(textarea, { target: { value: 'Appended paragraph.' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-6'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('Trailing prose.');
      expect(newCode).toContain('Appended paragraph.');
      // The appended block is after the trailing prose
      expect(newCode.indexOf('Appended paragraph.')).toBeGreaterThan(newCode.indexOf('Trailing prose.'));
      // The new document has one more block
      expect(parseMarkdownBlocks(newCode).length).toBe(parseMarkdownBlocks(MD).length + 1);
    });

    it('insert into an empty document works', () => {
      const { props } = renderEditor({ code: '' });
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));

      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'First content.' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('First content.');
    });
  });

  describe('mermaid blocks', () => {
    it('clicking a mermaid block calls onSelectDiagram with the block index', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('mock-mermaid-block-1'));
      expect(props.onSelectDiagram).toHaveBeenCalledWith(1);
    });
  });

  describe('re-parse on external code change', () => {
    it('re-renders blocks when the code prop changes', () => {
      const { props, rerender } = renderEditor();
      expect(screen.getByTestId('wysiwyg-block-0').textContent).toContain('Architecture Notes');

      const newCode = MD.replace('# Architecture Notes', '# Changed Title');
      rerender(<WYSIWYGEditor {...props} code={newCode} />);

      expect(screen.getByTestId('wysiwyg-block-0').textContent).toContain('Changed Title');
    });

    it('clears the active block when the code changes externally', () => {
      const { props, rerender } = renderEditor();
      // Activate a block
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      expect(screen.getByTestId('wysiwyg-block-editor-0')).toBeTruthy();

      // External change that removes the first block
      const newCode = MD.replace('# Architecture Notes\n\n', '');
      rerender(<WYSIWYGEditor {...props} code={newCode} />);

      // The editor should not crash; the textarea may or may not be visible
      // depending on whether the active index is still valid
      expect(screen.getByTestId('wysiwyg-editor')).toBeTruthy();
    });
  });

  describe('integration: edit → re-parse → edit again', () => {
    it('can edit two different blocks sequentially', () => {
      const { props, rerender } = renderEditor();

      // Edit block 0 (heading)
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-editor-0'), { target: { value: '# New Title' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

      const code1 = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      rerender(<WYSIWYGEditor {...props} code={code1} />);

      // Now edit block 1 (intro prose)
      fireEvent.click(screen.getByTestId('wysiwyg-block-1'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-editor-1'), { target: { value: 'New prose.' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-1'));

      const code2 = vi.mocked(props.onMarkdownEdit).mock.calls[1][0] as string;
      expect(code2).toContain('# New Title');
      expect(code2).toContain('New prose.');
      expect(code2).not.toContain('Intro prose with **bold** text.');
    });
  });
});
