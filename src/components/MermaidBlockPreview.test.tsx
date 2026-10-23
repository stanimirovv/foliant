import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MermaidBlockPreview from './MermaidBlockPreview';

// mermaid is mocked: tests assert which source the block renders (recorded on
// mock.calls), not the SVG.
const renderMock = vi.fn<(id: string, code: string) => { svg: string }>(() => ({
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

describe('MermaidBlockPreview delete button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders a delete button only when onDelete is provided', () => {
    const { unmount } = renderBlock();
    expect(screen.queryByTestId('md-mermaid-delete-0')).toBeNull();
    unmount();

    renderBlock({ onDelete: vi.fn() });
    expect(screen.getByTestId('md-mermaid-delete-0')).toBeTruthy();
  });

  it('clicking delete calls onDelete and does not open the diagram editor', () => {
    const onDelete = vi.fn();
    const { props } = renderBlock({ onDelete });
    fireEvent.click(screen.getByTestId('md-mermaid-delete-0'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('shows the delete button for a broken diagram too (still deletable)', () => {
    const onDelete = vi.fn();
    renderBlock({ content: 'this is not mermaid at all', onDelete });
    fireEvent.click(screen.getByTestId('md-mermaid-delete-0'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('MermaidBlockPreview link clicks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('clicking a link inside the diagram does not open the editor', async () => {
    renderMock.mockImplementation(() => ({
      svg: '<svg data-testid="mock-mermaid-svg"><a href="https://example.com"><rect width="100" height="100"/></a></svg>',
    }));
    const onSelect = vi.fn();
    const { container } = renderBlock({ onSelect });
    await waitFor(() => {
      expect(container.querySelector('svg a')).toBeTruthy();
    });
    // ensureLinkTargets adds target="_blank"
    const anchor = container.querySelector('svg a')!;
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    // Clicking inside the anchor must not call onSelect
    fireEvent.click(anchor.querySelector('rect')!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicking outside a link still opens the editor', async () => {
    renderMock.mockImplementation(() => ({
      svg: '<svg data-testid="mock-mermaid-svg"><a href="https://example.com"><rect width="10" height="10"/></a><rect class="empty-space" width="100" height="100"/></svg>',
    }));
    const onSelect = vi.fn();
    const { container } = renderBlock({ onSelect });
    await waitFor(() => {
      expect(container.querySelector('svg')).toBeTruthy();
    });
    // Clicking on the block (not on the anchor) still calls onSelect
    fireEvent.click(container.querySelector('[data-testid="md-mermaid-block-0"]')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('MermaidBlockPreview — presentation mode (walkthrough player)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderMock.mockImplementation(() => ({
      svg: '<svg data-testid="mock-mermaid-svg"><text>mock diagram</text></svg>',
    }));
  });
  afterEach(() => {
    cleanup();
  });

  it('shows Present button for valid sequence block, wraps SVG in TransformWrapper when presenting, dims future messages & notes, and unwraps on Esc/exit without calling onSelect', async () => {
    const { SEQ_SVG, SEQ_CODE } = await import('@/lib/svgTestFixtures');
    renderMock.mockImplementation((id: string) => ({
      svg: SEQ_SVG.replaceAll('fx-seq', id),
    }));

    const { props, container } = renderBlock({ content: SEQ_CODE });
    await waitFor(() => expect(container.querySelector('[data-testid="md-mermaid-svg-0"] svg')).toBeTruthy());

    // Not wrapped in TransformWrapper initially
    expect(container.querySelector('.react-transform-wrapper')).toBeNull();
    const presentBtn = screen.getByTestId('md-mermaid-present-0');
    expect(presentBtn.textContent).toContain('Present');

    // Click Present button -> does not trigger onSelect, wraps in TransformWrapper, shows WalkthroughBar
    fireEvent.click(presentBtn);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('.react-transform-wrapper')).toBeTruthy();
    expect(screen.getByTestId('walkthrough-step-count').textContent).toBe('Step 1/4');

    // Clicking block body while presenting does not trigger onSelect
    fireEvent.click(screen.getByTestId('md-mermaid-block-0'));
    expect(props.onSelect).not.toHaveBeenCalled();

    // Step 1: m:0 (i1) is active, m:1 (i2) and note (i3) are dimmed
    expect(container.querySelector('[data-id="i1"]')?.classList.contains('walkthrough-active')).toBe(true);
    expect(container.querySelector('[data-id="i2"]')?.classList.contains('walkthrough-dimmed')).toBe(true);
    expect(container.querySelector('[data-id="i3"]')?.classList.contains('walkthrough-dimmed')).toBe(true);

    // Step 2: m:1 (i2) and Note over (i3) are revealed
    fireEvent.click(screen.getByTestId('walkthrough-next'));
    expect(screen.getByTestId('walkthrough-step-count').textContent).toBe('Step 2/4');
    expect(container.querySelector('[data-id="i2"]')?.classList.contains('walkthrough-active')).toBe(true);
    expect(container.querySelector('[data-id="i3"]')?.classList.contains('walkthrough-dimmed')).toBe(false);

    // Exit via Escape -> unwraps TransformWrapper and restores all elements
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.react-transform-wrapper')).toBeNull();
    expect(screen.queryByTestId('walkthrough-bar')).toBeNull();
    expect(container.querySelectorAll('.walkthrough-dimmed')).toHaveLength(0);
    expect(container.querySelectorAll('.walkthrough-active')).toHaveLength(0);
  });

  it('keeps the diagram at its fit-to-width size when entering presenter mode (zoom is not reset)', async () => {
    const { SEQ_SVG, SEQ_CODE } = await import('@/lib/svgTestFixtures');
    renderMock.mockImplementation((id: string) => ({
      svg: SEQ_SVG.replaceAll('fx-seq', id),
    }));

    const { container } = renderBlock({ content: SEQ_CODE });
    await waitFor(() => expect(container.querySelector('[data-testid="md-mermaid-svg-0"] svg')).toBeTruthy());

    // The preview renders the SVG fit-to-width inside .md-mermaid-svg
    // (padding 0.75em). The presenter host must inset it identically and the
    // SVG wrapper must have a definite full width, so the SVG's width="100%"
    // resolves the same way and the fresh TransformWrapper's scale 1 shows
    // the diagram at the same size as the preview.
    const previewHost = container.querySelector('[data-testid="md-mermaid-svg-0"]') as HTMLElement;
    expect(previewHost.className).toContain('md-mermaid-svg');

    fireEvent.click(screen.getByTestId('md-mermaid-present-0'));
    const presenterHost = container.querySelector('[data-testid="md-mermaid-svg-0"]') as HTMLElement;
    expect(presenterHost.className).toContain('p-[0.75em]');
    const svgWrapper = presenterHost.querySelector('.react-transform-component > div');
    expect(svgWrapper?.className).toContain('w-full');
  });

  it('steps flowchart block by depth level (1/N where N = depth levels)', async () => {
    const { FLOW_SVG, FLOW_CODE } = await import('@/lib/svgTestFixtures');
    renderMock.mockImplementation((id: string) => ({
      svg: FLOW_SVG.replaceAll('fx-flow', id),
    }));

    const { container } = renderBlock({ content: FLOW_CODE, title: 'flowchart' });
    await waitFor(() => expect(container.querySelector('[data-testid="md-mermaid-svg-0"] svg')).toBeTruthy());

    fireEvent.click(screen.getByTestId('md-mermaid-present-0'));
    expect(screen.getByTestId('walkthrough-step-count').textContent).toBe('Step 1/3');
    expect(container.querySelector('[id$="-flowchart-A-0"]')?.classList.contains('walkthrough-active')).toBe(true);
    expect(container.querySelector('[id$="-flowchart-B-1"]')?.classList.contains('walkthrough-dimmed')).toBe(true);

    fireEvent.click(screen.getByTestId('walkthrough-next'));
    expect(screen.getByTestId('walkthrough-step-count').textContent).toBe('Step 2/3');
    expect(container.querySelector('[id$="-flowchart-B-1"]')?.classList.contains('walkthrough-active')).toBe(true);
    expect(container.querySelector('[data-id="L_A_B_0"]')?.classList.contains('walkthrough-active')).toBe(true);
  });

  it('hides Present button for empty, non-diagram, or unsupported diagram blocks', () => {
    const { unmount: u1 } = renderBlock({ content: '   ' });
    expect(screen.queryByTestId('md-mermaid-present-0')).toBeNull();
    u1();

    const { unmount: u2 } = renderBlock({ content: 'just some prose' });
    expect(screen.queryByTestId('md-mermaid-present-0')).toBeNull();
    u2();

    const { unmount: u3 } = renderBlock({ content: 'pie\n  "A" : 50\n  "B" : 50' });
    expect(screen.queryByTestId('md-mermaid-present-0')).toBeNull();
    u3();
  });
});

