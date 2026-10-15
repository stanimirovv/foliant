import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MarkdownEditor from './MarkdownEditor';
import { looksLikeMermaidDiagram } from './MermaidBlockPreview';
import mermaid from 'mermaid';

// Both arguments stay declared (and recorded on mock.calls) so tests can
// assert which block source was rendered.
const baseRender = (id: string, code: string) => ({
  svg: `<svg data-testid="mock-mermaid-svg" data-render-id="${id}" data-code-length="${code.length}"><text>mock diagram</text></svg>`,
});
const renderMock = vi.fn(baseRender);

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (id: string, code: string) => renderMock(id, code),
  },
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

\`\`\`js
console.log("not a diagram");
\`\`\`

Trailing prose.
`;

const renderEditor = (overrides?: Partial<Parameters<typeof MarkdownEditor>[0]>) => {
  const props = {
    code: MD,
    theme: 'default' as const,
    fileName: 'notes.md',
    onCodeChange: vi.fn(),
    onSelectDiagram: vi.fn(),
    ...overrides,
  };
  const result = render(<MarkdownEditor {...props} />);
  return { props, ...result };
};

describe('MarkdownEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    renderMock.mockImplementation(baseRender);
  });

  it('shows the WYSIWYG preview by default, and the raw source in Edit mode', async () => {
    renderEditor();

    // preview (default): rendered rich text, no source pane
    const preview = await screen.findByTestId('markdown-preview');
    expect(screen.queryByTestId('markdown-source-pane')).toBeNull();
    expect(within(preview).getByText('Architecture Notes').tagName).toBe('H1');
    expect(within(preview).getByText('bold')).toBeTruthy();
    expect(within(preview).getByText('Trailing prose.')).toBeTruthy();
    // the non-mermaid fenced block renders as code, not as a diagram
    expect(within(preview).getByText('console.log("not a diagram");')).toBeTruthy();

    // Edit mode: the source pane with the raw markdown (Monaco mock textarea)
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    const source = await screen.findByTestId('markdown-source-pane');
    expect(source.querySelector('[data-testid="monaco-editor-textarea"]')).toBeTruthy();
    expect(screen.queryByTestId('markdown-preview-pane')).toBeNull();
  });

  it('renders each embedded mermaid block through mermaid.render with the app theme', async () => {
    renderEditor({ theme: 'dark' });

    const svg0 = await screen.findByTestId('md-mermaid-svg-0');
    expect(svg0.querySelector('svg')).toBeTruthy();
    await screen.findByTestId('md-mermaid-svg-1');

    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(renderMock.mock.calls[0][1]).toContain('A->>B: First diagram');
    expect(renderMock.mock.calls[1][1]).toContain('flowchart TD');
    // the app theme is applied (dark theme variables, like the diagram viewer)
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark', themeVariables: expect.objectContaining({ darkMode: true }) }),
    );
  });

  it('marks mermaid blocks with title, line range and an edit affordance', async () => {
    renderEditor();

    const block = await screen.findByTestId('md-mermaid-block-0');
    expect(block.textContent).toContain('sequenceDiagram');
    expect(block.textContent).toContain('Diagram 1');
    expect(block.textContent).toContain('Click to edit');
  });

  it('selecting a mermaid block in the preview opens that diagram for editing', async () => {
    const { props } = renderEditor();

    const block = await screen.findByTestId('md-mermaid-block-1');
    fireEvent.click(block);
    expect(props.onSelectDiagram).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByTestId('md-mermaid-block-0'));
    expect(props.onSelectDiagram).toHaveBeenCalledWith(0);
  });

  it('switches between edit and preview modes (no split mode)', async () => {
    renderEditor();

    // preview (default): preview pane only
    expect(screen.queryByTestId('markdown-source-pane')).toBeNull();
    expect(screen.getByTestId('markdown-preview-pane')).toBeTruthy();

    // the split mode button is gone
    expect(screen.queryByTestId('markdown-mode-split')).toBeNull();

    // edit only
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.getByTestId('markdown-source-pane')).toBeTruthy();
    expect(screen.queryByTestId('markdown-preview-pane')).toBeNull();

    // back to preview
    fireEvent.click(screen.getByTestId('markdown-mode-preview'));
    expect(screen.queryByTestId('markdown-source-pane')).toBeNull();
    expect(screen.getByTestId('markdown-preview-pane')).toBeTruthy();
  });

  it('migrates a stored split preference to preview mode', async () => {
    window.localStorage.setItem('mermaid_md_editor_view', 'split');
    renderEditor();

    expect(screen.queryByTestId('markdown-source-pane')).toBeNull();
    expect(screen.getByTestId('markdown-preview-pane')).toBeTruthy();
  });

  it('persists the selected mode to localStorage', async () => {
    renderEditor();

    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(window.localStorage.getItem('mermaid_md_editor_view')).toBe('edit');

    fireEvent.click(screen.getByTestId('markdown-mode-preview'));
    expect(window.localStorage.getItem('mermaid_md_editor_view')).toBe('preview');
  });

  it('reports source edits through onCodeChange', async () => {
    const { props } = renderEditor();

    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    const textarea = await screen.findByTestId('monaco-editor-textarea');
    fireEvent.change(textarea, { target: { value: '# Changed\n' } });
    expect(props.onCodeChange).toHaveBeenCalledWith('# Changed\n');
  });

  it('shows the raw source with an error note when a mermaid block fails to render', async () => {
    renderMock.mockImplementationOnce(() => {
      throw new Error('Parse error on line 2');
    });
    renderEditor();

    const error = await screen.findByTestId('md-mermaid-error-0');
    expect(error.textContent).toContain('Parse error on line 2');
    expect(error.textContent).toContain('A->>B: First diagram');
    // the other block still renders
    await screen.findByTestId('md-mermaid-svg-1');
  });

  it('keeps the last good render with a syntax-error chip when a block becomes invalid, and recovers', async () => {
    renderMock.mockImplementation((id: string, code: string) => {
      if (code.includes('this is not a diagram')) {
        throw new Error('No diagram type detected matching given configuration');
      }
      return baseRender(id, code);
    });
    const { props, rerender } = renderEditor();

    // initial good render
    await screen.findByTestId('md-mermaid-svg-0');
    expect(screen.queryByTestId('md-mermaid-error-chip-0')).toBeNull();

    // the block becomes invalid (e.g. mid-typing): the last good render
    // stays on screen and a small chip marks the syntax error — the diagram
    // is not replaced by a destructive error box. The broken source still
    // starts with a diagram keyword so it passes the not-a-diagram guard and
    // actually reaches mermaid.render.
    rerender(<MarkdownEditor {...props} code={MD.replace('sequenceDiagram', 'sequenceDiagram\n    this is not a diagram')} />);
    const chip = await screen.findByTestId('md-mermaid-error-chip-0');
    expect(chip.textContent).toContain('Syntax error');
    expect(chip.title).toContain('No diagram type detected');
    expect(screen.getByTestId('md-mermaid-svg-0')).toBeTruthy();
    expect(screen.queryByTestId('md-mermaid-error-0')).toBeNull();

    // the block becomes valid again: the chip clears and the diagram re-renders
    rerender(<MarkdownEditor {...props} code={MD} />);
    await waitFor(() => {
      expect(screen.queryByTestId('md-mermaid-error-chip-0')).toBeNull();
    });
    expect(screen.getByTestId('md-mermaid-svg-0')).toBeTruthy();
  });

  it('removes the temp element mermaid leaves in the DOM when a render fails', async () => {
    renderMock.mockImplementation((id: string) => {
      // mermaid 12 appends its temp element (#d<id>) to document.body and
      // only removes it on success — simulate the leak, then fail.
      const leak = document.createElement('div');
      leak.id = `d${id}`;
      leak.textContent = 'leaked error diagram';
      document.body.appendChild(leak);
      throw new Error('Parse error on line 1');
    });
    // Diagram-looking source (passes the not-a-diagram guard) that fails to render.
    renderEditor({ code: '```mermaid\nsequenceDiagram\n    this is not a diagram\n```\n' });

    await screen.findByTestId('md-mermaid-error-0');
    expect(document.querySelector('div[id^="dmd-mermaid-"]')).toBeNull();
  });

  it('shows an empty-diagram hint for a mermaid block without content', async () => {
    renderEditor({ code: '```mermaid\n```\n' });
    const empty = await screen.findByTestId('md-mermaid-empty-0');
    expect(empty.textContent).toContain('empty diagram');
    expect(renderMock).not.toHaveBeenCalled();
  });

  describe('mermaid content guard (regression: prose must never reach mermaid.render)', () => {
    it('shows a not-a-diagram note and never calls mermaid.render for prose inside a mermaid fence', async () => {
      renderEditor({ code: '```mermaid\n# Just prose\nSome text here.\n```\n' });
      const note = await screen.findByTestId('md-mermaid-not-diagram-0');
      expect(note.textContent).toContain('not a mermaid diagram');
      expect(renderMock).not.toHaveBeenCalled();
    });

    it('still renders diagrams whose first meaningful line is a keyword after %% comments or blank lines', async () => {
      renderEditor({ code: '```mermaid\n%% a config comment\n\nsequenceDiagram\n    A->>B: Hi\n```\n' });
      await screen.findByTestId('md-mermaid-svg-0');
      expect(renderMock).toHaveBeenCalledTimes(1);
      expect(renderMock.mock.calls[0][1]).toContain('sequenceDiagram');
    });

    it('an unclosed mermaid fence swallowing document prose shows the not-a-diagram note, not a mermaid error', async () => {
      // Regression for the reported error: typing "```mermaid" at the top of
      // the file (unclosed fence) makes mdast consume the rest of the document
      // as the block content — including the opening prose — which was passed
      // to mermaid.render, producing "No diagram type detected matching given
      // configuration for text: # Markdown Demo …".
      renderEditor({ code: '```mermaid\n' + MD });
      const note = await screen.findByTestId('md-mermaid-not-diagram-0');
      expect(note.textContent).toContain('not a mermaid diagram');
      expect(renderMock).not.toHaveBeenCalled();
    });

    it('never passes markdown prose to mermaid.render for the committed demo file, even when blocks shift', async () => {
      const demo = readFileSync(join(process.cwd(), 'diagrams/markdown-demo.md'), 'utf8');
      const onMarkdownEdit = vi.fn();
      const { props, rerender } = renderEditor({ code: demo, onMarkdownEdit });

      const assertAllRenderCallsAreDiagrams = () => {
        expect(renderMock.mock.calls.length).toBeGreaterThan(0);
        for (const call of renderMock.mock.calls) {
          expect(looksLikeMermaidDiagram(call[1])).toBe(true);
        }
      };

      // initial render: both demo diagrams render as SVGs
      await screen.findByTestId('md-mermaid-svg-0');
      await screen.findByTestId('md-mermaid-svg-1');
      assertAllRenderCallsAreDiagrams();

      // shift every offset after the intro prose by editing it (WYSIWYG save)
      fireEvent.click(screen.getByTestId('wysiwyg-block-1'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-editor-1'), {
        target: { value: 'Edited intro prose, now much longer, shifting every offset after it.' },
      });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-1'));
      const edited = vi.mocked(onMarkdownEdit).mock.calls[0][0] as string;
      rerender(<MarkdownEditor {...props} code={edited} />);
      await screen.findByTestId('md-mermaid-svg-0');
      await screen.findByTestId('md-mermaid-svg-1');
      assertAllRenderCallsAreDiagrams();

      // shift again by deleting the first block (the document heading)
      fireEvent.click(screen.getByTestId('wysiwyg-block-delete-0'));
      const afterDelete = vi.mocked(onMarkdownEdit).mock.calls[1][0] as string;
      rerender(<MarkdownEditor {...props} code={afterDelete} />);
      await screen.findByTestId('md-mermaid-svg-0');
      await screen.findByTestId('md-mermaid-svg-1');
      assertAllRenderCallsAreDiagrams();
    });
  });

  it('shows an empty-document affordance when the document has no content', () => {
    renderEditor({ code: '' });
    expect(screen.getByTestId('markdown-preview').textContent).toContain('empty document');
  });

  it('renders text blocks as WYSIWYG blocks in the preview', async () => {
    renderEditor();
    // The heading and prose render inside wysiwyg-block containers
    expect(screen.getByTestId('wysiwyg-block-0').textContent).toContain('Architecture Notes');
    expect(screen.getByTestId('wysiwyg-block-1').textContent).toContain('bold');
  });

  it('clicking a text block in the preview switches it to edit mode', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
    expect(screen.getByTestId('wysiwyg-block-editor-0')).toBeTruthy();
  });

  it('editing a block calls onMarkdownEdit with the updated full document', async () => {
    const onMarkdownEdit = vi.fn();
    renderEditor({ onMarkdownEdit });

    fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
    fireEvent.change(screen.getByTestId('wysiwyg-block-editor-0'), { target: { value: '# Changed' } });
    fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

    expect(onMarkdownEdit).toHaveBeenCalledTimes(1);
    const newCode = vi.mocked(onMarkdownEdit).mock.calls[0][0] as string;
    expect(newCode).toContain('# Changed');
    expect(newCode).not.toContain('# Architecture Notes');
  });

  it('falls back to onCodeChange when onMarkdownEdit is not provided', async () => {
    const { props } = renderEditor();
    // No onMarkdownEdit — WYSIWYG edits go through onCodeChange
    fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
    fireEvent.change(screen.getByTestId('wysiwyg-block-editor-0'), { target: { value: '# Fallback' } });
    fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));

    expect(props.onCodeChange).toHaveBeenCalled();
    const newCode = vi.mocked(props.onCodeChange).mock.calls[0][0] as string;
    expect(newCode).toContain('# Fallback');
  });

  it('insert buttons appear between blocks in the preview', async () => {
    renderEditor();
    // At least one insert button is visible
    expect(screen.getByTestId('wysiwyg-insert-0')).toBeTruthy();
  });

  describe('undo/redo buttons', () => {
    it('shows undo/redo buttons in preview mode when handlers are provided', () => {
      renderEditor({ onUndo: vi.fn(), onRedo: vi.fn(), canUndo: true, canRedo: false });
      expect(screen.getByTestId('markdown-undo')).toBeTruthy();
      expect(screen.getByTestId('markdown-redo')).toBeTruthy();
    });

    it('hides undo/redo buttons in edit mode', () => {
      renderEditor({ onUndo: vi.fn(), onRedo: vi.fn(), canUndo: true, canRedo: true });
      fireEvent.click(screen.getByTestId('markdown-mode-edit'));
      expect(screen.queryByTestId('markdown-undo')).toBeNull();
      expect(screen.queryByTestId('markdown-redo')).toBeNull();
    });

    it('hides undo/redo buttons when handlers are not provided', () => {
      renderEditor();
      expect(screen.queryByTestId('markdown-undo')).toBeNull();
      expect(screen.queryByTestId('markdown-redo')).toBeNull();
    });

    it('undo button is disabled when canUndo is false', () => {
      renderEditor({ onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false });
      expect((screen.getByTestId('markdown-undo') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('markdown-redo') as HTMLButtonElement).disabled).toBe(true);
    });

    it('clicking undo/redo calls the handlers', () => {
      const onUndo = vi.fn();
      const onRedo = vi.fn();
      renderEditor({ onUndo, onRedo, canUndo: true, canRedo: true });
      fireEvent.click(screen.getByTestId('markdown-undo'));
      expect(onUndo).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('markdown-redo'));
      expect(onRedo).toHaveBeenCalledTimes(1);
    });
  });
});
