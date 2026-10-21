'use client';

import { useEffect, useState, useRef, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import mermaid from 'mermaid';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { parseModel, ParticipantElement, looksLikeMermaidDiagram } from '@/lib/model';
import { applyArrowStyles, applyNodeColors, reorderSequenceLayers, addEdgeHitPaths, markPanExclusionTargets, PAN_EXCLUDE_CLASS } from '@/lib/styling';
import {
  elementKeyAtTarget, svgElementForKey, flowchartNodeIdOf, zipModelToSvg, EDGE_HIT_CLASS,
  labelElementForKey,
  getParticipantScreenInfo, getNodeScreenInfo, getMessageScreenInfo, getMessageEndpointScreenInfo,
  getEdgeEndpointScreenInfo,
  nearestParticipantAtX, nearestMessageKeyAt,
  sequenceConnectHandlePos, sequenceBottomConnectHandlePos, nodeConnectHandlePositions, nearestConnectHandleAt,
  nearestNodeAtPoint, nearestNodeHandleAt,
  CONNECT_HANDLE_GRAB_RADIUS, NODE_HOVER_PAD, NODE_DROP_PAD,
  ParticipantScreenInfo, MessageScreenInfo, MessageEndpointScreenInfo, EdgeEndpointScreenInfo,
} from '@/lib/svgmap';
import { DiagramConfig, StickyNote as StickyNoteType, parseViewsData } from '@/lib/views';
import { MessageInsertPosition } from '@/lib/editor';
import { WALKTHROUGH_MIN_ZOOM, WALKTHROUGH_MAX_ZOOM } from '@/lib/walkthrough';
import { useWalkthroughPlayback } from '@/lib/useWalkthroughPlayback';
import { Lock, ZoomIn, ZoomOut, Maximize2, ChevronUp, ChevronDown } from 'lucide-react';
import StickyNote from './StickyNote';
import WalkthroughBar from './WalkthroughBar';

interface DiagramViewerProps {
  code: string;
  searchQuery: string;
  theme: 'default' | 'dark';
  editMode?: boolean;
  isVisualLocked?: boolean;
  presentation?: boolean;
  onExitPresentation?: () => void;
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
  // Retarget a flowchart edge: end 'to' drags the arrow head (target node),
  // 'from' drags the tail (origin) onto the node with the given key.
  onMoveEdgeEndpoint?: (edgeKey: string, end: 'from' | 'to', targetNodeKey: string) => void;
  // Move a sequence message vertically up or down to reorder messages.
  onMoveMessage?: (messageKey: string, position: MessageInsertPosition) => void;
  // Sticky notes:
  notes?: StickyNoteType[];
  showNotes?: boolean;
  selectedNoteIds?: string[];   // CONFIG ids of the selected sticky notes (highlight ring)
  onSelectNote?: (id: string, options?: { shiftKey?: boolean }) => void;
  onUpdateNote?: (id: string, patch: Partial<Omit<StickyNoteType, 'id'>>) => void;
  onDeleteNote?: (id: string) => void;
  // Double-click inline label editing: reports the processed key of the
  // double-clicked participant/node/message/edge and the edited label.
  onLabelEdit?: (key: string, label: string) => void;
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

// Canvas zoom range and the pill's step: minScale below 1 lets "Fit to screen"
// shrink large diagrams (the library default of 1 never zooms out).
const MIN_ZOOM_SCALE = WALKTHROUGH_MIN_ZOOM;
const MAX_ZOOM_SCALE = WALKTHROUGH_MAX_ZOOM;
const ZOOM_STEP = 0.5;

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

// The endpoint (arrow head = 'to', tail = 'from') nearest to the cursor,
// within the grab radius. Works for sequence messages and flowchart edges
// alike — both carry { key, fromX, fromY, toX, toY } screen points. A
// selected element's endpoints get the much larger
// ENDPOINT_GRAB_RADIUS_SELECTED zone. Candidates are checked head-first and
// only a strictly closer point replaces the best, so a self-message (head
// and tail coincide on the lifeline) resolves to the head.
function endpointHitAt(
  endpoints: (MessageEndpointScreenInfo | EdgeEndpointScreenInfo)[],
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
  presentation = false,
  onExitPresentation,
  arrowStyles = null,
  nodeColors = null,
  selection = null,
  onSelect,
  onMoveParticipant,
  onCreateMessageDrag,
  onMoveMessageEndpoint,
  onMoveEdgeEndpoint,
  onMoveMessage,
  notes = [],
  showNotes = true,
  selectedNoteIds,
  onSelectNote,
  onUpdateNote,
  onDeleteNote,
  onLabelEdit,
}: DiagramViewerProps) {
  const [svgStr, setSvgStr] = useState<string>('');
  // Memoized so the object identity is stable across re-renders while svgStr
  // is unchanged. React diffs host props by identity at commit time and
  // re-applies innerHTML whenever the dangerouslySetInnerHTML object changes —
  // with a fresh { __html } literal on every render, each commit would replace
  // the whole SVG subtree, detaching elements that effects hold onto (search
  // matches) and wiping their inline highlight.
  const svgInnerHtml = useMemo(() => ({ __html: svgStr }), [svgStr]);
  const [error, setError] = useState<string | null>(null);
  const [dragOverlay, setDragOverlay] = useState<DragOverlay | null>(null);
  // Hover affordances ("handles connect, body moves"): the sequence connect
  // handle (fixed, on the lifeline just below the top actor box) for the
  // hovered participant column, and the four connect handles for the hovered
  // flowchart node. The cursor hint mirrors the hovered zone: crosshair on a
  // connect handle, grab on a movable body.
  const [hoverConnectHandle, setHoverConnectHandle] = useState<{ x: number; y: number; participantKey: string; participantId: string } | null>(null);
  const [hoverNode, setHoverNode] = useState<ParticipantScreenInfo | null>(null);
  // Processed key of the hovered flowchart edge (its invisible hit path makes
  // the hover target a ~12px band, so unlabeled edges are discoverable).
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [cursorHint, setCursorHint] = useState<'grab' | 'crosshair' | 'pointer' | null>(null);

  // Zoom pill state: the TransformWrapper instance (zoom in/out/fit/search-pan
  // actions) and the current scale for the percentage readout.
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const zoomScaleRef = useRef(1);
  const handleTransform = (_ref: unknown, state: { scale: number }) => {
    if (state.scale !== zoomScaleRef.current) {
      zoomScaleRef.current = state.scale;
      setZoomScale(state.scale);
    }
  };

  const walkthroughConfig = useMemo<DiagramConfig | null>(() => {
    const parsed = parseViewsData(code);
    const base = parsed ?? arrowStyles ?? nodeColors ?? null;
    if (!base && (!notes || notes.length === 0)) return null;
    return {
      version: base?.version ?? 1,
      ...base,
      ...(arrowStyles?.arrows ? { arrows: arrowStyles.arrows } : {}),
      ...(nodeColors?.actors ? { actors: nodeColors.actors } : {}),
      ...(notes && notes.length > 0 ? { notes } : {}),
    };
  }, [code, arrowStyles, nodeColors, notes]);

  const walkthrough = useWalkthroughPlayback({
    code,
    config: walkthroughConfig,
    containerId: 'diagram-container',
    transformRef,
    getZoomScale: () => zoomScaleRef.current,
    enabled: !!presentation,
    svgVersion: svgStr,
    onExit: onExitPresentation,
  });

  // Search matches (the highlighted text nodes, in document order) and the
  // active match for the pill's prev/next navigation + auto-pan.
  const [searchMatches, setSearchMatches] = useState<Element[]>([]);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);

  // Double-click inline label editing: a floating input over the clicked
  // element's label text (Enter/blur commits, Escape cancels), mirroring the
  // StickyNote double-click-to-edit pattern. The rect is captured in viewport
  // coordinates at open time.
  const [labelEdit, setLabelEdit] = useState<{
    key: string;
    initial: string;
    value: string;
    placeholder: string;
    rect: { left: number; top: number; width: number; height: number };
    fontSize: number;
  } | null>(null);
  const labelEditRef = useRef(labelEdit);
  labelEditRef.current = labelEdit;
  // Guards against double-commit: Enter commits, then the unmount blur fires.
  const labelEditDoneRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Enter/blur commits (once — the unmount after Enter also fires blur);
  // Escape cancels. An unchanged label is not reported (the edit pipeline
  // no-ops on identical code anyway).
  const finishLabelEdit = (commit: boolean) => {
    const current = labelEditRef.current;
    if (!current || labelEditDoneRef.current) return;
    labelEditDoneRef.current = true;
    setLabelEdit(null);
    if (commit && current.value !== current.initial) {
      onLabelEdit?.(current.key, current.value);
    }
  };

  // In edit mode, dragging a participant (sequence) or a node (flowchart)
  // must not pan the screen — exclude those elements from TransformWrapper
  // panning. While presenting, drag edits are suspended so panning works everywhere.
  const diagramType = useMemo(() => parseModel(code).type, [code]);
  const isSequenceDiagram = diagramType === 'sequence';
  const isFlowchartDiagram = diagramType === 'flowchart';
  const panExcluded = editMode && !isVisualLocked && !presentation && (isSequenceDiagram || isFlowchartDiagram) && !!onSelect;
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
      // Add a random ID to prevent caching issues if code changes but ID doesn't
      const id = `mermaid-svg-${Math.random().toString(36).substr(2, 9)}`;
      try {
        setError(null);
        const { svg } = await mermaid.render(id, code);
        // Post-process: normalize sequence diagram layers, apply arrow styles
        // and node colors, add the invisible per-edge hit paths (after the
        // arrow styles, which create the .arrow-anim-packet-runner /
        // .arrow-x-mark overlays), then tag pan-exclusion targets.
        const model = parseModel(code);
        let styled = reorderSequenceLayers(svg);
        styled = applyArrowStyles(styled, model, arrowStyles);
        styled = applyNodeColors(styled, nodeColors, theme);
        styled = addEdgeHitPaths(styled);
        styled = markPanExclusionTargets(styled);
        if (isMounted) {
          setSvgStr(styled);
        }
      } catch (err: unknown) {
        if (typeof document !== 'undefined') {
          document.getElementById(`d${id}`)?.remove();
        }
        if (isMounted) {
          const e = err as Error;
          setError(e.message || 'Error rendering diagram');
        }
      }
    };
    if (code && looksLikeMermaidDiagram(code)) {
      renderDiagram();
    } else {
      // No diagram to show (e.g. the active directory has no .mmd files, or
      // the directory was just switched, or content is not a mermaid diagram):
      // drop the previous render instead of leaving the old diagram on screen.
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

  // Search highlight + match collection: matching text nodes are painted red
  // and collected (in document order) for the zoom pill's match navigation.
  // Non-matches are always cleared, so clearing the query removes the old
  // highlight as well.
  useEffect(() => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    const query = searchQuery.trim().toLowerCase();
    const matches: Element[] = [];
    container.querySelectorAll('text').forEach((node) => {
      const content = node.textContent?.toLowerCase() || '';
      if (query && content.includes(query)) {
        node.style.fill = 'red';
        node.style.fontWeight = 'bold';
        matches.push(node);
      } else {
        node.style.fill = '';
        node.style.fontWeight = 'normal';
      }
    });
    setSearchMatches(matches);
    setSearchMatchIndex(0);
  }, [svgStr, searchQuery]);

  // Search auto-pan: whenever the match list or the active match changes,
  // center the canvas on it (zoomToElement) at a readable scale — at least the
  // current zoom, never below 100%, so a match stays legible on huge diagrams.
  useEffect(() => {
    if (!searchQuery.trim() || searchMatches.length === 0) return;
    const target = searchMatches[Math.min(searchMatchIndex, searchMatches.length - 1)];
    if (!target) return;
    const scale = Math.min(Math.max(zoomScaleRef.current, 1), MAX_ZOOM_SCALE);
    // The matches are SVG text elements; zoomToElement's target type only
    // names HTMLElement, but it just measures the node's bounding rect.
    transformRef.current?.zoomToElement(target as unknown as HTMLElement, { scale, animationTime: 200 });
  }, [searchMatches, searchMatchIndex, searchQuery]);

  // Step through the search matches (wraps around); the effect above pans.
  const stepSearchMatch = (delta: number) => {
    setSearchMatchIndex(prev => {
      if (searchMatches.length === 0) return prev;
      return (prev + delta + searchMatches.length) % searchMatches.length;
    });
  };

  // Fit the whole diagram into the viewport: shrink it when it is larger than
  // the canvas (huge diagrams), but never zoom in past the default 100% view
  // — small diagrams already fit. Implemented via zoomToElement on the SVG
  // root: the library's own fitToView measures the wrapper-sized content div
  // (!w-full !h-full), which would degenerate to a plain 100% reset.
  const handleFitToScreen = () => {
    const ref = transformRef.current;
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!ref || !container || !svgRoot) return;
    const containerRect = container.getBoundingClientRect();
    const svgRect = svgRoot.getBoundingClientRect();
    // The SVG rect carries the current transform; divide it out to get the
    // untransformed diagram size.
    const currentScale = zoomScaleRef.current || 1;
    const svgWidth = svgRect.width / currentScale;
    const svgHeight = svgRect.height / currentScale;
    if (!containerRect.width || !containerRect.height || !svgWidth || !svgHeight) return;
    const fitScale = Math.min(
      1,
      Math.max(MIN_ZOOM_SCALE, Math.min(containerRect.width / svgWidth, containerRect.height / svgHeight))
    );
    // zoomToElement's target type only names HTMLElement, but it just measures
    // the node's bounding rect (same cast as the search auto-pan above).
    ref.zoomToElement(svgRoot as unknown as HTMLElement, { scale: fitScale, animationTime: 200 });
  };

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

  // Flowchart counterpart of selectedEndpoints: the screen points of the
  // single selected edge's tail/head, rendered as drag handles so the edge
  // can be retargeted (the flowchart parity of sequence message retargeting).
  const selectedEdgeEndpoints = useMemo(() => {
    if (!editMode || isVisualLocked || !isFlowchartDiagram || selectedProcessedKeys.length !== 1) return null;
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!svgRoot) return null;
    const model = parseModel(code);
    const eps = getEdgeEndpointScreenInfo(svgRoot, model);
    return eps.find(ep => ep.key === selectedProcessedKeys[0]) ?? null;
  }, [editMode, isVisualLocked, isFlowchartDiagram, selectedProcessedKeys, code, svgStr]);

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

  // Edge hover affordance: the hovered edge's invisible hit path lights up as
  // a translucent band and the visible edge gets a soft glow, so unlabeled
  // edges (selectable only through the hit path) are discoverable. Re-applied
  // after every render, like the selection highlight.
  useEffect(() => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    container.querySelectorAll('.edge-hover').forEach(el => el.classList.remove('edge-hover'));
    if (!editMode || !hoverEdge) return;
    const svgRoot = container.querySelector('svg');
    if (!svgRoot) return;
    const model = parseModel(code);
    if (model.type !== 'flowchart') return;
    const edges = model.elements.filter(e => e.kind === 'edge');
    const i = edges.findIndex(e => e.key === hoverEdge);
    if (i < 0) return;
    const visible = zipModelToSvg(svgRoot, model).edges[i];
    if (!visible) return;
    visible.classList.add('edge-hover');
    const dataId = visible.getAttribute('data-id');
    if (dataId) {
      svgRoot.querySelectorAll(`path.${EDGE_HIT_CLASS}`).forEach(h => {
        if (h.getAttribute('data-id') === dataId) h.classList.add('edge-hover');
      });
    }
  }, [svgStr, hoverEdge, editMode, code]);

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
  //   - Selected edge's arrow head / tail (within the endpoint grab zone
  //     around the rendered handle — ENDPOINT_GRAB_RADIUS_SELECTED px, only
  //     for the selected edge) → retarget: drag the head to change the target
  //     node, the tail to change the origin. Wins over the connect handles
  //     and the node body inside its zone. Releasing over another node
  //     retargets; anywhere else cancels (edges have no reorder fallback).
  //   - Connect handles (four dots shown on hover, at the node box's edge
  //     midpoints) → create edge: drag to another node and release. A drag
  //     line follows the cursor and a snap rect highlights the target node.
  //     Releasing anywhere else cancels. Outside a selected edge's endpoint
  //     zone this is the ONLY way to start an edge drag.
  //   - Node box (g.node) → move: drag and release over empty space to
  //     reorder the node (a dashed indicator shows the insertion position
  //     along the layout axis — horizontal for TD/BT, vertical for LR/RL).
  //   - Edge (its ~12px invisible hit band, the visible stroke, or the label
  //     box) → select: the press selects the edge immediately and never pans
  //     the canvas (unselected edges have no drag interaction).

  const getSvgAndModel = () => {
    const container = document.getElementById('diagram-container');
    const svgRoot = container?.querySelector('svg');
    if (!svgRoot) return null;
    return { svgRoot, model: parseModel(code) };
  };

  // Hover affordances: hovering an actor column (sequence) or a node
  // (flowchart) reveals its connect handle(s) and sets the cursor hint —
  // crosshair on a connect handle, grab on a movable body. Hovering a
  // flowchart edge glows it (unlabeled edges are only selectable through
  // their invisible hit path — hover makes the target discoverable).
  const handleContainerMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editMode || isVisualLocked || presentation || dragRef.current?.isDragging) {
      if (hoverConnectHandle) setHoverConnectHandle(null);
      if (hoverNode) setHoverNode(null);
      if (hoverEdge) setHoverEdge(null);
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
        const overBottomBox = nearest.bottomTop != null && nearest.bottomBottom != null &&
          e.clientX >= nearest.left && e.clientX <= nearest.right &&
          e.clientY >= nearest.bottomTop && e.clientY <= nearest.bottomBottom;
        const nearLifeline =
          Math.abs(nearest.centerX - e.clientX) < LIFELINE_HIT_THRESHOLD &&
          e.clientY > nearest.bottom &&
          e.clientY < svgRect.bottom;
        if (overTopBox || overBottomBox || nearLifeline) {
          const pEl = ctx.model.elements.find(
            e2 => e2.kind === 'participant' && (e2 as ParticipantElement).id === nearest.id
          );
          if (pEl) {
            // Show the handle (top or bottom) nearest to the cursor.
            const topHandle = sequenceConnectHandlePos(nearest);
            const bottomHandle = sequenceBottomConnectHandlePos(nearest);
            let handle = topHandle;
            if (bottomHandle) {
              const topD = Math.hypot(topHandle.x - e.clientX, topHandle.y - e.clientY);
              const botD = Math.hypot(bottomHandle.x - e.clientX, bottomHandle.y - e.clientY);
              handle = botD < topD ? bottomHandle : topHandle;
            }
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
        if (hoverEdge) setHoverEdge(null);
        return;
      }
      // No node under the cursor: an edge is hovered when the event target
      // resolves to one. The invisible fat hit path (addEdgeHitPaths) makes
      // the browser do the proximity work — within its band the target is the
      // edge's hit path (or its visible stroke / label box).
      const key = elementKeyAtTarget(e.target as Element, ctx.svgRoot, ctx.model, { x: e.clientX, y: e.clientY });
      const el = key ? ctx.model.elements.find(e2 => e2.key === key) : null;
      const edgeKey = el?.kind === 'edge' ? el.key : null;
      if (edgeKey !== hoverEdge) setHoverEdge(edgeKey);
      if (edgeKey) {
        setCursorHint('pointer');
      } else if (cursorHint) {
        setCursorHint(null);
      }
      if (hoverNode) setHoverNode(null);
      return;
    }

    if (hoverConnectHandle) setHoverConnectHandle(null);
    if (hoverNode) setHoverNode(null);
    if (hoverEdge) setHoverEdge(null);
    if (cursorHint) setCursorHint(null);
  };

  // Capture phase: stopPropagation prevents TransformWrapper from starting a
  // pan when the press is on a participant/node element (or near a lifeline).
  const handleMouseDownCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    // An open inline label editor commits when the mouse is pressed anywhere
    // on the canvas: the TransformWrapper pan handler preventDefaults
    // mousedown, so the input would never blur (and thus never commit) on a
    // canvas click.
    if (labelEditRef.current) finishLabelEdit(true);
    if ((e.target as Element).closest('.sticky-note-card')) {
      return;
    }
    if (!editMode || isVisualLocked || presentation || e.button !== 0) return;
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
    let key = elementKeyAtTarget(target, ctx.svgRoot, ctx.model, { x: e.clientX, y: e.clientY });
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
    } else if (selectedEdgeEndpoints) {
      // Flowchart edge endpoint drag: only the SELECTED edge's endpoints are
      // grabbable (its head/tail handles are the visible affordance), so
      // unselected edges never steal node drags near their endpoints.
      const hit = endpointHitAt([selectedEdgeEndpoints], e.clientX, e.clientY, selectedProcessedKeys);
      if (hit) {
        endpointHit = hit;
        const edgeEl = ctx.model.elements.find(e2 => e2.key === hit.key);
        endpointCurrentId = edgeEl && edgeEl.kind === 'edge'
          ? (hit.end === 'from' ? edgeEl.from : edgeEl.to)
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
      // Flowchart: a selected edge's head/tail (within the endpoint grab zone
      // around the visible handle) retargets the edge — it wins over the
      // connect handles and the node body, which share the node boundary.
      // Otherwise the connect handles (shown on hover at the node box's edge
      // midpoints) start an edge-creation drag; the node body moves.
      cachedParticipants = getNodeScreenInfo(ctx.svgRoot, ctx.model);
      const hovered = nearestNodeAtPoint(cachedParticipants, e.clientX, e.clientY, null, NODE_HOVER_PAD);
      const handleHit = hovered ? nearestNodeHandleAt(hovered, e.clientX, e.clientY) : null;
      if (endpointHit) {
        dragType = 'endpoint';
        participantKey = endpointHit.key;
      } else if (hovered && handleHit) {
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
        } else if (el?.kind === 'edge') {
          // Edge press: select immediately and prevent canvas pan from
          // hijacking the click (the hit path is pan-excluded as well).
          e.stopPropagation();
          e.preventDefault();
          onSelect(key);
          return;
        }
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
    setHoverEdge(null);
    setCursorHint(null);

    // Select the participant/node (or the grabbed message) on press.
    onSelect(participantKey);
  };

  // Compute the overlay for the current drag state.
  const computeOverlay = (drag: DragState): DragOverlay | null => {
    const cache = screenCacheRef.current;
    if (!cache) return null;

    if (drag.type === 'endpoint') {
      if (isFlowchartDiagram) {
        // Flowchart edge endpoint: the drop target is the node whose padded
        // box contains the cursor — except the node currently at the dragged
        // end (dropping on it is a no-op). There is no reorder fallback: an
        // endpoint drag only ever retargets the edge.
        const nodeTarget = nearestNodeAtPoint(
          cache.participants, drag.currentX, drag.currentY, null, NODE_DROP_PAD
        );
        const validTarget = nodeTarget && nodeTarget.id !== drag.endpointCurrentId ? nodeTarget : null;
        drag.toParticipantKey = validTarget ? validTarget.key : null;
        drag.toParticipantId = validTarget ? validTarget.id : null;
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
          hasTarget: validTarget !== null,
          targetRect: validTarget ? {
            left: validTarget.left - 4,
            top: validTarget.top - 4,
            width: validTarget.right - validTarget.left + 8,
            height: validTarget.bottom - validTarget.top + 8,
          } : null,
        };
      }
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
    const validTarget = target;
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
    const isSelf = validTarget ? validTarget.key === source.key : false;
    const insX1 = validTarget
      ? (isSelf ? source.centerX : Math.min(source.centerX, validTarget.centerX))
      : 0;
    const insX2 = validTarget
      ? (isSelf ? Math.max(source.right, source.centerX + 50) : Math.max(source.centerX, validTarget.centerX))
      : 0;

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
        if (isFlowchartDiagram) {
          // Flowchart: release over a different node retargets the edge's
          // endpoint; anywhere else cancels (edges have no reorder fallback).
          if (onMoveEdgeEndpoint && drag.messageKey && drag.endpointEnd && drag.toParticipantKey) {
            onMoveEdgeEndpoint(drag.messageKey, drag.endpointEnd, drag.toParticipantKey);
          }
        } else if (onMoveMessageEndpoint && drag.messageKey && drag.endpointEnd && drag.toParticipantKey) {
          // Retarget the message's endpoint when released over a different participant.
          // Otherwise, reorder the message vertically if dragged up/down.
          onMoveMessageEndpoint(drag.messageKey, drag.endpointEnd, drag.toParticipantKey);
        } else if (onMoveMessage && drag.messageKey && drag.insertPosition) {
          onMoveMessage(drag.messageKey, drag.insertPosition);
        }
      } else {
        // Message drag: create message when released over a participant (another participant or self).
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
  }, [editMode, code, selection, onMoveParticipant, onCreateMessageDrag, onMoveMessageEndpoint, onMoveEdgeEndpoint, onMoveMessage]);

  // Escape cancels an active canvas drag: the pending mouseup then does
  // nothing and the selection made on press stays. The event is marked handled
  // (preventDefault + stopImmediatePropagation — this window listener is
  // registered before ClientPage's own key handlers, since child effects run
  // first) so the page-level Escape does not also clear the selection while a
  // drag is being cancelled. ClientPage additionally skips events that arrive
  // already defaultPrevented, so the ordering is not load-bearing.
  useEffect(() => {
    if (!editMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' || target.isContentEditable)) return;
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      screenCacheRef.current = null;
      suppressClickRef.current = true;
      setDragOverlay(null);
      setHoverConnectHandle(null);
      setHoverNode(null);
      setHoverEdge(null);
      setCursorHint(null);
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode]);

  // Double-click delegation: in edit mode, double-clicking a participant box,
  // flowchart node, or message/edge label opens a floating inline input over
  // the clicked label (just like StickyNote's double-click-to-edit). Notes and
  // sticky notes are excluded — sticky notes have their own inline editor.
  const handleDiagramDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!editMode || isVisualLocked || presentation || !onLabelEdit) return;
    if ((e.target as Element).closest('.sticky-note-card')) return;
    const ctx = getSvgAndModel();
    if (!ctx) return;
    const key = elementKeyAtTarget(e.target as Element, ctx.svgRoot, ctx.model, { x: e.clientX, y: e.clientY });
    if (!key) return;
    const el = ctx.model.elements.find(el => el.key === key);
    if (!el || (el.kind !== 'participant' && el.kind !== 'node' && el.kind !== 'message' && el.kind !== 'edge')) return;
    const labelEl = labelElementForKey(ctx.svgRoot, ctx.model, key, e.target as Element);
    if (!labelEl) return;
    const rect = labelEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // Match the on-screen text size (content font size × pan/zoom × viewBox).
    const computed = parseFloat(getComputedStyle(labelEl).fontSize);
    const fontSize = Math.min(Math.max((Number.isFinite(computed) ? computed : 14) * contentScaleOf(ctx.svgRoot), 10), 64);
    const initial = el.kind === 'participant' ? (el.alias ?? '') : (el.label ?? '');
    labelEditDoneRef.current = false;
    setLabelEdit({
      key,
      initial,
      value: initial,
      placeholder: el.kind === 'participant' ? el.id : 'Label',
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      fontSize,
    });
  };

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
    let key = elementKeyAtTarget(e.target as Element, ctx.svgRoot, ctx.model, { x: e.clientX, y: e.clientY });
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

  const dimmedNoteIds =
    presentation && walkthrough.visibleStickyNoteIds && notes
      ? new Set(
          notes
            .map((n) => n.id)
            .filter((id) => !walkthrough.visibleStickyNoteIds!.includes(id)),
        )
      : null;

  return (
    <div
      ref={rootRef}
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
        className={`w-full h-full select-none ${editMode && !presentation ? (isVisualLocked ? 'cursor-not-allowed' : 'cursor-pointer') : ''}`}
        style={cursorHint ? { cursor: cursorHint } : undefined}
        onClick={handleDiagramClick}
        onDoubleClick={handleDiagramDoubleClick}
        onMouseDownCapture={handleMouseDownCapture}
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={() => {
          setHoverConnectHandle(null);
          setHoverNode(null);
          setHoverEdge(null);
          setCursorHint(null);
        }}
      >
        <TransformWrapper
          ref={transformRef}
          panning={{ excluded: panExclusions }}
          minScale={MIN_ZOOM_SCALE}
          maxScale={MAX_ZOOM_SCALE}
          // Double-click-to-zoom is disabled: double-clicking a participant,
          // node or message opens the inline label editor instead.
          doubleClick={{ disabled: true }}
          onTransform={handleTransform}
        >
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center p-8">
            {svgStr ? (
              <div className="relative inline-block select-none" data-testid="diagram-canvas-root">
                <div dangerouslySetInnerHTML={svgInnerHtml} />
                {showNotes && notes && notes.length > 0 && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    data-testid="sticky-notes-layer"
                    style={presentation ? { pointerEvents: 'none' } : undefined}
                    onMouseDownCapture={(e) => {
                      if (presentation) e.stopPropagation();
                    }}
                  >
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        data-testid={`sticky-note-wrapper-${note.id}`}
                        className={dimmedNoteIds?.has(note.id) ? 'walkthrough-dimmed' : undefined}
                        style={
                          dimmedNoteIds?.has(note.id)
                            ? { opacity: 0.2, transition: 'opacity 0.25s ease' }
                            : undefined
                        }
                      >
                        <StickyNote
                          note={note}
                          getZoomScale={zoomScaleOf}
                          selected={selectedNoteIds?.includes(note.id) ?? false}
                          onSelect={(shiftKey) => { if (!presentation) onSelectNote?.(note.id, { shiftKey }); }}
                          onMove={(id, x, y) => { if (!presentation) onUpdateNote?.(id, { x, y }); }}
                          onUpdateText={(id, text) => { if (!presentation) onUpdateNote?.(id, { text }); }}
                          onUpdateColor={(id, color) => { if (!presentation) onUpdateNote?.(id, { color }); }}
                          onResize={(id, width, height) => { if (!presentation) onUpdateNote?.(id, { width, height }); }}
                          onDelete={(id) => { if (!presentation) onDeleteNote?.(id); }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              (!code || !looksLikeMermaidDiagram(code)) && !error && (
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
      {presentation && walkthrough.plan && (
        <WalkthroughBar
          theme={theme}
          stepIndex={walkthrough.activeIndex}
          totalSteps={walkthrough.plan.steps.length}
          label={walkthrough.plan.steps[walkthrough.activeIndex]?.label}
          isPlaying={walkthrough.isPlaying}
          onPrev={walkthrough.prev}
          onNext={walkthrough.next}
          onTogglePlay={walkthrough.togglePlay}
          onExit={walkthrough.exit}
        />
      )}
      {/* Floating bottom-left canvas control pill: zoom out / level / zoom in
          / fit to screen, plus search-match navigation (with auto-pan) when a
          search query is active. Lives outside the TransformWrapper, so it
          never pans the canvas itself. bottom-12 keeps it clear of the bottom
          quick-actions bar (BottomAnimatedArrowBar), which occupies the bottom
          strip of the canvas. */}
      <div
        data-testid="zoom-controls"
        className={`absolute bottom-12 left-3 z-30 flex items-center rounded-full border shadow-lg backdrop-blur-md px-1 py-1 ${
          theme === 'dark'
            ? 'bg-slate-900/90 border-slate-700 text-slate-200'
            : 'bg-white/90 border-gray-200 text-gray-700'
        }`}
      >
        <button
          type="button"
          data-testid="zoom-out"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={zoomScale <= MIN_ZOOM_SCALE + 0.001}
          onClick={() => transformRef.current?.zoomOut(ZOOM_STEP)}
          className={`p-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
          }`}
        >
          <ZoomOut size={14} />
        </button>
        <span
          data-testid="zoom-level"
          className="w-11 text-center text-xs tabular-nums select-none"
          title="Zoom level"
        >
          {Math.round(zoomScale * 100)}%
        </span>
        <button
          type="button"
          data-testid="zoom-in"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={zoomScale >= MAX_ZOOM_SCALE - 0.001}
          onClick={() => transformRef.current?.zoomIn(ZOOM_STEP)}
          className={`p-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
          }`}
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          data-testid="zoom-fit"
          title="Fit to screen"
          aria-label="Fit to screen"
          onClick={handleFitToScreen}
          className={`p-1 rounded transition-colors ${
            theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
          }`}
        >
          <Maximize2 size={14} />
        </button>
        {searchQuery.trim() && (
          <>
            <div className={`w-px h-4 mx-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-300'}`} />
            <button
              type="button"
              data-testid="search-prev"
              title="Previous match"
              aria-label="Previous match"
              disabled={searchMatches.length === 0}
              onClick={() => stepSearchMatch(-1)}
              className={`p-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
              }`}
            >
              <ChevronUp size={14} />
            </button>
            <span
              data-testid="search-match-count"
              className="px-1 text-xs tabular-nums select-none"
              title="Search matches"
            >
              {searchMatches.length === 0
                ? '0/0'
                : `${Math.min(searchMatchIndex, searchMatches.length - 1) + 1}/${searchMatches.length}`}
            </span>
            <button
              type="button"
              data-testid="search-next"
              title="Next match"
              aria-label="Next match"
              disabled={searchMatches.length === 0}
              onClick={() => stepSearchMatch(1)}
              className={`p-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                theme === 'dark' ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
              }`}
            >
              <ChevronDown size={14} />
            </button>
          </>
        )}
      </div>
      {/* Floating inline label editor (double-click on a participant box,
          flowchart node, or message/edge label in edit mode). Sits outside
          #diagram-container so canvas click/drag/pinch handlers never see its
          events; positioned over the clicked label's screen rect, converted to
          this root's coordinate space. Enter/blur commits, Escape cancels. */}
      {labelEdit && (() => {
        const rootRect = rootRef.current?.getBoundingClientRect();
        return (
          <input
            data-testid="inline-label-editor"
            autoFocus
            value={labelEdit.value}
            placeholder={labelEdit.placeholder}
            onChange={(e) => setLabelEdit({ ...labelEdit, value: e.target.value })}
            onFocus={(e) => e.target.select()}
            onBlur={() => finishLabelEdit(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finishLabelEdit(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishLabelEdit(false);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`absolute z-40 rounded border-2 px-1 text-center shadow-lg outline-none select-text overflow-hidden ${
              theme === 'dark'
                ? 'bg-slate-900 border-blue-500 text-slate-100 placeholder:text-slate-500'
                : 'bg-white border-blue-500 text-gray-900 placeholder:text-gray-400'
            }`}
            style={{
              left: labelEdit.rect.left - (rootRect?.left ?? 0),
              top: labelEdit.rect.top - (rootRect?.top ?? 0),
              width: labelEdit.rect.width,
              height: labelEdit.rect.height,
              fontSize: labelEdit.fontSize,
              lineHeight: `${labelEdit.rect.height}px`,
            }}
          />
        );
      })()}
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
      {selectedEdgeEndpoints && !dragOverlay && (
        <svg
          data-testid="selected-edge-handles"
          className="fixed inset-0 pointer-events-none z-30"
          style={{ width: '100vw', height: '100vh', overflow: 'visible' }}
        >
          <circle
            data-testid="edge-tail-handle"
            cx={selectedEdgeEndpoints.fromX}
            cy={selectedEdgeEndpoints.fromY}
            r={5}
            fill="#3b82f6"
            stroke="#ffffff"
            strokeWidth={2}
            className="drop-shadow cursor-grab"
          />
          <circle
            data-testid="edge-head-handle"
            cx={selectedEdgeEndpoints.toX}
            cy={selectedEdgeEndpoints.toY}
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
