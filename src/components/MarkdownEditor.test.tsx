import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import MarkdownEditor from './MarkdownEditor';
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

  it('shows the markdown source in the editor and the rendered preview (split view by default)', async () => {
    renderEditor();

    // source pane: the raw markdown (Monaco mock textarea)
    const source = await screen.findByTestId('markdown-source-pane');
    expect(source.querySelector('[data-testid="monaco-editor-textarea"]')).toBeTruthy();

    // preview pane: rendered rich text
    const preview = await screen.findByTestId('markdown-preview');
    expect(within(preview).getByText('Architecture Notes').tagName).toBe('H1');
    expect(within(preview).getByText('bold')).toBeTruthy();
    expect(within(preview).getByText('Trailing prose.')).toBeTruthy();
    // the non-mermaid fenced block renders as code, not as a diagram
    expect(within(preview).getByText('console.log("not a diagram");')).toBeTruthy();
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

  it('switches between edit, split and preview modes', async () => {
    renderEditor();

    // split (default): both panes
    expect(screen.getByTestId('markdown-source-pane')).toBeTruthy();
    expect(screen.getByTestId('markdown-preview-pane')).toBeTruthy();

    // preview only
    fireEvent.click(screen.getByTestId('markdown-mode-preview'));
    expect(screen.queryByTestId('markdown-source-pane')).toBeNull();
    expect(screen.getByTestId('markdown-preview-pane')).toBeTruthy();

    // edit only
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.getByTestId('markdown-source-pane')).toBeTruthy();
    expect(screen.queryByTestId('markdown-preview-pane')).toBeNull();

    // back to split
    fireEvent.click(screen.getByTestId('markdown-mode-split'));
    expect(screen.getByTestId('markdown-source-pane')).toBeTruthy();
    expect(screen.getByTestId('markdown-preview-pane')).toBeTruthy();
  });

  it('reports source edits through onCodeChange', async () => {
    const { props } = renderEditor();

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
    // is not replaced by a destructive error box
    rerender(<MarkdownEditor {...props} code={MD.replace('sequenceDiagram', 'this is not a diagram')} />);
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
    renderEditor({ code: '```mermaid\nthis is not a diagram\n```\n' });

    await screen.findByTestId('md-mermaid-error-0');
    expect(document.querySelector('div[id^="dmd-mermaid-"]')).toBeNull();
  });

  it('shows an empty-diagram hint for a mermaid block without content', async () => {
    renderEditor({ code: '```mermaid\n```\n' });
    const empty = await screen.findByTestId('md-mermaid-empty-0');
    expect(empty.textContent).toContain('empty diagram');
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('shows an empty-file note when the document has no content', () => {
    renderEditor({ code: '' });
    expect(screen.getByTestId('markdown-preview').textContent).toContain('(empty file)');
  });
});
