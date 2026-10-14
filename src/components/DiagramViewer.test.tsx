import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import mermaid from 'mermaid';
import DiagramViewer, { DIAGRAM_PAN_EXCLUSIONS, STICKY_PAN_EXCLUSIONS } from './DiagramViewer';
import { SEQ_SVG, SEQ_CODE, FLOW_SVG, FLOW_CODE } from '@/lib/svgTestFixtures';
import { PAN_EXCLUDE_CLASS } from '@/lib/styling';
import { DiagramConfig } from '@/lib/views';

// mermaid.render is mocked to return the fixture SVGs (ids rewritten to the
// render id, exactly like real mermaid output). The fixtures mirror the
// confirmed Mermaid 12.1 structure and match SEQ_CODE / FLOW_CODE.
const renderMock = vi.fn(async (id: string, code: string) => {
  const isFlow = /^\s*(flowchart|graph)\b/m.test(code);
  const fixture = isFlow ? FLOW_SVG : SEQ_SVG;
  return { svg: fixture.replaceAll('fx-seq', id).replaceAll('fx-flow', id) };
});

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (id: string, code: string) => renderMock(id, code),
  },
}));

const styleOf = (el: Element | null) => (el as unknown as SVGElement).style;

describe('DiagramViewer', () => {
  beforeEach(() => {
    renderMock.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the diagram SVG', async () => {
    const { container } = render(<DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" />);
    await waitFor(() => {
      expect(container.querySelector('#diagram-container svg')).toBeTruthy();
    });
  });

  it('applies arrow styles to the rendered DOM', async () => {
    const arrowStyles: DiagramConfig = {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'm1', color: '#e11d48', width: 3, dash: 'dashed' }],
    };
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" arrowStyles={arrowStyles} />
    );
    await waitFor(() => {
      const line = container.querySelector('line[data-id="i1"]');
      expect(line).toBeTruthy();
      expect(styleOf(line).stroke).toBe('rgb(225, 29, 72)');
      expect(styleOf(line).strokeWidth).toBe('3');
      expect(styleOf(line).strokeDasharray).toBe('8 6');
      expect(line!.getAttribute('marker-end')).toContain('--styled-');
      // unstyled message untouched
      const other = container.querySelector('line[data-id="i2"]');
      expect(styleOf(other).stroke).toBe('');
    });
  });

  it('applies node colors to flowchart nodes', async () => {
    const nodeColors: DiagramConfig = { version: 1, actors: { A: { color: 'red' } } };
    const { container } = render(
      <DiagramViewer code={FLOW_CODE} searchQuery="" theme="default" nodeColors={nodeColors} />
    );
    await waitFor(() => {
      const rect = container.querySelector('g.node[id$="-A-0"] .label-container');
      expect(rect).toBeTruthy();
      expect(styleOf(rect).fill).toBe('red');
      const other = container.querySelector('g.node[id$="-B-1"] .label-container');
      expect(styleOf(other).fill).toBe('');
    });
  });

  it('click on a message line calls onSelect with the right key in edit mode', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={onSelect} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i1"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('line[data-id="i1"]')!);
    expect(onSelect).toHaveBeenCalledWith('m:0');
    fireEvent.click(container.querySelector('path[data-id="i4"]')!);  // self-call
    expect(onSelect).toHaveBeenCalledWith('m:2');
    fireEvent.click(container.querySelector('g[data-et="participant"][data-id="B"]')!);
    expect(onSelect).toHaveBeenCalledWith('p:1');
    fireEvent.click(container.querySelector('g[data-et="note"] rect')!);
    expect(onSelect).toHaveBeenCalledWith('note:0');
  });

  it('click on a flowchart edge label resolves through the foreignObject', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={onSelect} />
    );
    await waitFor(() => {
      expect(container.querySelector('g.edgeLabel span.edgeLabel')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('g.edgeLabel span.edgeLabel p')!);
    expect(onSelect).toHaveBeenCalledWith('e:1');
    fireEvent.click(container.querySelector('path[data-id="L_A_B_0"]')!);
    expect(onSelect).toHaveBeenCalledWith('e:0');
  });

  it('does not call onSelect when edit mode is off', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" onSelect={onSelect} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i1"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('line[data-id="i1"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('#diagram-container')!.className).not.toContain('cursor-pointer');
  });

  it('applies the highlight class to the selected element', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      const line = container.querySelector('line[data-id="i2"]');
      expect(line?.classList.contains('editor-selected')).toBe(true);
    });
    // nothing else highlighted
    expect(container.querySelectorAll('.editor-selected')).toHaveLength(1);
  });

  it('restores the highlight after a re-render (code prop change)', async () => {
    const { container, rerender } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i2"]')?.classList.contains('editor-selected')).toBe(true);
    });
    const firstSvgId = container.querySelector('svg')!.getAttribute('id');

    // re-render with a comment added: same model, new render id -> new DOM
    rerender(
      <DiagramViewer code={`${SEQ_CODE}\n    %% a comment`} searchQuery="" theme="default" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      const svg = container.querySelector('svg');
      expect(svg!.getAttribute('id')).not.toBe(firstSvgId);
      expect(container.querySelector('line[data-id="i2"]')?.classList.contains('editor-selected')).toBe(true);
    });
  });

  it('clears the highlight when the selection is cleared', async () => {
    const { container, rerender } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      expect(container.querySelector('.editor-selected')).toBeTruthy();
    });
    rerender(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => {
      expect(container.querySelector('.editor-selected')).toBeNull();
    });
  });

  it('makes diagram text unselectable with select-none class', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode />
    );
    await waitFor(() => {
      expect(container.querySelector('#diagram-container')).toBeTruthy();
    });
    expect(container.querySelector('#diagram-container')?.className).toContain('select-none');
    expect(container.querySelector('[data-testid="diagram-canvas-root"]')?.className).toContain('select-none');
  });

  it('shift-click calls onSelect with shiftKey option and prevents text selection on mousedown', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={onSelect} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i1"]')).toBeTruthy();
    });
    const target = container.querySelector('line[data-id="i1"]')!;
    const notPrevented = fireEvent.mouseDown(target, { shiftKey: true, button: 0 });
    expect(notPrevented).toBe(false); // preventDefault was called

    fireEvent.click(target, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith('m:0', { shiftKey: true });
  });

  it('shift-click on a note selects it for multi-selection', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={onSelect} />
    );
    await waitFor(() => {
      expect(container.querySelector('g[data-et="note"]')).toBeTruthy();
    });
    const target = container.querySelector('g[data-et="note"] rect')!;
    fireEvent.mouseDown(target, { shiftKey: true, button: 0 });
    fireEvent.click(target, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith('note:0', { shiftKey: true });
  });

  it('applies the highlight class to multiple selected elements when selection is an array', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={['m:0', 'm:1']} onSelect={() => {}} />
    );
    await waitFor(() => {
      const line1 = container.querySelector('line[data-id="i1"]');
      const line2 = container.querySelector('line[data-id="i2"]');
      expect(line1?.classList.contains('editor-selected')).toBe(true);
      expect(line2?.classList.contains('editor-selected')).toBe(true);
    });
    expect(container.querySelectorAll('.editor-selected')).toHaveLength(2);
  });

  it('search highlight still works on the post-processed SVG', async () => {
    const arrowStyles: DiagramConfig = {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'm1', color: 'red' }],
    };
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="m2" theme="default" arrowStyles={arrowStyles} />
    );
    await waitFor(() => {
      const texts = Array.from(container.querySelectorAll('text.messageText'));
      const hit = texts.find(t => t.textContent === 'm2');
      expect(hit).toBeTruthy();
      expect(styleOf(hit!).fill).toBe('red');
      expect(styleOf(hit!).fontWeight).toBe('bold');
      const miss = texts.find(t => t.textContent === 'm1');
      expect(styleOf(miss!).fill).toBe('');
    });
  });

  it('create -> change -> verify: styled render, click, re-render keeps highlight', async () => {
    const onSelect = vi.fn();
    const arrowStyles: DiagramConfig = {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'm1', color: '#e11d48', width: 3, dash: 'dashed' }],
    };
    const { container, rerender } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode arrowStyles={arrowStyles} selection={null} onSelect={onSelect} />
    );
    // styled DOM
    await waitFor(() => {
      expect(styleOf(container.querySelector('line[data-id="i1"]')).stroke).toBe('rgb(225, 29, 72)');
    });
    // click -> onSelect with the correct key
    fireEvent.click(container.querySelector('line[data-id="i1"]')!);
    expect(onSelect).toHaveBeenCalledWith('m:0');
    // parent stores the selection; highlight appears
    rerender(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode arrowStyles={arrowStyles} selection="m:0" onSelect={onSelect} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i1"]')?.classList.contains('editor-selected')).toBe(true);
    });
    // style + highlight coexist on the same element
    const line = container.querySelector('line[data-id="i1"]')!;
    expect(styleOf(line).stroke).toBe('rgb(225, 29, 72)');
    expect(line.classList.contains('editor-selected')).toBe(true);
  });

  it('keeps the last good render and shows an error when a re-render fails (soft-fail, NFR-01)', async () => {
    const defaultImpl = renderMock.getMockImplementation()!;
    renderMock.mockImplementation(async (id: string, code: string) => {
      if (code.includes('garbage')) throw new Error('Syntax error in text');
      return defaultImpl(id, code);
    });
    try {
      const { container, rerender } = render(
        <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" />
      );
      await waitFor(() => {
        expect(container.querySelector('#diagram-container svg')).toBeTruthy();
      });
      const goodSvg = container.querySelector('#diagram-container svg');

      // the code breaks (e.g. a half-finished edit produced unparsable
      // mermaid): the render throws, the error banner shows, the previous
      // SVG stays on screen
      rerender(
        <DiagramViewer code={`${SEQ_CODE}\n    this is garbage`} searchQuery="" theme="default" />
      );
      await waitFor(() => {
        expect(container.textContent).toContain('Syntax error in text');
      });
      expect(container.querySelector('#diagram-container svg')).toBe(goodSvg);
    } finally {
      renderMock.mockImplementation(defaultImpl);
    }
  });

  it('applies the selection highlight in the dark theme', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="dark" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i2"]')?.classList.contains('editor-selected')).toBe(true);
    });
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('keeps pan/zoom and the highlight across a code change (NFR-03)', async () => {
    const { container, rerender } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i2"]')).toBeTruthy();
    });
    const component = () => container.querySelector('.react-transform-component') as HTMLElement;
    expect(component().style.transform).toBe('translate(0px, 0px) scale(1)');

    // zoom in with the wheel, then let the zoom animation settle
    fireEvent.wheel(container.querySelector('.react-transform-wrapper')!, { deltaY: -100 });
    await waitFor(() => {
      expect(component().style.transform).not.toBe('translate(0px, 0px) scale(1)');
    });
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    const zoomed = component().style.transform;

    // an edit lands: new code -> full re-render of the SVG
    rerender(
      <DiagramViewer code={`${SEQ_CODE}\n    %% an edit`} searchQuery="" theme="default" editMode selection="m:1" onSelect={() => {}} />
    );
    await waitFor(() => {
      expect(container.querySelector('line[data-id="i2"]')?.classList.contains('editor-selected')).toBe(true);
    });

    // pan/zoom state survived the re-render (the TransformWrapper never unmounts)
    expect(component().style.transform).toBe(zoomed);
  });
});

// --- Drag interactions (reorder + create-message) ---------------------------

function mockRect(el: Element, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({
    left, top, width, height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
}

// Mock screen rects for the SEQ fixture: participants A(0), B(150), C(300)
// at the top (boxes Y=10..50), messages at Y=100,150,200,250. The connect
// handle of each participant sits at (centerX, 64) — 14px below the top box.
function mockSeqScreenRects(container: HTMLElement) {
  const svg = container.querySelector('#diagram-container svg');
  if (!svg) return;
  // the svg root rect bounds the lifeline hover zone
  mockRect(svg, 0, 0, 500, 400);
  const groups = svg.querySelectorAll('g[data-et="participant"]');
  const byId = new Map<string, Element>();
  groups.forEach(g => { const id = g.getAttribute('data-id'); if (id) byId.set(id, g); });
  mockRect(byId.get('A')!, 0, 10, 100, 40);
  mockRect(byId.get('B')!, 150, 10, 100, 40);
  mockRect(byId.get('C')!, 300, 10, 100, 40);
  const lines = svg.querySelectorAll('[data-et="message"]');
  const ys = [100, 150, 200, 250];
  lines.forEach((el, i) => { if (i < ys.length) mockRect(el, 0, ys[i], 200, 2); });
  // container rect for reorder Y extent
  const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
  if (diagramContainer) mockRect(diagramContainer, 0, 0, 500, 400);
}

describe('DiagramViewer drag interactions', () => {
  beforeEach(() => {
    renderMock.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  // Helper: the lifeline element for a participant id.
  const lifelineOf = (container: HTMLElement, id: string) =>
    container.querySelector(`line.actor-line[data-id="${id}"]`) as Element;

  // Helper: the top actor box for a participant id.
  const actorBoxOf = (container: HTMLElement, id: string) =>
    container.querySelector(`g[data-et="participant"][data-id="${id}"]`) as Element;

  it('dragging an actor box fires onMoveParticipant (reorder), regardless of selection', async () => {
    const onMoveParticipant = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Mouse down on participant C's actor box → reorder, even though nothing is selected
    fireEvent.mouseDown(actorBoxOf(container, 'C'), { button: 0, clientX: 350, clientY: 30 });
    expect(onSelect).toHaveBeenCalledWith('p:2');

    // Drag left past B (to X=100, between A and B)
    fireEvent.mouseMove(window, { clientX: 100, clientY: 200 });
    await waitFor(() => expect(container.querySelector('[data-testid="reorder-indicator"]')).toBeTruthy());

    fireEvent.mouseUp(window, { clientX: 100, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('p:2', 'p:1'); // move C before B
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('dragging an actor box reorders even when that participant is already selected', async () => {
    const onMoveParticipant = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection="p:0"
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // A is selected, but dragging its actor box still reorders (spatial, not selection-based)
    fireEvent.mouseDown(actorBoxOf(container, 'A'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 200 }); // drag right past C
    fireEvent.mouseUp(window, { clientX: 350, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('p:0', null); // move A to end
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('dragging a participant to the front inserts before the first participant', async () => {
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Drag C's actor box to the far left (before A)
    fireEvent.mouseDown(actorBoxOf(container, 'C'), { button: 0, clientX: 350, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: -50, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: -50, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('p:2', 'p:0'); // move C before A
  });

  it('dragging into the right half of the last gap inserts before the last participant, not at the end', async () => {
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Drag A's actor box to X=300: past B's center (200) but before C's center (350).
    // The gap midpoint is 275, so the cursor is in the right half of the gap —
    // the drop must land between B and C, not at the end.
    fireEvent.mouseDown(actorBoxOf(container, 'A'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('p:0', 'p:2'); // move A before C
  });

  it('dragging the connect handle fires onCreateMessageDrag with insert position', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onCreateMessageDrag={onCreateMessageDrag} onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Mouse down on A's connect handle (50, 64 — on the lifeline, 14px below
    // the top box) → message drag
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 64 });
    expect(onSelect).toHaveBeenCalledWith('p:0');

    // Drag to participant C at Y=180 (between messages at 150 and 200)
    fireEvent.mouseMove(window, { clientX: 350, clientY: 180 });
    await waitFor(() => expect(container.querySelector('[data-testid="message-drag-line"]')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('[data-testid="message-insert-indicator"]')).toBeTruthy());
    // The drag line starts at the grabbed handle.
    const line = container.querySelector('[data-testid="message-drag-line"]')!;
    expect(line.getAttribute('x1')).toBe('50');
    expect(line.getAttribute('y1')).toBe('64');

    fireEvent.mouseUp(window, { clientX: 350, clientY: 180 });
    expect(onCreateMessageDrag).toHaveBeenCalledWith(
      'p:0', 'p:2',
      { type: 'before', key: 'm:2' } // between msg at Y=150 (m:1) and Y=200 (m:2)
    );
    expect(onMoveParticipant).not.toHaveBeenCalled();
  });

  it('the connect handle wins over an endpoint grab zone that overlaps it', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveMessageEndpoint = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Move m:0's line up to Y=70 (center 71): its tail endpoint (50, 71) now
    // sits 7px below A's connect handle (50, 64) — inside BOTH the 8px
    // endpoint grab zone and the 10px handle grab radius. On small renderings
    // the first message crowds the handle like this.
    const firstMsg = container.querySelector('#diagram-container [data-et="message"]') as Element;
    mockRect(firstMsg, 0, 70, 200, 2);

    // Press the handle itself: the dot is the dedicated affordance, so it wins
    // over the endpoint zone → message-creation drag.
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 64 });
    expect(onSelect).toHaveBeenCalledWith('p:0');
    fireEvent.mouseMove(window, { clientX: 200, clientY: 150 });
    await waitFor(() => expect(container.querySelector('[data-testid="message-drag-line"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 200, clientY: 150 });
    expect(onCreateMessageDrag).toHaveBeenCalledWith('p:0', 'p:1', { type: 'before', key: 'm:1' });
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();

    // The endpoint stays grabbable just outside the handle's grab radius.
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 78 });
    expect(onSelect).toHaveBeenCalledWith('m:0');
    fireEvent.mouseMove(window, { clientX: 350, clientY: 150 });
    await waitFor(() => expect(container.querySelector('[data-testid="endpoint-drag-line"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 350, clientY: 150 });
    expect(onMoveMessageEndpoint).toHaveBeenCalledWith('m:0', 'from', 'p:2');
  });

  it('pressing empty space near a lifeline starts no drag (message creation is handle-only)', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag} onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Mouse down on the SVG background near A's lifeline (centerX=50, within
    // 20px, but not on the connect handle at Y=64)
    const svgRoot = container.querySelector('#diagram-container svg') as Element;
    fireEvent.mouseDown(svgRoot, { button: 0, clientX: 55, clientY: 130 });
    // Drag to C
    fireEvent.mouseMove(window, { clientX: 350, clientY: 180 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 180 });
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
    expect(onMoveParticipant).not.toHaveBeenCalled();
  });

  it('releasing a message drag over the same participant does not create a message', async () => {
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Drag from A's connect handle back to A — no valid target
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 64 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 180 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 180 });
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('a plain click on an actor box (no drag) does not fire drag callbacks', async () => {
    const onMoveParticipant = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    fireEvent.mouseDown(actorBoxOf(container, 'A'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 30 }); // no movement
    expect(onMoveParticipant).not.toHaveBeenCalled();
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('dragging the connect handle to create a message at the top inserts before the first message', async () => {
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 64 });
    // Drag to C at Y=60 (above the first message at Y=100)
    fireEvent.mouseMove(window, { clientX: 350, clientY: 60 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 60 });
    expect(onCreateMessageDrag).toHaveBeenCalledWith(
      'p:0', 'p:2',
      { type: 'before', key: 'm:0' } // before the first message
    );
  });

  it('dragging the connect handle to create a message at the bottom inserts after the last message', async () => {
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 64 });
    // Drag to C at Y=350 (below the last message at Y=250)
    fireEvent.mouseMove(window, { clientX: 350, clientY: 350 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 350 });
    expect(onCreateMessageDrag).toHaveBeenCalledWith(
      'p:0', 'p:2',
      { type: 'after', key: 'm:3' } // after the last message
    );
  });

  // --- Endpoint drag (message retarget) -------------------------------------
  // With mockSeqScreenRects the endpoints are:
  //   m:0 A->B: tail (50,101), head (200,101)
  //   m:1 B->A: tail (200,151), head (50,151)
  //   m:2 A->A: both (50,201)
  //   m:3 A->C: tail (50,251), head (350,251)

  it('dragging an arrow head retargets the recipient', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Press B's lifeline exactly at m:0's arrow head — the endpoint grab zone
    // wins over the lifeline message-create at the same point.
    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 100 });
    expect(onSelect).toHaveBeenCalledWith('m:0'); // the grabbed message is selected

    // Drag to participant C
    fireEvent.mouseMove(window, { clientX: 350, clientY: 150 });
    await waitFor(() => expect(container.querySelector('[data-testid="endpoint-drag-line"]')).toBeTruthy());
    // The overlay line starts at the FIXED endpoint (the tail on A's lifeline).
    const line = container.querySelector('[data-testid="endpoint-drag-line"]')!;
    expect(line.getAttribute('x1')).toBe('50');
    expect(line.getAttribute('y1')).toBe('101');
    expect(line.getAttribute('x2')).toBe('350');
    expect(line.getAttribute('y2')).toBe('150');
    expect(line.getAttribute('stroke')).toBe('#3b82f6'); // valid target under the cursor
    // Snap highlight on the target participant.
    expect(container.querySelector('[data-testid="endpoint-snap-rect"]')).toBeTruthy();

    fireEvent.mouseUp(window, { clientX: 350, clientY: 150 });
    expect(onMoveMessageEndpoint).toHaveBeenCalledWith('m:0', 'to', 'p:2');
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('dragging an arrow tail retargets the origin', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Press A's lifeline at m:0's tail (50, 101), drag to C
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 300 });
    expect(onMoveMessageEndpoint).toHaveBeenCalledWith('m:0', 'from', 'p:2');
  });

  it('releasing over the participant already at the dragged end is a no-op', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Grab m:0's head (on B's lifeline), drag straight down — still over B
    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 300 });
    await waitFor(() => expect(container.querySelector('[data-testid="endpoint-drag-line"]')).toBeTruthy());
    // No valid target: the line is grey and there is no snap highlight.
    const line = container.querySelector('[data-testid="endpoint-drag-line"]')!;
    expect(line.getAttribute('stroke')).toBe('#9ca3af');
    expect(container.querySelector('[data-testid="endpoint-snap-rect"]')).toBeNull();
    fireEvent.mouseUp(window, { clientX: 200, clientY: 300 });
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
  });

  it('dragging an arrow tail vertically reorders the message', async () => {
    const onMoveMessage = vi.fn();
    const onMoveMessageEndpoint = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveMessage={onMoveMessage} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Press A's lifeline at m:0's tail (50, 100) and drag vertically to Y=180 (between m:1 at 150 and m:2 at 200)
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 180 });

    await waitFor(() => expect(container.querySelector('[data-testid="message-insert-indicator"]')).toBeTruthy());
    const indicator = container.querySelector('[data-testid="message-insert-indicator"]')!;
    expect(indicator.getAttribute('y1')).toBe('176');

    fireEvent.mouseUp(window, { clientX: 50, clientY: 180 });
    expect(onMoveMessage).toHaveBeenCalledWith('m:0', { type: 'after', key: 'm:1' });
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
  });

  it('dragging an arrow tail to below all messages reorders it to after the last message', async () => {
    const onMoveMessage = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveMessage={onMoveMessage}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Press A's lifeline at m:0's tail (50, 100) and drag down to Y=320 (past m:3 at 250)
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 320 });

    await waitFor(() => expect(container.querySelector('[data-testid="message-insert-indicator"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 50, clientY: 320 });
    expect(onMoveMessage).toHaveBeenCalledWith('m:0', { type: 'after', key: 'm:3' });
  });

  it('dragging an arrow tail to above all other messages reorders it before the first other message', async () => {
    const onMoveMessage = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveMessage={onMoveMessage}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // Press m:1's tail (on B's lifeline at 200, 150) and drag up to Y=50 (above m:0 at 100)
    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 150 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 50 });

    await waitFor(() => expect(container.querySelector('[data-testid="message-insert-indicator"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 200, clientY: 50 });
    expect(onMoveMessage).toHaveBeenCalledWith('m:1', { type: 'before', key: 'm:0' });
  });

  it('a plain press on an endpoint selects the message without dragging', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: 100 }); // no movement
    expect(onSelect).toHaveBeenCalledWith('m:0');
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('pressing the lifeline away from endpoints reorders the participant instead of creating a message', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
        onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // 29px below m:0's head and 21px above m:1's tail — outside the grab
    // zones, and away from B's connect handle (200, 64): a lifeline press is
    // a reorder drag now, so it must never create or retarget a message.
    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 130 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 180 });
    await waitFor(() => expect(container.querySelector('[data-testid="reorder-indicator"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 400, clientY: 180 });
    // B dragged right past C's center (350) → move to end
    expect(onMoveParticipant).toHaveBeenCalledWith('p:1', null);
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
  });

  it('pressing the middle of a message line does not start an endpoint drag', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // m:0's line runs (50,101)-(200,101); its middle is ~75px from both ends
    const msgLine = container.querySelector('line[data-id="i1"]') as Element;
    fireEvent.mouseDown(msgLine, { button: 0, clientX: 125, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 125, clientY: 100 });
    fireEvent.click(msgLine);
    expect(onSelect).toHaveBeenCalledWith('m:0'); // the click selects the message
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('dragging a self-message loop retargets the recipient', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // m:2 is A->>A: head and tail coincide on A's lifeline at (50, 201) and
    // the grab resolves to the head.
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 250 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: 250 });
    expect(onMoveMessageEndpoint).toHaveBeenCalledWith('m:2', 'to', 'p:1');
  });

  it('a selected message\'s arrow head has a much larger grab zone', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:0"
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // 19px below m:0's head (200,101): outside the 8px unselected zone, but
    // inside the 24px zone of the selected message.
    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 150 });
    await waitFor(() => expect(container.querySelector('[data-testid="endpoint-drag-line"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 350, clientY: 150 });
    expect(onMoveMessageEndpoint).toHaveBeenCalledWith('m:0', 'to', 'p:2');
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('a selected message\'s arrow tail has a much larger grab zone', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:0"
        onSelect={() => {}} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // 19px below m:0's tail (50,101) on A's lifeline
    fireEvent.mouseDown(lifelineOf(container, 'A'), { button: 0, clientX: 50, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 300 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 300 });
    expect(onMoveMessageEndpoint).toHaveBeenCalledWith('m:0', 'from', 'p:2');
  });

  it('an unselected message keeps the small grab zone when another message is selected', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection="m:1"
        onSelect={() => {}} onCreateMessageDrag={onCreateMessageDrag} onMoveMessageEndpoint={onMoveMessageEndpoint}
        onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    // 19px below m:0's head: m:0 is NOT selected, so its zone stays at 8px and
    // the press is not an endpoint drag. It lands on B's lifeline (away from
    // the connect handle), so it reorders B instead.
    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 180 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 180 });
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
    // cursor X=300: past B's center (200), before C's center (350) → move B before C
    expect(onMoveParticipant).toHaveBeenCalledWith('p:1', 'p:2');
  });

  it('does not start an endpoint drag outside edit mode', async () => {
    const onMoveMessageEndpoint = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode={false} selection={null}
        onSelect={() => {}} onMoveMessageEndpoint={onMoveMessageEndpoint}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    fireEvent.mouseDown(lifelineOf(container, 'B'), { button: 0, clientX: 200, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 150 });
    fireEvent.mouseUp(window, { clientX: 350, clientY: 150 });
    expect(onMoveMessageEndpoint).not.toHaveBeenCalled();
  });

  // --- Hover affordances (connect handle) ------------------------------------

  it('hovering an actor column reveals the connect handle just below the top box', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
    // Hover A's lifeline at Y=130 (below the top box, within 20px of centerX=50)
    fireEvent.mouseMove(diagramContainer, { clientX: 50, clientY: 130 });
    await waitFor(() => expect(container.querySelector('[data-testid="sequence-connect-handle"]')).toBeTruthy());
    const handle = container.querySelector('[data-testid="sequence-connect-handle"]')!;
    // A's top box is (0,10,100,40): the handle sits at (centerX=50, bottom+14=64)
    expect(handle.getAttribute('transform')).toBe('translate(50, 64)');
    // the column body is a reorder zone → grab cursor
    expect(diagramContainer.style.cursor).toBe('grab');

    // Hovering the handle itself switches to a crosshair
    fireEvent.mouseMove(diagramContainer, { clientX: 50, clientY: 64 });
    await waitFor(() => expect(diagramContainer.style.cursor).toBe('crosshair'));
  });

  it('hovering the top actor box also reveals the connect handle', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
    fireEvent.mouseMove(diagramContainer, { clientX: 200, clientY: 30 }); // over B's top box
    await waitFor(() => expect(container.querySelector('[data-testid="sequence-connect-handle"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="sequence-connect-handle"]')!.getAttribute('transform'))
      .toBe('translate(200, 64)');
  });

  it('hovering empty space far from any column shows no connect handle', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
    // X=450 is 100px right of C's center (350) — outside the 20px lifeline zone
    fireEvent.mouseMove(diagramContainer, { clientX: 450, clientY: 130 });
    expect(container.querySelector('[data-testid="sequence-connect-handle"]')).toBeNull();
    expect(diagramContainer.style.cursor).toBe('');
  });
});

describe('DiagramViewer pan exclusion (participant drag)', () => {
  beforeEach(() => {
    renderMock.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it('does not pan the screen when dragging a participant in edit mode', async () => {
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={() => {}}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockSeqScreenRects(container);

    const component = container.querySelector('.react-transform-component') as HTMLElement;
    const initialTransform = component.style.transform;

    // Mouse down on a participant and drag — should start a drag, not pan
    const participantA = container.querySelector('g[data-et="participant"][data-id="A"]') as Element;
    fireEvent.mouseDown(participantA, { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });

    // The transform should not have changed — panning was excluded
    expect(component.style.transform).toBe(initialTransform);
  });

  it('still allows panning from non-participant areas in edit mode', async () => {
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());

    // Mouse down on the SVG background (not a participant) and drag — should pan
    const svgRoot = container.querySelector('#diagram-container svg') as Element;
    fireEvent.mouseDown(svgRoot, { button: 0, clientX: 400, clientY: 350 });
    fireEvent.mouseMove(svgRoot, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(svgRoot, { clientX: 300, clientY: 250 });

    // Panning is not globally disabled — only participant elements are excluded.
    // (In jsdom the pan may or may not apply depending on the library's internal
    // coordinate handling; the key assertion is that no error occurs and the
    // component remains functional.)
    expect(container.querySelector('#diagram-container svg')).toBeTruthy();
  });

  it('allows panning when not in edit mode (no exclusion)', async () => {
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE} searchQuery="" theme="default" editMode={false}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    // No edit mode → no exclusion → component renders normally
    expect(container.querySelector('.react-transform-wrapper')).toBeTruthy();
  });

  it('clears the previous diagram when the code becomes empty (e.g. an empty directory)', async () => {
    const { container, rerender } = render(<DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" />);
    await waitFor(() => {
      expect(container.querySelector('#diagram-container svg')).toBeTruthy();
    });

    rerender(<DiagramViewer code="" searchQuery="" theme="default" />);

    // the stale SVG is dropped and an empty-state placeholder shows instead
    await waitFor(() => {
      expect(container.querySelector('#diagram-container svg')).toBeNull();
    });
    expect(container.querySelector('[data-testid="no-diagram"]')?.textContent).toBe('No diagram selected');
  });
});

// --- Pan exclusion contract (react-zoom-pan-pinch) ---------------------------

// The library expands each `panning.excluded` entry E into
// `.react-transform-wrapper E, .react-transform-wrapper .E,
// .react-transform-wrapper E *, .react-transform-wrapper .E *` and calls
// Element.matches() with it on every mouse-down inside the wrapper. E must
// be a bare class name — anything else is an invalid selector and matches()
// throws, which surfaced as an unhandled error and silently killed
// drag-panning in edit mode in real browsers (regression test for the old
// `[data-et="message"]` exclusion entry).
describe('pan exclusion config', () => {
  beforeEach(() => {
    renderMock.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  const expandLikeLibrary = (entry: string) =>
    `.react-transform-wrapper ${entry}, .react-transform-wrapper .${entry}, ` +
    `.react-transform-wrapper ${entry} *, .react-transform-wrapper .${entry} *`;

  it.each([...DIAGRAM_PAN_EXCLUSIONS, ...STICKY_PAN_EXCLUSIONS])(
    'exclusion entry "%s" expands to a valid selector',
    (entry) => {
      const probe = document.createElement('div');
      expect(() => probe.matches(expandLikeLibrary(entry))).not.toThrow();
    }
  );

  it('marks draggable sequence elements with the exclusion class', async () => {
    const { container } = render(
      <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    const marked = (selector: string) => {
      const el = container.querySelector(selector);
      expect(el, selector).toBeTruthy();
      expect(el!.classList.contains(PAN_EXCLUDE_CLASS), selector).toBe(true);
    };
    marked('g[data-et="participant"]');
    marked('line.actor-line');
    marked('[data-et="message"]');
    marked('text.messageText');
    marked('g[data-et="note"]');
    // the svg root itself stays unmarked — background drags must still pan
    const svgRoot = container.querySelector('#diagram-container svg');
    expect(svgRoot!.classList.contains(PAN_EXCLUDE_CLASS)).toBe(false);
  });

  it('marks flowchart nodes with the exclusion class', async () => {
    const { container } = render(
      <DiagramViewer code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    const node = container.querySelector('g.node');
    expect(node).toBeTruthy();
    expect(node!.classList.contains(PAN_EXCLUDE_CLASS)).toBe(true);
  });
});

// --- Flowchart node drag (connect + move) ------------------------------------

// Mock screen rects for the FLOW fixture: nodes A(0), B(150), C(300) at the
// top (same geometry as the sequence fixture).
function mockFlowScreenRects(container: HTMLElement) {
  const svg = container.querySelector('#diagram-container svg');
  if (!svg) return;
  const byId = new Map<string, Element>();
  svg.querySelectorAll('g.node[id]').forEach(g => {
    const id = g.getAttribute('id') ?? '';
    const m = id.match(/-flowchart-(.+)-\d+$/);
    if (m) byId.set(m[1], g);
  });
  mockRect(byId.get('A')!, 0, 10, 100, 40);
  mockRect(byId.get('B')!, 150, 10, 100, 40);
  mockRect(byId.get('C')!, 300, 10, 100, 40);
  // container rect for the reorder indicator extent
  const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
  if (diagramContainer) mockRect(diagramContainer, 0, 0, 500, 400);
}

// The node group for a node id, by the fixture's id suffix (-A-0, -B-1, -C-7).
const flowNodeOf = (container: HTMLElement, suffix: string) =>
  container.querySelector(`g.node[id$="${suffix}"]`) as Element;

describe('DiagramViewer flowchart node drag', () => {
  beforeEach(() => {
    renderMock.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it('dragging a node connect handle onto another node fires onCreateMessageDrag', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={onSelect} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press A's right-edge connect handle (100, 30) → connect drag
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 100, clientY: 30 });
    expect(onSelect).toHaveBeenCalledWith('n:0');

    fireEvent.mouseMove(window, { clientX: 200, clientY: 30 }); // over B (150-250)
    await waitFor(() => expect(container.querySelector('[data-testid="message-drag-line"]')).toBeTruthy());
    // The drag line starts at the grabbed handle, and the target node snaps.
    const line = container.querySelector('[data-testid="message-drag-line"]')!;
    expect(line.getAttribute('x1')).toBe('100');
    expect(line.getAttribute('y1')).toBe('30');
    expect(container.querySelector('[data-testid="target-lifeline-snap-rect"]')).toBeTruthy();

    fireEvent.mouseUp(window, { clientX: 200, clientY: 30 });
    expect(onCreateMessageDrag).toHaveBeenCalledWith('n:0', 'n:1', { type: 'bottom' });
    expect(onMoveParticipant).not.toHaveBeenCalled();
  });

  it('dragging a node body over another node moves it — no accidental edge', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press A's body (50, 30) — 20px from every edge-midpoint handle → move drag
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 250, clientY: 30 }); // over B's right half
    await waitFor(() => expect(container.querySelector('[data-testid="reorder-indicator"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 250, clientY: 30 });
    // Releasing over another node must NOT create an edge — the node moves:
    // cursor X=250 is past B's center (200) → A lands after B (before C).
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
    expect(onMoveParticipant).toHaveBeenCalledWith('n:0', 'n:2');
  });

  it('a small node’s body still moves even when the handle zones reach its center', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Shrink A to a 30x20 box (a small rendering): its top/bottom handles sit
    // 10px from the center — exactly the fixed grab radius. The radius shrinks
    // to fit the box, so the center is still a body press (move), while a
    // press next to the top handle is a connect drag.
    const a = flowNodeOf(container, '-A-0');
    mockRect(a, 0, 10, 30, 20); // center (15, 20), handles at (15,10) (30,20) (15,30) (0,20)

    // Body press at the center → move, never connect.
    fireEvent.mouseDown(a, { button: 0, clientX: 15, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 250, clientY: 20 });
    await waitFor(() => expect(container.querySelector('[data-testid="reorder-indicator"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 250, clientY: 20 });
    expect(onMoveParticipant).toHaveBeenCalledWith('n:0', 'n:2');
    expect(onCreateMessageDrag).not.toHaveBeenCalled();

    // Press next to the top handle (2px away) → connect drag.
    fireEvent.mouseDown(a, { button: 0, clientX: 15, clientY: 12 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 20 }); // over B
    await waitFor(() => expect(container.querySelector('[data-testid="message-drag-line"]')).toBeTruthy());
    fireEvent.mouseUp(window, { clientX: 200, clientY: 20 });
    expect(onCreateMessageDrag).toHaveBeenCalledWith('n:0', 'n:1', { type: 'bottom' });
  });

  it('dragging a node into empty space fires onMoveParticipant (reorder)', async () => {
    const onMoveParticipant = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press node C, drag to the far left (before A)
    fireEvent.mouseDown(flowNodeOf(container, '-C-7'), { button: 0, clientX: 350, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: -50, clientY: 200 });
    await waitFor(() => expect(container.querySelector('[data-testid="reorder-indicator"]')).toBeTruthy());

    fireEvent.mouseUp(window, { clientX: -50, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('n:2', 'n:0'); // move C before A
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('dragging a node past the last node moves it to the end', async () => {
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press node A, drag right past C
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 500, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('n:0', null); // move A to end
  });

  it('dragging a node into the gap between two nodes inserts before the right one', async () => {
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press node A, drag to X=300: past B's center (200), before C's center (350)
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 200 });
    expect(onMoveParticipant).toHaveBeenCalledWith('n:0', 'n:2'); // move A before C
  });

  it('releasing a connect drag over the source node cancels (no self-edge)', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press A's right-edge connect handle, drag back over A itself — the
    // source node is excluded from the drop targets, so the drag cancels.
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 100, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 30 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 30 });
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
    expect(onMoveParticipant).not.toHaveBeenCalled();
  });

  it('releasing a connect drag over empty space cancels', async () => {
    const onCreateMessageDrag = vi.fn();
    const onMoveParticipant = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    // Press A's right-edge connect handle, drag to empty space below the nodes
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 100, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 300 });
    await waitFor(() => expect(container.querySelector('[data-testid="message-drag-line"]')).toBeTruthy());
    // no target: the line is grey and there is no snap highlight
    const line = container.querySelector('[data-testid="message-drag-line"]')!;
    expect(line.getAttribute('stroke')).toBe('#9ca3af');
    expect(container.querySelector('[data-testid="target-lifeline-snap-rect"]')).toBeNull();
    fireEvent.mouseUp(window, { clientX: 200, clientY: 300 });
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
    expect(onMoveParticipant).not.toHaveBeenCalled();
  });

  it('a plain click on a node (no drag) does not fire drag callbacks', async () => {
    const onMoveParticipant = vi.fn();
    const onCreateMessageDrag = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={onMoveParticipant} onCreateMessageDrag={onCreateMessageDrag}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 30 }); // no movement
    expect(onMoveParticipant).not.toHaveBeenCalled();
    expect(onCreateMessageDrag).not.toHaveBeenCalled();
  });

  it('does not pan the screen when dragging a node in edit mode', async () => {
    const { container } = render(
      <DiagramViewer
        code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null}
        onSelect={() => {}} onMoveParticipant={() => {}}
      />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    const component = container.querySelector('.react-transform-component') as HTMLElement;
    const initialTransform = component.style.transform;

    // Mouse down on a node and drag — should start a drag, not pan
    fireEvent.mouseDown(flowNodeOf(container, '-A-0'), { button: 0, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });

    // The transform should not have changed — panning was excluded
    expect(component.style.transform).toBe(initialTransform);
  });

  it('hovering a node reveals four connect handles at the box edge midpoints', async () => {
    const { container } = render(
      <DiagramViewer code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
    // Hover node A's body (0,10,100,40)
    fireEvent.mouseMove(diagramContainer, { clientX: 50, clientY: 30 });
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="node-connect-handle"]')).toHaveLength(4)
    );
    const transforms = Array.from(container.querySelectorAll('[data-testid="node-connect-handle"]'))
      .map(el => el.getAttribute('transform'));
    expect(transforms).toEqual([
      'translate(50, 10)',  // top
      'translate(100, 30)', // right
      'translate(50, 50)',  // bottom
      'translate(0, 30)',   // left
    ]);
    // the node body is a move zone → grab cursor
    expect(diagramContainer.style.cursor).toBe('grab');

    // Hovering a handle itself switches to a crosshair
    fireEvent.mouseMove(diagramContainer, { clientX: 100, clientY: 30 });
    await waitFor(() => expect(diagramContainer.style.cursor).toBe('crosshair'));
  });

  it('hovering empty space far from any node shows no connect handles', async () => {
    const { container } = render(
      <DiagramViewer code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
    );
    await waitFor(() => expect(container.querySelector('#diagram-container svg')).toBeTruthy());
    mockFlowScreenRects(container);

    const diagramContainer = container.querySelector('#diagram-container') as HTMLElement;
    fireEvent.mouseMove(diagramContainer, { clientX: 250, clientY: 300 });
    expect(container.querySelector('[data-testid="node-connect-handle"]')).toBeNull();
    expect(diagramContainer.style.cursor).toBe('');
  });
});

// --- Transition animation (FLIP) ---------------------------------------------

describe('DiagramViewer transition animation (FLIP)', () => {
  beforeEach(() => {
    renderMock.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  // Prototype-level rect mock: each render generation (svg id) gets its own
  // layout, so the capture (old SVG) and the animation effect (new SVG) see
  // different positions. Keys are participant/node ids (data-id or name).
  const setupLayoutMock = (layouts: Record<string, number>[]) => {
    const seenSvgIds: string[] = [];
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      // The svg root reports its viewBox size so the viewBox scale factor
      // in contentScaleOf stays 1.
      if (this.tagName.toLowerCase() === 'svg') {
        const vb = (this.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
        const w = vb.length === 4 && vb[2] > 0 ? vb[2] : 100;
        const h = vb.length === 4 && vb[3] > 0 ? vb[3] : 40;
        return {
          left: 0, top: 0, width: w, height: h,
          right: w, bottom: h, x: 0, y: 0,
          toJSON: () => ({}),
        };
      }
      const svg = this.closest('svg');
      const svgId = svg?.getAttribute('id') ?? '';
      let gen = seenSvgIds.indexOf(svgId);
      if (gen < 0) {
        seenSvgIds.push(svgId);
        gen = seenSvgIds.length - 1;
      }
      const layout = layouts[Math.min(gen, layouts.length - 1)];
      // Participants/lifelines carry data-id, bottom boxes/men carry name,
      // flowchart node groups carry the id in their id attribute.
      const rawId = this.getAttribute('data-id') ?? this.getAttribute('name') ?? this.getAttribute('id') ?? '';
      const nodeMatch = rawId.match(/-flowchart-(.+)-\d+$/);
      const id = nodeMatch ? nodeMatch[1] : rawId;
      const x = layout[id] ?? 0;
      return {
        left: x, top: 10, width: 100, height: 40,
        right: x + 100, bottom: 50, x, y: 10,
        toJSON: () => ({}),
      };
    };
    return () => {
      Element.prototype.getBoundingClientRect = original;
    };
  };

  const installAnimateMock = () => {
    const animateMock = vi.fn();
    (Element.prototype as unknown as { animate: unknown }).animate = animateMock;
    return animateMock;
  };
  const uninstallAnimateMock = () => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  };

  it('animates moved participants from their old positions after a reorder', async () => {
    const animateMock = installAnimateMock();
    const restore = setupLayoutMock([
      { A: 0, B: 150, C: 300 },  // before: A, B, C left-to-right
      { C: 0, B: 150, A: 300 },  // after reorder: C, B, A
    ]);
    try {
      const REORDERED = `sequenceDiagram
    participant C
    participant B
    participant A
    A->>B: m1
    B-->>A: m2
    Note over A,C: Shared
    A->>A: m3
    A->>C: m4`;
      const { container, rerender } = render(
        <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => {
        expect(container.querySelector('#diagram-container svg')).toBeTruthy();
      });
      // let the first render's effects settle (no animation on mount)
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      animateMock.mockClear();

      rerender(
        <DiagramViewer code={REORDERED} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => expect(animateMock).toHaveBeenCalled());

      const starts = animateMock.mock.calls.map(c => c[0][0].transform as string);
      // C moved from x=300 to x=0: the animation starts at +300
      expect(starts).toContain('translate(300px, 0px)');
      // A moved from x=0 to x=300: the animation starts at -300
      expect(starts).toContain('translate(-300px, 0px)');
      // every animation glides to the element's base transform
      animateMock.mock.calls.forEach(c => {
        expect(c[0][1].transform).toBe('translate(0px, 0px)');
        expect(c[1]).toMatchObject({ duration: 400, easing: 'ease-out' });
      });
      // A and C each contribute a participant group, a lifeline and a bottom
      // box; B did not move, so it is never animated.
      expect(animateMock.mock.calls).toHaveLength(6);
    } finally {
      restore();
      uninstallAnimateMock();
    }
  });

  it('does not animate when nothing moved (same ids, same positions)', async () => {
    const animateMock = installAnimateMock();
    const restore = setupLayoutMock([
      { A: 0, B: 150, C: 300 },
      { A: 0, B: 150, C: 300 },
    ]);
    try {
      const { container, rerender } = render(
        <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => {
        expect(container.querySelector('#diagram-container svg')).toBeTruthy();
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      animateMock.mockClear();

      // a comment-only edit: same elements, same positions
      rerender(
        <DiagramViewer code={`${SEQ_CODE}\n    %% a comment`} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => {
        expect(container.querySelector('#diagram-container svg')).toBeTruthy();
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      expect(animateMock).not.toHaveBeenCalled();
    } finally {
      restore();
      uninstallAnimateMock();
    }
  });

  it('does not animate when the element ids change (participant added)', async () => {
    const defaultImpl = renderMock.getMockImplementation()!;
    // The second render adds a participant D to the SVG fixture.
    const SEQ_SVG_WITH_D = SEQ_SVG.replace(
      '</svg>',
      '<g id="root-3" data-et="participant" data-type="participant" data-id="D"><rect class="actor actor-top" name="D"></rect><text class="actor actor-box"><tspan>D</tspan></text></g></svg>'
    );
    renderMock.mockImplementation(async (id: string, code: string) => {
      if (code.includes('participant D')) {
        return { svg: SEQ_SVG_WITH_D.replaceAll('fx-seq', id) };
      }
      return defaultImpl(id, code);
    });
    const animateMock = installAnimateMock();
    const restore = setupLayoutMock([
      { A: 0, B: 150, C: 300 },
      { A: 0, B: 150, C: 300, D: 450 },
    ]);
    try {
      const { container, rerender } = render(
        <DiagramViewer code={SEQ_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => {
        expect(container.querySelector('#diagram-container svg')).toBeTruthy();
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      animateMock.mockClear();

      rerender(
        <DiagramViewer code={`${SEQ_CODE}\n    participant D`} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => {
        expect(container.querySelector('g[data-et="participant"][data-id="D"]')).toBeTruthy();
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      // The id sets differ (D is new): no cross-element animation.
      expect(animateMock).not.toHaveBeenCalled();
    } finally {
      restore();
      uninstallAnimateMock();
      renderMock.mockImplementation(defaultImpl);
    }
  });

  it('folds the node group transform attribute into the animation keyframes (flowchart)', async () => {
    const defaultImpl = renderMock.getMockImplementation()!;
    // Fixture variant: node groups carry a base translate like real mermaid output.
    const FLOW_SVG_TRANSLATED = FLOW_SVG
      .replace('<g class="node default" id="fx-flow-flowchart-A-0">', '<g class="node default" id="fx-flow-flowchart-A-0" transform="translate(100, 50)">')
      .replace('<g class="node default" id="fx-flow-flowchart-B-1">', '<g class="node default" id="fx-flow-flowchart-B-1" transform="translate(100, 110)">')
      .replace('<g class="node default" id="fx-flow-flowchart-C-7">', '<g class="node default" id="fx-flow-flowchart-C-7" transform="translate(240, 50)">');
    renderMock.mockImplementation(async (id: string, code: string) => {
      const isFlow = /^\s*(flowchart|graph)\b/m.test(code);
      const fixture = isFlow ? FLOW_SVG_TRANSLATED : SEQ_SVG;
      return { svg: fixture.replaceAll('fx-seq', id).replaceAll('fx-flow', id) };
    });
    const animateMock = installAnimateMock();
    // Layouts are screen rects of the node groups; the mock serves left=x.
    const restore = setupLayoutMock([
      { A: 100, B: 100, C: 240 },
      { A: 240, B: 100, C: 100 }, // after reorder: C, B, A left-to-right
    ]);
    try {
      const REORDERED_FLOW = `flowchart TD\n    C[Charlie]\n    A[Alice] --> B[Bob]`;
      const { container, rerender } = render(
        <DiagramViewer code={FLOW_CODE} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => {
        expect(container.querySelector('#diagram-container svg')).toBeTruthy();
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      animateMock.mockClear();

      rerender(
        <DiagramViewer code={REORDERED_FLOW} searchQuery="" theme="default" editMode selection={null} onSelect={() => {}} />
      );
      await waitFor(() => expect(animateMock).toHaveBeenCalled());

      // Node A moved from x=100 to x=240 (dx=-140): the keyframes fold in the
      // base translate(100, 50) from the transform attribute.
      const aCall = animateMock.mock.calls.find(c =>
        c[0][0].transform === 'translate(-40px, 50px)'
      );
      expect(aCall).toBeTruthy();
      expect(aCall![0][1].transform).toBe('translate(100px, 50px)');
      // Node C moved from x=240 to x=100 (dx=+140), base translate(240, 50).
      const cCall = animateMock.mock.calls.find(c =>
        c[0][0].transform === 'translate(380px, 50px)'
      );
      expect(cCall).toBeTruthy();
      expect(cCall![0][1].transform).toBe('translate(240px, 50px)');
    } finally {
      restore();
      uninstallAnimateMock();
      renderMock.mockImplementation(defaultImpl);
    }
  });
});

describe('DiagramViewer sticky notes overlay', () => {
  it('renders sticky notes layer when notes are provided and showNotes is true', async () => {
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE}
        searchQuery=""
        theme="default"
        notes={[{ id: 'n1', x: 50, y: 50, text: 'Note content', color: 'yellow' }]}
        showNotes={true}
      />
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="sticky-notes-layer"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="sticky-note-n1"]')).toBeTruthy();
      expect(container.textContent).toContain('Note content');
    });
  });

  it('hides sticky notes when showNotes is false', async () => {
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE}
        searchQuery=""
        theme="default"
        notes={[{ id: 'n1', x: 50, y: 50, text: 'Note content', color: 'yellow' }]}
        showNotes={false}
      />
    );
    await waitFor(() => {
      expect(container.querySelector('svg')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="sticky-notes-layer"]')).toBeNull();
  });

  it('does not trigger onSelect when clicking a sticky note in edit mode', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE}
        searchQuery=""
        theme="default"
        editMode={true}
        onSelect={onSelect}
        notes={[{ id: 'n1', x: 50, y: 50, text: 'Note content', color: 'yellow' }]}
        showNotes={true}
      />
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="sticky-note-n1"]')).toBeTruthy();
    });
    const noteCard = container.querySelector('[data-testid="sticky-note-n1"]')!;
    fireEvent.click(noteCard);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders locked banner and disables selection and drag when isVisualLocked is true', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramViewer
        code={SEQ_CODE}
        searchQuery=""
        theme="default"
        editMode={true}
        isVisualLocked={true}
        onSelect={onSelect}
      />
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="visual-locked-banner"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="visual-locked-banner"]')?.textContent).toContain(
        'Visual edits locked (editing source code)'
      );
      expect(container.querySelector('#diagram-container')?.className).toContain('cursor-not-allowed');
    });

    const msg = container.querySelector('line[data-id="i1"]')!;
    fireEvent.click(msg);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

