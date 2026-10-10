import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import mermaid from 'mermaid';
import DiagramViewer from './DiagramViewer';
import { SEQ_SVG, SEQ_CODE, FLOW_SVG, FLOW_CODE } from '@/lib/svgTestFixtures';
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
