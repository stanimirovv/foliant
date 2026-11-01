import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import CommandPalette, { CommandPaletteProps } from './CommandPalette';

function makeProps(overrides: Partial<CommandPaletteProps> = {}): CommandPaletteProps {
  return {
    open: true,
    onClose: vi.fn(),
    theme: 'dark',
    files: ['checkout.mmd', 'payments.mmd'],
    markdownFiles: ['architecture.md'],
    mdDiagrams: {
      'architecture.md': [{ index: 0, title: 'System Overview', startLine: 5, endLine: 15 }],
    },
    currentFile: 'checkout.mmd',
    diagramIndex: null,
    elements: [
      {
        key: 'p:0',
        kind: 'participant',
        id: 'Gateway',
        alias: 'API Gateway',
        lineStart: 1,
        lineEnd: 1,
      },
      {
        key: 'p:1',
        kind: 'participant',
        id: 'Billing',
        alias: 'Billing Service',
        lineStart: 2,
        lineEnd: 2,
      },
    ],
    views: [{ name: 'Happy Path', hiddenPaths: [], hideKeys: ['legacy'] }],
    activeViewName: null,
    isDefaultViewActive: true,
    availableKeys: ['core', 'legacy'],
    hideKeys: new Set(['legacy']),
    mergeKeys: new Set(),
    isMarkdownDoc: false,
    editMode: true,
    isSidebarVisible: true,
    isSplitView: false,
    presentation: false,
    onSelectFile: vi.fn(),
    onJumpToElement: vi.fn(),
    onSelectView: vi.fn(),
    onSetTagState: vi.fn(),
    onCopyPng: vi.fn(),
    onExportPng: vi.fn(),
    onExportSvg: vi.fn(),
    onCopyMermaid: vi.fn(),
    onToggleEditMode: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleSplitView: vi.fn(),
    onToggleTheme: vi.fn(),
    onTogglePresentation: vi.fn(),
    onAddParticipant: vi.fn(),
    onAddStickyNote: vi.fn(),
    ...overrides,
  };
}

describe('CommandPalette', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(<CommandPalette {...makeProps({ open: false })} />);
    expect(container.querySelector('[data-testid="command-palette"]')).toBeNull();
  });

  it('lists participants, actions, views, tags, and files and filters by search query', () => {
    const props = makeProps();
    const { getByTestId, queryByTestId } = render(<CommandPalette {...props} />);

    expect(getByTestId('command-palette')).toBeTruthy();
    expect(getByTestId('cmd-jump-Gateway')).toBeTruthy();
    expect(getByTestId('cmd-copy-png')).toBeTruthy();
    expect(getByTestId('cmd-view-Happy Path')).toBeTruthy();
    expect(getByTestId('cmd-tag-core')).toBeTruthy();
    expect(getByTestId('cmd-file-payments.mmd')).toBeTruthy();

    const input = getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'Billing' } });

    expect(getByTestId('cmd-jump-Billing')).toBeTruthy();
    expect(queryByTestId('cmd-jump-Gateway')).toBeNull();
  });

  it('supports keyboard navigation (ArrowDown, ArrowUp, Enter, Escape)', () => {
    const props = makeProps();
    const { getByTestId } = render(<CommandPalette {...props} />);
    const input = getByTestId('command-palette-input');

    // First item is Jump to API Gateway (Gateway)
    expect(getByTestId('cmd-jump-Gateway').getAttribute('data-active')).toBe('true');

    // ArrowDown moves to second item: Jump to Billing Service (Billing)
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(getByTestId('cmd-jump-Billing').getAttribute('data-active')).toBe('true');

    // Enter executes the active item and closes the palette
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onJumpToElement).toHaveBeenCalledWith('p:1');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key or backdrop click', () => {
    const props = makeProps();
    const { getByTestId } = render(<CommandPalette {...props} />);
    const input = getByTestId('command-palette-input');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(getByTestId('command-palette-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('executes PNG export, view switch, tag filter toggle, and file switch on click', () => {
    const props = makeProps();
    const { getByTestId } = render(<CommandPalette {...props} />);

    fireEvent.click(getByTestId('cmd-copy-png'));
    expect(props.onCopyPng).toHaveBeenCalledTimes(1);

    fireEvent.click(getByTestId('cmd-view-Happy Path'));
    expect(props.onSelectView).toHaveBeenCalledWith(props.views[0]);

    // 'core' is currently On -> clicking toggles to 'off'
    fireEvent.click(getByTestId('cmd-tag-core'));
    expect(props.onSetTagState).toHaveBeenCalledWith('core', 'off');

    // 'legacy' is in hideKeys (Off) -> clicking toggles to 'on'
    fireEvent.click(getByTestId('cmd-tag-legacy'));
    expect(props.onSetTagState).toHaveBeenCalledWith('legacy', 'on');

    fireEvent.click(getByTestId('cmd-file-architecture.md-0'));
    expect(props.onSelectFile).toHaveBeenCalledWith('architecture.md', 0);
  });
});
