import { describe, it, expect } from 'vitest';
import { parseModel, DiagramModel, ParticipantElement, MessageElement } from './model';
import { zipModelToSvg, elementKeyAtTarget, buildSelectionMap, flowchartNodeIdOf, SvgZip } from './svgmap';
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
      A: { color: 'red' },
      B: { color: 'red' },
      C: { color: 'blue' },
      D: { keys: ['internal'] },
    },
  };

  const process = (code: string, cfg: DiagramConfig | null, options: Parameters<typeof transformActors>[2]) =>
    processMermaid(transformActors(code, cfg, options), { isRegionVisible: () => true }).code;

  it('maps processed keys to raw elements through a color merge', () => {
    const options = { mergeByColor: ['red'] };
    const processed = process(RAW_SEQ, config, options);
    const map = buildSelectionMap(RAW_SEQ, processed, config, options);
    const processedModel = parseModel(processed);

    // merged participant maps to the first raw actor of the group
    const mergedParticipant = processedModel.elements.find(e => e.kind === 'participant' && (e as ParticipantElement).id === 'MergedColor_red')!;
    expect(mergedParticipant).toMatchObject({ kind: 'participant', id: 'MergedColor_red' });
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

    // Note over A,A normalized to Note over MergedColor_red
    const note = processedModel.elements.find(e => e.kind === 'note')!;
    expect(note).toMatchObject({ kind: 'note', over: ['MergedColor_red'] });
    expect(map.get(note.key)?.key).toBe('note:0');
  });

  it('excludes clean-merge self-calls and hidden actors (not selectable)', () => {
    const options = { mergeCleanByColor: ['red'], hideKeys: ['internal'] };
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
    const options = { mergeByColor: ['red'] };
    const processed = process(raw, config, options);
    const map = buildSelectionMap(raw, processed, config, options);
    const processedModel = parseModel(processed);

    const node = processedModel.elements.find(e => e.kind === 'node')!;
    expect(node).toMatchObject({ kind: 'node', id: 'MergedColor_red' });
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
  getParticipantScreenInfo, getMessageScreenInfo, nearestParticipantAtX,
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
