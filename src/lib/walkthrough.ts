import {
  BlockElement,
  DiagramModel,
  EdgeElement,
  MessageElement,
  ModelElement,
  NodeElement,
  NoteElement,
  ParticipantElement,
  parseModel,
} from './model';
import {
  EDGE_HIT_CLASS,
  allMessageLabelElements,
  labelElementForKey,
  svgElementForKey,
  zipModelToSvg,
} from './svgmap';
import { getArrowTags, getNoteTags } from './editor';
import { DiagramConfig } from './views';

export const WALKTHROUGH_MIN_ZOOM = 0.2;
export const WALKTHROUGH_MAX_ZOOM = 8;
export const WALKTHROUGH_DIM_OPACITY = 0.2;
export const WALKTHROUGH_STEP_BOX_COLOR = '#10b981';
export const WALKTHROUGH_STEP_BOX_PADDING = 10;

export interface WalkthroughStep {
  index: number;
  keys: string[];           // element keys newly revealed at this step
  panKey: string;           // element key to center the canvas on
  label?: string;           // bar readout: message label (sequence) or level caption (flowchart)
  revealedKeys: string[];   // element keys at full opacity at this step (cumulative)
  noteKeys: string[];       // 'note:N' keys revealed at this step
  stickyNoteIds: string[];  // sticky notes attached to this step (shared tags)
  dimmedKeys: string[];     // messages/notes/nodes/edges dimmed at this step
}

export interface WalkthroughPlan {
  type: 'sequence' | 'flowchart';
  steps: WalkthroughStep[];
}

export interface FlowchartLevels {
  nodeDepth: Map<string, number>;   // node key -> depth level
  edgeLevel: Map<string, number>;   // edge key -> reveal level
  maxDepth: number;                 // number of steps - 1
  isolated: string[];               // isolated node keys (never dimmed)
}

function ofKind<T extends ModelElement>(model: DiagramModel, kind: string): T[] {
  return model.elements.filter((e) => e.kind === kind) as T[];
}

export function computeFlowchartLevels(model: DiagramModel): FlowchartLevels {
  const nodes = ofKind<NodeElement>(model, 'node');
  const edges = ofKind<EdgeElement>(model, 'edge');
  const blocks = ofKind<BlockElement>(model, 'block');

  const subgraphIds = new Set<string>(
    blocks
      .filter((b) => b.blockType === 'subgraph' && b.title)
      .map((b) => b.title!),
  );

  const nodeById = new Map<string, NodeElement>();
  for (const n of nodes) {
    if (!subgraphIds.has(n.id) && !nodeById.has(n.id)) {
      nodeById.set(n.id, n);
    }
  }

  const resolve = (id: string): NodeElement | null => nodeById.get(id) ?? null;

  // A node is part of the flow graph when at least one edge connects it to
  // another non-subgraph node (or itself). Nodes with no such edges are isolated.
  const incident = (id: string): boolean =>
    edges.some(
      (e) =>
        (e.from === id || e.to === id) &&
        resolve(e.from) !== null &&
        resolve(e.to) !== null,
    );

  const nonSubgraphNodes = nodes.filter((n) => !subgraphIds.has(n.id));
  const graphNodes = nonSubgraphNodes.filter((n) => incident(n.id));
  const isolated = nonSubgraphNodes
    .filter((n) => !incident(n.id))
    .map((n) => n.key);

  const incoming = (u: NodeElement): EdgeElement[] =>
    edges.filter((e) => e.to === u.id && resolve(e.from) !== null);
  const outgoing = (u: NodeElement): EdgeElement[] =>
    edges.filter((e) => e.from === u.id && resolve(e.to) !== null);

  // Pass 1: identify back edges via DFS. Start from entry nodes (no incoming
  // edges) first in source order, then any remaining unvisited nodes (pure cycles)
  // in source order so pure-cycle components unroll from their first source node.
  const state = new Map<string, 0 | 1 | 2>();
  for (const n of graphNodes) state.set(n.key, 0);
  const backEdges = new Set<string>();

  const dfs = (u: NodeElement) => {
    state.set(u.key, 1);
    for (const e of outgoing(u)) {
      const v = resolve(e.to);
      if (!v) continue;
      const st = state.get(v.key) ?? 0;
      if (st === 1) {
        backEdges.add(e.key);
      } else if (st === 0) {
        dfs(v);
      }
    }
    state.set(u.key, 2);
  };

  for (const n of graphNodes) {
    if (incoming(n).length === 0 && state.get(n.key) === 0) {
      dfs(n);
    }
  }
  for (const n of graphNodes) {
    if (state.get(n.key) === 0) {
      dfs(n);
    }
  }

  // Pass 2: longest-path depth over the acyclic skeleton (edges \ backEdges).
  const nodeDepth = new Map<string, number>();
  const visitingDepth = new Set<string>();
  const computeDepth = (u: NodeElement): number => {
    const cached = nodeDepth.get(u.key);
    if (cached !== undefined) return cached;
    if (visitingDepth.has(u.key)) return 0;
    visitingDepth.add(u.key);
    let best = -1;
    for (const e of incoming(u)) {
      if (backEdges.has(e.key)) continue;
      const pred = resolve(e.from);
      if (!pred) continue;
      best = Math.max(best, computeDepth(pred));
    }
    visitingDepth.delete(u.key);
    const d = best + 1;
    nodeDepth.set(u.key, d);
    return d;
  };

  for (const n of graphNodes) {
    computeDepth(n);
  }

  const edgeLevel = new Map<string, number>();
  for (const e of edges) {
    const fromNode = resolve(e.from);
    const toNode = resolve(e.to);
    if (fromNode && toNode) {
      const df = nodeDepth.get(fromNode.key) ?? 0;
      const dt = nodeDepth.get(toNode.key) ?? 0;
      edgeLevel.set(e.key, Math.max(df, dt));
    } else {
      edgeLevel.set(e.key, 0);
    }
  }

  let maxDepth = 0;
  for (const d of nodeDepth.values()) {
    if (d > maxDepth) maxDepth = d;
  }

  return { nodeDepth, edgeLevel, maxDepth, isolated };
}

function buildEffectiveTagsMap(
  code: string,
  model: DiagramModel,
  config: DiagramConfig | null,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const el of model.elements) {
    if (el.kind === 'message' || el.kind === 'edge') {
      const info = getArrowTags(code, config, el.key);
      const tags = new Set<string>([...(info?.keys ?? []), ...(info?.inherited ?? [])]);
      map.set(el.key, tags);
    } else if (el.kind === 'note') {
      const tags = new Set<string>(getNoteTags(code, config, el.key));
      map.set(el.key, tags);
    } else if (el.kind === 'participant' || el.kind === 'node') {
      const tags = new Set<string>(config?.actors?.[el.id]?.keys ?? []);
      map.set(el.key, tags);
    }
  }
  return map;
}

function stickyNotesForRevealedKeys(
  revealedKeys: string[],
  effectiveTags: Map<string, Set<string>>,
  config: DiagramConfig | null,
): string[] {
  const stickyNotes = config?.notes ?? [];
  if (stickyNotes.length === 0) return [];
  const attached: string[] = [];
  for (const note of stickyNotes) {
    if (!note.keys || note.keys.length === 0) continue; // untagged -> attaches to no step (always visible)
    const matches = revealedKeys.some((k) => {
      const elTags = effectiveTags.get(k);
      if (!elTags || elTags.size === 0) return false;
      return note.keys!.some((t) => elTags.has(t));
    });
    if (matches && !attached.includes(note.id)) {
      attached.push(note.id);
    }
  }
  return attached;
}

export function buildWalkthroughPlan(
  code: string,
  config: DiagramConfig | null,
): WalkthroughPlan | null {
  const model = parseModel(code);
  if (model.type !== 'sequence' && model.type !== 'flowchart') {
    return null;
  }

  const effectiveTags = buildEffectiveTagsMap(code, model, config);

  if (model.type === 'sequence') {
    const messages = ofKind<MessageElement>(model, 'message');
    if (messages.length === 0) return null;

    const participants = ofKind<ParticipantElement>(model, 'participant');
    const notes = ofKind<NoteElement>(model, 'note');
    const participantKeys = participants.map((p) => p.key);

    // Map each note to its attached step index (nearest preceding message by line span;
    // notes before the first message -> step 0; trailing notes -> last step).
    const notesByStep = new Map<number, string[]>();
    for (let i = 0; i < messages.length; i++) {
      notesByStep.set(i, []);
    }
    for (const note of notes) {
      let attachedIdx = 0;
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].lineStart <= note.lineStart) {
          attachedIdx = i;
        } else {
          break;
        }
      }
      notesByStep.get(attachedIdx)!.push(note.key);
    }

    const steps: WalkthroughStep[] = messages.map((msg, i) => {
      const revealedMessageKeys = messages.slice(0, i + 1).map((m) => m.key);
      const dimmedMessageKeys = messages.slice(i + 1).map((m) => m.key);

      const revealedNoteKeys: string[] = [];
      const dimmedNoteKeys: string[] = [];
      for (let s = 0; s < messages.length; s++) {
        const stepNotes = notesByStep.get(s) ?? [];
        if (s <= i) {
          revealedNoteKeys.push(...stepNotes);
        } else {
          dimmedNoteKeys.push(...stepNotes);
        }
      }

      const revealedKeys = [
        ...participantKeys,
        ...revealedMessageKeys,
        ...revealedNoteKeys,
      ];
      const dimmedKeys = [...dimmedMessageKeys, ...dimmedNoteKeys];
      const noteKeys = notesByStep.get(i) ?? [];

      return {
        index: i,
        keys: [msg.key],
        panKey: msg.key,
        label: msg.label,
        revealedKeys,
        noteKeys,
        stickyNoteIds: stickyNotesForRevealedKeys(revealedKeys, effectiveTags, config),
        dimmedKeys,
      };
    });

    return { type: 'sequence', steps };
  }

  // Flowchart
  const edges = ofKind<EdgeElement>(model, 'edge');
  if (edges.length === 0) return null;

  const nodes = ofKind<NodeElement>(model, 'node');
  const blocks = ofKind<BlockElement>(model, 'block');
  const subgraphIds = new Set<string>(
    blocks
      .filter((b) => b.blockType === 'subgraph' && b.title)
      .map((b) => b.title!),
  );
  const realNodes = nodes.filter((n) => !subgraphIds.has(n.id));
  const levels = computeFlowchartLevels(model);

  const steps: WalkthroughStep[] = [];
  for (let d = 0; d <= levels.maxDepth; d++) {
    const stepNodes = realNodes.filter((n) => levels.nodeDepth.get(n.key) === d);
    const stepEdges = edges.filter((e) => levels.edgeLevel.get(e.key) === d);

    const revealedNodeKeys = realNodes
      .filter((n) => {
        const nd = levels.nodeDepth.get(n.key);
        return nd !== undefined && nd <= d;
      })
      .map((n) => n.key);
    const revealedEdgeKeys = edges
      .filter((e) => (levels.edgeLevel.get(e.key) ?? 0) <= d)
      .map((e) => e.key);
    const revealedKeys = [
      ...revealedNodeKeys,
      ...revealedEdgeKeys,
      ...levels.isolated,
    ];

    const dimmedNodeKeys = realNodes
      .filter((n) => {
        const nd = levels.nodeDepth.get(n.key);
        return nd !== undefined && nd > d;
      })
      .map((n) => n.key);
    const dimmedEdgeKeys = edges
      .filter((e) => (levels.edgeLevel.get(e.key) ?? 0) > d)
      .map((e) => e.key);
    const dimmedKeys = [...dimmedNodeKeys, ...dimmedEdgeKeys];

    const keys = [
      ...stepNodes.map((n) => n.key),
      ...stepEdges.map((e) => e.key),
    ];
    const panKey = stepNodes[0]?.key ?? stepEdges[0]?.key ?? '';
    const nCount = stepNodes.length;
    const eCount = stepEdges.length;
    const label = `Depth ${d + 1} · ${nCount} ${nCount === 1 ? 'node' : 'nodes'} · ${eCount} ${eCount === 1 ? 'edge' : 'edges'}`;

    steps.push({
      index: d,
      keys,
      panKey,
      label,
      revealedKeys,
      noteKeys: [],
      stickyNoteIds: stickyNotesForRevealedKeys(revealedKeys, effectiveTags, config),
      dimmedKeys,
    });
  }

  return { type: 'flowchart', steps };
}

const OVERLAY_SELECTOR =
  '.arrow-anim-packet-runner, .arrow-x-mark, .arrow-barrier-wall, .arrow-shockwave-burst, .arrow-breaker-cap';

function collectArrowOverlays(el: Element): Element[] {
  const overlays: Element[] = [];
  let sib = el.nextElementSibling;
  while (sib && sib.matches(OVERLAY_SELECTOR)) {
    overlays.push(sib);
    sib = sib.nextElementSibling;
  }
  return overlays;
}

function extractMessageOriginCoords(
  svg: Element,
  el: Element,
  fromId: string,
): { x: number; y: number } | null {
  let y = NaN;
  let x = NaN;
  const tag = el.tagName.toLowerCase();
  if (tag === 'line') {
    y = parseFloat(el.getAttribute('y1') ?? '');
    x = parseFloat(el.getAttribute('x1') ?? '');
  } else if (tag === 'path') {
    const d = el.getAttribute('d');
    if (d) {
      const m = d.match(/(-?[\d.]+)[ ,]+(-?[\d.]+)/);
      if (m) {
        x = parseFloat(m[1]);
        y = parseFloat(m[2]);
      }
    }
  }
  const actorId = el.getAttribute('data-from') || fromId;
  const lifeline = Array.from(svg.querySelectorAll('line.actor-line[data-id]')).find(
    (l) => l.getAttribute('data-id') === actorId,
  );
  if (lifeline) {
    const lx = parseFloat(lifeline.getAttribute('x1') ?? '');
    if (!Number.isNaN(lx)) x = lx;
  }
  if (Number.isNaN(y) || Number.isNaN(x)) return null;
  return { x, y };
}

function findSequenceNumberBadge(
  svg: Element,
  el: Element,
  fromId: string,
): Element | null {
  const origin = extractMessageOriginCoords(svg, el, fromId);
  if (!origin) return null;
  const badges = Array.from(svg.querySelectorAll('text.sequenceNumber'));
  let best: Element | null = null;
  let bestDist = Infinity;
  for (const b of badges) {
    const by = parseFloat(b.getAttribute('y') ?? '');
    const bx = parseFloat(b.getAttribute('x') ?? '');
    if (Number.isNaN(by) || Number.isNaN(bx)) continue;
    if (by >= origin.y && by <= origin.y + 10) {
      const dist = Math.abs(bx - origin.x);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
  }
  return best;
}

function pushUnique(list: Element[], el: Element | null | undefined) {
  if (el && !list.includes(el)) {
    list.push(el);
  }
}

export function dimTargetsForStep(
  svg: Element,
  model: DiagramModel,
  plan: WalkthroughPlan,
  stepIndex: number,
): { dimmed: Element[]; active: Element[]; activeGroups: Element[][] } {
  const dimmed: Element[] = [];
  const active: Element[] = [];
  // Elements that share one personal highlight box: a sequence message with
  // its wrapped label lines is ONE group; each flowchart node is its own
  // group and each edge (path + its label) is its own group, so a level whose
  // elements are spread out (e.g. across subgraphs) gets one box per element
  // instead of a single big rectangle over all of them.
  const activeGroups: Element[][] = [];
  if (plan.steps.length === 0) return { dimmed, active, activeGroups };
  const clampedIdx = Math.max(0, Math.min(stepIndex, plan.steps.length - 1));
  const step = plan.steps[clampedIdx];
  const zip = zipModelToSvg(svg, model);

  if (plan.type === 'sequence') {
    const messages = ofKind<MessageElement>(model, 'message');
    const notes = ofKind<NoteElement>(model, 'note');
    const msgIdxByKey = new Map(messages.map((m, i) => [m.key, i]));
    const noteIdxByKey = new Map(notes.map((n, i) => [n.key, i]));

    for (const key of step.dimmedKeys) {
      if (msgIdxByKey.has(key)) {
        const idx = msgIdxByKey.get(key)!;
        const el = zip.messages[idx];
        if (!el) continue;
        pushUnique(dimmed, el);
        // Include ALL wrapped label lines so the dim/highlight covers the
        // full multi-line text, not just the line nearest the arrow.
        for (const t of allMessageLabelElements(svg, model, key)) {
          pushUnique(dimmed, t);
        }
        pushUnique(dimmed, findSequenceNumberBadge(svg, el, messages[idx].from));
        for (const ov of collectArrowOverlays(el)) {
          pushUnique(dimmed, ov);
        }
      } else if (noteIdxByKey.has(key)) {
        const idx = noteIdxByKey.get(key)!;
        const el = zip.notes[idx];
        pushUnique(dimmed, el);
      }
    }

    for (const key of step.keys) {
      if (msgIdxByKey.has(key)) {
        const idx = msgIdxByKey.get(key)!;
        const el = zip.messages[idx];
        if (!el) continue;
        pushUnique(active, el);
        // Include ALL wrapped label lines, the autonumber sequence badge, and
        // any arrow animation overlays so the green step box encompasses the
        // full message visual without clipping its edges.
        const group: Element[] = [];
        pushUnique(group, el);
        for (const t of allMessageLabelElements(svg, model, key)) {
          pushUnique(group, t);
          pushUnique(active, t);
        }
        const badge = findSequenceNumberBadge(svg, el, messages[idx].from);
        if (badge) {
          pushUnique(group, badge);
          pushUnique(active, badge);
        }
        for (const ov of collectArrowOverlays(el)) {
          pushUnique(group, ov);
          pushUnique(active, ov);
        }
        if (group.length > 0) activeGroups.push(group);
      }
    }

    return { dimmed, active, activeGroups };
  }

  if (plan.type === 'flowchart') {
    const nodes = ofKind<NodeElement>(model, 'node');
    const edges = ofKind<EdgeElement>(model, 'edge');
    const nodeIdxByKey = new Map(nodes.map((n, i) => [n.key, i]));
    const edgeIdxByKey = new Map(edges.map((e, i) => [e.key, i]));

    const findEdgeLabelElements = (dataId: string | null): Element[] => {
      if (!dataId) return [];
      const found: Element[] = [];
      const inner = Array.from(svg.querySelectorAll('g.edgeLabel g.label[data-id]')).find(
        (l) => l.getAttribute('data-id') === dataId,
      );
      if (inner) {
        const outer = inner.closest('g.edgeLabel');
        if (outer) found.push(outer);
        found.push(inner);
      }
      return found;
    };

    for (const key of step.dimmedKeys) {
      if (nodeIdxByKey.has(key)) {
        const idx = nodeIdxByKey.get(key)!;
        pushUnique(dimmed, zip.nodes[idx]);
      } else if (edgeIdxByKey.has(key)) {
        const idx = edgeIdxByKey.get(key)!;
        const path = zip.edges[idx];
        if (!path) continue;
        pushUnique(dimmed, path);
        const dataId = path.getAttribute('data-id');
        for (const lab of findEdgeLabelElements(dataId)) {
          pushUnique(dimmed, lab);
        }
        if (dataId) {
          const hit = Array.from(svg.querySelectorAll(`path.${EDGE_HIT_CLASS}`)).find(
            (p) => p.getAttribute('data-id') === dataId,
          );
          pushUnique(dimmed, hit);
        }
        for (const ov of collectArrowOverlays(path)) {
          pushUnique(dimmed, ov);
        }
      }
    }

    for (const key of step.keys) {
      if (nodeIdxByKey.has(key)) {
        const idx = nodeIdxByKey.get(key)!;
        const el = zip.nodes[idx];
        pushUnique(active, el);
        // Each node of the level gets its own personal highlight box.
        if (el) activeGroups.push([el]);
      } else if (edgeIdxByKey.has(key)) {
        const idx = edgeIdxByKey.get(key)!;
        const path = zip.edges[idx];
        if (!path) continue;
        pushUnique(active, path);
        const dataId = path.getAttribute('data-id');
        // The edge path, its label, and its arrow overlays form the edge's ONE personal box.
        const group: Element[] = [path];
        for (const lab of findEdgeLabelElements(dataId)) {
          pushUnique(group, lab);
          pushUnique(active, lab);
        }
        for (const ov of collectArrowOverlays(path)) {
          pushUnique(group, ov);
          pushUnique(active, ov);
        }
        activeGroups.push(group);
      }
    }

    return { dimmed, active, activeGroups };
  }

  return { dimmed, active, activeGroups };
}

export function panTargetForStep(
  svg: Element,
  model: DiagramModel,
  plan: WalkthroughPlan,
  stepIndex: number,
): Element | null {
  if (plan.steps.length === 0) return null;
  const clampedIdx = Math.max(0, Math.min(stepIndex, plan.steps.length - 1));
  const step = plan.steps[clampedIdx];
  if (!step.panKey) return null;

  if (plan.type === 'sequence') {
    return (
      labelElementForKey(svg, model, step.panKey) ??
      svgElementForKey(svg, model, step.panKey)
    );
  }

  if (plan.type === 'flowchart') {
    return svgElementForKey(svg, model, step.panKey);
  }

  return null;
}

export interface WalkthroughStepBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getElementLocalBounds(
  el: Element,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  // Skip empty flowchart edge labels (Mermaid places empty foreignObjects at 0,0)
  if (el.classList.contains('edgeLabel') || el.closest('g.edgeLabel')) {
    if ((el.textContent ?? '').trim() === '') return null;
  }

  if (el.classList.contains('sequenceNumber')) {
    const bx = parseFloat(el.getAttribute('x') ?? '');
    const by = parseFloat(el.getAttribute('y') ?? '');
    if (!Number.isNaN(bx) && !Number.isNaN(by)) {
      // Mermaid places text.sequenceNumber at (autonumberX, lineY + 4) with
      // text-anchor="middle" over a circular marker of radius ~9px centered
      // at (autonumberX, lineY). SVG getBBox() omits the <marker> circle.
      const cy = by - 4;
      const r = 9;
      return {
        minX: bx - r,
        minY: cy - r,
        maxX: bx + r,
        maxY: cy + r,
      };
    }
  }

  if (el.classList.contains('arrow-x-mark')) {
    return { minX: -9, minY: -9, maxX: 9, maxY: 9 };
  }

  const tag = el.tagName.toLowerCase();
  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx') ?? '');
    const cy = parseFloat(el.getAttribute('cy') ?? '');
    const r = parseFloat(el.getAttribute('r') ?? '');
    if (!Number.isNaN(cx) && !Number.isNaN(cy) && !Number.isNaN(r)) {
      return {
        minX: cx - r,
        minY: cy - r,
        maxX: cx + r,
        maxY: cy + r,
      };
    }
  }

  if (tag === 'line') {
    const x1 = parseFloat(el.getAttribute('x1') ?? '');
    const y1 = parseFloat(el.getAttribute('y1') ?? '');
    const x2 = parseFloat(el.getAttribute('x2') ?? '');
    const y2 = parseFloat(el.getAttribute('y2') ?? '');
    if (!Number.isNaN(x1) && !Number.isNaN(y1) && !Number.isNaN(x2) && !Number.isNaN(y2)) {
      let minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      let maxX = Math.max(x1, x2);
      const maxY = Math.max(y1, y2);
      // Mermaid shortens sequence message <line> endpoints inward from the
      // participant lifelines to leave room for arrowhead markers, activation
      // boxes, and autonumber circles. Extend minX/maxX to the sender/receiver
      // lifelines so the step box padding is measured from the full arrow span.
      if (el.getAttribute('data-et') === 'message') {
        const svg = el.closest('svg');
        if (svg) {
          for (const attr of ['data-from', 'data-to']) {
            const actorId = el.getAttribute(attr);
            if (!actorId) continue;
            const lifeline = Array.from(svg.querySelectorAll('line.actor-line[data-id]')).find(
              (l) => l.getAttribute('data-id') === actorId,
            );
            const lx = parseFloat(lifeline?.getAttribute('x1') ?? '');
            if (!Number.isNaN(lx)) {
              if (lx < minX) minX = lx;
              if (lx > maxX) maxX = lx;
            }
          }
        }
      }
      return { minX, minY, maxX, maxY };
    }
  }

  if (tag === 'path') {
    const d = el.getAttribute('d');
    if (d) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const pairs = Array.from(d.matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g));
      for (const p of pairs) {
        const px = parseFloat(p[1]);
        const py = parseFloat(p[2]);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      for (const h of d.matchAll(/H\s*(-?\d+(?:\.\d+)?)/g)) {
        const hx = parseFloat(h[1]);
        if (hx < minX) minX = hx;
        if (hx > maxX) maxX = hx;
      }
      for (const v of d.matchAll(/V\s*(-?\d+(?:\.\d+)?)/g)) {
        const vy = parseFloat(v[1]);
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
      }
      if (el.getAttribute('data-et') === 'message') {
        const svg = el.closest('svg');
        if (svg) {
          for (const attr of ['data-from', 'data-to']) {
            const actorId = el.getAttribute(attr);
            if (!actorId) continue;
            const lifeline = Array.from(svg.querySelectorAll('line.actor-line[data-id]')).find(
              (l) => l.getAttribute('data-id') === actorId,
            );
            const lx = parseFloat(lifeline?.getAttribute('x1') ?? '');
            if (!Number.isNaN(lx)) {
              if (lx < minX) minX = lx;
              if (lx > maxX) maxX = lx;
            }
          }
        }
      }
      if (Number.isFinite(minX) && Number.isFinite(minY)) {
        return { minX, minY, maxX, maxY };
      }
    }
  }

  const gfx = el as unknown as { getBBox?: () => DOMRect };
  if (typeof gfx.getBBox === 'function') {
    try {
      const b = gfx.getBBox();
      const isJsdomStub = b.x === 0 && b.y === 0 && b.width === 100 && b.height === 20;
      if (!isJsdomStub && (b.width > 0 || b.height > 0)) {
        return {
          minX: b.x,
          minY: b.y,
          maxX: b.x + b.width,
          maxY: b.y + b.height,
        };
      }
      if (el.hasAttribute('x') || el.hasAttribute('y')) {
        const x = parseFloat(el.getAttribute('x') ?? '0') || 0;
        const y = parseFloat(el.getAttribute('y') ?? '0') || 0;
        const w = parseFloat(el.getAttribute('width') ?? '') || b.width || 40;
        const h = parseFloat(el.getAttribute('height') ?? '') || b.height || 20;
        return { minX: x, minY: y, maxX: x + w, maxY: y + h };
      }
      return {
        minX: b.x,
        minY: b.y,
        maxX: b.x + b.width,
        maxY: b.y + b.height,
      };
    } catch {
      // ignore getBBox errors on non-rendered elements
    }
  }

  return null;
}

export function computeActiveStepBounds(
  svg: Element,
  active: Element[],
): WalkthroughStepBounds | null {
  if (active.length === 0) return null;
  const host = svg.querySelector('g.root') ?? svg;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of active) {
    const local = getElementLocalBounds(el);
    if (!local) continue;
    let tx = 0;
    let ty = 0;
    let curr: Element | null = el;
    while (curr && curr !== host && curr !== svg) {
      const t = curr.getAttribute('transform');
      if (t) {
        const m = t.match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
        if (m) {
          tx += parseFloat(m[1]) || 0;
          ty += parseFloat(m[2] ?? '0') || 0;
        }
      }
      curr = curr.parentElement;
    }
    if (local.minX + tx < minX) minX = local.minX + tx;
    if (local.minY + ty < minY) minY = local.minY + ty;
    if (local.maxX + tx > maxX) maxX = local.maxX + tx;
    if (local.maxY + ty > maxY) maxY = local.maxY + ty;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  const pad = WALKTHROUGH_STEP_BOX_PADDING;
  const rawW = maxX - minX;
  const rawH = maxY - minY;
  const width = Math.max(rawW + pad * 2, 24);
  const height = Math.max(rawH + pad * 2, 24);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  };
}

export function renderWalkthroughStepBox(
  svg: Element,
  active: Element[],
): Element | null {
  const bounds = computeActiveStepBounds(svg, active);
  if (!bounds) return null;
  const doc = svg.ownerDocument;
  if (!doc) return null;
  const host = svg.querySelector('g.root') ?? svg;
  const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'walkthrough-step-box');
  rect.setAttribute('data-testid', 'walkthrough-step-box');
  rect.setAttribute('x', String(bounds.x));
  rect.setAttribute('y', String(bounds.y));
  rect.setAttribute('width', String(bounds.width));
  rect.setAttribute('height', String(bounds.height));
  rect.setAttribute('rx', '6');
  rect.setAttribute('ry', '6');
  rect.setAttribute('fill', 'rgba(16, 185, 129, 0.06)');
  rect.setAttribute('stroke', WALKTHROUGH_STEP_BOX_COLOR);
  rect.setAttribute('stroke-width', '2.5');
  rect.setAttribute('stroke-dasharray', '8 6');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  rect.setAttribute('pointer-events', 'none');
  host.appendChild(rect);
  return rect;
}

// Render ONE personal highlight box per active element group (see
// dimTargetsForStep): a sequence message's arrow + wrapped label lines share
// one box, while each flowchart node and each edge (with its label) gets its
// own box — never a single union rectangle over a whole level's spread-out
// elements. Returns the rendered rects (groups with no measurable bounds are
// skipped).
export function renderWalkthroughStepBoxes(
  svg: Element,
  activeGroups: Element[][],
): Element[] {
  const rects: Element[] = [];
  for (const group of activeGroups) {
    const rect = renderWalkthroughStepBox(svg, group);
    if (rect) rects.push(rect);
  }
  return rects;
}
