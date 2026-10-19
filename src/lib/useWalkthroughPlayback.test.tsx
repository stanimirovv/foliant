import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { useWalkthroughPlayback } from './useWalkthroughPlayback';
import { FLOW_CODE, FLOW_SVG, SEQ_CODE, SEQ_SVG } from './svgTestFixtures';
import { DiagramConfig } from './views';

interface HostProps {
  code: string;
  svg: string;
  enabled: boolean;
  config?: DiagramConfig | null;
  withTransformRef?: boolean;
  zoomToElementMock?: ReturnType<typeof vi.fn>;
  zoomScale?: number;
  onExit?: () => void;
}

function TestHost({
  code,
  svg,
  enabled,
  config = null,
  withTransformRef = false,
  zoomToElementMock,
  zoomScale = 1,
  onExit,
}: HostProps) {
  const mockRef = useRef<ReactZoomPanPinchContentRef | null>(
    withTransformRef
      ? ({
          zoomToElement: zoomToElementMock ?? vi.fn(),
          state: { scale: zoomScale },
        } as unknown as ReactZoomPanPinchContentRef)
      : null,
  );
  if (withTransformRef && mockRef.current && zoomToElementMock) {
    mockRef.current.zoomToElement = zoomToElementMock as unknown as ReactZoomPanPinchContentRef['zoomToElement'];
  }

  const playback = useWalkthroughPlayback({
    code,
    config,
    containerId: 'test-walkthrough-container',
    transformRef: withTransformRef ? mockRef : undefined,
    getZoomScale: () => zoomScale,
    enabled,
    svgVersion: svg,
    onExit,
  });

  return (
    <div>
      <input data-testid="search-input" />
      <div data-testid="active-index">{playback.activeIndex}</div>
      <div data-testid="total-steps">{playback.plan?.steps.length ?? 0}</div>
      <div data-testid="is-playing">{String(playback.isPlaying)}</div>
      <div data-testid="visible-stickies">
        {playback.visibleStickyNoteIds ? playback.visibleStickyNoteIds.join(',') : 'null'}
      </div>
      <button data-testid="btn-next" onClick={playback.next}>Next</button>
      <button data-testid="btn-prev" onClick={playback.prev}>Prev</button>
      <button data-testid="btn-play" onClick={playback.togglePlay}>Play</button>
      <button data-testid="btn-exit" onClick={playback.exit}>Exit</button>
      <div
        id="test-walkthrough-container"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

describe('useWalkthroughPlayback', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('applies walkthrough-dimmed and walkthrough-active classes when enabled, moves them on step, and removes them when disabled', () => {
    const { container, rerender } = render(
      <TestHost code={SEQ_CODE} svg={SEQ_SVG} enabled={true} />,
    );

    const host = container.querySelector('#test-walkthrough-container')!;
    expect(screen.getByTestId('active-index').textContent).toBe('0');
    expect(screen.getByTestId('total-steps').textContent).toBe('4');

    // Step 0: i1 is active; i2, i3 (note), i4, i5 are dimmed; participants never dimmed
    expect(host.querySelector('[data-id="i1"]')?.classList.contains('walkthrough-active')).toBe(true);
    expect(host.querySelector('[data-id="i2"]')?.classList.contains('walkthrough-dimmed')).toBe(true);
    expect(host.querySelector('[data-id="i3"]')?.classList.contains('walkthrough-dimmed')).toBe(true);
    expect(host.querySelector('[data-id="i4"]')?.classList.contains('walkthrough-dimmed')).toBe(true);
    expect(host.querySelector('[data-id="i5"]')?.classList.contains('walkthrough-dimmed')).toBe(true);
    expect(host.querySelector('g[data-et="participant"]')?.classList.contains('walkthrough-dimmed')).toBe(false);

    // Advance to step 1: i2 becomes active, i3 (note after m2) becomes revealed (no longer dimmed)
    fireEvent.click(screen.getByTestId('btn-next'));
    expect(screen.getByTestId('active-index').textContent).toBe('1');
    expect(host.querySelector('[data-id="i1"]')?.classList.contains('walkthrough-active')).toBe(false);
    expect(host.querySelector('[data-id="i1"]')?.classList.contains('walkthrough-dimmed')).toBe(false);
    expect(host.querySelector('[data-id="i2"]')?.classList.contains('walkthrough-active')).toBe(true);
    expect(host.querySelector('[data-id="i3"]')?.classList.contains('walkthrough-dimmed')).toBe(false);
    expect(host.querySelector('[data-id="i4"]')?.classList.contains('walkthrough-dimmed')).toBe(true);

    // Disable presentation: all classes removed and index resets when re-enabled
    rerender(<TestHost code={SEQ_CODE} svg={SEQ_SVG} enabled={false} />);
    expect(host.querySelectorAll('.walkthrough-dimmed')).toHaveLength(0);
    expect(host.querySelectorAll('.walkthrough-active')).toHaveLength(0);
  });

  it('handles keyboard shortcuts (ArrowRight, ArrowLeft, Space, Escape) and ignores input elements and defaultPrevented events', () => {
    const onExit = vi.fn();
    render(<TestHost code={SEQ_CODE} svg={SEQ_SVG} enabled={true} onExit={onExit} />);

    // ArrowRight -> step 1
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('active-index').textContent).toBe('1');

    // ArrowLeft -> step 0
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('active-index').textContent).toBe('0');

    // Space -> togglePlay
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByTestId('is-playing').textContent).toBe('true');

    // Events originating from an <input> are ignored
    const input = screen.getByTestId('search-input');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(screen.getByTestId('active-index').textContent).toBe('0');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onExit).not.toHaveBeenCalled();

    // defaultPrevented events are ignored
    const preventedEvt = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    preventedEvt.preventDefault();
    window.dispatchEvent(preventedEvt);
    expect(screen.getByTestId('active-index').textContent).toBe('0');

    // Escape on window calls exit and stops immediate propagation
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(window, { key: 'Escape' });
    window.removeEventListener('keydown', spy);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('advances every 1600ms during autoplay, stops at the last step, and pauses on manual step', () => {
    vi.useFakeTimers();
    render(<TestHost code={SEQ_CODE} svg={SEQ_SVG} enabled={true} />);

    fireEvent.click(screen.getByTestId('btn-play'));
    expect(screen.getByTestId('is-playing').textContent).toBe('true');

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByTestId('active-index').textContent).toBe('1');

    // Manual next pauses playback
    fireEvent.click(screen.getByTestId('btn-next'));
    expect(screen.getByTestId('active-index').textContent).toBe('2');
    expect(screen.getByTestId('is-playing').textContent).toBe('false');

    // Resume play and advance to last step (index 3)
    fireEvent.click(screen.getByTestId('btn-play'));
    expect(screen.getByTestId('is-playing').textContent).toBe('true');

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByTestId('active-index').textContent).toBe('3');
    expect(screen.getByTestId('is-playing').textContent).toBe('false');
  });

  it('auto-pans via zoomToElement with scale >= 1 when transformRef is provided, or scrollIntoView when absent', () => {
    const zoomToElementMock = vi.fn();
    const { rerender } = render(
      <TestHost
        code={SEQ_CODE}
        svg={SEQ_SVG}
        enabled={true}
        withTransformRef={true}
        zoomToElementMock={zoomToElementMock}
        zoomScale={0.5}
      />,
    );

    expect(zoomToElementMock).toHaveBeenCalled();
    const [targetSeq, optsSeq] = zoomToElementMock.mock.calls[0];
    expect((targetSeq as Element).textContent).toBe('m1');
    expect(optsSeq.scale).toBe(1); // clamped from 0.5 up to >= 1

    // Flowchart pan target is the level's first g.node
    zoomToElementMock.mockClear();
    rerender(
      <TestHost
        code={FLOW_CODE}
        svg={FLOW_SVG}
        enabled={true}
        withTransformRef={true}
        zoomToElementMock={zoomToElementMock}
        zoomScale={1.5}
      />,
    );
    expect(zoomToElementMock).toHaveBeenCalled();
    const [targetFlow, optsFlow] = zoomToElementMock.mock.calls[0];
    expect((targetFlow as Element).getAttribute('id')).toBe('fx-flow-flowchart-A-0');
    expect(optsFlow.scale).toBe(1.5);

    // Without transformRef, falls back to scrollIntoView
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    rerender(
      <TestHost
        code={FLOW_CODE}
        svg={FLOW_SVG}
        enabled={true}
        withTransformRef={false}
      />,
    );
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('clamps activeIndex when code changes mid-presentation to fewer steps, and computes visibleStickyNoteIds', () => {
    const config: DiagramConfig = {
      version: 1,
      arrows: [{ from: 'B', to: 'A', label: 'm2', keys: ['t2'] }],
      notes: [
        { id: 'free', x: 0, y: 0, text: 'Untagged' },
        { id: 'tagged', x: 0, y: 0, text: 'Tagged to m2', keys: ['t2'] },
      ],
    };
    const { rerender } = render(
      <TestHost code={SEQ_CODE} svg={SEQ_SVG} enabled={true} config={config} />,
    );

    // At step 0, only 'free' is visible
    expect(screen.getByTestId('visible-stickies').textContent).toBe('free');

    // Step to index 3 (last step of 4)
    fireEvent.click(screen.getByTestId('btn-next'));
    expect(screen.getByTestId('visible-stickies').textContent).toBe('tagged,free');
    fireEvent.click(screen.getByTestId('btn-next'));
    fireEvent.click(screen.getByTestId('btn-next'));
    expect(screen.getByTestId('active-index').textContent).toBe('3');

    // Shrink diagram to 2 messages
    const shorterCode = `sequenceDiagram
      participant A
      participant B
      A->>B: m1
      B-->>A: m2`;
    rerender(
      <TestHost code={shorterCode} svg={SEQ_SVG} enabled={true} config={config} />,
    );
    expect(screen.getByTestId('total-steps').textContent).toBe('2');
    expect(screen.getByTestId('active-index').textContent).toBe('1');
  });
});
