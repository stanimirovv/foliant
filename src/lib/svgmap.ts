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
//   flowchart cluster    | g.cluster (subgraphs; not a node, not selectable).

import { DiagramModel, ModelElement, ParticipantElement, MessageElement, NoteElement, NodeElement, EdgeElement, parseModel } from './model';
import { ActorTransformOptions, buildActorRewriteMap } from './preprocessor';
import { DiagramConfig } from './views';

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

// Resolves a click target to a model element key (the processed key that
// DiagramViewer reports; ClientPage maps it to the raw element via
// buildSelectionMap). Returns null for anything not selectable.
export function elementKeyAtTarget(target: Element | null, svg: Element, model: DiagramModel): string | null {
  if (!target) return null;
  const zip = zipModelToSvg(svg, model);

  if (model.type === 'sequence') {
    const participants = ofKind<ParticipantElement>(model, 'participant');
    const messages = ofKind<MessageElement>(model, 'message');
    const notes = ofKind<NoteElement>(model, 'note');

    const msg = target.closest('[data-et="message"]');
    if (msg) return keyFromList(messages, zip.messages, msg);

    const text = target.closest('text.messageText');
    if (text) {
      const line = text.nextElementSibling;
      if (line && line.matches('[data-et="message"]')) return keyFromList(messages, zip.messages, line);
      return null;
    }

    const note = target.closest('g[data-et="note"]');
    if (note) return keyFromList(notes, zip.notes, note);

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

  const { rename } = buildActorRewriteMap(config, options);
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
