import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MermaidBlockPreview from './MermaidBlockPreview';

// mermaid is mocked: tests assert which source the block renders (recorded on
// mock.calls), not the SVG.
const renderMock = vi.fn(() => ({
  svg: '<svg data-testid="mock-mermaid-svg"><text>mock diagram</text></svg>',
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (id: string, code: string) => renderMock(id, code),
  },
}));

const CONFIG = '%% CONFIG: {"version":1,"actors":{"Client":{"keys":["frontend"]},"Auth":{"keys":["backend"]}},"views":[{"name":"Backend only","hideKeys":["frontend"]},{"name":"Empty view","hiddenPaths":[]}]}';

const CONTENT = [
  CONFIG,
  'sequenceDiagram',
  '    participant Client as Client',
  '    participant Auth as Auth Service',
  '    Client->>Auth: Login',
  '    Auth->>Client: Token',
].join('\n');

const PLAIN_CONTENT = [
  'sequenceDiagram',
  '    participant A as Alice',
  '    participant B as Bob',
  '    A->>B: Hello',
].join('\n');

const renderBlock = (overrides?: Partial<Parameters<typeof MermaidBlockPreview>[0]>) => {
  const props = {
    content: CONTENT,
    index: 0,
    title: 'sequenceDiagram',
    startLine: 5,
    endLine: 10,
    theme: 'default' as const,
    onSelect: vi.fn(),
    ...overrides,
  };
  const result = render(<MermaidBlockPreview {...props} />);
  return { props, ...result };
};

// Waits out the debounced render and returns the source of the last render call.
const lastRenderedCode = async (): Promise<string> => {
  await waitFor(() => expect(renderMock).toHaveBeenCalled());
  return renderMock.mock.calls.at(-1)![1];
};

describe('MermaidBlockPreview view/tag controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('shows the view dropdown and tag chips when the block has views/tags and a change handler', () => {
    renderBlock({ onViewStateChange: vi.fn() });
    expect(screen.getByTestId('md-mermaid-view-controls-0')).toBeTruthy();
    const select = screen.getByTestId('md-mermaid-view-select-0') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.textContent);
    expect(options).toEqual(['All (default)', 'Backend only', 'Empty view']);
    expect(select.value).toBe('');
    const frontendChip = screen.getByTestId('md-mermaid-tag-0-frontend');
    expect(frontendChip.getAttribute('data-state')).toBe('on');
    expect(screen.getByTestId('md-mermaid-tag-0-backend').getAttribute('data-state')).toBe('on');
  });

  it('hides the controls without a change handler or without views/tags', () => {
    const { unmount } = renderBlock();
    expect(screen.queryByTestId('md-mermaid-view-controls-0')).toBeNull();
    unmount();
    renderBlock({ content: PLAIN_CONTENT, onViewStateChange: vi.fn() });
    expect(screen.queryByTestId('md-mermaid-view-controls-0')).toBeNull();
  });

  it('selecting a view reports the selection seeded with the view\'s hidden tags', () => {
    const onViewStateChange = vi.fn();
    renderBlock({ onViewStateChange });
    fireEvent.change(screen.getByTestId('md-mermaid-view-select-0'), {
      target: { value: 'Backend only' },
    });
    expect(onViewStateChange).toHaveBeenCalledWith({
      viewName: 'Backend only',
      hideKeys: ['frontend'],
    });
  });

  it('selecting the default option clears the selection', () => {
    const onViewStateChange = vi.fn();
    const { props, rerender } = renderBlock({
      onViewStateChange,
      viewState: { viewName: 'Backend only', hideKeys: ['frontend'] },
    });
    const select = screen.getByTestId('md-mermaid-view-select-0') as HTMLSelectElement;
    expect(select.value).toBe('Backend only');
    fireEvent.change(select, { target: { value: '' } });
    expect(onViewStateChange).toHaveBeenCalledWith({ viewName: null, hideKeys: [] });
    // the chips reflect the active view's hidden tags
    expect(screen.getByTestId('md-mermaid-tag-0-frontend').getAttribute('data-state')).toBe('off');
    expect(screen.getByTestId('md-mermaid-tag-0-backend').getAttribute('data-state')).toBe('on');
    rerender(<MermaidBlockPreview {...props} viewState={{ viewName: null, hideKeys: [] }} />);
    expect(screen.getByTestId('md-mermaid-tag-0-frontend').getAttribute('data-state')).toBe('on');
  });

  it('clicking a tag chip toggles it and exits view mode', () => {
    const onViewStateChange = vi.fn();
    renderBlock({
      onViewStateChange,
      viewState: { viewName: 'Backend only', hideKeys: ['frontend'] },
    });
    fireEvent.click(screen.getByTestId('md-mermaid-tag-0-backend'));
    expect(onViewStateChange).toHaveBeenCalledWith({
      viewName: null,
      hideKeys: ['frontend', 'backend'],
    });
  });

  it('clicking a tag chip does not open the diagram editor', () => {
    const { props } = renderBlock({ onViewStateChange: vi.fn() });
    fireEvent.click(screen.getByTestId('md-mermaid-tag-0-backend'));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('renders the raw content unchanged when nothing is selected', async () => {
    renderBlock({ onViewStateChange: vi.fn() });
    expect(await lastRenderedCode()).toBe(CONTENT);
  });

  it('renders the diagram with toggled-off tags hidden', async () => {
    renderBlock({
      onViewStateChange: vi.fn(),
      viewState: { viewName: null, hideKeys: ['frontend'] },
    });
    const code = await lastRenderedCode();
    expect(code).not.toContain('participant Client');
    // hiding an actor drops every line that mentions it, in both directions
    // (the same rule the diagram editor applies)
    expect(code).not.toContain('Client->>Auth: Login');
    expect(code).not.toContain('Auth->>Client: Token');
    expect(code).toContain('participant Auth');
  });

  it('renders the diagram with the selected saved view applied', async () => {
    renderBlock({
      onViewStateChange: vi.fn(),
      viewState: { viewName: 'Backend only', hideKeys: ['frontend'] },
    });
    const code = await lastRenderedCode();
    expect(code).not.toContain('participant Client');
    expect(code).toContain('participant Auth');
  });

  it('re-renders when the selection changes', async () => {
    const onViewStateChange = vi.fn();
    const { props, rerender } = renderBlock({ onViewStateChange });
    expect(await lastRenderedCode()).toBe(CONTENT);
    rerender(
      <MermaidBlockPreview
        {...props}
        viewState={{ viewName: null, hideKeys: ['backend'] }}
      />,
    );
    await waitFor(() => {
      expect(renderMock.mock.calls.at(-1)![1]).not.toContain('participant Auth');
    });
  });
});
