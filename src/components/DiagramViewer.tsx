'use client';

import { useEffect, useState, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { parseModel, ParticipantElement } from '@/lib/model';
import { applyArrowStyles, applyNodeColors } from '@/lib/styling';
import {
  elementKeyAtTarget, svgElementForKey,
  getParticipantScreenInfo, getMessageScreenInfo, nearestParticipantAtX,
  ParticipantScreenInfo, MessageScreenInfo,
} from '@/lib/svgmap';
import { DiagramConfig } from '@/lib/views';
import { MessageInsertPosition } from '@/lib/editor';

interface DiagramViewerProps {
  code: string;
  searchQuery: string;
  theme: 'default' | 'dark';
  editMode?: boolean;
  arrowStyles?: DiagramConfig | null;  // resolved config (rewriteArrowStyles); its arrows are applied
  nodeColors?: DiagramConfig | null;   // raw config; actors colors applied to flowchart nodes
  selection?: string | null;           // selected processed element key
  onSelect?: (key: string | null) => void;
  // Drag callbacks (processed keys; ClientPage maps them to raw keys).
  onMoveParticipant?: (participantKey: string, beforeKey: string | null) => void;
  onCreateMessageDrag?: (fromKey: string, toKey: string, position: MessageInsertPosition) => void;
}

// Minimum mouse movement (px) before a press becomes a drag.
const DRAG_THRESHOLD = 5;

// How close (px) the cursor must be to a participant's center X to grab its
// lifeline from empty space (the rendered lifeline stroke is only 1–2 px).
const LIFELINE_HIT_THRESHOLD = 20;

// SVG selectors for every element that resolves to a participant (the same
// set elementKeyAtTarget checks). Excluded from TransformWrapper panning in
// edit mode so dragging a participant reorders / creates a message instead
// of panning the screen.
const PARTICIPANT_PAN_EXCLUSIONS = [
  'g[data-et="participant"]',
  'line.actor-line',
  'rect.actor',
  'g.actor-man',
];

interface DragState {
  type: 'reorder' | 'message';
  participantKey: string;   // processed key of the dragged participant
  participantId: string;
  startX: number;
  startY: number;
  isDragging: boolean;
  currentX: number;
  currentY: number;
  // Reorder: the participant before which to insert (null = move to end).
  targetBeforeKey: string | null;
  // Message: the participant under the cursor (null = no target).
  toParticipantKey: string | null;
  toParticipantId: string | null;
  insertPosition: MessageInsertPosition | null;
}

// Visual overlay data (screen coordinates, rendered in a fixed SVG).
interface DragOverlay {
  type: 'reorder' | 'message';
  // Reorder: vertical dashed insertion line.
  reorderX: number | null;
  reorderY1: number;
  reorderY2: number;
  // Message: drag line from source to cursor + horizontal insertion indicator.
  lineX1: number;
  lineY1: number;
  lineX2: number;
  lineY2: number;
  insertY: number | null;
  insertX1: number;
  insertX2: number;
  hasTarget: boolean;
}

export default function DiagramViewer({
  code,
  searchQuery,
  theme,
  editMode = false,
  arrowStyles = null,
  nodeColors = null,
  selection = null,
  onSelect,
  onMoveParticipant,
  onCreateMessageDrag,
}: DiagramViewerProps) {
  const [svgStr, setSvgStr] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [dragOverlay, setDragOverlay] = useState<DragOverlay | null>(null);

  // In edit mode on sequence diagrams, dragging a participant must not pan
  // the screen — exclude participant elements from TransformWrapper panning.
  const isSequenceDiagram = useMemo(() => parseModel(code).type === 'sequence', [code]);
  const panExcluded = editMode && isSequenceDiagram && onSelect;

  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  // Cached screen info, computed once on mouse-down (the diagram does not
  // re-render during a drag, so participant/message positions are stable).
  const screenCacheRef = useRef<{
    participants: ParticipantScreenInfo[];
    messages: MessageScreenInfo[];
  } | null>(null);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme });
  }, [theme]);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        setError(null);
        // Add a random ID to prevent caching issues if code changes but ID doesn't
        const id = `mermaid-svg-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        // Post-process: arrow styles + flowchart node colors (both no-op when absent)
        const model = parseModel(code);
        let styled = applyArrowStyles(svg, model, arrowStyles);
        styled = applyNodeColors(styled, nodeColors);
        if (isMounted) {
          setSvgStr(styled);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const e = err as Error;
          setError(e.message || 'Error rendering diagram');
        }
      }
    };
    if (code) {
      renderDiagram();
    }
    return () => {
      isMounted = false;
    };
  }, [code, theme, arrowStyles, nodeColors]);

  useEffect(() => {
    if (svgStr && searchQuery) {
      const container = document.getElementById('diagram-container');
      if (container) {
        const textNodes = container.querySelectorAll('text');
        textNodes.forEach((node) => {
          const content = node.textContent?.toLowerCase() || '';
          if (searchQuery && content.includes(searchQuery.toLowerCase())) {
            node.style.fill = 'red';
            node.style.fontWeight = 'bold';
          } else {
            node.style.fill = '';
            node.style.fontWeight = 'normal';
          }
        });
      }
    }
  }, [svgStr, searchQuery]);

  // Selection highlight: re-applied after every render via the zip (plan 4.7).
  // Coexists with the search highlight (different elements/properties).
  useEffect(() => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    container.querySelectorAll('.editor-selected').forEach(el => el.classList.remove('editor-selected'));
    if (!editMode || !selection) return;
    const svgRoot = container.querySelector('svg');
    if (!svgRoot) return;
    const el = svgElementForKey(svgRoot, parseModel(code), selection);
    if (el) el.classList.add('editor-selected');
  }, [svgStr, selection, editMode, code]);

  // --- Drag interactions (sequence diagrams, edit mode) -------------------
  // Spatial separation — the drag type is determined by WHERE the mouse is,
  // not by selection state:
  //   - Actor box (top g[data-et="participant"], bottom rect.actor / g.actor-man)
  //     → reorder: drag horizontally to change participant order. The space
  //     between any two actors, before the first, and after the last are all
  //     valid drop positions (a vertical dashed indicator shows the target).
  //   - Lifeline (line.actor-line, or empty space within LIFELINE_HIT_THRESHOLD
  //     px of a participant's center X, below the top actor box) → create
  //     message: drag to another participant and release to connect. A drag
  //     line follows the cursor and a green horizontal indicator shows the
  //     vertical insertion point (top / between messages / bottom).

  const getSvgAndModel = () => {
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!svgRoot) return null;
    return { svgRoot, model: parseModel(code) };
  };

  // Capture phase: stopPropagation prevents TransformWrapper from starting a
  // pan when the press is on a participant element (or near a lifeline).
  const handleMouseDownCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editMode || e.button !== 0) return;
    const ctx = getSvgAndModel();
    if (!ctx || ctx.model.type !== 'sequence') return;
    if (!onSelect) return;

    const target = e.target as Element;
    const key = elementKeyAtTarget(target, ctx.svgRoot, ctx.model);

    let dragType: 'reorder' | 'message' | null = null;
    let participantKey: string | null = null;
    let cachedParticipants: ParticipantScreenInfo[] | null = null;

    if (key) {
      const el = ctx.model.elements.find(e2 => e2.key === key);
      if (el?.kind === 'participant') {
        // Actor box → reorder; lifeline → message.
        const isLifeline = target.closest('line.actor-line') !== null;
        dragType = isLifeline ? 'message' : 'reorder';
        participantKey = key;
      }
      // Messages / notes: no drag — the click handler manages selection.
    } else {
      // Empty space: check proximity to a lifeline for a message drag.
      cachedParticipants = getParticipantScreenInfo(ctx.svgRoot, ctx.model);
      const nearest = nearestParticipantAtX(cachedParticipants, e.clientX);
      if (
        nearest &&
        Math.abs(nearest.centerX - e.clientX) < LIFELINE_HIT_THRESHOLD &&
        e.clientY > nearest.bottom // below the top actor box
      ) {
        const pEl = ctx.model.elements.find(
          e2 => e2.kind === 'participant' && (e2 as ParticipantElement).id === nearest.id
        );
        if (pEl) {
          dragType = 'message';
          participantKey = pEl.key;
        }
      }
    }

    if (!dragType || !participantKey) return; // not a drag — let the event propagate

    // Prevent TransformWrapper panning and text selection.
    e.stopPropagation();
    e.preventDefault();

    const participant = ctx.model.elements.find(e2 => e2.key === participantKey) as ParticipantElement;

    screenCacheRef.current = {
      participants: cachedParticipants ?? getParticipantScreenInfo(ctx.svgRoot, ctx.model),
      messages: getMessageScreenInfo(ctx.svgRoot, ctx.model),
    };

    dragRef.current = {
      type: dragType,
      participantKey,
      participantId: participant.id,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      currentX: e.clientX,
      currentY: e.clientY,
      targetBeforeKey: null,
      toParticipantKey: null,
      toParticipantId: null,
      insertPosition: null,
    };
    suppressClickRef.current = false;

    // Select the participant on press.
    onSelect(participantKey);
  };

  // Compute the overlay for the current drag state.
  const computeOverlay = (drag: DragState): DragOverlay | null => {
    const cache = screenCacheRef.current;
    if (!cache) return null;
    const source = cache.participants.find(p => p.key === drag.participantKey);
    if (!source) return null;

    if (drag.type === 'reorder') {
      // Participants sorted by screen X (left-to-right = source order).
      const sorted = [...cache.participants].sort((a, b) => a.centerX - b.centerX);
      const remaining = sorted.filter(p => p.key !== drag.participantKey);
      // Find the gap where the cursor X falls.
      let beforeKey: string | null = null;
      let indicatorX: number | null = null;
      if (remaining.length === 0) {
        indicatorX = null;
      } else if (drag.currentX < remaining[0].centerX) {
        beforeKey = remaining[0].key;
        indicatorX = remaining[0].left;
      } else if (drag.currentX > remaining[remaining.length - 1].centerX) {
        beforeKey = null; // move to end
        indicatorX = remaining[remaining.length - 1].right + 15;
      } else {
        // Cursor is within the span of the remaining participants: insert
        // before the first remaining participant whose center is past the cursor.
        const nextP = remaining.find(p => drag.currentX < p.centerX);
        if (nextP) {
          beforeKey = nextP.key;
          const idx = remaining.indexOf(nextP);
          indicatorX =
            idx > 0
              ? (remaining[idx - 1].centerX + nextP.centerX) / 2
              : nextP.left;
        } else {
          // Cursor at/past the last participant's center: move to end.
          beforeKey = null;
          indicatorX = remaining[remaining.length - 1].right + 15;
        }
      }
      drag.targetBeforeKey = beforeKey;
      // Vertical extent: from top of participant boxes to bottom of the SVG.
      const y1 = Math.min(...cache.participants.map(p => p.top));
      const svgRect = document.getElementById('diagram-container')?.getBoundingClientRect();
      const y2 = svgRect ? svgRect.bottom : y1 + 400;
      return {
        type: 'reorder',
        reorderX: indicatorX,
        reorderY1: y1,
        reorderY2: y2,
        lineX1: 0, lineY1: 0, lineX2: 0, lineY2: 0,
        insertY: null, insertX1: 0, insertX2: 0,
        hasTarget: true,
      };
    }

    // Message drag: line from source to cursor + horizontal insertion indicator.
    const target = nearestParticipantAtX(cache.participants, drag.currentX);
    const validTarget = target && target.key !== drag.participantKey ? target : null;
    drag.toParticipantKey = validTarget ? validTarget.key : null;
    drag.toParticipantId = validTarget ? validTarget.id : null;

    // Determine insertion position from cursor Y.
    let insertPosition: MessageInsertPosition | null = null;
    let insertY: number | null = null;
    if (validTarget) {
      const msgs = [...cache.messages].sort((a, b) => a.y - b.y);
      if (msgs.length === 0) {
        insertPosition = { type: 'top' };
        insertY = source.bottom + 15;
      } else if (drag.currentY < msgs[0].y) {
        insertPosition = { type: 'before', key: msgs[0].key };
        insertY = msgs[0].y - 8;
      } else if (drag.currentY > msgs[msgs.length - 1].y) {
        insertPosition = { type: 'after', key: msgs[msgs.length - 1].key };
        insertY = msgs[msgs.length - 1].y + 20;
      } else {
        for (let i = 0; i < msgs.length - 1; i++) {
          if (drag.currentY >= msgs[i].y && drag.currentY <= msgs[i + 1].y) {
            insertPosition = { type: 'before', key: msgs[i + 1].key };
            insertY = (msgs[i].y + msgs[i + 1].y) / 2;
            break;
          }
        }
        if (!insertPosition) {
          insertPosition = { type: 'after', key: msgs[msgs.length - 1].key };
          insertY = msgs[msgs.length - 1].y + 20;
        }
      }
      drag.insertPosition = insertPosition;
    } else {
      drag.insertPosition = null;
    }

    const x1 = source.centerX;
    const y1 = source.centerY;
    const x2 = drag.currentX;
    const y2 = drag.currentY;
    const insX1 = validTarget ? Math.min(source.centerX, validTarget.centerX) : 0;
    const insX2 = validTarget ? Math.max(source.centerX, validTarget.centerX) : 0;

    return {
      type: 'message',
      reorderX: null,
      reorderY1: 0,
      reorderY2: 0,
      lineX1: x1,
      lineY1: y1,
      lineX2: x2,
      lineY2: y2,
      insertY,
      insertX1: insX1,
      insertX2: insX2,
      hasTarget: validTarget !== null,
    };
  };

  // Window-level mouse move/up so dragging works outside the container.
  useEffect(() => {
    if (!editMode) return;

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.isDragging && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      drag.isDragging = true;
      suppressClickRef.current = true;
      drag.currentX = e.clientX;
      drag.currentY = e.clientY;
      setDragOverlay(computeOverlay(drag));
    };

    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      screenCacheRef.current = null;
      setDragOverlay(null);
      if (!drag.isDragging) {
        // A plain click: let the click handler manage selection.
        return;
      }
      suppressClickRef.current = true;
      if (drag.type === 'reorder') {
        if (onMoveParticipant && drag.targetBeforeKey !== undefined) {
          // Only fire when the target differs from the current position.
          // targetBeforeKey === null means "move to end"; the transform
          // handles no-ops (e.g. already at end).
          onMoveParticipant(drag.participantKey, drag.targetBeforeKey);
        }
      } else {
        // Message drag: only create when released over a different participant.
        if (onCreateMessageDrag && drag.toParticipantKey && drag.insertPosition) {
          onCreateMessageDrag(drag.participantKey, drag.toParticipantKey, drag.insertPosition);
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, code, selection, onMoveParticipant, onCreateMessageDrag]);

  // Click delegation: in edit mode, resolve the target to a processed element
  // key (null = empty space -> deselect). Suppressed after a drag.
  const handleDiagramClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!editMode || !onSelect) return;
    const ctx = getSvgAndModel();
    if (!ctx) return;
    const key = elementKeyAtTarget(e.target as Element, ctx.svgRoot, ctx.model);
    onSelect(key);
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-white  rounded border border-gray-200 ">
      {error && (
        <div className="absolute top-0 left-0 w-full bg-red-100 text-red-600 p-2 z-10 text-sm overflow-auto max-h-32">
          {error}
        </div>
      )}
      <div
        id="diagram-container"
        className={`w-full h-full ${editMode ? 'cursor-pointer' : ''}`}
        onClick={handleDiagramClick}
        onMouseDownCapture={handleMouseDownCapture}
      >
        <TransformWrapper
          panning={panExcluded ? { excluded: PARTICIPANT_PAN_EXCLUSIONS } : undefined}
        >
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center p-8">
            {svgStr && <div dangerouslySetInnerHTML={{ __html: svgStr }} />}
          </TransformComponent>
        </TransformWrapper>
      </div>
      {dragOverlay && (
        <svg
          data-testid="drag-overlay"
          className="fixed inset-0 pointer-events-none z-40"
          style={{ width: '100vw', height: '100vh', overflow: 'visible' }}
        >
          {dragOverlay.type === 'reorder' && dragOverlay.reorderX !== null && (
            <line
              data-testid="reorder-indicator"
              x1={dragOverlay.reorderX}
              y1={dragOverlay.reorderY1}
              x2={dragOverlay.reorderX}
              y2={dragOverlay.reorderY2}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
          {dragOverlay.type === 'message' && (
            <>
              <line
                data-testid="message-drag-line"
                x1={dragOverlay.lineX1}
                y1={dragOverlay.lineY1}
                x2={dragOverlay.lineX2}
                y2={dragOverlay.lineY2}
                stroke={dragOverlay.hasTarget ? '#3b82f6' : '#9ca3af'}
                strokeWidth={2}
              />
              {dragOverlay.insertY !== null && (
                <line
                  data-testid="message-insert-indicator"
                  x1={dragOverlay.insertX1}
                  y1={dragOverlay.insertY}
                  x2={dragOverlay.insertX2}
                  y2={dragOverlay.insertY}
                  stroke="#22c55e"
                  strokeWidth={3}
                />
              )}
            </>
          )}
        </svg>
      )}
    </div>
  );
}
