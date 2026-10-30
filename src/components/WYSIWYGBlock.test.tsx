import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WYSIWYGBlock from './WYSIWYGBlock';
import type { TextBlock } from '@/lib/markdownBlocks';

const makeBlock = (overrides?: Partial<TextBlock>): TextBlock => ({
  kind: 'text',
  nodeType: 'paragraph',
  startOffset: 0,
  endOffset: 10,
  source: 'Hello world',
  ...overrides,
});

const renderBlock = (block: TextBlock, overrides?: Partial<Parameters<typeof WYSIWYGBlock>[0]>) => {
  const props = {
    block,
    blockIndex: 0,
    theme: 'default' as const,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const result = render(<WYSIWYGBlock {...props} />);
  return { props, ...result };
};

describe('WYSIWYGBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  describe('read mode', () => {
    it('renders a paragraph as HTML', () => {
      renderBlock(makeBlock({ source: 'Hello **bold** world' }));
      const block = screen.getByTestId('wysiwyg-block-0');
      expect(block.querySelector('p')).toBeTruthy();
      expect(block.querySelector('strong')?.textContent).toBe('bold');
    });

    it('renders a heading as an h1', () => {
      renderBlock(makeBlock({ nodeType: 'heading', headingDepth: 1, source: '# Title' }));
      const block = screen.getByTestId('wysiwyg-block-0');
      expect(block.querySelector('h1')?.textContent).toBe('Title');
    });

    it('renders a list', () => {
      renderBlock(makeBlock({ nodeType: 'list', source: '- one\n- two' }));
      const block = screen.getByTestId('wysiwyg-block-0');
      expect(block.querySelectorAll('li')).toHaveLength(2);
    });

    it('renders a code block', () => {
      renderBlock(makeBlock({ nodeType: 'code', source: '```js\nconsole.log(1)\n```' }));
      const block = screen.getByTestId('wysiwyg-block-0');
      expect(block.querySelector('pre')).toBeTruthy();
      expect(block.querySelector('code')?.textContent).toContain('console.log(1)');
    });

    it('shows the block type label in the toolbar', () => {
      renderBlock(makeBlock({ nodeType: 'heading', headingDepth: 2, source: '## Subtitle' }));
      expect(screen.getByText('H2')).toBeTruthy();
    });

    it('shows a placeholder for an empty block', () => {
      renderBlock(makeBlock({ source: '' }));
      expect(screen.getByTestId('wysiwyg-block-empty-0').textContent).toContain('Empty block');
    });

    it('shows a placeholder for a whitespace-only block', () => {
      renderBlock(makeBlock({ source: '   ' }));
      expect(screen.getByTestId('wysiwyg-block-empty-0')).toBeTruthy();
    });
  });

  describe('edit mode', () => {
    it('clicking the block switches to edit mode with a textarea', () => {
      renderBlock(makeBlock({ source: 'Hello world' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(textarea).toBeTruthy();
      expect(textarea.value).toBe('Hello world');
    });

    it('save button calls onSave with the edited source', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Edited' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));
      expect(props.onSave).toHaveBeenCalledWith(0, 'Edited');
    });

    it('Cmd/Ctrl+Enter saves', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Edited' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(props.onSave).toHaveBeenCalledWith(0, 'Edited');
    });

    it('Meta+Enter (Cmd) saves', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Edited' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(props.onSave).toHaveBeenCalledWith(0, 'Edited');
    });

    it('blur saves', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Edited on blur' } });
      fireEvent.blur(textarea);
      expect(props.onSave).toHaveBeenCalledWith(0, 'Edited on blur');
    });

    it('blur to a toolbar control keeps edit mode without saving', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      const select = screen.getByTestId('wysiwyg-block-type-0');
      fireEvent.change(textarea, { target: { value: 'Edited' } });
      // Focus moves to the type select (inside the block) — e.g. the user
      // clicked it to change the block type.
      fireEvent.blur(textarea, { relatedTarget: select });
      expect(props.onSave).not.toHaveBeenCalled();
      const stillEditing = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(stillEditing.value).toBe('Edited');
      expect(screen.getByTestId('wysiwyg-block-type-0')).toBeTruthy();
    });

    it('blur to outside the block saves', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Edited outside' } });
      fireEvent.blur(textarea, { relatedTarget: document.body });
      expect(props.onSave).toHaveBeenCalledWith(0, 'Edited outside');
    });

    it('cancel button reverts without calling onSave', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Changed' } });
      fireEvent.click(screen.getByTestId('wysiwyg-block-cancel-0'));
      expect(props.onSave).not.toHaveBeenCalled();
      // back in read mode showing the original content
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
      expect(screen.getByTestId('wysiwyg-block-0').textContent).toContain('Original');
    });

    it('Escape cancels', () => {
      const { props } = renderBlock(makeBlock({ source: 'Original' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0');
      fireEvent.change(textarea, { target: { value: 'Changed' } });
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(props.onSave).not.toHaveBeenCalled();
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
    });

    it('save with unchanged source does not call onSave', () => {
      const { props } = renderBlock(makeBlock({ source: 'Same' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));
      expect(props.onSave).not.toHaveBeenCalled();
    });

    it('shows save and cancel buttons (not delete) while editing', () => {
      renderBlock(makeBlock());
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      expect(screen.getByTestId('wysiwyg-block-save-0')).toBeTruthy();
      expect(screen.getByTestId('wysiwyg-block-cancel-0')).toBeTruthy();
      expect(screen.queryByTestId('wysiwyg-block-delete-0')).toBeNull();
    });
  });

  describe('delete', () => {
    it('delete button calls onDelete', () => {
      const { props } = renderBlock(makeBlock(), { blockIndex: 3 });
      fireEvent.click(screen.getByTestId('wysiwyg-block-delete-3'));
      expect(props.onDelete).toHaveBeenCalledWith(3);
    });

    it('shows delete button (not save/cancel) in read mode', () => {
      renderBlock(makeBlock());
      expect(screen.getByTestId('wysiwyg-block-delete-0')).toBeTruthy();
      expect(screen.queryByTestId('wysiwyg-block-save-0')).toBeNull();
      expect(screen.queryByTestId('wysiwyg-block-cancel-0')).toBeNull();
    });
  });

  describe('dark theme', () => {
    it('applies dark theme classes', () => {
      renderBlock(makeBlock(), { theme: 'dark' });
      const block = screen.getByTestId('wysiwyg-block-0');
      expect(block.className).toContain('text-slate-100');
    });

    it('applies light theme classes', () => {
      renderBlock(makeBlock(), { theme: 'default' });
      const block = screen.getByTestId('wysiwyg-block-0');
      expect(block.className).toContain('text-gray-900');
    });
  });

  describe('block type switching', () => {
    it('shows a type selector in edit mode', () => {
      renderBlock(makeBlock({ source: 'Hello' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      expect(screen.getByTestId('wysiwyg-block-type-0')).toBeTruthy();
    });

    it('does not show a type selector in read mode', () => {
      renderBlock(makeBlock({ source: 'Hello' }));
      expect(screen.queryByTestId('wysiwyg-block-type-0')).toBeNull();
    });

    it('changing the type converts the draft source', () => {
      const { props } = renderBlock(makeBlock({ source: 'Hello world' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-type-0'), { target: { value: 'heading1' } });
      // The textarea now contains the converted source
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(textarea.value).toBe('# Hello world');
      // Save to verify
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));
      expect(props.onSave).toHaveBeenCalledWith(0, '# Hello world');
    });

    it('converts a heading to a paragraph', () => {
      const { props } = renderBlock(makeBlock({ nodeType: 'heading', headingDepth: 2, source: '## Title' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-type-0'), { target: { value: 'paragraph' } });
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Title');
      fireEvent.click(screen.getByTestId('wysiwyg-block-save-0'));
      expect(props.onSave).toHaveBeenCalledWith(0, 'Title');
    });

    it('converts to a bullet list', () => {
      renderBlock(makeBlock({ source: 'Item' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-type-0'), { target: { value: 'bulletList' } });
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(textarea.value).toBe('- Item');
    });

    it('converts to a quote', () => {
      renderBlock(makeBlock({ source: 'Quoted' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-type-0'), { target: { value: 'quote' } });
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(textarea.value).toBe('> Quoted');
    });

    it('converts to a code block', () => {
      renderBlock(makeBlock({ source: 'const x = 1;' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      fireEvent.change(screen.getByTestId('wysiwyg-block-type-0'), { target: { value: 'code' } });
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      expect(textarea.value).toBe('```\nconst x = 1;\n```');
    });

    it('detects the current type in the selector', () => {
      renderBlock(makeBlock({ nodeType: 'heading', headingDepth: 3, source: '### Sub' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const select = screen.getByTestId('wysiwyg-block-type-0') as HTMLSelectElement;
      expect(select.value).toBe('heading3');
    });
  });

  describe('keyboard shortcuts in the textarea', () => {
    it('Cmd+B wraps the selection with **', () => {
      renderBlock(makeBlock({ source: 'Hello world' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      // Select "world"
      textarea.setSelectionRange(6, 11);
      fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
      expect(textarea.value).toBe('Hello **world**');
    });

    it('Cmd+I wraps the selection with *', () => {
      renderBlock(makeBlock({ source: 'Hello world' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      textarea.setSelectionRange(6, 11);
      fireEvent.keyDown(textarea, { key: 'i', metaKey: true });
      expect(textarea.value).toBe('Hello *world*');
    });

    it('Cmd+K wraps the selection with a link', () => {
      renderBlock(makeBlock({ source: 'Click here' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      textarea.setSelectionRange(0, 10);
      fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true });
      expect(textarea.value).toBe('[Click here](url)');
    });

    it('Cmd+B unwraps already-bold text', () => {
      renderBlock(makeBlock({ source: 'Hello **world**' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      // Select "**world**" (including the markers)
      textarea.setSelectionRange(6, 15);
      fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
      expect(textarea.value).toBe('Hello world');
    });

    it('Cmd+B with no selection inserts ** and places cursor in between', () => {
      renderBlock(makeBlock({ source: 'Hello' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      const textarea = screen.getByTestId('wysiwyg-block-editor-0') as HTMLTextAreaElement;
      textarea.setSelectionRange(5, 5); // cursor at end
      fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
      expect(textarea.value).toBe('Hello****');
    });
  });

  describe('link clicks and edit mode rework', () => {
    it('executes external links in current tab without window.open or target=_blank', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      renderBlock(makeBlock({ source: '[Google](https://google.com)' }));
      const link = screen.getByText('Google').closest('a')!;
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toBe('https://google.com');
      expect(link.getAttribute('target')).toBeNull();

      let defaultPrevented = true;
      const clickHandler = (e: MouseEvent) => {
        defaultPrevented = e.defaultPrevented;
        // Prevent jsdom "navigation to another Document" warning in test runner
        e.preventDefault();
      };
      window.addEventListener('click', clickHandler);
      fireEvent.click(link);
      window.removeEventListener('click', clickHandler);

      // Link was not opened in a new tab
      expect(openSpy).not.toHaveBeenCalled();
      // Default navigation was not prevented by the component
      expect(defaultPrevented).toBe(false);
      // Edit mode was not entered
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
      openSpy.mockRestore();
    });

    it('executes relative-path links in current tab without opening in a new tab', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      renderBlock(makeBlock({ source: '[Other](./other.md)' }));
      const link = screen.getByText('Other').closest('a')!;
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toBe('./other.md');
      expect(link.getAttribute('target')).toBeNull();

      let defaultPrevented = true;
      const clickHandler = (e: MouseEvent) => {
        defaultPrevented = e.defaultPrevented;
        e.preventDefault();
      };
      window.addEventListener('click', clickHandler);
      fireEvent.click(link);
      window.removeEventListener('click', clickHandler);

      expect(openSpy).not.toHaveBeenCalled();
      expect(defaultPrevented).toBe(false);
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
      openSpy.mockRestore();
    });

    it('does not enter edit mode when clicking nested elements within a link', () => {
      renderBlock(makeBlock({ source: '[**Bold link**](https://example.com)' }));
      const boldText = screen.getByText('Bold link');
      const clickHandler = (e: MouseEvent) => e.preventDefault();
      window.addEventListener('click', clickHandler);
      fireEvent.click(boldText);
      window.removeEventListener('click', clickHandler);

      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
    });

    it('does not enter edit mode on right-click (contextmenu) on a link', () => {
      renderBlock(makeBlock({ source: '[Google](https://google.com)' }));
      const link = screen.getByText('Google');
      fireEvent.contextMenu(link);

      // Context menu right-click should not enter edit mode
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
    });

    it('scrolls to the target heading for internal fragment links', () => {
      const scrollSpy = vi.fn();
      // Render a block with an internal link; the target heading is a sibling
      // inside the same preview container.
      const { container } = render(
        <div data-testid="markdown-preview">
          <WYSIWYGBlock
            block={makeBlock({ nodeType: 'heading', headingDepth: 1, source: '# Target Section' })}
            blockIndex={0}
            theme="default"
            onSave={vi.fn()}
            onDelete={vi.fn()}
          />
          <WYSIWYGBlock
            block={makeBlock({ source: '[Go to target](#target-section)' })}
            blockIndex={1}
            theme="default"
            onSave={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      );
      // jsdom doesn't implement scrollIntoView — stub it on the target element.
      const heading = container.querySelector('h1');
      expect(heading).toBeTruthy();
      heading!.scrollIntoView = scrollSpy;
      const link = screen.getByText('Go to target');
      fireEvent.click(link);
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('does not enter edit mode when an internal link is clicked', () => {
      renderBlock(makeBlock({ source: '[Section](#my-section)' }));
      const link = screen.getByText('Section');
      fireEvent.click(link);
      // Still in read mode — no textarea appeared.
      expect(screen.queryByTestId('wysiwyg-block-editor-0')).toBeNull();
    });

    it('clicking non-link content still enters edit mode', () => {
      renderBlock(makeBlock({ source: 'Plain text' }));
      fireEvent.click(screen.getByTestId('wysiwyg-block-0'));
      expect(screen.getByTestId('wysiwyg-block-editor-0')).toBeTruthy();
    });

    it('renders headings with id attributes for anchor targeting', () => {
      renderBlock(makeBlock({ nodeType: 'heading', headingDepth: 2, source: '## My Section' }));
      const heading = screen.getByTestId('wysiwyg-block-0').querySelector('h2');
      expect(heading?.getAttribute('id')).toBe('my-section');
    });
  });

  describe('block type labels', () => {
    it.each([
      ['heading', 1, 'H1'],
      ['heading', 6, 'H6'],
      ['paragraph', undefined, 'Text'],
      ['list', undefined, 'List'],
      ['code', undefined, 'Code'],
      ['blockquote', undefined, 'Quote'],
      ['thematicBreak', undefined, 'Divider'],
      ['html', undefined, 'HTML'],
    ])('labels %s (depth %s) as "%s"', (nodeType, depth, label) => {
      renderBlock(makeBlock({ nodeType, headingDepth: depth }));
      expect(screen.getByText(label)).toBeTruthy();
    });
  });
});
