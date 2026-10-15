// SVG mapping contract (EDITING_PLAN.md 4.7).
//
// Selectors confirmed against real Mermaid 12.1 render output (theme
// "default", default "neo" look). The plan's original table was written
// against older Mermaid chunks; the confirmed 12.1 structure is:
//
//   sequence participant | g[data-et="participant"] (data-id = participant id;
//                        covers top actor boxes and top `actor` men).
//                        Lifelines: line.actor-line[data-et="life-line"]
//                        [data-id]. Bottom boxes: bare g > rect.actor[name].
//                        Bottom actor men: g.actor-man[name].
//                        NOTE: participant groups are NOT in participant
//                        order in the DOM (they come out right-to-left), so
//                        participants are matched by data-id, not position.
//   sequence message     | [data-et="message"] (line, or path for self-calls),
//                        DOM order = statement order, data-from/data-to =
//                        participant ids. The label is the preceding sibling
//                        text.messageText. messageLineN classes are per line
//                        STYLE (0 = solid, 1 = dashed), not per message.
//   sequence note        | g[data-et="note"] with rect.note + text.noteText.
//   sequence block       | g[data-et="control-structure"] (not selectable).
//   flowchart node       | g.node[id], id = "<renderId>-flowchart-<nodeId>-<n>"
//                        (n is not dense; the id is parsed from the middle).
//                        Shape = first .label-container descendant.
//   flowchart edge       | g.edgePaths path[data-et="edge"], data-id =
//                        "L_<from>_<to>_<n>", DOM order = statement order,
//                        marker-end (+ marker-start for <-->). Labels live in
//                        g.edgeLabel g.label[data-id] > span.edgeLabel.
//                        Every edge also gets an invisible fat hit path
//                        (path.edge-hit, injected by addEdgeHitPaths) with
//                        the same d/data-id — the reliable click target for
//                        unlabeled edges, whose visible stroke is only ~2px.
//   flowchart cluster    | g.cluster (subgraphs; not a node, not selectable).

import { DiagramModel, ModelElement, ParticipantElement, MessageElement, NoteElement, NodeElement, EdgeElement, parseModel } from './model';
import { ActorTransformOptions, buildActorRewriteMap } from './preprocessor';
import { DiagramConfig } from './views';

// Class of the invisible per-edge hit path injected by addEdgeHitPaths
// (styling.ts): a transparent, non-scaling-stroke sibling of the visible edge
// path that makes unlabeled edges reliably selectable. Kept here (not in
// styling.ts) because styling.ts already imports from this module.
export const EDGE_HIT_CLASS = 'edge-hit';

export interface SvgZip {
  participants: (Element | null)[];  // aligned with model participant elements (source order)
  messages: (Element | null)[];      // aligned with model message elements
  notes: (Element | null)[];         // aligned with model note elements
  nodes: (Element | null)[];         // aligned with model node elements
  edges: (Element | null)[];         // aligned with model edge elements
  warnings: string[];
}

function ofKind<T extends ModelElement>(model: DiagramModel, kind: string): T[] {
  return model.elements.filter(e => e.kind === kind) as T[];
}

function toArray(list: NodeListOf<Element>): Element[] {
  return Array.from(list);
}

function zipParticipants(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const participants = ofKind<ParticipantElement>(model, 'participant');
  const byId = new Map<string, Element>();
  toArray(svg.querySelectorAll('g[data-et="participant"]')).forEach(g => {
    const id = g.getAttribute('data-id');
    if (id && !byId.has(id)) byId.set(id, g);
  });
  return participants.map(p => {
    const el = byId.get(p.id) ?? null;
    if (!el) warnings.push(`participant "${p.id}" has no SVG counterpart`);
    return el;
  });
}

// Fallback when positional zip fails (plan 4.7 risk 2): match message labels
// to text.messageText siblings, then hand out remaining lines in order.
function zipMessagesByLabel(svg: Element, messages: MessageElement[]): (Element | null)[] {
  const texts = toArray(svg.querySelectorAll('text.messageText'));
  const lines = toArray(svg.querySelectorAll('[data-et="message"]'));
  const usedTexts = new Set<Element>();
  const usedLines = new Set<Element>();
  const result: (Element | null)[] = messages.map(() => null);
  messages.forEach((m, i) => {
    if (!m.label) return;
    const t = texts.find(t => !usedTexts.has(t) && (t.textContent ?? '').trim() === m.label);
    if (!t) return;
    const line = t.nextElementSibling;
    if (line && line.matches('[data-et="message"]') && !usedLines.has(line)) {
      usedTexts.add(t);
      usedLines.add(line);
      result[i] = line;
    }
  });
  const remaining = lines.filter(l => !usedLines.has(l));
  let r = 0;
  messages.forEach((m, i) => {
    if (result[i]) return;
    if (r < remaining.length) result[i] = remaining[r++];
  });
  return result;
}

function zipMessages(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const messages = ofKind<MessageElement>(model, 'message');
  const lines = toArray(svg.querySelectorAll('[data-et="message"]'));
  if (lines.length !== messages.length) {
    warnings.push(`message count mismatch: model ${messages.length}, svg ${lines.length}; falling back to label matching`);
    return zipMessagesByLabel(svg, messages);
  }
  let ok = true;
  messages.forEach((m, i) => {
    const el = lines[i];
    const from = el.getAttribute('data-from');
    const to = el.getAttribute('data-to');
    if ((from && from !== m.from) || (to && to !== m.to)) ok = false;
  });
  if (!ok) {
    warnings.push('message endpoint mismatch; falling back to label matching');
    return zipMessagesByLabel(svg, messages);
  }
  return lines;
}

function zipNotesByText(svg: Element, notes: NoteElement[]): (Element | null)[] {
  const groups = toArray(svg.querySelectorAll('g[data-et="note"]'));
  const used = new Set<Element>();
  const result: (Element | null)[] = notes.map(() => null);
  notes.forEach((n, i) => {
    const g = groups.find(g => {
      if (used.has(g)) return false;
      const t = g.querySelector('text.noteText');
      return t && (t.textContent ?? '').trim() === n.text;
    });
    if (g) {
      used.add(g);
      result[i] = g;
    }
  });
  const remaining = groups.filter(g => !used.has(g));
  let r = 0;
  notes.forEach((n, i) => {
    if (result[i]) return;
    if (r < remaining.length) result[i] = remaining[r++];
  });
  return result;
}

function zipNotes(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const notes = ofKind<NoteElement>(model, 'note');
  const groups = toArray(svg.querySelectorAll('g[data-et="note"]'));
  if (groups.length !== notes.length) {
    warnings.push(`note count mismatch: model ${notes.length}, svg ${groups.length}; falling back to text matching`);
    return zipNotesByText(svg, notes);
  }
  let ok = true;
  notes.forEach((n, i) => {
    const t = groups[i].querySelector('text.noteText');
    if (t && (t.textContent ?? '').trim() !== n.text) ok = false;
  });
  if (!ok) {
    warnings.push('note text mismatch; falling back to text matching');
    return zipNotesByText(svg, notes);
  }
  return groups;
}

const FLOWCHART_NODE_ID_RE = /-flowchart-(.+)-(\d+)$/;

// Extracts the Mermaid node id from a rendered node group id
// ("<renderId>-flowchart-<nodeId>-<n>"). The trailing counter is not dense.
export function flowchartNodeIdOf(svgNodeId: string): string | null {
  const m = svgNodeId.match(FLOWCHART_NODE_ID_RE);
  return m ? m[1] : null;
}

function zipNodes(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const nodes = ofKind<NodeElement>(model, 'node');
  const byId = new Map<string, Element>();
  toArray(svg.querySelectorAll('g.node[id]')).forEach(g => {
    const id = g.getAttribute('id');
    if (!id) return;
    const nodeId = flowchartNodeIdOf(id);
    if (nodeId && !byId.has(nodeId)) byId.set(nodeId, g);
  });
  return nodes.map(n => {
    const el = byId.get(n.id) ?? null;
    if (!el) warnings.push(`node "${n.id}" has no SVG counterpart`);
    return el;
  });
}

// Parses "L_<from>_<to>_<n>". Only unambiguous when neither id contains an
// underscore; otherwise returns null and the caller skips the check.
function parseEdgeDataId(dataId: string | null): { from: string; to: string } | null {
  if (!dataId) return null;
  const m = dataId.match(/^L_([A-Za-z0-9-]+)_([A-Za-z0-9-]+)_\d+$/);
  return m ? { from: m[1], to: m[2] } : null;
}

function zipEdgesByLabel(svg: Element, edges: EdgeElement[]): (Element | null)[] {
  const paths = toArray(svg.querySelectorAll('g.edgePaths path[data-et="edge"]'));
  const byDataId = new Map<string, Element>();
  paths.forEach(p => {
    const d = p.getAttribute('data-id');
    if (d && !byDataId.has(d)) byDataId.set(d, p);
  });
  const labels = toArray(svg.querySelectorAll('g.edgeLabel g.label[data-id]'));
  const used = new Set<string>();
  const result: (Element | null)[] = edges.map(() => null);
  edges.forEach((e, i) => {
    if (!e.label) return;
    const lab = labels.find(l => {
      const d = l.getAttribute('data-id') ?? '';
      return !used.has(d) && (l.textContent ?? '').trim() === e.label;
    });
    if (!lab) return;
    const d = lab.getAttribute('data-id');
    const p = d ? byDataId.get(d) : undefined;
    if (p && d) {
      used.add(d);
      result[i] = p;
    }
  });
  const remaining = paths.filter(p => result.indexOf(p) < 0);
  let r = 0;
  edges.forEach((e, i) => {
    if (result[i]) return;
    if (r < remaining.length) result[i] = remaining[r++];
  });
  return result;
}

function zipEdges(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const edges = ofKind<EdgeElement>(model, 'edge');
  const paths = toArray(svg.querySelectorAll('g.edgePaths path[data-et="edge"]'));
  if (paths.length !== edges.length) {
    warnings.push(`edge count mismatch: model ${edges.length}, svg ${paths.length}; falling back to label matching`);
    return zipEdgesByLabel(svg, edges);
  }
  let ok = true;
  edges.forEach((e, i) => {
    const parsed = parseEdgeDataId(paths[i].getAttribute('data-id'));
    if (parsed && (parsed.from !== e.from || parsed.to !== e.to)) ok = false;
  });
  if (!ok) {
    warnings.push('edge endpoint mismatch; falling back to label matching');
    return zipEdgesByLabel(svg, edges);
  }
  return paths;
}

// Zips the model's elements with the rendered SVG nodes, per kind. The
// returned arrays are aligned with the model's elements of that kind (in
// source order); entries are null when no counterpart exists (soft-fail).
export function zipModelToSvg(svg: Element, model: DiagramModel): SvgZip {
  const warnings: string[] = [];
  const empty: (Element | null)[] = [];
  if (model.type === 'sequence') {
    return {
      participants: zipParticipants(svg, model, warnings),
      messages: zipMessages(svg, model, warnings),
      notes: zipNotes(svg, model, warnings),
      nodes: empty,
      edges: empty,
      warnings,
    };
  }
  if (model.type === 'flowchart') {
    return {
      participants: empty,
      messages: empty,
      notes: empty,
      nodes: zipNodes(svg, model, warnings),
      edges: zipEdges(svg, model, warnings),
      warnings,
    };
  }
  return { participants: empty, messages: empty, notes: empty, nodes: empty, edges: empty, warnings };
}

function keyFromList(list: ModelElement[], zipped: (Element | null)[], el: Element | null): string | null {
  if (!el) return null;
  const i = zipped.indexOf(el);
  return i >= 0 ? list[i].key : null;
}

// The zipped note group whose rect contains the given viewport point, or null.
function noteGroupAtPoint(zippedNotes: (Element | null)[], point: { x: number; y: number }): Element | null {
  for (const el of zippedNotes) {
    if (!el) continue;
    const rect = el.querySelector('rect');
    if (!rect) continue;
    const r = rect.getBoundingClientRect();
    if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) {
      return el;
    }
  }
  return null;
}

// Resolves a click target to a model element key (the processed key that
// DiagramViewer reports; ClientPage maps it to the raw element via
// buildSelectionMap). Returns null for anything not selectable.
//
// `point` is the click position in viewport coordinates. Mermaid paints
// participant lifelines above notes, so a click landing on a lifeline that
// crosses a note really targets the note (the note's fill is opaque; the
// lifeline only shows through) — pass the point to resolve such clicks to
// the note instead of the participant.
export function elementKeyAtTarget(
  target: Element | null,
  svg: Element,
  model: DiagramModel,
  point?: { x: number; y: number },
): string | null {
  if (!target) return null;
  const zip = zipModelToSvg(svg, model);

  if (model.type === 'sequence') {
    const participants = ofKind<ParticipantElement>(model, 'participant');
    const messages = ofKind<MessageElement>(model, 'message');
    const notes = ofKind<NoteElement>(model, 'note');

    const msg = target.closest('[data-et="message"]');
    if (msg) return keyFromList(messages, zip.messages, msg);

    const runner = target.closest(
      '.arrow-anim-packet-runner, .arrow-x-mark, .arrow-barrier-wall, .arrow-shockwave-burst'
    );
    if (runner) {
      const prevLine = runner.previousElementSibling;
      if (prevLine && prevLine.matches('[data-et="message"]')) return keyFromList(messages, zip.messages, prevLine);
      const parentLine = runner.parentElement?.querySelector('[data-et="message"]');
      if (parentLine) return keyFromList(messages, zip.messages, parentLine);
    }

    const text = target.closest('text.messageText');
    if (text) {
      const line = text.nextElementSibling;
      if (line && line.matches('[data-et="message"]')) return keyFromList(messages, zip.messages, line);
      return null;
    }

    const note = target.closest('g[data-et="note"]');
    if (note) return keyFromList(notes, zip.notes, note);

    // Lifelines are painted above notes: a click whose target is a lifeline
    // but whose position is inside a note's rect belongs to the note.
    const lifeLine = target.closest('line.actor-line, line[data-et="life-line"]');
    if (lifeLine && point) {
      const overNote = noteGroupAtPoint(zip.notes, point);
      if (overNote) return keyFromList(notes, zip.notes, overNote);
    }

    const group = target.closest('g[data-et="participant"]');
    const line = target.closest('line.actor-line');
    const rect = target.closest('rect.actor');
    const man = target.closest('g.actor-man');
    const id = (group && group.getAttribute('data-id'))
      ?? (line && line.getAttribute('data-id'))
      ?? (rect && rect.getAttribute('name'))
      ?? (man && man.getAttribute('name'))
      ?? null;
    if (id) {
      const p = participants.find(p => p.id === id);
      return p ? p.key : null;
    }
    return null;
  }

  if (model.type === 'flowchart') {
    const nodes = ofKind<NodeElement>(model, 'node');
    const edges = ofKind<EdgeElement>(model, 'edge');

    const node = target.closest('g.node');
    if (node) {
      const id = node.getAttribute('id');
      const nodeId = id ? flowchartNodeIdOf(id) : null;
      if (nodeId) {
        const n = nodes.find(n => n.id === nodeId);
        if (n) return n.key;
      }
      return keyFromList(nodes, zip.nodes, node);
    }

    const edge = target.closest('path[data-et="edge"]');
    if (edge) return keyFromList(edges, zip.edges, edge);

    // Invisible fat hit path (addEdgeHitPaths): carries the same data-id as
    // its visible edge path, so it resolves to the same model edge.
    const hit = target.closest(`path.${EDGE_HIT_CLASS}`);
    if (hit) {
      const dataId = hit.getAttribute('data-id');
      if (dataId) {
        const i = zip.edges.findIndex(el => el !== null && el.getAttribute('data-id') === dataId);
        if (i >= 0) return edges[i].key;
      }
      return null;
    }

    const label = target.closest('g.edgeLabel');
    if (label) {
      const labelInner = label.querySelector('g.label[data-id]');
      const dataId = labelInner ? labelInner.getAttribute('data-id') : null;
      if (dataId) {
        const i = zip.edges.findIndex(el => el !== null && el.getAttribute('data-id') === dataId);
        if (i >= 0) return edges[i].key;
      }
      return null;
    }
    return null;
  }

  return null;
}

// The SVG element zipped to the given model element key (for highlight), or
// null when the key is unknown or has no SVG counterpart.
export function svgElementForKey(svg: Element, model: DiagramModel, key: string): Element | null {
  const zip = zipModelToSvg(svg, model);
  const kinds: [string, (Element | null)[]][] = [
    ['participant', zip.participants],
    ['message', zip.messages],
    ['note', zip.notes],
    ['node', zip.nodes],
    ['edge', zip.edges],
  ];
  for (const [kind, zipped] of kinds) {
    const list = ofKind(model, kind);
    const i = list.findIndex(el => el.key === key);
    if (i >= 0) return zipped[i] ?? null;
  }
  return null;
}

// --- Screen-coordinate helpers for drag interactions (sequence diagrams) ---
// These use getBoundingClientRect (post-transform screen coordinates) so the
// drag overlay aligns with the rendered diagram regardless of pan/zoom.

export interface ParticipantScreenInfo {
  key: string;
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

// Screen rects of all participants, in model (source) order. The rendered
// left-to-right order matches source order for sequence diagrams.
export function getParticipantScreenInfo(svg: Element, model: DiagramModel): ParticipantScreenInfo[] {
  const zip = zipModelToSvg(svg, model);
  const participants = ofKind<ParticipantElement>(model, 'participant');
  const result: ParticipantScreenInfo[] = [];
  participants.forEach((p, i) => {
    const el = zip.participants[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    result.push({
      key: p.key,
      id: p.id,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    });
  });
  return result;
}

// Screen rects of all flowchart nodes, in model (source) order. Same shape as
// ParticipantScreenInfo; used by the node drag interactions.
export function getNodeScreenInfo(svg: Element, model: DiagramModel): ParticipantScreenInfo[] {
  const zip = zipModelToSvg(svg, model);
  const nodes = ofKind<NodeElement>(model, 'node');
  const result: ParticipantScreenInfo[] = [];
  nodes.forEach((n, i) => {
    const el = zip.nodes[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    result.push({
      key: n.key,
      id: n.id,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    });
  });
  return result;
}

export interface MessageScreenInfo {
  key: string;
  y: number;  // vertical center of the message line
}

// Screen Y of each message line, in model (source) order.
export function getMessageScreenInfo(svg: Element, model: DiagramModel): MessageScreenInfo[] {
  const zip = zipModelToSvg(svg, model);
  const messages = ofKind<MessageElement>(model, 'message');
  const result: MessageScreenInfo[] = [];
  messages.forEach((m, i) => {
    const el = zip.messages[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    result.push({ key: m.key, y: rect.top + rect.height / 2 });
  });
  return result;
}

export interface MessageEndpointScreenInfo {
  key: string;
  fromX: number; fromY: number;  // screen point of the tail (origin lifeline)
  toX: number; toY: number;      // screen point of the arrow head (recipient lifeline)
}

// Screen points of each message's two endpoints. Mermaid draws sequence
// messages lifeline-to-lifeline at the message's Y: the tail starts at the
// origin participant's center X, the head (arrowhead marker-end) touches the
// recipient's. For self-messages both ends sit on the same lifeline.
export function getMessageEndpointScreenInfo(svg: Element, model: DiagramModel): MessageEndpointScreenInfo[] {
  const participants = getParticipantScreenInfo(svg, model);
  const messages = getMessageScreenInfo(svg, model);
  const yByKey = new Map(messages.map(m => [m.key, m.y]));
  const pById = new Map(participants.map(p => [p.id, p]));
  const result: MessageEndpointScreenInfo[] = [];
  ofKind<MessageElement>(model, 'message').forEach(m => {
    const y = yByKey.get(m.key);
    const from = pById.get(m.from);
    const to = pById.get(m.to);
    if (y === undefined || !from || !to) return;
    result.push({ key: m.key, fromX: from.centerX, fromY: y, toX: to.centerX, toY: y });
  });
  return result;
}

// Finds the sequence message whose horizontal span and vertical Y coordinate
// are nearest to the given screen point (x, y) within maxVerticalDist px.
// Makes clicking arrow lines and surrounding space reliable even when area
// rects or thin 2px strokes are present.
export function nearestMessageKeyAt(
  endpoints: MessageEndpointScreenInfo[],
  x: number,
  y: number,
  maxVerticalDist = 14
): string | null {
  let closestKey: string | null = null;
  let minDist = Infinity;

  for (const ep of endpoints) {
    const minX = Math.min(ep.fromX, ep.toX) - 10;
    const maxX = Math.max(ep.fromX, ep.toX) + 10;
    const msgY = (ep.fromY + ep.toY) / 2;

    // For self-messages, fromX === toX; allow a hit zone extending 50px to the right
    const effectiveMaxX = ep.fromX === ep.toX ? ep.fromX + 50 : maxX;

    if (x >= minX && x <= effectiveMaxX) {
      const dist = Math.abs(y - msgY);
      if (dist <= maxVerticalDist && dist < minDist) {
        minDist = dist;
        closestKey = ep.key;
      }
    }
  }

  return closestKey;
}

// The participant nearest to the given screen X (by center distance). Used as
// the drop target when creating a message by dragging between participants.
export function nearestParticipantAtX(
  participants: ParticipantScreenInfo[],
  x: number,
): ParticipantScreenInfo | null {
  if (participants.length === 0) return null;
  let closest = participants[0];
  for (const p of participants) {
    if (Math.abs(p.centerX - x) < Math.abs(closest.centerX - x)) {
      closest = p;
    }
  }
  return closest;
}

// --- Connect-handle helpers ("handles connect, body moves") -----------------
// In edit mode every drag has exactly one meaning per region: connecting starts
// only from a visible connect handle, moving/reordering starts from the
// element body. These helpers locate the handles and hit-test them.

// How far below the top actor box the sequence connect handle sits on the
// lifeline. The handle is the ONLY way to start a message-creation drag; the
// lifeline and actor boxes reorder the participant.
export const SEQ_CONNECT_HANDLE_OFFSET = 14;

// How close (px) the cursor must be to a connect handle to grab it. Sized to
// cover the rendered handle (a 12px-radius dot in DiagramViewer) so the whole
// visible dot is grabbable.
export const CONNECT_HANDLE_GRAB_RADIUS = 13;

// Padding (px) around a flowchart node's box for hover/handle hit-testing.
export const NODE_HOVER_PAD = 10;

// Padding (px) around a flowchart node's box for connect drop-target
// hit-testing (a generous drop zone; the handle grab radius stays small).
export const NODE_DROP_PAD = 20;

// The sequence connect handle of a participant: a fixed point on the lifeline,
// just below the top actor box. On small renderings the first message's tail
// endpoint can sit close to the handle; the component gives the handle
// precedence over endpoint grab zones within its grab radius, so the handle
// always starts message creation.
export function sequenceConnectHandlePos(p: ParticipantScreenInfo): { x: number; y: number } {
  return { x: p.centerX, y: p.bottom + SEQ_CONNECT_HANDLE_OFFSET };
}

// The four connect handles of a flowchart node: the midpoints of the node
// box's edges (draw.io/Figma style). Edge creation drags start only from here.
export function nodeConnectHandlePositions(n: ParticipantScreenInfo): { x: number; y: number }[] {
  return [
    { x: n.centerX, y: n.top },
    { x: n.right, y: n.centerY },
    { x: n.centerX, y: n.bottom },
    { x: n.left, y: n.centerY },
  ];
}

// The participant whose connect handle is nearest to (x, y) within the grab
// radius (null when the cursor is not on any handle).
export function nearestConnectHandleAt(
  participants: ParticipantScreenInfo[],
  x: number,
  y: number,
): { participant: ParticipantScreenInfo; handle: { x: number; y: number } } | null {
  let best: { participant: ParticipantScreenInfo; handle: { x: number; y: number }; d: number } | null = null;
  for (const p of participants) {
    const handle = sequenceConnectHandlePos(p);
    const d = Math.hypot(handle.x - x, handle.y - y);
    if (d <= CONNECT_HANDLE_GRAB_RADIUS && (!best || d < best.d)) {
      best = { participant: p, handle, d };
    }
  }
  return best ? { participant: best.participant, handle: best.handle } : null;
}

// The node whose padded box contains (x, y), nearest by center distance
// (null when the cursor is not over any node). Used for flowchart hover,
// connect-handle hit-testing and connect drop targets. Nearest-center wins
// over model order, so overlapping padded boxes stay unambiguous.
export function nearestNodeAtPoint(
  nodes: ParticipantScreenInfo[],
  x: number,
  y: number,
  excludeKey: string | null,
  pad: number,
): ParticipantScreenInfo | null {
  let best: ParticipantScreenInfo | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    if (n.key === excludeKey) continue;
    if (x >= n.left - pad && x <= n.right + pad && y >= n.top - pad && y <= n.bottom + pad) {
      const d = Math.hypot(n.centerX - x, n.centerY - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
  }
  return best;
}

// The connect handle of a node nearest to (x, y) within the grab radius
// (null when the cursor is not on any of the node's four handles). The radius
// shrinks for small nodes so the four handle zones never swallow the body:
// pressing a node's center must always move it, never connect it.
export function nearestNodeHandleAt(
  node: ParticipantScreenInfo,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const radius = Math.min(
    CONNECT_HANDLE_GRAB_RADIUS,
    Math.min(node.right - node.left, node.bottom - node.top) / 2 - 2,
  );
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const h of nodeConnectHandlePositions(node)) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

// Selection map (processed -> raw), plan 4.7: parses both models, rewrites
// the raw model's ids through buildActorRewriteMap, and joins on
// (kind, from, to, label, occurrence). Elements stripped by the transform
// (hidden actors, clean-merge self-calls) have no processed counterpart and
// are simply not selectable.
export function buildSelectionMap(
  rawCode: string,
  processedCode: string,
  config: DiagramConfig | null,
  options: ActorTransformOptions,
): Map<string, ModelElement> {
  const map = new Map<string, ModelElement>();
  const rawModel = parseModel(rawCode);
  const processedModel = parseModel(processedCode);
  if (rawModel.type !== processedModel.type) return map;

  const { rename } = buildActorRewriteMap(config, options, rawCode);
  const rewriteId = (id: string) => rename.get(id) ?? id;

  const signature = (el: ModelElement): string | null => {
    switch (el.kind) {
      case 'participant':
        return `participant|${rewriteId(el.id)}`;
      case 'node':
        return `node|${rewriteId(el.id)}`;
      case 'message':
        return `message|${rewriteId(el.from)}|${rewriteId(el.to)}|${el.label ?? ''}`;
      case 'edge':
        return `edge|${rewriteId(el.from)}|${rewriteId(el.to)}|${el.label ?? ''}`;
      case 'note': {
        // transformActors rewrites "Note over A,A" to "Note over A".
        const seen = new Set<string>();
        const over: string[] = [];
        el.over.map(rewriteId).forEach(id => {
          if (!seen.has(id)) {
            seen.add(id);
            over.push(id);
          }
        });
        return `note|${over.join(',')}|${el.text}`;
      }
      default:
        return null;  // blocks, regions, config are not selectable
    }
  };

  const rawGroups = new Map<string, ModelElement[]>();
  rawModel.elements.forEach(el => {
    const sig = signature(el);
    if (!sig) return;
    const list = rawGroups.get(sig) ?? [];
    list.push(el);
    rawGroups.set(sig, list);
  });

  const processedGroups = new Map<string, ModelElement[]>();
  processedModel.elements.forEach(el => {
    const sig = signature(el);
    if (!sig) return;
    const list = processedGroups.get(sig) ?? [];
    list.push(el);
    processedGroups.set(sig, list);
  });

  processedGroups.forEach((processedList, sig) => {
    const rawList = rawGroups.get(sig);
    if (!rawList) return;
    processedList.forEach((p, i) => {
      const raw = rawList[i];
      if (raw) map.set(p.key, raw);
    });
  });

  return map;
}
