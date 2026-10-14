'use client';

import { useEffect, useState, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { parseModel, ParticipantElement } from '@/lib/model';
import { applyArrowStyles, applyNodeColors, reorderSequenceLayers, markPanExclusionTargets, PAN_EXCLUDE_CLASS } from '@/lib/styling';
import {
  elementKeyAtTarget, svgElementForKey, flowchartNodeIdOf,
  getParticipantScreenInfo, getNodeScreenInfo, getMessageScreenInfo, getMessageEndpointScreenInfo,
  nearestParticipantAtX, nearestMessageKeyAt,
  sequenceConnectHandlePos, nodeConnectHandlePositions, nearestConnectHandleAt,
  nearestNodeAtPoint, nearestNodeHandleAt,
  CONNECT_HANDLE_GRAB_RADIUS, NODE_HOVER_PAD, NODE_DROP_PAD,
  ParticipantScreenInfo, MessageScreenInfo, MessageEndpointScreenInfo,
} from '@/lib/svgmap';
import { DiagramConfig, StickyNote as StickyNoteType } from '@/lib/views';
import { MessageInsertPosition } from '@/lib/editor';
import { Lock } from 'lucide-react';
import StickyNote from './StickyNote';

interface DiagramViewerProps {
  code: string;
  searchQuery: string;
  theme: 'default' | 'dark';
  editMode?: boolean;
  isVisualLocked?: boolean;
  arrowStyles?: DiagramConfig | null;  // resolved config (rewriteArrowStyles); its arrows are applied
  nodeColors?: DiagramConfig | null;   // raw config; actors colors applied to flowchart nodes
  selection?: string | string[] | null;           // selected processed element key(s)
  onSelect?: (key: string | null, options?: { shiftKey?: boolean }) => void;
  // Drag callbacks (processed keys; ClientPage maps them to raw keys).
  // onMoveParticipant moves a participant (sequence) or a node (flowchart).
  onMoveParticipant?: (participantKey: string, beforeKey: string | null) => void;
  onCreateMessageDrag?: (fromKey: string, toKey: string, position: MessageInsertPosition) => void;
  // Retarget a sequence message: end 'to' drags the arrow head (recipient),
  // 'from' drags the tail (origin) onto the participant with the given key.
  onMoveMessageEndpoint?: (messageKey: string, end: 'from' | 'to', targetParticipantKey: string) => void;
  // Move a sequence message vertically up or down to reorder messages.
  onMoveMessage?: (messageKey: string, position: MessageInsertPosition) => void;
  // Sticky notes:
  notes?: StickyNoteType[];
  showNotes?: boolean;
  onUpdateNote?: (id: string, patch: Partial<Omit<StickyNoteType, 'id'>>) => void;
  onDeleteNote?: (id: string) => void;
}

// Minimum mouse movement (px) before a press becomes a drag.
const DRAG_THRESHOLD = 5;

// How close (px) the cursor must be to a participant's center X to count as
// hovering its column (the rendered lifeline stroke is only 1–2 px). Hovering
// the column reveals the connect handle on the lifeline.
const LIFELINE_HIT_THRESHOLD = 20;

// How close (px) the cursor must be to a message's arrow head or tail to grab
// it for an endpoint retarget drag. Deliberately small: messages sit ~20px
// apart on a lifeline, and an 8px radius still leaves a pressable gap between
// two adjacent endpoint zones for lifeline message creation (the insertion
// point comes from the drop position, so the press only needs one clear spot
// on the lifeline).
const ENDPOINT_GRAB_RADIUS = 8;

// When that message is already selected, its endpoint grab zones grow to this
// radius: the user has committed to the arrow, so its head/tail become easy to
// grab. Unselected messages keep the small radius so message creation on the
// lifelines stays easy.
const ENDPOINT_GRAB_RADIUS_SELECTED = 24;

// Elements that are drag targets in edit mode (participants, lifelines,
// messages, notes, flowchart nodes, arrow animation overlays) are excluded
// from TransformWrapper panning so dragging them edits instead of panning
// the screen. react-zoom-pan-pinch expands each `panning.excluded` entry E
// into `.react-transform-wrapper E` / `.<E>` selector variants and calls
// Element.matches() with them on every mouse-down, so every entry MUST be a
// bare class name — anything else makes matches() throw. The draggable SVG
// elements are tagged with PAN_EXCLUDE_CLASS by markPanExclusionTargets()
// during the render pipeline; sticky notes are the app's own components and
// already carry their classes.
export const DIAGRAM_PAN_EXCLUSIONS = [PAN_EXCLUDE_CLASS];
export const STICKY_PAN_EXCLUSIONS = ['sticky-note-card', 'sticky-note-handle'];

interface DragState {
  type: 'reorder' | 'message' | 'node' | 'endpoint' | 'connect';
  participantKey: string;   // processed key of the dragged participant/node
  participantId: string;
  startX: number;
  startY: number;
  isDragging: boolean;
  currentX: number;
  currentY: number;
  // Rubber-band start: the grabbed connect handle (message/connect drags).
  anchorX: number;
  anchorY: number;
  // Reorder/node move: the participant before which to insert (null = move to end).
  targetBeforeKey: string | null;
  // Message/connect: the participant/node under the cursor (null = no target).
  toParticipantKey: string | null;
  toParticipantId: string | null;
  insertPosition: MessageInsertPosition | null;
  // Endpoint drag (sequence messages): retarget a message's origin ('from')
  // or recipient ('to') onto another participant.
  messageKey: string | null;         // processed key of the message
  endpointEnd: 'from' | 'to' | null;  // which end is dragged
  endpointCurrentId: string | null;   // participant id currently at that end (drop on it = no-op)
  endpointFixedX: number;            // screen point of the endpoint that stays put
  endpointFixedY: number;
}

// Visual overlay data (screen coordinates, rendered in a fixed SVG).
interface DragOverlay {
  type: 'reorder' | 'message' | 'endpoint';
  // Reorder: dashed insertion line — vertical for horizontal layouts
  // (sequence diagrams, flowchart TD/BT), horizontal for LR/RL flowcharts.
  reorderX: number | null;
  reorderY1: number;
  reorderY2: number;
  reorderY: number | null;
  reorderX1: number;
  reorderX2: number;
  // Message/connect: drag line from the grabbed handle to the cursor (+ a
  // horizontal insertion indicator for sequence messages).
  // Endpoint: drag line from the fixed endpoint to the cursor.
  lineX1: number;
  lineY1: number;
  lineX2: number;
  lineY2: number;
  insertY: number | null;
  insertX1: number;
  insertX2: number;
  hasTarget: boolean;
  // Endpoint: dashed highlight rect around the participant the drop would land on.
  targetRect: { left: number; top: number; width: number; height: number } | null;
}

// The layout axis of a flowchart: TD/BT stack nodes vertically (same-rank
// nodes sit side by side, so reordering runs along X); LR/RL stack them
// horizontally (reordering runs along Y). Default direction is TD.
function flowAxisOf(code: string): 'x' | 'y' {
  const m = code.match(/^\s*(?:flowchart|graph)\s+(TD|BT|LR|RL)\b/im);
  const dir = m ? m[1].toUpperCase() : 'TD';
  return dir === 'LR' || dir === 'RL' ? 'y' : 'x';
}

// Where a reorder drop lands among the given movable elements, sorted along
// the layout axis: the first element whose center is past the cursor becomes
// the "insert before" target (null = move to the end). The indicator is the
// screen coordinate of the insertion line. Behavior for axis 'x' matches the
// original sequence-diagram reorder exactly.
function computeReorderDrop(
  movables: ParticipantScreenInfo[],
  excludeKey: string,
  cursorCoord: number,
  axis: 'x' | 'y',
): { beforeKey: string | null; indicator: number | null } {
  const coord = (p: ParticipantScreenInfo) => axis === 'x' ? p.centerX : p.centerY;
  const startEdge = (p: ParticipantScreenInfo) => axis === 'x' ? p.left : p.top;
  const endEdge = (p: ParticipantScreenInfo) => axis === 'x' ? p.right : p.bottom;
  const sorted = [...movables].sort((a, b) => coord(a) - coord(b));
  const remaining = sorted.filter(p => p.key !== excludeKey);
  if (remaining.length === 0) return { beforeKey: null, indicator: null };
  const first = remaining[0];
  const last = remaining[remaining.length - 1];
  if (cursorCoord < coord(first)) {
    return { beforeKey: first.key, indicator: startEdge(first) };
  }
  if (cursorCoord > coord(last)) {
    return { beforeKey: null, indicator: endEdge(last) + 15 };
  }
  const nextP = remaining.find(p => cursorCoord < coord(p));
  if (nextP) {
    const idx = remaining.indexOf(nextP);
    const prev = idx > 0 ? remaining[idx - 1] : null;
    return {
      beforeKey: nextP.key,
      indicator: prev ? (coord(prev) + coord(nextP)) / 2 : startEdge(nextP),
    };
  }
  return { beforeKey: null, indicator: endEdge(last) + 15 };
}

// The message endpoint (arrow head = 'to', tail = 'from') nearest to the
// cursor, within the grab radius. A selected message's endpoints get the much
// larger ENDPOINT_GRAB_RADIUS_SELECTED zone. Candidates are checked head-first
// and only a strictly closer point replaces the best, so a self-message (head
// and tail coincide on the lifeline) resolves to the head.
function endpointHitAt(
  endpoints: MessageEndpointScreenInfo[],
  x: number,
  y: number,
  selectedKeys: string[] | string | null,
): { key: string; end: 'from' | 'to'; fixedX: number; fixedY: number } | null {
  const isSelected = (k: string) =>
    Array.isArray(selectedKeys) ? selectedKeys.includes(k) : selectedKeys === k;
  let best: { key: string; end: 'from' | 'to'; fixedX: number; fixedY: number; d: number } | null = null;
  for (const ep of endpoints) {
    const radius = isSelected(ep.key) ? ENDPOINT_GRAB_RADIUS_SELECTED : ENDPOINT_GRAB_RADIUS;
    const candidates = [
      { end: 'to' as const, x: ep.toX, y: ep.toY, fixedX: ep.fromX, fixedY: ep.fromY },
      { end: 'from' as const, x: ep.fromX, y: ep.fromY, fixedX: ep.toX, fixedY: ep.toY },
    ];
    for (const c of candidates) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= radius && (!best || d < best.d)) {
        best = { key: ep.key, end: c.end, fixedX: c.fixedX, fixedY: c.fixedY, d };
      }
    }
  }
  return best;
}

// --- Transition animation (FLIP) --------------------------------------------
// A re-render replaces the whole SVG, so a reorder would teleport elements to
// their new positions. To make the change visible, every movable element is
// animated from its previous screen position to the new one (First, Last,
// Invert, Play). Only runs when the same elements are present before and
// after — a reorder keeps the id sets identical, while switching files or
// adding/deleting elements does not (and is not animated).

// Draggable/movable SVG elements, keyed by a stable id so the same element can
// be found across renders: participants (top boxes, lifelines, bottom boxes,
// bottom actor men), flowchart nodes, and sequence messages.
function movableElementsOf(svg: Element): Map<string, Element> {
  const map = new Map<string, Element>();
  const add = (key: string, el: Element) => { if (!map.has(key)) map.set(key, el); };
  svg.querySelectorAll('g[data-et="participant"][data-id]').forEach(el => {
    const id = el.getAttribute('data-id');
    if (id) add(`participant:${id}`, el);
  });
  svg.querySelectorAll('line.actor-line[data-id]').forEach(el => {
    const id = el.getAttribute('data-id');
    if (id) add(`lifeline:${id}`, el);
  });
  svg.querySelectorAll('rect.actor-bottom[name]').forEach(el => {
    const id = el.getAttribute('name');
    if (id) add(`bottombox:${id}`, el);
  });
  svg.querySelectorAll('g.actor-man[name]').forEach(el => {
    const id = el.getAttribute('name');
    if (id) add(`actorman:${id}`, el);
  });
  svg.querySelectorAll('g.node[id]').forEach(el => {
    const svgId = el.getAttribute('id');
    const nodeId = svgId ? flowchartNodeIdOf(svgId) : null;
    if (nodeId) add(`node:${nodeId}`, el);
  });
  const messageElements = Array.from(svg.querySelectorAll('[data-et="message"]'));
  const messageTexts = Array.from(svg.querySelectorAll('text.messageText'));
  const occurrences = new Map<string, number>();
  messageElements.forEach((el, i) => {
    const from = el.getAttribute('data-from') ?? '';
    const to = el.getAttribute('data-to') ?? '';
    const textEl = messageTexts[i] ?? null;
    const text = textEl?.textContent?.trim() ?? '';
    const occKey = `${from}->${to}:${text}`;
    const occ = occurrences.get(occKey) ?? 0;
    occurrences.set(occKey, occ + 1);
    const key = `msg:${occKey}:${occ}`;
    add(`${key}:line`, el);
    if (textEl) add(`${key}:text`, textEl);
  });
  return map;
}

interface MovableSnapshot {
  positions: Map<string, { x: number; y: number }>;  // screen left/top
  participantIds: Set<string>;
  nodeIds: Set<string>;
}

function captureMovableSnapshot(svg: Element | null): MovableSnapshot | null {
  if (!svg) return null;
  const elements = movableElementsOf(svg);
  const positions = new Map<string, { x: number; y: number }>();
  elements.forEach((el, key) => {
    const r = el.getBoundingClientRect();
    positions.set(key, { x: r.left, y: r.top });
  });
  const participantIds = new Set<string>();
  const nodeIds = new Set<string>();
  elements.forEach((_, key) => {
    if (key.startsWith('node:')) nodeIds.add(key.slice(5));
    else if (!key.startsWith('msg:')) participantIds.add(key.slice(key.indexOf(':') + 1));
  });
  return { positions, participantIds, nodeIds };
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// The current zoom scale of the TransformWrapper content (deltas applied via
// CSS transforms inside the content are in content coordinates, so screen
// deltas must be divided by the scale).
function zoomScaleOf(): number {
  const content = document.querySelector('.react-transform-component') as HTMLElement | null;
  const m = content?.style.transform.match(/scale\(([\d.]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}

// Screen-to-content scale of the SVG: the wrapper's zoom scale times the
// svg's own viewBox scaling (the svg is often displayed at a different size
// than its viewBox). Screen deltas are divided by this to get content
// (transform-attribute) coordinates for the animation keyframes.
function contentScaleOf(svg: Element): number {
  let scale = zoomScaleOf();
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // preserveAspectRatio defaults to "xMidYMid meet": uniform scale.
        scale *= Math.min(rect.width / parts[2], rect.height / parts[3]);
      }
    }
  }
  return scale || 1;
}

// The element's base translation from its transform attribute (flowchart node
// groups carry translate(x,y); a CSS transform overrides the attribute, so
// the animation keyframes must fold the base in).
function baseTranslateOf(el: Element): { x: number; y: number } {
  const t = el.getAttribute('transform');
  if (!t) return { x: 0, y: 0 };
  const m = t.match(/translate\(\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)\s*\)/);
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

function animateMovedElements(svg: Element, prevPositions: Map<string, { x: number; y: number }>): void {
  // jsdom has no Web Animations API; skip silently there.
  if (typeof (Element.prototype as unknown as { animate?: unknown }).animate !== 'function') return;
  const scale = contentScaleOf(svg);
  const currentElements = movableElementsOf(svg);
  currentElements.forEach((el, key) => {
    const prev = prevPositions.get(key);
    if (prev) {
      const r = el.getBoundingClientRect();
      const dx = (prev.x - r.left) / scale;
      const dy = (prev.y - r.top) / scale;
      if (Math.abs(dx) + Math.abs(dy) < 2) return; // did not move
      const base = baseTranslateOf(el);
      const isMsg = key.startsWith('msg:');
      el.animate(
        [
          { transform: `translate(${base.x + dx}px, ${base.y + dy}px)` },
          { transform: `translate(${base.x}px, ${base.y}px)` },
        ],
        isMsg
          ? { duration: 350, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
          : { duration: 400, easing: 'ease-out' },
      );
    } else if (key.startsWith('msg:')) {
      el.animate(
        [
          { opacity: 0, transform: 'scaleY(0.7)' },
          { opacity: 1, transform: 'scaleY(1)' },
        ],
        { duration: 300, easing: 'ease-out' },
      );
      el.classList.add('new-message-accent-pulse');
      setTimeout(() => {
        el.classList.remove('new-message-accent-pulse');
      }, 4000);
    }
  });
}

export default function DiagramViewer({
  code,
  searchQuery,
  theme,
  editMode = false,
  isVisualLocked = false,
  arrowStyles = null,
  nodeColors = null,
  selection = null,
  onSelect,
  onMoveParticipant,
  onCreateMessageDrag,
  onMoveMessageEndpoint,
  onMoveMessage,
  notes = [],
  showNotes = true,
  onUpdateNote,
  onDeleteNote,
}: DiagramViewerProps) {
  const [svgStr, setSvgStr] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [dragOverlay, setDragOverlay] = useState<DragOverlay | null>(null);
  // Hover affordances ("handles connect, body moves"): the sequence connect
  // handle (fixed, on the lifeline just below the top actor box) for the
  // hovered participant column, and the four connect handles for the hovered
  // flowchart node. The cursor hint mirrors the hovered zone: crosshair on a
  // connect handle, grab on a movable body.
  const [hoverConnectHandle, setHoverConnectHandle] = useState<{ x: number; y: number; participantKey: string; participantId: string } | null>(null);
  const [hoverNode, setHoverNode] = useState<ParticipantScreenInfo | null>(null);
  const [cursorHint, setCursorHint] = useState<'grab' | 'crosshair' | null>(null);

  // In edit mode, dragging a participant (sequence) or a node (flowchart)
  // must not pan the screen — exclude those elements from TransformWrapper
  // panning. Sticky notes are always excluded from panning.
  const diagramType = useMemo(() => parseModel(code).type, [code]);
  const isSequenceDiagram = diagramType === 'sequence';
  const isFlowchartDiagram = diagramType === 'flowchart';
  const panExcluded = editMode && !isVisualLocked && (isSequenceDiagram || isFlowchartDiagram) && !!onSelect;
  const panExclusions = useMemo(() => {
    return [...STICKY_PAN_EXCLUSIONS, ...(panExcluded ? DIAGRAM_PAN_EXCLUSIONS : [])];
  }, [panExcluded]);

  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  // Screen positions of the movable elements of the currently rendered SVG,
  // captured before each re-render for the FLIP transition animation.
  const prevMovableRef = useRef<MovableSnapshot | null>(null);
  // Cached screen info, computed once on mouse-down (the diagram does not
  // re-render during a drag, so participant/message positions are stable).
  const screenCacheRef = useRef<{
    participants: ParticipantScreenInfo[];
    messages: MessageScreenInfo[];
  } | null>(null);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      themeVariables: theme === 'dark' ? {
        darkMode: true,
        background: '#090d16',
        mainBkg: '#0f172a',
        actorBkg: '#1e293b',
        actorBorder: '#3b82f6',
        actorTextColor: '#f8fafc',
        actorLineColor: '#334155',
        signalColor: '#94a3b8',
        signalTextColor: '#f8fafc',
        labelBoxBkgColor: '#1e293b',
        labelBoxBorderColor: '#334155',
        labelTextColor: '#f8fafc',
        loopTextColor: '#f8fafc',
        noteBkgColor: '#1e293b',
        noteBorderColor: '#334155',
        noteTextColor: '#f8fafc',
        activationBorderColor: '#3b82f6',
        activationBkgColor: '#1e293b',
        sequenceNumberColor: '#f8fafc',
        rectBorder: '#334155',
        nodeBorder: '#3b82f6',
        primaryColor: '#1e293b',
        primaryBorderColor: '#3b82f6',
        primaryTextColor: '#f8fafc',
        lineColor: '#334155',
      } : undefined,
    });
  }, [theme]);

  useEffect(() => {
    // Capture the movable elements' screen positions while the OLD SVG is
    // still in the DOM (svgStr lags one render behind), for the FLIP
    // transition animation once the new render lands.
    prevMovableRef.current = captureMovableSnapshot(
      document.getElementById('diagram-container')?.querySelector('svg') ?? null
    );
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        setError(null);
        // Add a random ID to prevent caching issues if code changes but ID doesn't
        const id = `mermaid-svg-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        // Post-process: normalize sequence diagram layers, apply arrow styles
        // and node colors, tag pan-exclusion targets (after the arrow styles,
        // which create the .arrow-anim-packet-runner / .arrow-x-mark overlays)
        const model = parseModel(code);
        let styled = reorderSequenceLayers(svg);
        styled = applyArrowStyles(styled, model, arrowStyles);
        styled = applyNodeColors(styled, nodeColors);
        styled = markPanExclusionTargets(styled);
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
    } else {
      // No diagram to show (e.g. the active directory has no .mmd files, or
      // the directory was just switched): drop the previous render instead of
      // leaving the old diagram on screen.
      setSvgStr('');
      setError(null);
    }
    return () => {
      isMounted = false;
    };
  }, [code, theme, arrowStyles, nodeColors]);

  // FLIP transition animation: when a re-render moves elements (e.g. after a
  // drag-reorder), animate the moved ones from their previous screen positions
  // to the new ones. Skipped when the element id sets changed (file switch,
  // add, delete) or when nothing moved.
  useEffect(() => {
    const prev = prevMovableRef.current;
    prevMovableRef.current = null;
    if (!prev || !svgStr) return;
    if (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const svg = document.getElementById('diagram-container')?.querySelector('svg');
    if (!svg) return;
    const next = captureMovableSnapshot(svg);
    if (!next) return;
    if (!sameIdSet(prev.participantIds, next.participantIds)) return;
    if (!sameIdSet(prev.nodeIds, next.nodeIds)) return;
    animateMovedElements(svg, prev.positions);
  }, [svgStr]);

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

  const selectedProcessedKeys = useMemo(() => {
    if (!selection) return [];
    if (Array.isArray(selection)) return selection;
    return [selection];
  }, [selection]);

  const selectedEndpoints = useMemo(() => {
    if (!editMode || isVisualLocked || !isSequenceDiagram || selectedProcessedKeys.length !== 1) return null;
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!svgRoot) return null;
    const model = parseModel(code);
    const eps = getMessageEndpointScreenInfo(svgRoot, model);
    return eps.find(ep => ep.key === selectedProcessedKeys[0]) ?? null;
  }, [editMode, isVisualLocked, isSequenceDiagram, selectedProcessedKeys, code, svgStr]);

  // Selection highlight: re-applied after every render via the zip (plan 4.7).
  // Coexists with the search highlight (different elements/properties).
  useEffect(() => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    container.querySelectorAll('.editor-selected').forEach(el => el.classList.remove('editor-selected'));
    if (!editMode || selectedProcessedKeys.length === 0) return;
    const svgRoot = container.querySelector('svg');
    if (!svgRoot) return;
    const model = parseModel(code);
    for (const key of selectedProcessedKeys) {
      const el = svgElementForKey(svgRoot, model, key);
      if (el) el.classList.add('editor-selected');
    }
  }, [svgStr, selectedProcessedKeys, editMode, code]);

  // --- Drag interactions (edit mode) -------------------
  // "Handles connect, body moves" — every region of an element does exactly
  // one thing, and every action has a visible handle. The drag type is
  // determined by WHERE the mouse is pressed, not by selection state:
  // Sequence diagrams:
  //   - Connect handle (the dot shown on hover, on the lifeline just below the
  //     top actor box) → create message: drag to another participant and
  //     release to connect. A drag line follows the cursor and a green
  //     horizontal indicator shows the vertical insertion point (top /
  //     between messages / bottom). This is the ONLY way to start a message
  //     drag, and within its grab radius it wins over endpoint grab zones —
  //     pressing the dot must always create a message (on small renderings
  //     the first message's tail sits close to the handle).
  //   - Actor box (top g[data-et="participant"], bottom rect.actor /
  //     g.actor-man) or the lifeline (line.actor-line) → reorder: drag
  //     horizontally to change participant order. The space between any two
  //     actors, before the first, and after the last are all valid drop
  //     positions (a vertical dashed indicator shows the target).
  //   - Message arrow head / tail (within ENDPOINT_GRAB_RADIUS px of the
  //     endpoint — ENDPOINT_GRAB_RADIUS_SELECTED px when that message is
  //     selected) → retarget: drag the head to change the recipient, the tail
  //     to change the origin. Loses to the connect handle within its grab
  //     radius; everywhere else the zones coexist.
  // Flowchart diagrams:
  //   - Connect handles (four dots shown on hover, at the node box's edge
  //     midpoints) → create edge: drag to another node and release. A drag
  //     line follows the cursor and a snap rect highlights the target node.
  //     Releasing anywhere else cancels. This is the ONLY way to start an
  //     edge drag.
  //   - Node box (g.node) → move: drag and release over empty space to
  //     reorder the node (a dashed indicator shows the insertion position
  //     along the layout axis — horizontal for TD/BT, vertical for LR/RL).

  const getSvgAndModel = () => {
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!svgRoot) return null;
    return { svgRoot, model: parseModel(code) };
  };

  // Hover affordances: hovering an actor column (sequence) or a node
  // (flowchart) reveals its connect handle(s) and sets the cursor hint —
  // crosshair on a connect handle, grab on a movable body.
  const handleContainerMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editMode || isVisualLocked || dragRef.current?.isDragging) {
      if (hoverConnectHandle) setHoverConnectHandle(null);
      if (hoverNode) setHoverNode(null);
      if (cursorHint) setCursorHint(null);
      return;
    }
    const ctx = getSvgAndModel();
    if (!ctx) return;

    if (ctx.model.type === 'sequence') {
      const participants = getParticipantScreenInfo(ctx.svgRoot, ctx.model);
      const nearest = nearestParticipantAtX(participants, e.clientX);
      if (nearest) {
        const svgRect = ctx.svgRoot.getBoundingClientRect();
        const overTopBox =
          e.clientX >= nearest.left && e.clientX <= nearest.right &&
          e.clientY >= nearest.top && e.clientY <= nearest.bottom;
        const nearLifeline =
          Math.abs(nearest.centerX - e.clientX) < LIFELINE_HIT_THRESHOLD &&
          e.clientY > nearest.bottom &&
          e.clientY < svgRect.bottom;
        if (overTopBox || nearLifeline) {
          const pEl = ctx.model.elements.find(
            e2 => e2.kind === 'participant' && (e2 as ParticipantElement).id === nearest.id
          );
          if (pEl) {
            const handle = sequenceConnectHandlePos(nearest);
            setHoverConnectHandle({
              x: handle.x,
              y: handle.y,
              participantKey: pEl.key,
              participantId: nearest.id,
            });
            const nearHandle =
              Math.hypot(handle.x - e.clientX, handle.y - e.clientY) <= CONNECT_HANDLE_GRAB_RADIUS;
            setCursorHint(nearHandle ? 'crosshair' : 'grab');
            return;
          }
        }
      }
    } else if (ctx.model.type === 'flowchart') {
      const nodes = getNodeScreenInfo(ctx.svgRoot, ctx.model);
      const hovered = nearestNodeAtPoint(nodes, e.clientX, e.clientY, null, NODE_HOVER_PAD);
      if (hovered) {
        setHoverNode(hovered);
        const nearHandle = nearestNodeHandleAt(hovered, e.clientX, e.clientY) !== null;
        setCursorHint(nearHandle ? 'crosshair' : 'grab');
        return;
      }
    }

    if (hoverConnectHandle) setHoverConnectHandle(null);
    if (hoverNode) setHoverNode(null);
    if (cursorHint) setCursorHint(null);
  };

  // Capture phase: stopPropagation prevents TransformWrapper from starting a
  // pan when the press is on a participant/node element (or near a lifeline).
  const handleMouseDownCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.sticky-note-card')) {
      return;
    }
    if (!editMode || isVisualLocked || e.button !== 0) return;
    const ctx = getSvgAndModel();
    if (!ctx || (ctx.model.type !== 'sequence' && ctx.model.type !== 'flowchart')) return;
    if (!onSelect) return;

    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window !== 'undefined' && window.getSelection) {
        window.getSelection()?.removeAllRanges();
      }
      return;
    }

    const target = e.target as Element;
    let key = elementKeyAtTarget(target, ctx.svgRoot, ctx.model);
    if (!key && ctx.model.type === 'sequence') {
      key = nearestMessageKeyAt(
        getMessageEndpointScreenInfo(ctx.svgRoot, ctx.model),
        e.clientX,
        e.clientY,
      );
    }

    let dragType: 'reorder' | 'message' | 'node' | 'endpoint' | 'connect' | null = null;
    let participantKey: string | null = null;
    let cachedParticipants: ParticipantScreenInfo[] | null = null;
    // Rubber-band start: the grabbed connect handle (message/connect drags).
    let anchorX = 0;
    let anchorY = 0;
    // Endpoint drag (sequence): grabbing a message's arrow head or tail.
    let endpointHit: { key: string; end: 'from' | 'to'; fixedX: number; fixedY: number } | null = null;
    let endpointCurrentId: string | null = null;

    if (ctx.model.type === 'sequence') {
      cachedParticipants = getParticipantScreenInfo(ctx.svgRoot, ctx.model);
      endpointHit = endpointHitAt(
        getMessageEndpointScreenInfo(ctx.svgRoot, ctx.model),
        e.clientX,
        e.clientY,
        selectedProcessedKeys,
      );
      if (endpointHit) {
        const msgEl = ctx.model.elements.find(e2 => e2.key === endpointHit!.key);
        endpointCurrentId = msgEl && msgEl.kind === 'message'
          ? (endpointHit.end === 'from' ? msgEl.from : msgEl.to)
          : null;
      }
    }

    if (ctx.model.type === 'sequence') {
      // The connect handle (the dot shown on hover, just below the top actor
      // box) is the only way to start a message-creation drag — and it wins
      // over endpoint grab zones that overlap it: on small renderings the
      // first message's tail sits close to the handle, and pressing the
      // visible dot must always create a message. Endpoints stay grabbable
      // everywhere outside the handle's grab radius.
      const handleHit = nearestConnectHandleAt(cachedParticipants ?? [], e.clientX, e.clientY);
      if (handleHit) {
        dragType = 'message';
        participantKey = handleHit.participant.key;
        anchorX = handleHit.handle.x;
        anchorY = handleHit.handle.y;
      } else if (endpointHit) {
        // Precise grab zones around the message endpoints retarget/reorder.
        dragType = 'endpoint';
        participantKey = endpointHit.key;
      } else if (key) {
        const el = ctx.model.elements.find(e2 => e2.key === key);
        if (el?.kind === 'participant') {
          // Actor box or lifeline → reorder.
          dragType = 'reorder';
          participantKey = key;
        } else if (el?.kind === 'message') {
          // Message press: select message immediately and prevent canvas pan from hijacking the click.
          e.stopPropagation();
          e.preventDefault();
          onSelect(key);
          return;
        }
        // Notes: no drag — the click handler manages selection.
      }
      // Empty space near a lifeline: no drag — message creation starts from
      // the connect handle only.
    } else {
      // Flowchart: the connect handles (shown on hover at the node box's edge
      // midpoints) start an edge-creation drag; the node body moves.
      cachedParticipants = getNodeScreenInfo(ctx.svgRoot, ctx.model);
      const hovered = nearestNodeAtPoint(cachedParticipants, e.clientX, e.clientY, null, NODE_HOVER_PAD);
      const handleHit = hovered ? nearestNodeHandleAt(hovered, e.clientX, e.clientY) : null;
      if (hovered && handleHit) {
        dragType = 'connect';
        participantKey = hovered.key;
        anchorX = handleHit.x;
        anchorY = handleHit.y;
      } else if (key) {
        const el = ctx.model.elements.find(e2 => e2.key === key);
        if (el?.kind === 'node') {
          // Node box → move (reorder along the layout axis).
          dragType = 'node';
          participantKey = key;
        }
        // Edges: no drag — the click handler manages selection.
      }
    }

    if (!dragType || !participantKey) return; // not a drag — let the event propagate

    // Prevent TransformWrapper panning and text selection.
    e.stopPropagation();
    e.preventDefault();

    const draggedEl = ctx.model.elements.find(e2 => e2.key === participantKey);
    const participantId =
      draggedEl && (draggedEl.kind === 'participant' || draggedEl.kind === 'node')
        ? draggedEl.id
        : '';

    screenCacheRef.current = {
      participants: cachedParticipants ?? (
        ctx.model.type === 'flowchart'
          ? getNodeScreenInfo(ctx.svgRoot, ctx.model)
          : getParticipantScreenInfo(ctx.svgRoot, ctx.model)
      ),
      messages: ctx.model.type === 'sequence'
        ? getMessageScreenInfo(ctx.svgRoot, ctx.model)
        : [],
    };

    dragRef.current = {
      type: dragType,
      participantKey,
      participantId,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      currentX: e.clientX,
      currentY: e.clientY,
      anchorX,
      anchorY,
      targetBeforeKey: null,
      toParticipantKey: null,
      toParticipantId: null,
      insertPosition: null,
      messageKey: endpointHit ? endpointHit.key : null,
      endpointEnd: endpointHit ? endpointHit.end : null,
      endpointCurrentId,
      endpointFixedX: endpointHit ? endpointHit.fixedX : 0,
      endpointFixedY: endpointHit ? endpointHit.fixedY : 0,
    };
    suppressClickRef.current = false;
    setHoverConnectHandle(null);
    setHoverNode(null);
    setCursorHint(null);

    // Select the participant/node (or the grabbed message) on press.
    onSelect(participantKey);
  };

  // Compute the overlay for the current drag state.
  const computeOverlay = (drag: DragState): DragOverlay | null => {
    const cache = screenCacheRef.current;
    if (!cache) return null;

    if (drag.type === 'endpoint') {
      // Drag line from the fixed endpoint to the cursor.
      // If cursor moves over another participant: retarget the endpoint (change actor).
      // If cursor stays near the same participant (or dragged vertically): reorder the message!
      const target = nearestParticipantAtX(cache.participants, drag.currentX);
      const isDifferentActor = target && target.id !== drag.endpointCurrentId;
      const validTarget = isDifferentActor ? target : null;
      drag.toParticipantKey = validTarget ? validTarget.key : null;
      drag.toParticipantId = validTarget ? validTarget.id : null;

      if (validTarget) {
        drag.insertPosition = null;
        return {
          type: 'endpoint',
          reorderX: null,
          reorderY1: 0,
          reorderY2: 0,
          reorderY: null,
          reorderX1: 0,
          reorderX2: 0,
          lineX1: drag.endpointFixedX,
          lineY1: drag.endpointFixedY,
          lineX2: drag.currentX,
          lineY2: drag.currentY,
          insertY: null,
          insertX1: 0,
          insertX2: 0,
          hasTarget: true,
          targetRect: {
            left: validTarget.left - 4,
            top: validTarget.top - 4,
            width: validTarget.right - validTarget.left + 8,
            height: validTarget.bottom - validTarget.top + 8,
          },
        };
      }

      // Dragging vertically: reorder the message among the other messages.
      const otherMsgs = [...cache.messages]
        .filter(m => m.key !== drag.messageKey)
        .sort((a, b) => a.y - b.y);

      let insertPosition: MessageInsertPosition | null = null;
      let insertY: number | null = null;

      if (otherMsgs.length === 0) {
        insertPosition = { type: 'top' };
        insertY = drag.startY;
      } else if (drag.currentY < otherMsgs[0].y) {
        insertPosition = { type: 'before', key: otherMsgs[0].key };
        insertY = otherMsgs[0].y - 8;
      } else if (drag.currentY > otherMsgs[otherMsgs.length - 1].y) {
        insertPosition = { type: 'after', key: otherMsgs[otherMsgs.length - 1].key };
        insertY = otherMsgs[otherMsgs.length - 1].y + 12;
      } else {
        for (let i = 0; i < otherMsgs.length - 1; i++) {
          if (drag.currentY >= otherMsgs[i].y && drag.currentY <= otherMsgs[i + 1].y) {
            insertPosition = { type: 'after', key: otherMsgs[i].key };
            insertY = (otherMsgs[i].y + otherMsgs[i + 1].y) / 2;
            break;
          }
        }
      }
      drag.insertPosition = insertPosition;

      const minX = Math.min(...cache.participants.map(p => p.left));
      const maxX = Math.max(...cache.participants.map(p => p.right));

      return {
        type: 'endpoint',
        reorderX: null,
        reorderY1: 0,
        reorderY2: 0,
        reorderY: null,
        reorderX1: 0,
        reorderX2: 0,
        lineX1: drag.endpointFixedX,
        lineY1: drag.endpointFixedY,
        lineX2: drag.currentX,
        lineY2: drag.currentY,
        insertY,
        insertX1: minX - 10,
        insertX2: maxX + 10,
        hasTarget: false,
        targetRect: null,
      };
    }

    const source = cache.participants.find(p => p.key === drag.participantKey);
    if (!source) return null;

    if (drag.type === 'reorder') {
      // Participants sorted by screen X (left-to-right = source order).
      const { beforeKey, indicator } = computeReorderDrop(
        cache.participants, drag.participantKey, drag.currentX, 'x'
      );
      drag.targetBeforeKey = beforeKey;
      // Vertical extent: from top of participant boxes to bottom of the SVG.
      const y1 = Math.min(...cache.participants.map(p => p.top));
      const svgRect = document.getElementById('diagram-container')?.getBoundingClientRect();
      const y2 = svgRect ? svgRect.bottom : y1 + 400;
      return {
        type: 'reorder',
        reorderX: indicator,
        reorderY1: y1,
        reorderY2: y2,
        reorderY: null,
        reorderX1: 0,
        reorderX2: 0,
        lineX1: 0, lineY1: 0, lineX2: 0, lineY2: 0,
        insertY: null, insertX1: 0, insertX2: 0,
        hasTarget: true,
        targetRect: null,
      };
    }

    if (drag.type === 'connect') {
      // Edge creation (flowchart): rubber band from the grabbed connect
      // handle to the cursor. Releasing over another node creates the edge;
      // releasing anywhere else (empty space, the source node) cancels. The
      // drop target is the nearest node whose padded box contains the cursor
      // — not the first in model order.
      const connectTarget = nearestNodeAtPoint(
        cache.participants, drag.currentX, drag.currentY, drag.participantKey, NODE_DROP_PAD
      );
      drag.toParticipantKey = connectTarget ? connectTarget.key : null;
      drag.toParticipantId = connectTarget ? connectTarget.id : null;
      drag.insertPosition = null;
      return {
        type: 'message',
        reorderX: null,
        reorderY1: 0,
        reorderY2: 0,
        reorderY: null,
        reorderX1: 0,
        reorderX2: 0,
        lineX1: drag.anchorX,
        lineY1: drag.anchorY,
        lineX2: drag.currentX,
        lineY2: drag.currentY,
        insertY: null,
        insertX1: 0,
        insertX2: 0,
        hasTarget: connectTarget !== null,
        targetRect: connectTarget ? {
          left: connectTarget.left - 4,
          top: connectTarget.top - 4,
          width: connectTarget.right - connectTarget.left + 8,
          height: connectTarget.bottom - connectTarget.top + 8,
        } : null,
      };
    }

    if (drag.type === 'node') {
      // Node move: dashed insertion indicator along the layout axis. Edge
      // creation is only possible from a node's connect handles (drag.type
      // 'connect'), so a body drag can never create an edge by accident.
      const axis = flowAxisOf(code);
      const cursorCoord = axis === 'x' ? drag.currentX : drag.currentY;
      drag.toParticipantKey = null;
      drag.toParticipantId = null;
      const { beforeKey, indicator } = computeReorderDrop(
        cache.participants, drag.participantKey, cursorCoord, axis
      );
      drag.targetBeforeKey = beforeKey;
      const svgRect = document.getElementById('diagram-container')?.getBoundingClientRect();
      if (axis === 'x') {
        // Vertical extent: from top of the node boxes to bottom of the SVG.
        const y1 = Math.min(...cache.participants.map(p => p.top));
        const y2 = svgRect ? svgRect.bottom : y1 + 400;
        return {
          type: 'reorder',
          reorderX: indicator,
          reorderY1: y1,
          reorderY2: y2,
          reorderY: null,
          reorderX1: 0,
          reorderX2: 0,
          lineX1: 0, lineY1: 0, lineX2: 0, lineY2: 0,
          insertY: null, insertX1: 0, insertX2: 0,
          hasTarget: true,
          targetRect: null,
        };
      }
      // Horizontal extent: from left of the node boxes to right of the SVG.
      const x1 = Math.min(...cache.participants.map(p => p.left));
      const x2 = svgRect ? svgRect.right : x1 + 400;
      return {
        type: 'reorder',
        reorderX: null,
        reorderY1: 0,
        reorderY2: 0,
        reorderY: indicator,
        reorderX1: x1,
        reorderX2: x2,
        lineX1: 0, lineY1: 0, lineX2: 0, lineY2: 0,
        insertY: null, insertX1: 0, insertX2: 0,
        hasTarget: true,
        targetRect: null,
      };
    }

    // Message drag (sequence): line from the grabbed connect handle to the
    // cursor + horizontal insertion indicator.
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

    // The drag line starts where the connect handle was grabbed.
    const x1 = drag.anchorX;
    const y1 = drag.anchorY;
    const x2 = drag.currentX;
    const y2 = drag.currentY;
    const insX1 = validTarget ? Math.min(source.centerX, validTarget.centerX) : 0;
    const insX2 = validTarget ? Math.max(source.centerX, validTarget.centerX) : 0;

    return {
      type: 'message',
      reorderX: null,
      reorderY1: 0,
      reorderY2: 0,
      reorderY: null,
      reorderX1: 0,
      reorderX2: 0,
      lineX1: x1,
      lineY1: y1,
      lineX2: x2,
      lineY2: y2,
      insertY,
      insertX1: insX1,
      insertX2: insX2,
      hasTarget: validTarget !== null,
      targetRect: validTarget ? {
        left: validTarget.left - 4,
        top: validTarget.top - 4,
        width: validTarget.right - validTarget.left + 8,
        height: validTarget.bottom - validTarget.top + 8,
      } : null,
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
      setHoverConnectHandle(null);
      setHoverNode(null);
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
      } else if (drag.type === 'connect') {
        // Released over another node: create an edge between them. Released
        // anywhere else (empty space, the source node itself): cancel.
        if (onCreateMessageDrag && drag.toParticipantKey) {
          onCreateMessageDrag(drag.participantKey, drag.toParticipantKey, { type: 'bottom' });
        }
      } else if (drag.type === 'node') {
        // Node move: reorder the node. targetBeforeKey === null means "move
        // to end"; the transform handles no-ops.
        if (onMoveParticipant && drag.targetBeforeKey !== undefined) {
          onMoveParticipant(drag.participantKey, drag.targetBeforeKey);
        }
      } else if (drag.type === 'endpoint') {
        // Retarget the message's endpoint when released over a different participant.
        // Otherwise, reorder the message vertically if dragged up/down.
        if (onMoveMessageEndpoint && drag.messageKey && drag.endpointEnd && drag.toParticipantKey) {
          onMoveMessageEndpoint(drag.messageKey, drag.endpointEnd, drag.toParticipantKey);
        } else if (onMoveMessage && drag.messageKey && drag.insertPosition) {
          onMoveMessage(drag.messageKey, drag.insertPosition);
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
  }, [editMode, code, selection, onMoveParticipant, onCreateMessageDrag, onMoveMessageEndpoint, onMoveMessage]);

  // Click delegation: in edit mode, resolve the target to a processed element
  // key (null = empty space -> deselect). Suppressed after a drag.
  const handleDiagramClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if ((e.target as Element).closest('.sticky-note-card')) {
      return;
    }
    if (!editMode || isVisualLocked || !onSelect) return;
    const ctx = getSvgAndModel();
    if (!ctx) return;
    let key = elementKeyAtTarget(e.target as Element, ctx.svgRoot, ctx.model);
    if (!key && ctx.model.type === 'sequence') {
      key = nearestMessageKeyAt(
        getMessageEndpointScreenInfo(ctx.svgRoot, ctx.model),
        e.clientX,
        e.clientY,
      );
    }
    if (e.shiftKey) {
      onSelect(key, { shiftKey: true });
    } else {
      onSelect(key);
    }
  };

  return (
    <div
      className={`w-full h-full relative overflow-hidden rounded border transition-colors ${
        theme === 'dark'
          ? 'bg-slate-950 border-slate-800/80 text-slate-100 theme-dark'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
    >
      {isVisualLocked && (
        <div
          data-testid="visual-locked-banner"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center space-x-2 px-3 py-1.5 rounded-full shadow-lg border border-amber-500/40 bg-amber-500/10 backdrop-blur-md text-amber-500 dark:text-amber-400 text-xs font-medium pointer-events-none select-none transition-all"
        >
          <Lock size={13} className="flex-shrink-0" />
          <span>Visual edits locked (editing source code)</span>
        </div>
      )}
      {error && (
        <div
          className={`absolute top-0 left-0 w-full p-2 z-10 text-sm overflow-auto max-h-32 ${
            theme === 'dark'
              ? 'bg-red-950/80 text-red-300 border-b border-red-800/50'
              : 'bg-red-100 text-red-600'
          }`}
        >
          {error}
        </div>
      )}
      <div
        id="diagram-container"
        className={`w-full h-full select-none ${editMode ? (isVisualLocked ? 'cursor-not-allowed' : 'cursor-pointer') : ''}`}
        style={cursorHint ? { cursor: cursorHint } : undefined}
        onClick={handleDiagramClick}
        onMouseDownCapture={handleMouseDownCapture}
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={() => {
          setHoverConnectHandle(null);
          setHoverNode(null);
          setCursorHint(null);
        }}
      >
        <TransformWrapper
          panning={{ excluded: panExclusions }}
        >
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center p-8">
            {svgStr ? (
              <div className="relative inline-block select-none" data-testid="diagram-canvas-root">
                <div dangerouslySetInnerHTML={{ __html: svgStr }} />
                {showNotes && notes && notes.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none" data-testid="sticky-notes-layer">
                    {notes.map((note) => (
                      <StickyNote
                        key={note.id}
                        note={note}
                        getZoomScale={zoomScaleOf}
                        onMove={(id, x, y) => onUpdateNote?.(id, { x, y })}
                        onUpdateText={(id, text) => onUpdateNote?.(id, { text })}
                        onUpdateColor={(id, color) => onUpdateNote?.(id, { color })}
                        onDelete={(id) => onDeleteNote?.(id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              !code && !error && (
                <div
                  className={`text-sm select-none ${theme === 'dark' ? 'text-slate-500' : 'text-gray-400'}`}
                  data-testid="no-diagram"
                >
                  No diagram selected
                </div>
              )
            )}
          </TransformComponent>
        </TransformWrapper>
      </div>
      {hoverConnectHandle && !dragOverlay && (
        <svg
          data-testid="connect-handle-overlay"
          className="fixed inset-0 pointer-events-none z-30"
          style={{ width: '100vw', height: '100vh', overflow: 'visible' }}
        >
          <g
            data-testid="sequence-connect-handle"
            transform={`translate(${hoverConnectHandle.x}, ${hoverConnectHandle.y})`}
          >
            <circle r={12} fill="#3b82f6" stroke="#ffffff" strokeWidth={2} className="drop-shadow-md" />
            <path d="M -5 0 H 5 M 0 -5 V 5" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
          </g>
        </svg>
      )}
      {hoverNode && !dragOverlay && (
        <svg
          data-testid="node-connect-handles-overlay"
          className="fixed inset-0 pointer-events-none z-30"
          style={{ width: '100vw', height: '100vh', overflow: 'visible' }}
        >
          {nodeConnectHandlePositions(hoverNode).map((h, i) => (
            <g
              key={i}
              data-testid="node-connect-handle"
              transform={`translate(${h.x}, ${h.y})`}
            >
              <circle r={7} fill="#3b82f6" stroke="#ffffff" strokeWidth={2} className="drop-shadow-md" />
              <path d="M -3 0 H 3 M 0 -3 V 3" stroke="#ffffff" strokeWidth={1.6} strokeLinecap="round" />
            </g>
          ))}
        </svg>
      )}
      {selectedEndpoints && !dragOverlay && (
        <svg
          data-testid="selected-message-handles"
          className="fixed inset-0 pointer-events-none z-30"
          style={{ width: '100vw', height: '100vh', overflow: 'visible' }}
        >
          <circle
            data-testid="message-tail-handle"
            cx={selectedEndpoints.fromX}
            cy={selectedEndpoints.fromY}
            r={5}
            fill="#3b82f6"
            stroke="#ffffff"
            strokeWidth={2}
            className="drop-shadow cursor-grab"
          />
          <circle
            data-testid="message-head-handle"
            cx={selectedEndpoints.toX}
            cy={selectedEndpoints.toY}
            r={5}
            fill="#10b981"
            stroke="#ffffff"
            strokeWidth={2}
            className="drop-shadow cursor-grab"
          />
        </svg>
      )}
      <style>{`
        @keyframes accentPulseGlow {
          0% {
            filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.9)) drop-shadow(0 0 12px rgba(6, 182, 212, 0.8));
          }
          30% {
            filter: drop-shadow(0 0 10px rgba(16, 185, 129, 1)) drop-shadow(0 0 18px rgba(6, 182, 212, 0.9));
          }
          100% {
            filter: drop-shadow(0 0 0px transparent);
          }
        }
        .new-message-accent-pulse {
          animation: accentPulseGlow 3.5s ease-out forwards;
        }
      `}</style>
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
          {dragOverlay.type === 'reorder' && dragOverlay.reorderY !== null && (
            <line
              data-testid="reorder-indicator-h"
              x1={dragOverlay.reorderX1}
              y1={dragOverlay.reorderY}
              x2={dragOverlay.reorderX2}
              y2={dragOverlay.reorderY}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
          {dragOverlay.type === 'message' && (
            <>
              {dragOverlay.targetRect && (
                <rect
                  data-testid="target-lifeline-snap-rect"
                  x={dragOverlay.targetRect.left}
                  y={dragOverlay.targetRect.top}
                  width={dragOverlay.targetRect.width}
                  height={dragOverlay.targetRect.height}
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  rx={4}
                />
              )}
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
          {dragOverlay.type === 'endpoint' && (
            <>
              <line
                data-testid="endpoint-drag-line"
                x1={dragOverlay.lineX1}
                y1={dragOverlay.lineY1}
                x2={dragOverlay.lineX2}
                y2={dragOverlay.lineY2}
                stroke={dragOverlay.hasTarget ? '#3b82f6' : '#9ca3af'}
                strokeWidth={2}
              />
              {dragOverlay.targetRect && (
                <rect
                  data-testid="endpoint-snap-rect"
                  x={dragOverlay.targetRect.left}
                  y={dragOverlay.targetRect.top}
                  width={dragOverlay.targetRect.width}
                  height={dragOverlay.targetRect.height}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              )}
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
