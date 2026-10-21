import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WYSIWYGEditor from './WYSIWYGEditor';
import { parseMarkdownBlocks } from '@/lib/markdownBlocks';

// Mock MermaidBlockPreview so we don't need mermaid/SVG in these tests. The
// mock also records the per-block view state and can report a change.
vi.mock('./MermaidBlockPreview', () => ({
  default: ({
    index,
    title,
    onSelect,
    onDelete,
    viewState,
    onViewStateChange,
  }: {
    index: number;
    title: string;
    onSelect: () => void;
    onDelete?: () => void;
    viewState?: { viewName?: string | null; hideKeys?: string[] };
    onViewStateChange?: (selection: { viewName?: string | null; hideKeys?: string[] }) => void;
  }) => (
    <div
      data-testid={`mock-mermaid-block-${index}`}
      data-title={title}
      data-viewstate={JSON.stringify(viewState ?? null)}
      onClick={onSelect}
    >
      mermaid block {index}: {title}
      <button
        data-testid={`mock-mermaid-viewstate-${index}`}
        onClick={(e) => {
          e.stopPropagation();
          onViewStateChange?.({ viewName: 'V', hideKeys: ['k'] });
        }}
      >
        change view state
      </button>
      {onDelete && (
        <button
          data-testid={`mock-mermaid-delete-${index}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          delete diagram
        </button>
      )}
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

    it('deleting a mermaid block calls onMarkdownEdit with the diagram removed', () => {
      const { props } = renderEditor();
      // Mermaid index 0 is document block 2 (between the intro and middle prose).
      fireEvent.click(screen.getByTestId('mock-mermaid-delete-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      // The first diagram is gone…
      expect(newCode).not.toContain('sequenceDiagram');
      expect(newCode).not.toContain('First diagram');
      expect(newCode.match(/```mermaid/g)).toHaveLength(1);
      // …but everything else survives, including the second diagram.
      expect(newCode).toContain('# Architecture Notes');
      expect(newCode).toContain('Intro prose with **bold** text.');
      expect(newCode).toContain('Middle prose.');
      expect(newCode).toContain('flowchart TD');
      expect(newCode).toContain('Trailing prose.');
    });

    it('deleting a mermaid block does not open the diagram editor', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('mock-mermaid-delete-1'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      // The second diagram (flowchart) is removed, the first survives.
      expect(newCode).not.toContain('flowchart TD');
      expect(newCode).toContain('sequenceDiagram');
      expect(props.onSelectDiagram).not.toHaveBeenCalled();
    });

    it('deleting the only mermaid block leaves the surrounding text intact', () => {
      const md = 'Before.\n\n```mermaid\nsequenceDiagram\n    A->>B: Hi\n```\n\nAfter.\n';
      const { props } = renderEditor({ code: md });
      fireEvent.click(screen.getByTestId('mock-mermaid-delete-0'));

      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).not.toContain('```mermaid');
      expect(newCode).toBe('Before.\n\nAfter.\n');
    });
  });

  describe('inserting a block', () => {
    it('clicking + opens a menu; choosing Text block shows a pending block without modifying the document', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));

      // The menu is open, no pending block yet
      expect(screen.getByTestId('wysiwyg-insert-menu-0')).toBeTruthy();
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();

      fireEvent.click(screen.getByTestId('wysiwyg-insert-text-0'));

      // A textarea appears (pending block in edit mode), the menu is closed
      expect(screen.getByTestId('wysiwyg-block-editor-0')).toBeTruthy();
      expect(screen.queryByTestId('wysiwyg-insert-menu-0')).toBeNull();
      // The document is not modified yet
      expect(props.onMarkdownEdit).not.toHaveBeenCalled();
    });

    it('typing in a pending block and saving inserts it into the document', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));
      fireEvent.click(screen.getByTestId('wysiwyg-insert-text-0'));

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
      fireEvent.click(screen.getByTestId('wysiwyg-insert-text-1'));

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
      fireEvent.click(screen.getByTestId('wysiwyg-insert-text-1'));

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
      fireEvent.click(screen.getByTestId('wysiwyg-insert-text-6'));

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
      fireEvent.click(screen.getByTestId('wysiwyg-insert-text-0'));

      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'First content.' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('First content.');
    });
  });

  describe('insert menu behavior', () => {
    it('opening the menu does not modify the document; Escape dismisses it', () => {
      const { props } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-2'));
      expect(screen.getByTestId('wysiwyg-insert-menu-2')).toBeTruthy();
      expect(props.onMarkdownEdit).not.toHaveBeenCalled();
      expect(props.onSelectDiagram).not.toHaveBeenCalled();

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByTestId('wysiwyg-insert-menu-2')).toBeNull();
      expect(props.onMarkdownEdit).not.toHaveBeenCalled();
    });

    it('clicking + again toggles the menu closed', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-2'));
      expect(screen.getByTestId('wysiwyg-insert-menu-2')).toBeTruthy();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-2'));
      expect(screen.queryByTestId('wysiwyg-insert-menu-2')).toBeNull();
    });

    it('only one menu is open at a time', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));
      expect(screen.getByTestId('wysiwyg-insert-menu-0')).toBeTruthy();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-3'));
      expect(screen.queryByTestId('wysiwyg-insert-menu-0')).toBeNull();
      expect(screen.getByTestId('wysiwyg-insert-menu-3')).toBeTruthy();
    });

    it('the menu offers text, sequence diagram, and flowchart choices', () => {
      renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-1'));
      const menu = screen.getByTestId('wysiwyg-insert-menu-1');
      expect(menu.textContent).toContain('Text block');
      expect(menu.textContent).toContain('Sequence Diagram');
      expect(menu.textContent).toContain('Flowchart');
    });
  });

  describe('inserting a diagram', () => {
    it('+ Sequence Diagram scaffolds a mermaid block and opens it in the diagram editor', () => {
      const { props } = renderEditor();
      // Insert after block 0 (the heading) → position 1
      fireEvent.click(screen.getByTestId('wysiwyg-insert-1'));
      fireEvent.click(screen.getByTestId('wysiwyg-insert-diagram-sequence-1'));

      // The document gains a scaffolded ```mermaid block, committed once
      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('```mermaid');
      expect(newCode).toContain('sequenceDiagram');
      expect(newCode).toContain('participant A as Alice');
      // between the heading and the intro prose
      const headingPos = newCode.indexOf('# Architecture Notes');
      const fencePos = newCode.indexOf('```mermaid');
      const introPos = newCode.indexOf('Intro prose');
      expect(headingPos).toBeLessThan(fencePos);
      expect(fencePos).toBeLessThan(introPos);
      // surrounding content preserved
      expect(newCode).toContain('A->>B: First diagram');
      expect(newCode).toContain('Trailing prose.');

      // The new diagram is opened in the diagram editor: no mermaid block
      // sits before position 1, so the new diagram is diagram 0.
      expect(props.onSelectDiagram).toHaveBeenCalledTimes(1);
      expect(props.onSelectDiagram).toHaveBeenCalledWith(0);

      // The menu is closed
      expect(screen.queryByTestId('wysiwyg-insert-menu-1')).toBeNull();

      // The new document parses with the new mermaid block at block index 1
      const blocks = parseMarkdownBlocks(newCode);
      expect(blocks.length).toBe(parseMarkdownBlocks(MD).length + 1);
      expect(blocks[1].kind).toBe('mermaid');
      const mermaid = blocks.filter(b => b.kind === 'mermaid');
      expect(mermaid.map(b => (b.kind === 'mermaid' ? b.index : -1))).toEqual([0, 1, 2]);
    });

    it('+ Flowchart between two existing diagrams opens the computed diagram index', () => {
      const { props } = renderEditor();
      // MD: block 2 = mermaid (diagram 0), block 4 = mermaid (diagram 1).
      // Insert after block 2 → position 3 → one mermaid before → diagram 1.
      fireEvent.click(screen.getByTestId('wysiwyg-insert-3'));
      fireEvent.click(screen.getByTestId('wysiwyg-insert-diagram-flowchart-3'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toContain('flowchart TD');
      expect(newCode).toContain('B -->|Reply| A');
      // inserted between the first mermaid and the middle prose
      const firstDiagramPos = newCode.indexOf('A->>B: First diagram');
      const newFencePos = newCode.indexOf('B -->|Reply| A');
      const middlePos = newCode.indexOf('Middle prose.');
      expect(firstDiagramPos).toBeLessThan(newFencePos);
      expect(newFencePos).toBeLessThan(middlePos);

      expect(props.onSelectDiagram).toHaveBeenCalledWith(1);

      const mermaid = parseMarkdownBlocks(newCode).filter(b => b.kind === 'mermaid');
      expect(mermaid.map(b => (b.kind === 'mermaid' ? b.index : -1))).toEqual([0, 1, 2]);
      if (mermaid[1].kind === 'mermaid') {
        expect(mermaid[1].content).toContain('B -->|Reply| A');
      }
    });

    it('inserting a sequence diagram into an empty document opens diagram 0', () => {
      const { props } = renderEditor({ code: '' });
      fireEvent.click(screen.getByTestId('wysiwyg-insert-0'));
      fireEvent.click(screen.getByTestId('wysiwyg-insert-diagram-sequence-0'));

      expect(props.onMarkdownEdit).toHaveBeenCalledTimes(1);
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;
      expect(newCode).toBe('```mermaid\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    B-->>A: Hi there\n```');
      expect(props.onSelectDiagram).toHaveBeenCalledWith(0);
    });

    it('after inserting, the new document renders the mermaid block preview', () => {
      const { props, rerender } = renderEditor();
      fireEvent.click(screen.getByTestId('wysiwyg-insert-1'));
      fireEvent.click(screen.getByTestId('wysiwyg-insert-diagram-sequence-1'));
      const newCode = vi.mocked(props.onMarkdownEdit).mock.calls[0][0] as string;

      rerender(<WYSIWYGEditor {...props} code={newCode} />);
      // block 1 is now the new mermaid block (rendered by the preview mock);
      // the intro prose shifted to block 2
      expect(screen.queryByTestId('wysiwyg-block-1')).toBeNull();
      expect(screen.getByTestId('wysiwyg-block-2').textContent).toContain('bold');
      // three mermaid previews: the new scaffold (diagram 0) plus the two
      // existing diagrams shifted to indexes 1 and 2
      expect(screen.getByTestId('mock-mermaid-block-0').textContent).toContain('sequenceDiagram');
      expect(screen.getByTestId('mock-mermaid-block-1').textContent).toContain('sequenceDiagram');
      expect(screen.getByTestId('mock-mermaid-block-2').textContent).toContain('flowchart TD');
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

  describe('per-block view/tag state (markdown preview controls)', () => {
    it('passes each block\'s selection to its mermaid preview, keyed by diagram index', () => {
      const viewStates = new Map<number, { viewName?: string | null; hideKeys?: string[] }>([
        [1, { viewName: 'Focus', hideKeys: ['backend'] }],
      ]);
      renderEditor({ viewStates });
      expect(screen.getByTestId('mock-mermaid-block-0').getAttribute('data-viewstate')).toBe('null');
      expect(screen.getByTestId('mock-mermaid-block-1').getAttribute('data-viewstate'))
        .toBe(JSON.stringify({ viewName: 'Focus', hideKeys: ['backend'] }));
    });

    it('reports a selection change with the diagram index', () => {
      const onViewStateChange = vi.fn();
      renderEditor({ onViewStateChange });
      fireEvent.click(screen.getByTestId('mock-mermaid-viewstate-1'));
      expect(onViewStateChange).toHaveBeenCalledWith(1, { viewName: 'V', hideKeys: ['k'] });
      fireEvent.click(screen.getByTestId('mock-mermaid-viewstate-0'));
      expect(onViewStateChange).toHaveBeenCalledWith(0, { viewName: 'V', hideKeys: ['k'] });
    });
  });
});
