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
//   sequence block       | alt/opt/loop/par: g[data-et="control-structure"] with
//                        polygon.labelBox + text.labelText (keyword) +
//                        text.loopText (title; may word-wrap into several
//                        text elements). DOM order is post-order (children
//                        before parents; ascending lineEnd).
//                        rect: bare top-level rect.rect[fill] (no label chip).
//                        box: bare top-level g > rect.rect + text.text (title).
//                        rect/box DOM order is descending lineEnd (later blocks
//                        paint first). reorderSequenceLayers buckets all three
//                        shapes as decorations without changing their relative
//                        order, so the pairing holds on raw and styled SVG.
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
//   flowchart cluster    | g.cluster (subgraphs; selectable).

import { DiagramModel, ModelElement, ParticipantElement, MessageElement, NoteElement, BlockElement, NodeElement, EdgeElement, parseModel } from './model';
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
  blocks: (Element | null)[];        // aligned with model block elements (source order)
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

// Block shapes render as three different top-level element kinds (see the
// header): alt/opt/loop/par as g[data-et="control-structure"] in post-order
// (children before parents = ascending lineEnd), rect as bare top-level
// rect.rect and box as bare top-level g > rect.rect + text.text, both in
// descending lineEnd order. reorderSequenceLayers (styling.ts) buckets all
// three as decorations but keeps their relative order, so the pairing holds
// on raw and styled SVG alike. Any count or label mismatch -> nulls + warning
// (never guess).
const CS_BLOCK_TYPES = new Set(['alt', 'opt', 'loop', 'par', 'subgraph']);

// A rendered box group: a bare top-level g whose direct child is a rect.rect
// and which contains no actor/message/note parts (participants declared
// inside a box render as regular top-level actor boxes, not inside it).
function isRenderedBoxGroup(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'g') return false;
  if (el.getAttribute('data-et')) return false;
  if (!el.querySelector(':scope > rect.rect')) return false;
  return !el.querySelector('.actor, .actor-man, .actor-line, [data-et="participant"], [data-et="message"], [data-et="note"]');
}

function zipBlocks(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const blocks = ofKind<BlockElement>(model, 'block');
  const result: (Element | null)[] = blocks.map(() => null);
  if (blocks.length === 0) return result;

  const byBlock = new Map<BlockElement, number>();
  blocks.forEach((b, i) => byBlock.set(b, i));

  // Control-structure blocks pair with g[data-et="control-structure"] groups
  // in document order; the label keyword is cross-checked so an ordering
  // surprise degrades to a warning instead of a wrong selection.
  const csBlocks = blocks
    .filter(b => CS_BLOCK_TYPES.has(b.blockType))
    .sort((a, b) => a.lineEnd - b.lineEnd);
  const csGroups = toArray(svg.querySelectorAll('g[data-et="control-structure"]'));
  if (csGroups.length !== csBlocks.length) {
    warnings.push(`block count mismatch: model ${csBlocks.length} control structures, svg ${csGroups.length}; blocks not selectable`);
  } else {
    let ok = true;
    csBlocks.forEach((b, i) => {
      const kw = csGroups[i].querySelector('text.labelText')?.textContent?.trim();
      if (kw !== b.blockType) ok = false;
    });
    if (!ok) {
      warnings.push('block label mismatch; blocks not selectable');
    } else {
      csBlocks.forEach((b, i) => { result[byBlock.get(b)!] = csGroups[i]; });
    }
  }

  // rect blocks pair with bare top-level rect.rect elements, which paint in
  // descending lineEnd order (later blocks first in the DOM).
  const rectBlocks = blocks
    .filter(b => b.blockType === 'rect')
    .sort((a, b) => b.lineEnd - a.lineEnd);
  const rects = Array.from(svg.children).filter(c => c.tagName.toLowerCase() === 'rect' && c.matches('rect.rect'));
  if (rects.length !== rectBlocks.length) {
    warnings.push(`rect block count mismatch: model ${rectBlocks.length}, svg ${rects.length}; rect blocks not selectable`);
  } else {
    rectBlocks.forEach((b, i) => { result[byBlock.get(b)!] = rects[i]; });
  }

  // box blocks pair with bare top-level box groups, also in descending
  // lineEnd order.
  const boxBlocks = blocks
    .filter(b => b.blockType === 'box')
    .sort((a, b) => b.lineEnd - a.lineEnd);
  const boxGroups = Array.from(svg.children).filter(isRenderedBoxGroup);
  if (boxGroups.length !== boxBlocks.length) {
    warnings.push(`box block count mismatch: model ${boxBlocks.length}, svg ${boxGroups.length}; box blocks not selectable`);
  } else {
    boxBlocks.forEach((b, i) => { result[byBlock.get(b)!] = boxGroups[i]; });
  }

  return result;
}

function parseFlowchartSubgraphHeader(rawTitle: string | undefined): { id: string; title: string } {
  if (!rawTitle) return { id: '', title: '' };
  const trimmed = rawTitle.trim();
  const m = trimmed.match(/^([A-Za-z0-9_-]+)\s*\[["']?([^\]"']*)["']?\]\s*$/);
  if (m) {
    return { id: m[1], title: m[2].trim() || m[1] };
  }
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  return { id: unquoted, title: unquoted };
}

function zipFlowchartBlocks(svg: Element, model: DiagramModel, warnings: string[]): (Element | null)[] {
  const allBlocks = ofKind<BlockElement>(model, 'block');
  const result: (Element | null)[] = allBlocks.map(() => null);
  if (allBlocks.length === 0) return result;

  const clusters = toArray(svg.querySelectorAll('g.cluster'));
  if (clusters.length === 0) return result;

  const usedClusters = new Set<Element>();
  allBlocks.forEach((b, i) => {
    if (b.blockType !== 'subgraph') return;
    const { id: subId, title } = parseFlowchartSubgraphHeader(b.title);
    const matchById = clusters.find(c => {
      if (usedClusters.has(c)) return false;
      const cId = c.getAttribute('id') ?? '';
      return subId !== '' && (cId === subId || cId.endsWith(`-${subId}`));
    });
    if (matchById) {
      result[i] = matchById;
      usedClusters.add(matchById);
      return;
    }

    const matchByLabel = clusters.find(c => {
      if (usedClusters.has(c)) return false;
      const labelText = c.querySelector('.cluster-label, .nodeLabel')?.textContent?.trim() ?? '';
      return title !== '' && labelText === title;
    });
    if (matchByLabel) {
      result[i] = matchByLabel;
      usedClusters.add(matchByLabel);
      return;
    }
  });

  const remainingClusters = clusters.filter(c => !usedClusters.has(c));
  let r = 0;
  allBlocks.forEach((b, i) => {
    if (b.blockType === 'subgraph' && !result[i] && r < remainingClusters.length) {
      result[i] = remainingClusters[r++];
    }
  });

  return result;
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
      blocks: zipBlocks(svg, model, warnings),
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
      blocks: zipFlowchartBlocks(svg, model, warnings),
      nodes: zipNodes(svg, model, warnings),
      edges: zipEdges(svg, model, warnings),
      warnings,
    };
  }
  return { participants: empty, messages: empty, notes: empty, blocks: empty, nodes: empty, edges: empty, warnings };
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

    // Blocks (edge B1): only the label chip of an alt/opt/loop/par frame
    // selects the block — frame-interior clicks fall through to null. rect
    // blocks and box groups render as bare top-level rects/groups (no
    // data-et); the app sets pointer-events:none on rect.rect, so real
    // clicks reach them only through the box group's title text.
    const blocks = ofKind<BlockElement>(model, 'block');
    const control = target.closest('g[data-et="control-structure"]');
    if (control) {
      const key = keyFromList(blocks, zip.blocks, control);
      if (key) {
        const onLabel = target.closest('.labelBox, .labelText, .loopText') !== null;
        const labelBox = control.querySelector('polygon.labelBox');
        const r = labelBox ? labelBox.getBoundingClientRect() : null;
        const inLabel = onLabel || (point != null && r != null
          && point.x >= r.left && point.x <= r.right
          && point.y >= r.top && point.y <= r.bottom);
        if (inLabel) return key;
      }
      return null;
    }
    if (target.matches('rect.rect')) {
      const key = keyFromList(blocks, zip.blocks, target);
      if (key) return key;
      // a box group's inner rect resolves through its parent group
      const parent = target.parentElement;
      if (parent && parent.parentElement === svg) return keyFromList(blocks, zip.blocks, parent);
      return null;
    }
    const boxGroup = target.closest('g');
    if (boxGroup && boxGroup.parentElement === svg && isRenderedBoxGroup(boxGroup)) {
      return keyFromList(blocks, zip.blocks, boxGroup);
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

    const cluster = target.closest('g.cluster');
    if (cluster) {
      const blocks = ofKind<BlockElement>(model, 'block');
      const key = keyFromList(blocks, zip.blocks, cluster);
      if (key) {
        if (target.closest('.cluster-label')) return key;
        const rect = cluster.querySelector(':scope > rect') ?? cluster.querySelector('rect');
        if (rect) {
          if (!point) return key;
          const r = rect.getBoundingClientRect();
          const nearBorder = point.x <= r.left + 12 || point.x >= r.right - 12 ||
                             point.y <= r.top + 32 || point.y >= r.bottom - 12;
          if (nearBorder) return key;
        } else {
          return key;
        }
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
    ['block', zip.blocks],
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

// The SVG element that renders the editable label text for the given model
// element key — sequence participant → the actor-box `text.actor` (top and
// bottom boxes and stick figures all render the same alias), message → the
// `text.messageText` preceding its line, flowchart node → the `span.nodeLabel`,
// edge → the `span.edgeLabel` in the label group carrying the edge's data-id.
// When `target` (the double-click target) sits inside a different visual of the
// same element (e.g. a bottom actor box, or a node's shape rect), that visual's
// own label element wins, so the inline editor opens right where the user
// clicked. Returns null for notes (not inline-editable) and unknown keys.
export function labelElementForKey(
  svg: Element,
  model: DiagramModel,
  key: string,
  target?: Element | null,
): Element | null {
  const zip = zipModelToSvg(svg, model);
  const zippedFor = (kind: string, zipped: (Element | null)[]): Element | null => {
    const list = ofKind(model, kind);
    const i = list.findIndex(e => e.key === key);
    return i >= 0 ? zipped[i] ?? null : null;
  };

  if (model.type === 'sequence') {
    if (ofKind<ParticipantElement>(model, 'participant').some(p => p.key === key)) {
      const actorText = target?.closest('text.actor');
      if (actorText) return actorText;
      const rect = target?.closest('rect.actor');
      const rectText = rect?.parentElement?.querySelector('text.actor');
      if (rectText) return rectText;
      const manText = target?.closest('g.actor-man')?.querySelector('text.actor');
      if (manText) return manText;
      return zippedFor('participant', zip.participants)?.querySelector('text.actor') ?? null;
    }
    const line = zippedFor('message', zip.messages);
    if (line) {
      const own = target?.closest('text.messageText');
      if (own) return own;
      const parent = line.parentElement;
      if (parent) {
        const text = toArray(parent.querySelectorAll('text.messageText'))
          .find(t => t.nextElementSibling === line);
        if (text) return text;
      }
    }
    return null;
  }

  if (model.type === 'flowchart') {
    if (ofKind<NodeElement>(model, 'node').some(n => n.key === key)) {
      const holder = target?.closest('g.node') ?? zippedFor('node', zip.nodes);
      return holder?.querySelector('g.label span.nodeLabel')
        ?? holder?.querySelector('span.nodeLabel')
        ?? null;
    }
    const edge = zippedFor('edge', zip.edges);
    if (edge && ofKind<EdgeElement>(model, 'edge').some(e => e.key === key)) {
      const ownLabel = target?.closest('g.edgeLabel');
      if (ownLabel) {
        return ownLabel.querySelector('span.edgeLabel') ?? ownLabel.querySelector('g.label') ?? ownLabel;
      }
      const dataId = edge.getAttribute('data-id');
      if (!dataId) return null;
      const label = toArray(svg.querySelectorAll('g.edgeLabel g.label[data-id]'))
        .find(l => l.getAttribute('data-id') === dataId);
      return label?.querySelector('span.edgeLabel') ?? label ?? null;
    }
    return null;
  }

  return null;
}

// All `text.messageText` elements that render a sequence message's label.
// Mermaid wraps long labels into multiple consecutive text.messageText
// siblings placed before the message line; labelElementForKey returns only
// the one immediately preceding the line. This walks backwards from the line
// collecting every consecutive text.messageText sibling, so callers that
// need the full label extent (e.g. the walkthrough step box) include all
// wrapped lines. Returns an empty array for non-message keys.
export function allMessageLabelElements(
  svg: Element,
  model: DiagramModel,
  key: string,
): Element[] {
  if (model.type !== 'sequence') return [];
  const zip = zipModelToSvg(svg, model);
  const messages = ofKind<MessageElement>(model, 'message');
  const i = messages.findIndex(m => m.key === key);
  if (i < 0) return [];
  const line = zip.messages[i];
  if (!line) return [];
  const result: Element[] = [];
  let sib = line.previousElementSibling;
  while (sib && sib.matches('text.messageText')) {
    result.unshift(sib);
    sib = sib.previousElementSibling;
  }
  return result;
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
  // Bottom actor box vertical extent (sequence diagrams only; null for
  // flowchart nodes and participants without a bottom actor box).
  bottomTop: number | null;
  bottomBottom: number | null;
}

// Screen rects of all participants, in model (source) order. The rendered
// left-to-right order matches source order for sequence diagrams. Also
// captures the bottom actor box (rect.actor-bottom / g.actor-man) so the
// connect handle can appear just above it.
export function getParticipantScreenInfo(svg: Element, model: DiagramModel): ParticipantScreenInfo[] {
  const zip = zipModelToSvg(svg, model);
  const participants = ofKind<ParticipantElement>(model, 'participant');
  // Bottom actors are matched by the `name` attribute (= participant id).
  const bottomById = new Map<string, Element>();
  svg.querySelectorAll('rect.actor-bottom[name], g.actor-man[name]').forEach(el => {
    const name = el.getAttribute('name');
    if (name && !bottomById.has(name)) bottomById.set(name, el);
  });
  const result: ParticipantScreenInfo[] = [];
  participants.forEach((p, i) => {
    const el = zip.participants[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bottomEl = bottomById.get(p.id);
    const bottomRect = bottomEl?.getBoundingClientRect();
    result.push({
      key: p.key,
      id: p.id,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      bottomTop: bottomRect ? bottomRect.top : null,
      bottomBottom: bottomRect ? bottomRect.bottom : null,
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
      bottomTop: null,
      bottomBottom: null,
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

export interface EdgeEndpointScreenInfo {
  key: string;
  fromX: number; fromY: number;  // screen point of the tail (at the 'from' node boundary)
  toX: number; toY: number;      // screen point of the arrow head (at the 'to' node boundary)
}

// The first and last points of an SVG path's `d` attribute, in the path's local
// coordinates. Mermaid 12.1 flowchart edges are single-subpath paths built
// from absolute M/L/Q commands (observed in real render output), but the
// parser handles the full command set (relative forms, H/V, C/S/T, Z) so a
// future mermaid change degrades to a wrong point, never a crash. Returns
// null for an empty or unparseable path.
function pathEndPoints(d: string): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let first: { x: number; y: number } | null = null;
  let last: { x: number; y: number } | null = null;
  let cmd = '';
  const num = (): number | null => {
    const t = tokens[i];
    if (t === undefined || /[A-Za-z]/.test(t)) return null;
    i++;
    return parseFloat(t);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
    }
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === 'M') {
      const x = num();
      const y = num();
      if (x === null || y === null) return last && first ? { from: first, to: last } : null;
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      if (!first) first = { x: cx, y: cy };
      // A moveto starts a new subpath (its implicit continuation is a lineto).
      startX = cx;
      startY = cy;
      last = { x: cx, y: cy };
      cmd = rel ? 'l' : 'L';
    } else if (c === 'L') {
      const x = num();
      const y = num();
      if (x === null || y === null) return first && last ? { from: first, to: last } : null;
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      last = { x: cx, y: cy };
    } else if (c === 'H') {
      const x = num();
      if (x === null) return first && last ? { from: first, to: last } : null;
      cx = rel ? cx + x : x;
      last = { x: cx, y: cy };
    } else if (c === 'V') {
      const y = num();
      if (y === null) return first && last ? { from: first, to: last } : null;
      cy = rel ? cy + y : y;
      last = { x: cx, y: cy };
    } else if (c === 'C' || c === 'S' || c === 'Q' || c === 'T') {
      // Consume the command's coordinate pairs; only the final point matters.
      const pairs = c === 'C' ? 3 : c === 'S' || c === 'Q' ? 2 : 1;
      let x: number | null = null;
      let y: number | null = null;
      for (let p = 0; p < pairs; p++) {
        x = num();
        y = num();
        if (x === null || y === null) return first && last ? { from: first, to: last } : null;
      }
      cx = rel ? cx + x! : x!;
      cy = rel ? cy + y! : y!;
      last = { x: cx, y: cy };
    } else if (c === 'Z') {
      cx = startX;
      cy = startY;
      last = { x: cx, y: cy };
    } else {
      return null; // unknown command
    }
  }
  return first && last ? { from: first, to: last } : null;
}

// Screen points of each flowchart edge's two endpoints. The edge path runs
// from the origin node's boundary (tail) to the target node's boundary
// (head, where the arrowhead marker sits), so the path's first/last points
// are the endpoint positions; they are mapped to viewport coordinates through
// the path's screen CTM (which already includes the pan/zoom transform).
// Edges whose path or CTM is missing are skipped (soft-fail).
export function getEdgeEndpointScreenInfo(svg: Element, model: DiagramModel): EdgeEndpointScreenInfo[] {
  const zip = zipModelToSvg(svg, model);
  const edges = ofKind<EdgeElement>(model, 'edge');
  const result: EdgeEndpointScreenInfo[] = [];
  edges.forEach((e, i) => {
    const el = zip.edges[i];
    if (!el) return;
    const d = el.getAttribute('d');
    if (!d) return;
    const pts = pathEndPoints(d);
    if (!pts) return;
    const ctm = (el as unknown as SVGGraphicsElement).getScreenCTM?.();
    if (!ctm) return;
    const toScreen = (p: { x: number; y: number }) => ({
      x: ctm.a * p.x + ctm.c * p.y + ctm.e,
      y: ctm.b * p.x + ctm.d * p.y + ctm.f,
    });
    const from = toScreen(pts.from);
    const to = toScreen(pts.to);
    result.push({ key: e.key, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
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

// The bottom connect handle of a participant: a fixed point on the lifeline,
// just above the bottom actor box. Allows creating a message by dragging from
// the bottom of the diagram (the top handle is the original affordance).
// Returns null when the participant has no bottom actor box.
export function sequenceBottomConnectHandlePos(p: ParticipantScreenInfo): { x: number; y: number } | null {
  if (p.bottomTop == null) return null;
  return { x: p.centerX, y: p.bottomTop - SEQ_CONNECT_HANDLE_OFFSET };
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
// radius (null when the cursor is not on any handle). Checks both the top
// handle (below the top actor box) and the bottom handle (above the bottom
// actor box); `handleType` tells the caller which one was hit.
export function nearestConnectHandleAt(
  participants: ParticipantScreenInfo[],
  x: number,
  y: number,
): { participant: ParticipantScreenInfo; handle: { x: number; y: number }; handleType: 'top' | 'bottom' } | null {
  let best: { participant: ParticipantScreenInfo; handle: { x: number; y: number }; handleType: 'top' | 'bottom'; d: number } | null = null;
  for (const p of participants) {
    const topHandle = sequenceConnectHandlePos(p);
    const topD = Math.hypot(topHandle.x - x, topHandle.y - y);
    if (topD <= CONNECT_HANDLE_GRAB_RADIUS && (!best || topD < best.d)) {
      best = { participant: p, handle: topHandle, handleType: 'top', d: topD };
    }
    const bottomHandle = sequenceBottomConnectHandlePos(p);
    if (bottomHandle) {
      const botD = Math.hypot(bottomHandle.x - x, bottomHandle.y - y);
      if (botD <= CONNECT_HANDLE_GRAB_RADIUS && (!best || botD < best.d)) {
        best = { participant: p, handle: bottomHandle, handleType: 'bottom', d: botD };
      }
    }
  }
  return best ? { participant: best.participant, handle: best.handle, handleType: best.handleType } : null;
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

// --- Flowchart cluster (subgraph) screen helpers ----------------------------
// Mermaid renders flowchart subgraphs as g.cluster elements wrapping their
// member nodes. These helpers map cluster screen rects to model block keys so
// the node drag interaction can be subgraph-aware: only nodes in the same
// scope as the cursor are drop targets, and a drop at the end of a subgraph
// (past its last node) targets that subgraph's block.

export interface ClusterScreenInfo {
  blockKey: string;   // model key of the subgraph block
  left: number;
  top: number;
  right: number;
  bottom: number;
  area: number;       // for innermost selection (smallest area wins)
}

// Screen rects of all flowchart clusters, each mapped to its model block key.
// Mapping: a block's member nodes (first declaration inside the block's line
// span) have screen centers that fall inside the cluster's rect — the cluster
// whose rect contains the most member centers is the block's cluster.
export function getFlowchartClusterInfo(
  svg: Element,
  model: DiagramModel,
  nodes: ParticipantScreenInfo[],
): ClusterScreenInfo[] {
  if (model.type !== 'flowchart') return [];
  const blocks = model.elements.filter(
    e => e.kind === 'block' && e.blockType === 'subgraph'
  ) as BlockElement[];
  if (blocks.length === 0) return [];

  const clusterRects: { left: number; top: number; right: number; bottom: number; area: number }[] = [];
  svg.querySelectorAll('g.cluster').forEach(el => {
    const r = el.getBoundingClientRect();
    clusterRects.push({
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      area: r.width * r.height,
    });
  });
  if (clusterRects.length === 0) return [];

  const nodeEls = new Map(nodes.map(n => [n.key, n]));
  const result: ClusterScreenInfo[] = [];
  for (const block of blocks) {
    // Member nodes: first declaration line inside the block's span.
    const memberKeys = new Set<string>();
    for (const e of model.elements) {
      if (e.kind === 'node' && e.lineStart > block.lineStart && e.lineStart <= block.lineEnd) {
        memberKeys.add(e.key);
      }
    }
    if (memberKeys.size === 0) continue;
    // Score each cluster rect by how many member centers it contains.
    let bestRect: typeof clusterRects[number] | null = null;
    let bestScore = 0;
    for (const rect of clusterRects) {
      let score = 0;
      for (const [key, n] of nodeEls) {
        if (!memberKeys.has(key)) continue;
        if (n.centerX >= rect.left && n.centerX <= rect.right &&
            n.centerY >= rect.top && n.centerY <= rect.bottom) {
          score++;
        }
      }
      if (score > bestScore) { bestScore = score; bestRect = rect; }
    }
    if (bestRect && bestScore > 0) {
      result.push({ blockKey: block.key, ...bestRect });
    }
  }
  return result;
}

// The innermost (smallest-area) cluster whose rect contains (x, y).
// Null when the point is outside every cluster (top-level scope).
export function innermostClusterAtPoint(
  clusters: ClusterScreenInfo[],
  x: number,
  y: number,
): ClusterScreenInfo | null {
  let best: ClusterScreenInfo | null = null;
  for (const c of clusters) {
    if (x >= c.left && x <= c.right && y >= c.top && y <= c.bottom) {
      if (!best || c.area < best.area) best = c;
    }
  }
  return best;
}

// True when the node's center falls inside the given cluster rect.
export function nodeCenterInCluster(
  node: ParticipantScreenInfo,
  cluster: { left: number; top: number; right: number; bottom: number },
): boolean {
  return node.centerX >= cluster.left && node.centerX <= cluster.right &&
         node.centerY >= cluster.top && node.centerY <= cluster.bottom;
}

// True when the node's center falls inside ANY cluster rect (i.e. the node is
// inside a subgraph, not at top level).
export function nodeInAnyCluster(
  node: ParticipantScreenInfo,
  clusters: { left: number; top: number; right: number; bottom: number }[],
): boolean {
  return clusters.some(c => nodeCenterInCluster(node, c));
}

// --- Subgraph scope-change drag aid ------------------------------------------
// While a flowchart node is dragged, the drop's scope (which subgraph, or top
// level) is the scope under the cursor — the node-drag interaction restricts
// drop targets to the cursor's scope. When that scope differs from the dragged
// node's current scope, releasing the drag moves the node into/out of a
// subgraph: a relocation the dashed insertion indicator alone does not reveal
// (it looks identical to an in-scope reorder). This helper compares the two
// scopes and returns the visual aid data for the drag overlay: a dashed
// outline on the cluster being left, a highlight on the cluster being
// entered, and a cursor badge naming the destination. Null when the drop
// keeps the node in its current scope (no aid needed).

export interface ScopeChangeAid {
  // Rect of the subgraph cluster the node is leaving (null when the node is
  // currently at top level).
  leaveRect: { left: number; top: number; width: number; height: number } | null;
  // Rect of the subgraph cluster the node would enter (null when the drop
  // targets top level).
  enterRect: { left: number; top: number; width: number; height: number } | null;
  // Badge text naming the destination scope.
  badgeText: string;
  // Badge pill geometry: estimated width and screen position (the badge
  // follows the cursor with a small offset, clamped to the viewport).
  badgeWidth: number;
  badgeX: number;
  badgeY: number;
}

const SCOPE_BADGE_OFFSET_X = 16;
const SCOPE_BADGE_OFFSET_Y = 22;
const SCOPE_BADGE_CHAR_WIDTH = 7;   // ~12px semibold sans, mixed case
const SCOPE_BADGE_PAD_X = 20;
const SCOPE_BADGE_HEIGHT = 22;

export function computeScopeChangeAid(
  clusters: ClusterScreenInfo[],
  source: ParticipantScreenInfo,
  cursorX: number,
  cursorY: number,
  blockTitle: (blockKey: string) => string | null,
): ScopeChangeAid | null {
  if (clusters.length === 0) return null;
  const sourceCluster = innermostClusterAtPoint(clusters, source.centerX, source.centerY);
  const targetCluster = innermostClusterAtPoint(clusters, cursorX, cursorY);
  if ((sourceCluster?.blockKey ?? null) === (targetCluster?.blockKey ?? null)) return null;

  const toRect = (c: ClusterScreenInfo) => ({
    left: c.left, top: c.top, width: c.right - c.left, height: c.bottom - c.top,
  });
  const enterTitle = targetCluster ? blockTitle(targetCluster.blockKey) : null;
  const badgeText = targetCluster
    ? `Move into subgraph${enterTitle ? ` "${enterTitle}"` : ''}`
    : 'Move to top level';
  const badgeWidth = badgeText.length * SCOPE_BADGE_CHAR_WIDTH + SCOPE_BADGE_PAD_X;
  const maxX = typeof window !== 'undefined' ? window.innerWidth : Infinity;
  const maxY = typeof window !== 'undefined' ? window.innerHeight : Infinity;
  const badgeX = Math.min(Math.max(cursorX + SCOPE_BADGE_OFFSET_X, 4), Math.max(4, maxX - badgeWidth - 8));
  const badgeY = Math.min(Math.max(cursorY + SCOPE_BADGE_OFFSET_Y, 4), Math.max(4, maxY - SCOPE_BADGE_HEIGHT - 8));
  return {
    leaveRect: sourceCluster ? toRect(sourceCluster) : null,
    enterRect: targetCluster ? toRect(targetCluster) : null,
    badgeText,
    badgeWidth,
    badgeX,
    badgeY,
  };
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
        // transformActors rewrites "Note over A,A" to "Note over A". The
        // placement keyword is part of the signature so an `over` note and a
        // `left of` note over the same actor never cross-match.
        const seen = new Set<string>();
        const over: string[] = [];
        el.over.map(rewriteId).forEach(id => {
          if (!seen.has(id)) {
            seen.add(id);
            over.push(id);
          }
        });
        return `note|${el.placement}|${over.join(',')}|${el.text}`;
      }
      case 'block':
        // Blocks match on (type, title). Grouped order matching tolerates
        // processed-only boxes (generated by transformActors) and blocks
        // stripped from processed code (hidden regions, empty-block
        // cleanup) — they simply have no processed counterpart.
        return `block|${el.blockType}|${el.title ?? ''}`;
      default:
        return null;  // regions, config are not selectable
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

export interface RectArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  pad = 2
): boolean {
  return (
    a.left <= b.right + pad &&
    a.right >= b.left - pad &&
    a.top <= b.bottom + pad &&
    a.bottom >= b.top - pad
  );
}

// Find all model elements and sticky notes intersecting a screen bounding box (marquee area).
export function findElementsInRect(
  svg: Element,
  model: DiagramModel,
  rect: RectArea,
  stickyNotes?: { id: string }[]
): string[] {
  const result = new Set<string>();
  const zip = zipModelToSvg(svg, model);
  const escapeSelector = (id: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id);

  if (model.type === 'sequence') {
    const participants = ofKind<ParticipantElement>(model, 'participant');
    participants.forEach((p, i) => {
      const g = zip.participants[i];
      if (g) {
        const r = g.getBoundingClientRect();
        if (rectsIntersect(rect, r)) {
          result.add(p.key);
          return;
        }
      }
      // Lifelines
      const lines = svg.querySelectorAll(`line.actor-line[data-id="${escapeSelector(p.id)}"], line[data-et="life-line"][data-id="${escapeSelector(p.id)}"]`);
      for (let j = 0; j < lines.length; j++) {
        const lr = lines[j].getBoundingClientRect();
        if (rectsIntersect(rect, lr, 4)) {
          result.add(p.key);
          return;
        }
      }
      // Bottom actor boxes
      const bottom = svg.querySelector(`rect.actor-bottom[name="${escapeSelector(p.id)}"], g.actor-man[name="${escapeSelector(p.id)}"]`);
      if (bottom) {
        const br = bottom.getBoundingClientRect();
        if (rectsIntersect(rect, br)) {
          result.add(p.key);
          return;
        }
      }
    });

    const messages = ofKind<MessageElement>(model, 'message');
    const texts = Array.from(svg.querySelectorAll('text.messageText'));
    messages.forEach((m, i) => {
      const line = zip.messages[i];
      if (line) {
        const r = line.getBoundingClientRect();
        if (rectsIntersect(rect, r, 4)) {
          result.add(m.key);
          return;
        }
      }
      if (texts[i]) {
        const tr = texts[i].getBoundingClientRect();
        if (rectsIntersect(rect, tr)) {
          result.add(m.key);
          return;
        }
      }
    });

    const notes = ofKind<NoteElement>(model, 'note');
    notes.forEach((n, i) => {
      const g = zip.notes[i];
      if (g) {
        const r = g.getBoundingClientRect();
        if (rectsIntersect(rect, r)) {
          result.add(n.key);
        }
      }
    });

    const blocks = ofKind<BlockElement>(model, 'block');
    blocks.forEach((b, i) => {
      const g = zip.blocks[i];
      if (g) {
        const r = g.getBoundingClientRect();
        if (rectsIntersect(rect, r)) {
          result.add(b.key);
        }
      }
    });
  } else if (model.type === 'flowchart') {
    const nodes = ofKind<NodeElement>(model, 'node');
    nodes.forEach((n, i) => {
      const g = zip.nodes[i];
      if (g) {
        const r = g.getBoundingClientRect();
        if (rectsIntersect(rect, r)) {
          result.add(n.key);
        }
      }
    });

    const edges = ofKind<EdgeElement>(model, 'edge');
    edges.forEach((e, i) => {
      const path = zip.edges[i];
      if (path) {
        const r = path.getBoundingClientRect();
        if (rectsIntersect(rect, r, 4)) {
          result.add(e.key);
          return;
        }
      }
      const hit = svg.querySelector(`path.${EDGE_HIT_CLASS}[data-key="${escapeSelector(e.key)}"]`);
      if (hit) {
        const hr = hit.getBoundingClientRect();
        if (rectsIntersect(rect, hr, 4)) {
          result.add(e.key);
          return;
        }
      }
      const label = svg.querySelector(`g.edgeLabel[data-id="${escapeSelector(e.key)}"], g.edgeLabel g.label[data-id="${escapeSelector(e.key)}"]`);
      if (label) {
        const lr = label.getBoundingClientRect();
        if (rectsIntersect(rect, lr)) {
          result.add(e.key);
        }
      }
    });

    const blocks = ofKind<BlockElement>(model, 'block');
    blocks.forEach((b, i) => {
      const g = zip.blocks[i];
      if (g) {
        const r = g.getBoundingClientRect();
        if (rectsIntersect(rect, r)) {
          result.add(b.key);
        }
      }
    });
  }

  // Sticky notes in the diagram container
  const container = svg.closest('#diagram-container') ?? document.getElementById('diagram-container');
  if (container) {
    const cards = container.querySelectorAll('.sticky-note-card');
    cards.forEach(card => {
      const r = card.getBoundingClientRect();
      if (rectsIntersect(rect, r)) {
        const id = card.getAttribute('data-note-id') ??
          card.getAttribute('data-testid')?.replace(/^sticky-note-/, '');
        if (id) {
          result.add(`sticky:${id}`);
        }
      }
    });
  }

  return Array.from(result);
}
