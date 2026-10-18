import { describe, it, expect, vi } from 'vitest';
import { parseModel, DiagramModel, ParticipantElement, MessageElement } from './model';
import { zipModelToSvg, elementKeyAtTarget, buildSelectionMap, flowchartNodeIdOf, nearestMessageKeyAt, labelElementForKey, SvgZip, EDGE_HIT_CLASS } from './svgmap';
import { addEdgeHitPaths } from './styling';
import { transformActors, processMermaid } from './preprocessor';
import { DiagramConfig } from './views';
import { createSequenceDiagram, createFlowchartDiagram, renderPipeline } from './editorTestHarness';
import { SEQ_SVG, SEQ_CODE, FLOW_SVG, FLOW_CODE, parseSvgRoot } from './svgTestFixtures';

function parseSvg(svg: string): Element {
  return parseSvgRoot(svg);
}

function parseOut(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'text/html');
}

const seqModel = (): DiagramModel => parseModel(SEQ_CODE);
const flowModel = (): DiagramModel => parseModel(FLOW_CODE);

describe('zipModelToSvg (sequence fixture)', () => {
  const svg = parseSvg(SEQ_SVG);
  const model = seqModel();
  const zip: SvgZip = zipModelToSvg(svg, model);

  it('zips participants by data-id (DOM order is reversed in real output)', () => {
    expect(zip.participants.map(el => el?.getAttribute('data-id'))).toEqual(['A', 'B', 'C']);
    expect(zip.warnings).toEqual([]);
  });

  it('zips messages in document order (line and self-call path)', () => {
    expect(zip.messages.map(el => el?.getAttribute('data-id'))).toEqual(['i1', 'i2', 'i4', 'i5']);
    expect(zip.messages[2]?.tagName.toLowerCase()).toBe('path');
  });

  it('zips notes', () => {
    expect(zip.notes).toHaveLength(1);
    expect(zip.notes[0]?.getAttribute('data-id')).toBe('i3');
  });

  it('leaves flowchart lists empty for sequence models', () => {
    expect(zip.nodes).toEqual([]);
    expect(zip.edges).toEqual([]);
  });
});

describe('zipModelToSvg (flowchart fixture)', () => {
  const svg = parseSvg(FLOW_SVG);
  const model = flowModel();
  const zip = zipModelToSvg(svg, model);

  it('zips nodes by parsed id (counter is not dense)', () => {
    expect(zip.nodes.map(el => el?.getAttribute('id'))).toEqual([
      'fx-flow-flowchart-A-0',
      'fx-flow-flowchart-B-1',
      'fx-flow-flowchart-C-7',
    ]);
    expect(zip.warnings).toEqual([]);
  });

  it('zips edges in document order', () => {
    expect(zip.edges.map(el => el?.getAttribute('data-id'))).toEqual(['L_A_B_0', 'L_B_C_0']);
  });

  it('parses node ids from rendered group ids', () => {
    expect(flowchartNodeIdOf('fx-flow-flowchart-A-0')).toBe('A');
    expect(flowchartNodeIdOf('render-flowchart-MergedColor_red-12')).toBe('MergedColor_red');
    expect(flowchartNodeIdOf('fx-flow-SG')).toBeNull();
  });
});

describe('zipModelToSvg fallback (plan 4.7 risk 2)', () => {
  it('falls back to label-text matching on count mismatch', () => {
    const svg = parseSvg(SEQ_SVG);
    // model claims one message more than the SVG has
    const model = parseModel(SEQ_CODE + '\n    C->>A: m5');
    const zip = zipModelToSvg(svg, model);
    expect(zip.warnings.length).toBeGreaterThan(0);
    // labeled messages still resolve via their messageText sibling
    expect(zip.messages[0]?.getAttribute('data-id')).toBe('i1');
    expect(zip.messages[1]?.getAttribute('data-id')).toBe('i2');
    expect(zip.messages[3]?.getAttribute('data-id')).toBe('i5');
    // the extra model message gets no element
    expect(zip.messages[4]).toBeNull();
  });

  it('falls back to label matching when endpoints mismatch', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = parseModel(SEQ_CODE.replace('A->>B: m1', 'C->>B: m1'));
    const zip = zipModelToSvg(svg, model);
    expect(zip.warnings.length).toBeGreaterThan(0);
    expect(zip.messages[0]?.getAttribute('data-id')).toBe('i1');
  });
});

describe('elementKeyAtTarget (sequence fixture)', () => {
  const svg = parseSvg(SEQ_SVG);
  const model = seqModel();
  const key = (selector: string, child?: string) => {
    const el = child ? svg.querySelector(selector)?.querySelector(child) : svg.querySelector(selector);
    return elementKeyAtTarget(el ?? null, svg, model);
  };

  it('resolves message lines and self-call paths', () => {
    expect(key('line[data-id="i1"]')).toBe('m:0');
    expect(key('line[data-id="i2"]')).toBe('m:1');
    expect(key('path[data-id="i4"]')).toBe('m:2');
    expect(key('line[data-id="i5"]')).toBe('m:3');
  });

  it('resolves message label text to the following message line', () => {
    const texts = svg.querySelectorAll('text.messageText');
    expect(elementKeyAtTarget(texts[1], svg, model)).toBe('m:1');
    expect(elementKeyAtTarget(texts[1].querySelector('tspan') ?? texts[1], svg, model)).toBe('m:1');
  });

  it('resolves notes', () => {
    expect(key('g[data-et="note"] rect')).toBe('note:0');
    expect(key('g[data-et="note"] text')).toBe('note:0');
  });

  it('resolves participants from top group, lifeline, bottom box and actor man', () => {
    expect(key('g[data-et="participant"][data-id="C"]')).toBe('p:2');
    expect(key('g[data-et="participant"][data-id="A"] text')).toBe('p:0');
    expect(key('line.actor-line[data-id="B"]')).toBe('p:1');
    expect(key('rect.actor-bottom[name="A"]')).toBe('p:0');
    expect(key('g.actor-man[name="B"] text')).toBe('p:1');
  });

  it('resolves a lifeline click inside a note rect to the note (lifelines paint above notes)', () => {
    const lifeline = svg.querySelector('line.actor-line[data-id="A"]')!;
    const noteRect = svg.querySelector('g[data-et="note"] rect')!;
    // jsdom reports zero-sized rects; give the note rect a real box.
    vi.spyOn(noteRect, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // the click lands on the lifeline but inside the note -> the note wins
    expect(elementKeyAtTarget(lifeline, svg, model, { x: 50, y: 20 })).toBe('note:0');
    // a lifeline click outside the note still resolves to the participant
    expect(elementKeyAtTarget(lifeline, svg, model, { x: 50, y: 200 })).toBe('p:0');
    // without a click point the behavior is unchanged
    expect(elementKeyAtTarget(lifeline, svg, model)).toBe('p:0');
  });

  it('returns null for unselectable targets', () => {
    expect(elementKeyAtTarget(svg, svg, model)).toBeNull();
    expect(elementKeyAtTarget(svg.querySelector('defs'), svg, model)).toBeNull();
    expect(elementKeyAtTarget(null, svg, model)).toBeNull();
  });
});

describe('elementKeyAtTarget (flowchart fixture)', () => {
  const svg = parseSvg(FLOW_SVG);
  const model = flowModel();

  it('resolves nodes (including rhombus polygon and label text)', () => {
    expect(elementKeyAtTarget(svg.querySelector('g.node[id$="-A-0"]'), svg, model)).toBe('n:0');
    expect(elementKeyAtTarget(svg.querySelector('g.node[id$="-C-7"] polygon'), svg, model)).toBe('n:2');
    expect(elementKeyAtTarget(svg.querySelector('g.node[id$="-B-1"] span.nodeLabel'), svg, model)).toBe('n:1');
  });

  it('resolves edges and edge labels (through foreignObject)', () => {
    expect(elementKeyAtTarget(svg.querySelector('path[data-id="L_A_B_0"]'), svg, model)).toBe('e:0');
    expect(elementKeyAtTarget(svg.querySelector('g.edgeLabel div'), svg, model)).toBe('e:1');
    expect(elementKeyAtTarget(svg.querySelector('g.edgeLabel span.edgeLabel p'), svg, model)).toBe('e:1');
  });

  it('resolves the invisible edge hit paths via their data-id', () => {
    const withHits = parseSvg(addEdgeHitPaths(FLOW_SVG));
    const hits = withHits.querySelectorAll(`path.${EDGE_HIT_CLASS}`);
    expect(hits.length).toBe(2);
    expect(elementKeyAtTarget(hits[0], withHits, model)).toBe('e:0');
    expect(elementKeyAtTarget(hits[1], withHits, model)).toBe('e:1');
    // a hit path whose data-id matches no zipped edge resolves to null
    const orphan = withHits.querySelector(`path.${EDGE_HIT_CLASS}`)!.cloneNode() as Element;
    orphan.setAttribute('data-id', 'L_NOPE_NOPE_0');
    withHits.querySelector('g.edgePaths')!.appendChild(orphan);
    expect(elementKeyAtTarget(orphan, withHits, model)).toBeNull();
    // nodes still resolve (nodes are checked before hit paths)
    expect(elementKeyAtTarget(withHits.querySelector('g.node[id$="-A-0"]'), withHits, model)).toBe('n:0');
  });

  it('returns null for clusters and the svg root', () => {
    expect(elementKeyAtTarget(svg.querySelector('g.cluster'), svg, model)).toBeNull();
    expect(elementKeyAtTarget(svg, svg, model)).toBeNull();
  });
});

describe('buildSelectionMap', () => {
  const RAW_SEQ = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    participant D as Dave
    A->>B: internal call
    A->>C: external call
    C->>D: to internal
    A->>A: self call
    Note over A,A: dup note
    A->>B: internal call`;

  const config: DiagramConfig = {
    version: 1,
    actors: {
      A: { color: 'red', keys: ['backend'] },
      B: { color: 'red', keys: ['backend'] },
      C: { color: 'blue' },
      D: { keys: ['internal'] },
    },
  };

  const process = (code: string, cfg: DiagramConfig | null, options: Parameters<typeof transformActors>[2]) =>
    processMermaid(transformActors(code, cfg, options), { isRegionVisible: () => true }).code;

  it('maps processed keys to raw elements through a key merge', () => {
    const options = { mergeByKeys: ['backend'] };
    const processed = process(RAW_SEQ, config, options);
    const map = buildSelectionMap(RAW_SEQ, processed, config, options);
    const processedModel = parseModel(processed);

    // merged participant maps to the first raw actor of the group
    const mergedParticipant = processedModel.elements.find(e => e.kind === 'participant' && (e as ParticipantElement).id === 'MergedKey_backend')!;
    expect(mergedParticipant).toMatchObject({ kind: 'participant', id: 'MergedKey_backend' });
    expect(map.get(mergedParticipant.key)?.key).toBe('p:0');

    // merged internal message maps to the raw A->>B message
    const internal = processedModel.elements.filter(e => e.kind === 'message' && (e as MessageElement).label === 'internal call');
    expect(internal).toHaveLength(2);
    expect(map.get(internal[0].key)?.key).toBe('m:0');
    expect(map.get(internal[1].key)?.key).toBe('m:4');  // occurrence disambiguation

    // external message and C->D message map straight through
    const external = processedModel.elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'external call')!;
    expect(map.get(external.key)?.key).toBe('m:1');
    const toInternal = processedModel.elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'to internal')!;
    expect(map.get(toInternal.key)?.key).toBe('m:2');

    // kept (non-clean) merged self-call is selectable
    const selfCall = processedModel.elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'self call')!;
    expect(map.get(selfCall.key)?.key).toBe('m:3');

    // Note over A,A normalized to Note over MergedKey_backend
    const note = processedModel.elements.find(e => e.kind === 'note')!;
    expect(note).toMatchObject({ kind: 'note', over: ['MergedKey_backend'] });
    expect(map.get(note.key)?.key).toBe('note:0');
  });

  it('excludes clean-merge self-calls and hidden actors (not selectable)', () => {
    const options = { mergeCleanByKeys: ['backend'], hideKeys: ['internal'] };
    const processed = process(RAW_SEQ, config, options);
    const map = buildSelectionMap(RAW_SEQ, processed, config, options);
    const processedModel = parseModel(processed);

    // self call was dropped by the clean merge
    expect(processedModel.elements.some(e => e.kind === 'message' && (e as MessageElement).label === 'self call')).toBe(false);
    // D was hidden: no message to D survives
    expect(processedModel.elements.some(e => e.kind === 'message' && (e as MessageElement).label === 'to internal')).toBe(false);
    // A->B "internal call" becomes a Merged->>Merged self-call: also dropped by the clean merge
    expect(processedModel.elements.some(e => e.kind === 'message' && (e as MessageElement).label === 'internal call')).toBe(false);
    const rawKeys = new Set(Array.from(map.values()).map(e => e.key));
    expect(rawKeys.has('m:2')).toBe(false);  // C->>D references hidden D
    expect(rawKeys.has('m:3')).toBe(false);  // clean self-call
    expect(rawKeys.has('m:0')).toBe(false);  // clean-merged internal call
    expect(rawKeys.has('m:1')).toBe(true);   // external call survives
  });

  it('maps flowchart edges through a merge, occurrence-disambiguated', () => {
    const raw = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A
    A --> A`;
    const options = { mergeByKeys: ['backend'] };
    const processed = process(raw, config, options);
    const map = buildSelectionMap(raw, processed, config, options);
    const processedModel = parseModel(processed);

    const node = processedModel.elements.find(e => e.kind === 'node')!;
    expect(node).toMatchObject({ kind: 'node', id: 'MergedKey_backend' });
    expect(map.get(node.key)?.key).toBe('n:0');

    const edges = processedModel.elements.filter(e => e.kind === 'edge');
    expect(edges).toHaveLength(3);
    expect(map.get(edges[0].key)?.key).toBe('e:0');
    expect(map.get(edges[1].key)?.key).toBe('e:1');
    expect(map.get(edges[2].key)?.key).toBe('e:2');  // self edge, occurrence 1
  });

  it('returns an empty map when diagram types differ', () => {
    const map = buildSelectionMap(RAW_SEQ, 'flowchart TD\n    A --> B', config, {});
    expect(map.size).toBe(0);
  });
});

describe('zip + click against real mermaid renders', () => {
  it('zips a rendered sequence diagram without warnings', async () => {
    const { svg, model } = await renderPipeline(createSequenceDiagram());
    const root = parseSvg(svg);
    const zip = zipModelToSvg(root, model);
    expect(zip.warnings).toEqual([]);
    expect(zip.participants).toHaveLength(2);
    expect(zip.participants.every(el => el !== null)).toBe(true);
    expect(zip.messages).toHaveLength(2);
    expect(zip.messages.every(el => el !== null)).toBe(true);

    // click resolution on the real DOM
    const firstLine = root.querySelector('[data-et="message"]')!;
    expect(elementKeyAtTarget(firstLine, root, model)).toBe('m:0');
    const topGroup = root.querySelector('g[data-et="participant"]')!;
    expect(elementKeyAtTarget(topGroup, root, model)).toMatch(/^p:\d+$/);
    const note = root.querySelector('g[data-et="note"]');
    expect(elementKeyAtTarget(note, root, model)).toBeNull();  // none in this diagram
  });

  it('zips a rendered flowchart without warnings', async () => {
    const { svg, model } = await renderPipeline(createFlowchartDiagram());
    const root = parseSvg(svg);
    const zip = zipModelToSvg(root, model);
    expect(zip.warnings).toEqual([]);
    expect(zip.nodes).toHaveLength(2);
    expect(zip.nodes.every(el => el !== null)).toBe(true);
    expect(zip.edges).toHaveLength(2);
    expect(zip.edges.every(el => el !== null)).toBe(true);

    const edge = root.querySelector('path[data-et="edge"]')!;
    expect(elementKeyAtTarget(edge, root, model)).toBe('e:0');
    const node = root.querySelector('g.node')!;
    expect(elementKeyAtTarget(node, root, model)).toMatch(/^n:\d+$/);
    // edge label click resolves through the foreignObject
    const label = root.querySelector('g.edgeLabel span.edgeLabel');
    if (label) expect(elementKeyAtTarget(label, root, model)).toBe('e:1');
  });

  it('zip output parses as HTML and serializes', async () => {
    const { svg } = await renderPipeline(createSequenceDiagram());
    const doc = parseOut(svg);
    expect(doc.querySelector('svg')).not.toBeNull();
    expect(doc.querySelector('svg')?.getAttribute('viewBox')).toBeTruthy();
  });
});

// --- Screen-coordinate helpers for drag interactions ------------------------

import {
  getParticipantScreenInfo, getNodeScreenInfo, getMessageScreenInfo, getMessageEndpointScreenInfo,
  nearestParticipantAtX,
  sequenceConnectHandlePos, nodeConnectHandlePositions, nearestConnectHandleAt,
  nearestNodeAtPoint, nearestNodeHandleAt,
  SEQ_CONNECT_HANDLE_OFFSET, CONNECT_HANDLE_GRAB_RADIUS, NODE_HOVER_PAD, NODE_DROP_PAD,
  ParticipantScreenInfo,
} from './svgmap';

function mockRect(el: Element, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({
    left, top, width, height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
}

describe('getParticipantScreenInfo', () => {
  it('returns screen rects in model (source) order with mocked getBoundingClientRect', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    // Mock rects: A at x=0, B at x=150, C at x=300 (left-to-right = source order)
    const groups = svg.querySelectorAll('g[data-et="participant"]');
    const byId = new Map<string, Element>();
    groups.forEach(g => { const id = g.getAttribute('data-id'); if (id) byId.set(id, g); });
    mockRect(byId.get('A')!, 0, 10, 100, 40);
    mockRect(byId.get('B')!, 150, 10, 100, 40);
    mockRect(byId.get('C')!, 300, 10, 100, 40);

    const info = getParticipantScreenInfo(svg, model);
    expect(info).toHaveLength(3);
    expect(info.map(p => p.id)).toEqual(['A', 'B', 'C']);
    expect(info.map(p => p.key)).toEqual(['p:0', 'p:1', 'p:2']);
    expect(info[0]).toMatchObject({ left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 });
    expect(info[1]).toMatchObject({ left: 150, right: 250, centerX: 200 });
    expect(info[2]).toMatchObject({ left: 300, right: 400, centerX: 350 });
  });

  it('skips participants with no SVG counterpart', () => {
    const svg = parseSvg(SEQ_SVG);
    // Model claims a 4th participant the SVG doesn't have
    const model = parseModel(SEQ_CODE + '\n    participant D');
    const groups = svg.querySelectorAll('g[data-et="participant"]');
    const byId = new Map<string, Element>();
    groups.forEach(g => { const id = g.getAttribute('data-id'); if (id) byId.set(id, g); });
    mockRect(byId.get('A')!, 0, 10, 100, 40);
    mockRect(byId.get('B')!, 150, 10, 100, 40);
    mockRect(byId.get('C')!, 300, 10, 100, 40);
    const info = getParticipantScreenInfo(svg, model);
    expect(info).toHaveLength(3); // D has no SVG element, skipped
    expect(info.map(p => p.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('getNodeScreenInfo', () => {
  const mockFlowRects = (svg: Element) => {
    const byId = new Map<string, Element>();
    svg.querySelectorAll('g.node[id]').forEach(g => {
      const id = g.getAttribute('id') ?? '';
      const m = id.match(/-flowchart-(.+)-\d+$/);
      if (m) byId.set(m[1], g);
    });
    mockRect(byId.get('A')!, 0, 10, 100, 40);
    mockRect(byId.get('B')!, 150, 10, 100, 40);
    mockRect(byId.get('C')!, 300, 10, 100, 40);
  };

  it('returns screen rects of flowchart nodes in model (source) order', () => {
    const svg = parseSvg(FLOW_SVG);
    mockFlowRects(svg);
    const info = getNodeScreenInfo(svg, flowModel());
    expect(info).toHaveLength(3);
    expect(info.map(n => n.id)).toEqual(['A', 'B', 'C']);
    expect(info.map(n => n.key)).toEqual(['n:0', 'n:1', 'n:2']);
    expect(info[0]).toMatchObject({ left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 });
    expect(info[1]).toMatchObject({ left: 150, right: 250, centerX: 200 });
    expect(info[2]).toMatchObject({ left: 300, right: 400, centerX: 350 });
  });

  it('skips nodes with no SVG counterpart', () => {
    const svg = parseSvg(FLOW_SVG);
    mockFlowRects(svg);
    // Model claims a 4th node the SVG doesn't have
    const model = parseModel(FLOW_CODE + '\n    D[Extra]');
    const info = getNodeScreenInfo(svg, model);
    expect(info).toHaveLength(3); // D has no SVG element, skipped
    expect(info.map(n => n.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('getMessageScreenInfo', () => {
  it('returns screen Y of each message line in model order', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const lines = svg.querySelectorAll('[data-et="message"]');
    // Mock: 4 messages at Y = 100, 150, 200, 250 (height 2 each)
    const ys = [100, 150, 200, 250];
    lines.forEach((el, i) => mockRect(el, 0, ys[i], 200, 2));

    const info = getMessageScreenInfo(svg, model);
    expect(info).toHaveLength(4);
    expect(info.map(m => m.key)).toEqual(['m:0', 'm:1', 'm:2', 'm:3']);
    // Y is the vertical center: top + height/2
    expect(info.map(m => m.y)).toEqual([101, 151, 201, 251]);
  });
});

describe('getMessageEndpointScreenInfo', () => {
  // Mock the same layout as mockSeqScreenRects: participants A(0), B(150),
  // C(300) at the top; messages at Y=100,150,200,250 (height 2 -> center +1).
  const mockLayout = (svg: Element) => {
    const groups = svg.querySelectorAll('g[data-et="participant"]');
    const byId = new Map<string, Element>();
    groups.forEach(g => { const id = g.getAttribute('data-id'); if (id) byId.set(id, g); });
    mockRect(byId.get('A')!, 0, 10, 100, 40);
    mockRect(byId.get('B')!, 150, 10, 100, 40);
    mockRect(byId.get('C')!, 300, 10, 100, 40);
    const lines = svg.querySelectorAll('[data-et="message"]');
    const ys = [100, 150, 200, 250];
    lines.forEach((el, i) => { if (i < ys.length) mockRect(el, 0, ys[i], 200, 2); });
  };

  it('returns tail/head points on the participants lifelines at the message Y', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    mockLayout(svg);

    const info = getMessageEndpointScreenInfo(svg, model);
    expect(info).toHaveLength(4);
    // m:0 A->B: tail at A's centerX, head at B's centerX
    expect(info[0]).toEqual({ key: 'm:0', fromX: 50, fromY: 101, toX: 200, toY: 101 });
    // m:1 B->A: the head is on the LEFT (A's lifeline)
    expect(info[1]).toEqual({ key: 'm:1', fromX: 200, fromY: 151, toX: 50, toY: 151 });
    // m:2 A->A (self-message): both ends on A's lifeline
    expect(info[2]).toEqual({ key: 'm:2', fromX: 50, fromY: 201, toX: 50, toY: 201 });
    // m:3 A->C
    expect(info[3]).toEqual({ key: 'm:3', fromX: 50, fromY: 251, toX: 350, toY: 251 });
  });

  it('skips messages whose endpoints have no SVG counterpart', () => {
    const svg = parseSvg(SEQ_SVG);
    // Model claims a 4th participant and a message to it; the SVG has neither
    const model = parseModel(SEQ_CODE + '\n    participant D\n    A->>D: to missing');
    mockLayout(svg);

    const info = getMessageEndpointScreenInfo(svg, model);
    expect(info.map(m => m.key)).toEqual(['m:0', 'm:1', 'm:2', 'm:3']); // m:4 skipped
  });
});

describe('nearestParticipantAtX', () => {
  const participants: ParticipantScreenInfo[] = [
    { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 },
    { key: 'p:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30 },
    { key: 'p:2', id: 'C', left: 300, right: 400, top: 10, bottom: 50, centerX: 350, centerY: 30 },
  ];

  it('returns the participant whose center is nearest to the given X', () => {
    expect(nearestParticipantAtX(participants, 0)?.id).toBe('A');
    expect(nearestParticipantAtX(participants, 60)?.id).toBe('A');
    expect(nearestParticipantAtX(participants, 120)?.id).toBe('A'); // closer to A(50) than B(200)
    expect(nearestParticipantAtX(participants, 130)?.id).toBe('B'); // closer to B(200)
    expect(nearestParticipantAtX(participants, 500)?.id).toBe('C');
  });

  it('returns null for an empty list', () => {
    expect(nearestParticipantAtX([], 100)).toBeNull();
  });

  it('handles a single participant', () => {
    expect(nearestParticipantAtX([participants[0]], 999)?.id).toBe('A');
  });
});

describe('connect-handle helpers ("handles connect, body moves")', () => {
  // Same geometry as the sequence fixture mocks: boxes at Y=10..50, so the
  // connect handle sits at Y=64 on each lifeline.
  const participants: ParticipantScreenInfo[] = [
    { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 },
    { key: 'p:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30 },
    { key: 'p:2', id: 'C', left: 300, right: 400, top: 10, bottom: 50, centerX: 350, centerY: 30 },
  ];
  const nodes: ParticipantScreenInfo[] = [
    { key: 'n:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 },
    { key: 'n:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30 },
    { key: 'n:2', id: 'C', left: 300, right: 400, top: 10, bottom: 50, centerX: 350, centerY: 30 },
  ];

  describe('sequenceConnectHandlePos', () => {
    it('sits on the lifeline just below the top actor box', () => {
      expect(sequenceConnectHandlePos(participants[0])).toEqual({ x: 50, y: 50 + SEQ_CONNECT_HANDLE_OFFSET });
      expect(sequenceConnectHandlePos(participants[2])).toEqual({ x: 350, y: 50 + SEQ_CONNECT_HANDLE_OFFSET });
    });
  });

  describe('nodeConnectHandlePositions', () => {
    it('returns the four edge midpoints of the node box', () => {
      expect(nodeConnectHandlePositions(nodes[0])).toEqual([
        { x: 50, y: 10 },   // top
        { x: 100, y: 30 },  // right
        { x: 50, y: 50 },   // bottom
        { x: 0, y: 30 },    // left
      ]);
    });
  });

  describe('nearestConnectHandleAt', () => {
    it('finds the handle within the grab radius', () => {
      const hit = nearestConnectHandleAt(participants, 50, 64);
      expect(hit?.participant.key).toBe('p:0');
      expect(hit?.handle).toEqual({ x: 50, y: 64 });
    });

    it('grabs at the edge of the radius', () => {
      expect(nearestConnectHandleAt(participants, 50 + CONNECT_HANDLE_GRAB_RADIUS, 64)?.participant.key).toBe('p:0');
      expect(nearestConnectHandleAt(participants, 50 + CONNECT_HANDLE_GRAB_RADIUS + 1, 64)).toBeNull();
    });

    it('returns null on the lifeline away from the handle', () => {
      // A lifeline press at a message Y must NOT start a message drag.
      expect(nearestConnectHandleAt(participants, 50, 130)).toBeNull();
    });

    it('picks the nearest handle when two handles overlap', () => {
      // Columns only 15px apart: both handles are within the grab radius of
      // X=57 (7px from A's, 8px from B's).
      const close: ParticipantScreenInfo[] = [
        { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 },
        { key: 'p:1', id: 'B', left: 15, right: 115, top: 10, bottom: 50, centerX: 65, centerY: 30 },
      ];
      expect(nearestConnectHandleAt(close, 57, 64)?.participant.key).toBe('p:0');
      expect(nearestConnectHandleAt(close, 58, 64)?.participant.key).toBe('p:1');
    });

    it('returns null for an empty list', () => {
      expect(nearestConnectHandleAt([], 50, 64)).toBeNull();
    });
  });

  describe('nearestNodeAtPoint', () => {
    it('finds the node whose padded box contains the point', () => {
      expect(nearestNodeAtPoint(nodes, 50, 30, null, NODE_HOVER_PAD)?.key).toBe('n:0');
      // just outside the box, inside the pad
      expect(nearestNodeAtPoint(nodes, 105, 30, null, NODE_HOVER_PAD)?.key).toBe('n:0');
      expect(nearestNodeAtPoint(nodes, 111, 30, null, NODE_HOVER_PAD)).toBeNull();
    });

    it('prefers the nearest center when padded boxes overlap', () => {
      // Nodes 10px apart: with pad=20 their padded boxes overlap (A: -20..120,
      // B: 90..230). X=110 is inside both; B's center (160) is nearer than
      // A's (50).
      const overlapping: ParticipantScreenInfo[] = [
        { key: 'n:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30 },
        { key: 'n:1', id: 'B', left: 110, right: 210, top: 10, bottom: 50, centerX: 160, centerY: 30 },
      ];
      expect(nearestNodeAtPoint(overlapping, 110, 30, null, NODE_DROP_PAD)?.key).toBe('n:1');
      // ...and the reverse: X=100 is nearer A's center.
      expect(nearestNodeAtPoint(overlapping, 100, 30, null, NODE_DROP_PAD)?.key).toBe('n:0');
    });

    it('excludes the given key (self-drop cancels)', () => {
      expect(nearestNodeAtPoint(nodes, 50, 30, 'n:0', NODE_DROP_PAD)).toBeNull();
      expect(nearestNodeAtPoint(nodes, 200, 30, 'n:0', NODE_DROP_PAD)?.key).toBe('n:1');
    });

    it('returns null when nothing is near', () => {
      expect(nearestNodeAtPoint(nodes, 500, 300, null, NODE_DROP_PAD)).toBeNull();
    });
  });

  describe('nearestNodeHandleAt', () => {
    it('finds the handle within the grab radius', () => {
      expect(nearestNodeHandleAt(nodes[0], 100, 30)).toEqual({ x: 100, y: 30 }); // right
      expect(nearestNodeHandleAt(nodes[0], 50, 10))?.toEqual({ x: 50, y: 10 });  // top
    });

    it('returns null on the node body away from the edge midpoints', () => {
      expect(nearestNodeHandleAt(nodes[0], 50, 30)).toBeNull(); // center: 20px from top/bottom handles
    });

    it('picks the nearest of the four handles', () => {
      // ~7px from the right handle (100,30), ~47px from the bottom one (50,50).
      expect(nearestNodeHandleAt(nodes[0], 95, 35)).toEqual({ x: 100, y: 30 });
    });

    it('shrinks the grab radius for small nodes so the body stays movable', () => {
      // A 30x20 node (a small rendering): its top/bottom handles sit 10px from
      // the center — exactly the fixed grab radius. The radius shrinks to fit
      // the box, so the center is still a body press (move), never a connect.
      const small: ParticipantScreenInfo = {
        key: 'n:0', id: 'A', left: 0, right: 30, top: 10, bottom: 30, centerX: 15, centerY: 20,
      };
      expect(nearestNodeHandleAt(small, 15, 20)).toBeNull(); // center: 10px from the top/bottom handles
      expect(nearestNodeHandleAt(small, 15, 12))?.toEqual({ x: 15, y: 10 }); // 2px from the top handle
    });
  });
});

describe('nearestMessageKeyAt', () => {
  const endpoints = [
    { key: 'm:1', fromX: 50, fromY: 100, toX: 250, toY: 100 },
    { key: 'm:2', fromX: 250, fromY: 160, toX: 50, toY: 160 },
    { key: 'm:3', fromX: 150, fromY: 220, toX: 150, toY: 220 }, // self-message
  ];

  it('matches a click near the line within vertical threshold', () => {
    expect(nearestMessageKeyAt(endpoints, 100, 105)).toBe('m:1');
    expect(nearestMessageKeyAt(endpoints, 100, 95)).toBe('m:1');
    expect(nearestMessageKeyAt(endpoints, 100, 155)).toBe('m:2');
  });

  it('resolves between endpoints with margin', () => {
    expect(nearestMessageKeyAt(endpoints, 45, 100)).toBe('m:1');
    expect(nearestMessageKeyAt(endpoints, 255, 100)).toBe('m:1');
    // Too far left or right
    expect(nearestMessageKeyAt(endpoints, 20, 100)).toBeNull();
    expect(nearestMessageKeyAt(endpoints, 280, 100)).toBeNull();
  });

  it('handles self-messages with an extended rightward corridor', () => {
    expect(nearestMessageKeyAt(endpoints, 170, 220)).toBe('m:3');
    expect(nearestMessageKeyAt(endpoints, 220, 220)).toBeNull();
  });

  it('returns null when outside the maxVerticalDist', () => {
    expect(nearestMessageKeyAt(endpoints, 100, 120, 14)).toBeNull();
  });
});

describe('arrow decorator selection & complex.mmd arrow selection', () => {
  it('resolves click on arrow-anim-packet-runner to the message key', async () => {
    const { applyArrowStyles } = await import('./styling');
    const model = parseModel(SEQ_CODE);
    const config = {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'm1', animation: 'pulse' as const }],
    };
    const out = applyArrowStyles(SEQ_SVG, model, config);
    const div = document.createElement('div');
    div.innerHTML = out;
    const svgEl = div.querySelector('svg')!;
    const runner = svgEl.querySelector('.arrow-anim-packet-runner')!;
    expect(runner).toBeTruthy();

    const key = elementKeyAtTarget(runner, svgEl, model);
    expect(key).toBe('m:0');
  });

  it('resolves all messages in complex.mmd even when surrounded by area rects', async () => {
    const { readFileSync } = await import('fs');
    const { reorderSequenceLayers } = await import('./styling');
    const code = readFileSync('diagrams/complex.mmd', 'utf8');
    const res = await renderPipeline(code);
    const styledSvg = reorderSequenceLayers(res.svg);
    const div = document.createElement('div');
    div.innerHTML = styledSvg;
    const svgEl = div.querySelector('svg')!;

    // 1. All rect.rect have pointer-events: none
    const areas = svgEl.querySelectorAll('rect.rect');
    expect(areas.length).toBeGreaterThan(0);
    areas.forEach(a => {
      expect(a.getAttribute('pointer-events')).toBe('none');
    });

    // 2. Direct message lines resolve
    const lines = svgEl.querySelectorAll('[data-et="message"]');
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => {
      const key = elementKeyAtTarget(l, svgEl, res.model);
      expect(key).toBeTruthy();
    });

    // 3. Message text labels resolve
    const texts = svgEl.querySelectorAll('text.messageText');
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((t) => {
      const key = elementKeyAtTarget(t, svgEl, res.model);
      expect(key).toBeTruthy();
    });
  });
});


describe('labelElementForKey (inline label editing)', () => {
  it('sequence: participant key resolves to the zipped (top) actor-box text', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const el = labelElementForKey(svg, model, 'p:0');
    expect(el?.matches('text.actor')).toBe(true);
    expect(el?.textContent).toBe('A');
    expect(el?.closest('[data-et="participant"]')?.getAttribute('data-id')).toBe('A');
  });

  it('sequence: a clicked bottom actor box resolves to that box\'s own text', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const bottomRect = svg.querySelector('rect.actor-bottom[name="C"]');
    expect(bottomRect).toBeTruthy();
    const el = labelElementForKey(svg, model, 'p:2', bottomRect ?? undefined);
    expect(el?.matches('text.actor')).toBe(true);
    expect(el?.textContent).toBe('C');
    // the bottom box's text, not the zipped top group's
    expect(el?.closest('[data-et="participant"]')).toBeNull();
    // without a target, the canonical (top box) label is returned
    expect(labelElementForKey(svg, model, 'p:2')?.closest('[data-et="participant"]')).toBeTruthy();
  });

  it('sequence: a clicked stick figure resolves to its own text', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const man = svg.querySelector('g.actor-man[name="B"]');
    expect(man).toBeTruthy();
    const el = labelElementForKey(svg, model, 'p:1', man ?? undefined);
    expect(el?.matches('text.actor')).toBe(true);
    expect(el?.textContent).toBe('B');
  });

  it('sequence: a clicked tspan inside the actor text resolves to that text', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const tspan = svg.querySelector('g[data-et="participant"][data-id="A"] text.actor tspan');
    expect(tspan).toBeTruthy();
    const el = labelElementForKey(svg, model, 'p:0', tspan ?? undefined);
    expect(el?.matches('text.actor')).toBe(true);
    expect(el?.textContent).toBe('A');
  });

  it('sequence: message key resolves to the messageText preceding its line', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const el = labelElementForKey(svg, model, 'm:1');
    expect(el?.matches('text.messageText')).toBe(true);
    expect(el?.textContent).toBe('m2');
    expect(el?.nextElementSibling?.matches('[data-et="message"]')).toBe(true);
  });

  it('sequence: a self-call message (path) resolves to its messageText too', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const el = labelElementForKey(svg, model, 'm:2');
    expect(el?.matches('text.messageText')).toBe(true);
    expect(el?.textContent).toBe('m3');
  });

  it('sequence: clicking the messageText itself returns that same element', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const text = svg.querySelectorAll('text.messageText')[1];
    expect(labelElementForKey(svg, model, 'm:1', text)).toBe(text);
  });

  it('sequence: notes and unknown keys are not inline-editable', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    expect(labelElementForKey(svg, model, 'note:0')).toBeNull();
    expect(labelElementForKey(svg, model, 'nope')).toBeNull();
  });

  it('flowchart: node key resolves to its nodeLabel span', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    const el = labelElementForKey(svg, model, 'n:2');
    expect(el?.matches('span.nodeLabel')).toBe(true);
    expect(el?.textContent).toBe('Charlie');
  });

  it('flowchart: clicking a node shape resolves to that node\'s own label', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    const polygon = svg.querySelector('g.node[id$="-C-7"] polygon');
    expect(polygon).toBeTruthy();
    const el = labelElementForKey(svg, model, 'n:2', polygon ?? undefined);
    expect(el?.matches('span.nodeLabel')).toBe(true);
    expect(el?.textContent).toBe('Charlie');
    expect(el?.closest('g.node')?.getAttribute('id')).toContain('-C-7');
  });

  it('flowchart: edge key resolves to its edgeLabel span via data-id', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    const el = labelElementForKey(svg, model, 'e:1');
    expect(el?.matches('span.edgeLabel')).toBe(true);
    expect(el?.textContent).toBe('Reply');
  });

  it('flowchart: clicking the edge label group resolves to its edgeLabel span', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    const labelG = svg.querySelector('g.edgeLabel');
    expect(labelG).toBeTruthy();
    const el = labelElementForKey(svg, model, 'e:1', labelG ?? undefined);
    expect(el?.matches('span.edgeLabel')).toBe(true);
    expect(el?.textContent).toBe('Reply');
  });

  it('flowchart: an unlabeled edge has no label element', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    expect(labelElementForKey(svg, model, 'e:0')).toBeNull();
  });
});
