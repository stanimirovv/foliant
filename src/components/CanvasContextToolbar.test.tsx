import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import CanvasContextToolbar from './CanvasContextToolbar';
import {
  ParticipantElement,
  NodeElement,
  MessageElement,
  NoteElement,
  BlockElement,
  StickyNoteElement,
} from '@/lib/model';

const baseHandlers = () => ({
  onSetColor: vi.fn(),
  onSetType: vi.fn(),
  onSetDash: vi.fn(),
  onSetAnimation: vi.fn(),
  onSetParticipantKind: vi.fn(),
  onSetNodeShape: vi.fn(),
  onAddSequenceNote: vi.fn(),
  onSetNotePlacement: vi.fn(),
  onSetBlockType: vi.fn(),
  onUnwrapBlock: vi.fn(),
  onUpdateStickyNote: vi.fn(),
  onGroupParticipants: vi.fn(),
  onGroupNodes: vi.fn(),
  onWrapInBlock: vi.fn(),
  onWrapInRegion: vi.fn(),
  onRequestDelete: vi.fn(),
});

describe('CanvasContextToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when selectedElements is empty', () => {
    const handlers = baseHandlers();
    const { container } = render(
      <CanvasContextToolbar
        selectedElements={[]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={null}
        {...handlers}
      />,
    );
    expect(container.querySelector('[data-testid="canvas-context-toolbar"]')).toBeNull();
  });

  it('renders single participant controls: kind selector, color swatches, add note, and delete', () => {
    const handlers = baseHandlers();
    const participant: ParticipantElement = {
      key: 'p:0',
      kind: 'participant',
      id: 'Auth',
      alias: 'Auth Service',
      participantType: 'participant',
      lineStart: 1,
      lineEnd: 1,
    };

    const { getByTestId } = render(
      <CanvasContextToolbar
        selectedElements={[participant]}
        diagramType="sequence"
        theme="dark"
        config={{ version: 1, actors: { Auth: { color: '#213b5e' } } }}
        arrowStyle={null}
        {...handlers}
      />,
    );

    expect(getByTestId('canvas-context-toolbar')).toBeTruthy();
    expect(getByTestId('ctx-element-badge').textContent).toBe('Auth');

    fireEvent.change(getByTestId('ctx-participant-kind'), { target: { value: 'actor' } });
    expect(handlers.onSetParticipantKind).toHaveBeenCalledWith('actor');

    fireEvent.click(getByTestId('ctx-color-swatch-#213b5e'));
    expect(handlers.onSetColor).toHaveBeenCalledWith('#213b5e');

    fireEvent.click(getByTestId('ctx-clear-color'));
    expect(handlers.onSetColor).toHaveBeenCalledWith('');

    fireEvent.click(getByTestId('ctx-add-note'));
    expect(handlers.onAddSequenceNote).toHaveBeenCalledTimes(1);

    fireEvent.click(getByTestId('ctx-delete'));
    expect(handlers.onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it('renders single flowchart node shape selector and swatches', () => {
    const handlers = baseHandlers();
    const node: NodeElement = {
      key: 'n:0',
      kind: 'node',
      id: 'DB',
      label: 'Primary DB',
      shape: 'rect',
      lineStart: 2,
      lineEnd: 2,
    };

    const { getByTestId } = render(
      <CanvasContextToolbar
        selectedElements={[node]}
        diagramType="flowchart"
        theme="default"
        config={null}
        arrowStyle={null}
        {...handlers}
      />,
    );

    fireEvent.change(getByTestId('ctx-node-shape'), { target: { value: 'cylinder' } });
    expect(handlers.onSetNodeShape).toHaveBeenCalledWith('cylinder');
  });

  it('renders single arrow controls: operator, dash, color, and animation preset', () => {
    const handlers = baseHandlers();
    const msg: MessageElement = {
      key: 'm:0',
      kind: 'message',
      from: 'A',
      to: 'B',
      operator: '->>',
      label: 'Login',
      lineStart: 3,
      lineEnd: 3,
    };

    const { getByTestId } = render(
      <CanvasContextToolbar
        selectedElements={[msg]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={{ color: '#00ff9d', dash: 'solid', animation: 'none' }}
        {...handlers}
      />,
    );

    fireEvent.change(getByTestId('ctx-arrow-operator'), { target: { value: '-->>' } });
    expect(handlers.onSetType).toHaveBeenCalledWith('-->>');

    fireEvent.change(getByTestId('ctx-arrow-dash'), { target: { value: 'dashed' } });
    expect(handlers.onSetDash).toHaveBeenCalledWith('dashed');

    fireEvent.change(getByTestId('ctx-arrow-animation'), { target: { value: 'pulse' } });
    expect(handlers.onSetAnimation).toHaveBeenCalledWith('pulse');

    fireEvent.click(getByTestId('ctx-clear-color'));
    expect(handlers.onSetColor).toHaveBeenCalledWith('');
  });

  it('renders multi-select controls for grouping participants into a box and wrapping messages', () => {
    const handlers = baseHandlers();
    const p0: ParticipantElement = {
      key: 'p:0',
      kind: 'participant',
      id: 'A',
      lineStart: 1,
      lineEnd: 1,
    };
    const p1: ParticipantElement = {
      key: 'p:1',
      kind: 'participant',
      id: 'B',
      lineStart: 2,
      lineEnd: 2,
    };

    const { getByTestId } = render(
      <CanvasContextToolbar
        selectedElements={[p0, p1]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={null}
        {...handlers}
      />,
    );

    expect(getByTestId('ctx-multi-count').textContent).toBe('2 selected');
    fireEvent.click(getByTestId('ctx-group-box'));
    const input = getByTestId('ctx-group-box-input');
    fireEvent.change(input, { target: { value: 'Core Services' } });
    fireEvent.click(getByTestId('ctx-group-box-confirm'));
    expect(handlers.onGroupParticipants).toHaveBeenCalledWith(['p:0', 'p:1'], 'Core Services');
  });

  it('renders multi-select wrap controls for contiguous sequence messages', () => {
    const handlers = baseHandlers();
    const m0: MessageElement = {
      key: 'm:0',
      kind: 'message',
      from: 'A',
      to: 'B',
      operator: '->>',
      label: 'step 1',
      lineStart: 3,
      lineEnd: 3,
    };
    const m1: MessageElement = {
      key: 'm:1',
      kind: 'message',
      from: 'B',
      to: 'A',
      operator: '-->>',
      label: 'step 2',
      lineStart: 4,
      lineEnd: 4,
    };

    const { getByTestId } = render(
      <CanvasContextToolbar
        selectedElements={[m0, m1]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={null}
        wrapChecks={{ block: { ok: true }, region: { ok: true } }}
        {...handlers}
      />,
    );

    fireEvent.click(getByTestId('ctx-wrap-block-loop'));
    expect(handlers.onWrapInBlock).toHaveBeenCalledWith('loop', '');

    fireEvent.click(getByTestId('ctx-wrap-region'));
    expect(handlers.onWrapInRegion).toHaveBeenCalledWith('flow', 'main');
  });

  it('renders single block unwrap and type controls, note placement, and sticky note colors', () => {
    const handlers = baseHandlers();
    const block: BlockElement = {
      key: 'b:0',
      kind: 'block',
      blockType: 'alt',
      title: 'valid',
      lineStart: 3,
      lineEnd: 6,
    };

    const { getByTestId, rerender } = render(
      <CanvasContextToolbar
        selectedElements={[block]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={null}
        {...handlers}
      />,
    );

    fireEvent.change(getByTestId('ctx-block-type'), { target: { value: 'opt' } });
    expect(handlers.onSetBlockType).toHaveBeenCalledWith('opt');

    fireEvent.click(getByTestId('ctx-unwrap-block'));
    expect(handlers.onUnwrapBlock).toHaveBeenCalledTimes(1);

    const note: NoteElement = {
      key: 'note:0',
      kind: 'note',
      placement: 'over',
      over: ['A'],
      text: 'Hello',
      lineStart: 4,
      lineEnd: 4,
    };
    rerender(
      <CanvasContextToolbar
        selectedElements={[note]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={null}
        {...handlers}
      />,
    );
    fireEvent.change(getByTestId('ctx-note-placement'), { target: { value: 'right of' } });
    expect(handlers.onSetNotePlacement).toHaveBeenCalledWith('right of');

    const sticky: StickyNoteElement = {
      key: 'sticky:s1',
      kind: 'sticky',
      id: 's1',
      text: 'Todo',
      color: 'yellow',
      lineStart: 0,
      lineEnd: 0,
    };
    rerender(
      <CanvasContextToolbar
        selectedElements={[sticky]}
        diagramType="sequence"
        theme="dark"
        config={null}
        arrowStyle={null}
        {...handlers}
      />,
    );
    fireEvent.click(getByTestId('ctx-sticky-color-green'));
    expect(handlers.onUpdateStickyNote).toHaveBeenCalledWith('s1', { color: 'green' });
  });
});
