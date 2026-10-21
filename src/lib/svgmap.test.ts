import { describe, it, expect, vi } from 'vitest';
import { parseModel, DiagramModel, ParticipantElement, MessageElement } from './model';
import { zipModelToSvg, elementKeyAtTarget, buildSelectionMap, flowchartNodeIdOf, nearestMessageKeyAt, labelElementForKey, allMessageLabelElements, svgElementForKey, SvgZip, EDGE_HIT_CLASS } from './svgmap';
import { addEdgeHitPaths } from './styling';
import { transformActors, processMermaid } from './preprocessor';
import { DiagramConfig } from './views';
import { createSequenceDiagram, createFlowchartDiagram, renderPipeline } from './editorTestHarness';
import { SEQ_SVG, SEQ_CODE, SEQ_AUTONUMBER_SVG, SEQ_AUTONUMBER_CODE, SEQ_WRAPPED_SVG, SEQ_WRAPPED_CODE, FLOW_SVG, FLOW_CODE, parseSvgRoot } from './svgTestFixtures';

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

  it('does not cross-match an `over` note and a `left of` note with the same actor and text', () => {
    const raw = `sequenceDiagram
    participant A
    participant B
    Note over A: same text
    Note left of A: same text`;
    // No merges: processed code is the raw code modulo region/cleanup passes.
    const processed = process(raw, null, {});
    const map = buildSelectionMap(raw, processed, null, {});
    const rawModel = parseModel(raw);
    const processedModel = parseModel(processed);
    const rawOver = rawModel.elements.find(e => e.kind === 'note' && e.placement === 'over')!;
    const rawLeft = rawModel.elements.find(e => e.kind === 'note' && e.placement === 'left of')!;
    const processedOver = processedModel.elements.find(e => e.kind === 'note' && e.placement === 'over')!;
    const processedLeft = processedModel.elements.find(e => e.kind === 'note' && e.placement === 'left of')!;
    expect(map.get(processedOver.key)?.key).toBe(rawOver.key);
    expect(map.get(processedLeft.key)?.key).toBe(rawLeft.key);
  });

  it('maps blocks raw<->processed by (type, title), duplicates in order', () => {
    const raw = `sequenceDiagram
    participant A
    participant B
    alt first
        A->>B: m1
    end
    alt first
        A->>B: m2
    end
    loop solo
        A->>B: m3
    end`;
    const processed = process(raw, null, {});
    const map = buildSelectionMap(raw, processed, null, {});
    const rawModel = parseModel(raw);
    const processedModel = parseModel(processed);
    const rawBlocks = rawModel.elements.filter(e => e.kind === 'block');
    const processedBlocks = processedModel.elements.filter(e => e.kind === 'block');
    expect(processedBlocks.map(b => b.key)).toEqual(['b:0', 'b:1', 'b:2']);
    processedBlocks.forEach((b, i) => {
      expect(map.get(b.key)?.key).toBe(rawBlocks[i].key);
    });
    // distinct titles never cross-match
    const altSig = map.get('b:0')!;
    expect(altSig).toMatchObject({ kind: 'block', blockType: 'alt', title: 'first' });
    expect(map.get('b:2')).toMatchObject({ kind: 'block', blockType: 'loop', title: 'solo' });
  });

  it('maps raw box and rect blocks through unchanged processing', () => {
    const raw = `sequenceDiagram
    participant A
    box red BoxOne
        participant B
    end
    rect rgb(1,2,3)
        A->>B: m1
    end`;
    const processed = process(raw, null, {});
    const map = buildSelectionMap(raw, processed, null, {});
    const processedModel = parseModel(processed);
    const box = processedModel.elements.find(e => e.kind === 'block' && e.blockType === 'box')!;
    const rect = processedModel.elements.find(e => e.kind === 'block' && e.blockType === 'rect')!;
    expect(map.get(box.key)?.key).toBe('b:0');
    expect(map.get(rect.key)?.key).toBe('b:1');
  });

  it('tolerates blocks stripped from processed code (hidden region, empty-block cleanup)', () => {
    const raw = `sequenceDiagram
    participant A
    participant B
    %% @region-start: hide
    loop hidden loop
        A->>B: m1
    end
    %% @region-end
    loop visible loop
        A->>B: m2
    end`;
    const processed = processMermaid(raw, { isRegionVisible: () => false }).code;
    const map = buildSelectionMap(raw, processed, null, {});
    const processedModel = parseModel(processed);
    const blocks = processedModel.elements.filter(e => e.kind === 'block');
    expect(blocks).toHaveLength(1);
    // the surviving processed loop maps to the raw loop with the same title
    expect(map.get(blocks[0].key)).toMatchObject({ kind: 'block', blockType: 'loop', title: 'visible loop' });
    expect(map.get(blocks[0].key)?.key).toBe('b:1');
  });

  it('does not map processed-only blocks (generated boxes)', () => {
    const raw = `sequenceDiagram
    participant A
    participant B
    A->>B: m1`;
    // transformActors injects `box #ccc ... Zone` wrappers for merge groups;
    // those boxes have no raw counterpart and stay unselectable.
    const processed = `sequenceDiagram
    box #ccc BACKEND Zone
        participant A
        participant B
    end
    A->>B: m1`;
    const map = buildSelectionMap(raw, processed, null, {});
    const processedModel = parseModel(processed);
    const box = processedModel.elements.find(e => e.kind === 'block')!;
    expect(box).toMatchObject({ kind: 'block', blockType: 'box' });
    expect(map.get(box.key)).toBeUndefined();
    // the message still maps straight through
    const msg = processedModel.elements.find(e => e.kind === 'message')!;
    expect(map.get(msg.key)?.key).toBe('m:0');
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

// --- Sequence blocks: zip + click resolution against real mermaid renders ---

const BLOCK_DEMO = `sequenceDiagram
    participant A
    participant B
    box red BoxOne
        participant C
    end
    A->>B: m0
    alt outer title
        A->>B: m1
        loop inner
            A->>B: m2
        end
    end
    rect rgb(1,2,3)
        A->>B: r1
    end`;

describe('sequence blocks (real mermaid renders)', () => {
  it('zips nested alt/loop, rect and box blocks without warnings, model-aligned', async () => {
    const { svg, model } = await renderPipeline(BLOCK_DEMO);
    const root = parseSvg(svg);
    const zip = zipModelToSvg(root, model);
    expect(zip.warnings).toEqual([]);

    const blocks = model.elements.filter(e => e.kind === 'block');
    expect(blocks.map(b => `${b.blockType}:${b.title}`)).toEqual([
      'box:red BoxOne', 'alt:outer title', 'loop:inner', 'rect:rgb(1,2,3)',
    ]);
    expect(zip.blocks).toHaveLength(4);
    expect(zip.blocks.every(el => el !== null)).toBe(true);

    // box block zips to the bare top-level box group (rect.rect + title text)
    const boxG = zip.blocks[0]!;
    expect(boxG.tagName.toLowerCase()).toBe('g');
    expect(boxG.querySelector(':scope > rect.rect')).not.toBeNull();
    expect(boxG.querySelector('text')?.textContent).toContain('BoxOne');

    // control-structure blocks zip in model (source) order — outer alt before
    // inner loop — even though the DOM is post-order (loop group first)
    const csGroups = root.querySelectorAll('g[data-et="control-structure"]');
    expect(csGroups).toHaveLength(2);
    expect(csGroups[0].querySelector('text.labelText')?.textContent?.trim()).toBe('loop');
    expect(csGroups[1].querySelector('text.labelText')?.textContent?.trim()).toBe('alt');
    expect(zip.blocks[1]).toBe(csGroups[1]);
    expect(zip.blocks[2]).toBe(csGroups[0]);

    // rect block zips to the bare top-level rect.rect
    const rect = zip.blocks[3]!;
    expect(rect.tagName.toLowerCase()).toBe('rect');
    expect(rect.getAttribute('fill')).toBe('rgb(1,2,3)');
    expect(rect.parentElement).toBe(root);
  });

  it('soft-fails control-structure blocks on count or label mismatch (never guesses)', async () => {
    const { svg, model } = await renderPipeline(BLOCK_DEMO);

    // count mismatch: drop one control-structure group from the rendered SVG
    const root1 = parseSvg(svg);
    root1.querySelectorAll('g[data-et="control-structure"]')[1].remove();
    const zip1 = zipModelToSvg(root1, model);
    expect(zip1.warnings.some(w => w.includes('block count mismatch'))).toBe(true);
    expect(zip1.blocks[1]).toBeNull();
    expect(zip1.blocks[2]).toBeNull();
    // the box and rect blocks still zip
    expect(zip1.blocks[0]).not.toBeNull();
    expect(zip1.blocks[3]).not.toBeNull();

    // label mismatch: rename a label keyword
    const root2 = parseSvg(svg);
    root2.querySelector('g[data-et="control-structure"] text.labelText')!.textContent = 'bogus';
    const zip2 = zipModelToSvg(root2, model);
    expect(zip2.warnings.some(w => w.includes('block label mismatch'))).toBe(true);
    expect(zip2.blocks[1]).toBeNull();
    expect(zip2.blocks[2]).toBeNull();
  });

  it('resolves label-chip clicks to the block and frame-interior clicks to null', async () => {
    const { svg, model } = await renderPipeline(BLOCK_DEMO);
    const root = parseSvg(svg);
    const zip = zipModelToSvg(root, model);
    const altGroup = zip.blocks[1]!;
    const loopGroup = zip.blocks[2]!;

    // the label chip: polygon, keyword text and title text all select the block
    expect(elementKeyAtTarget(altGroup.querySelector('polygon.labelBox'), root, model)).toBe('b:1');
    expect(elementKeyAtTarget(altGroup.querySelector('text.labelText'), root, model)).toBe('b:1');
    expect(elementKeyAtTarget(altGroup.querySelector('text.loopText'), root, model)).toBe('b:1');
    // nested: the inner loop's own chip selects the inner block
    expect(elementKeyAtTarget(loopGroup.querySelector('polygon.labelBox'), root, model)).toBe('b:2');

    // the frame interior (loop lines) is not selectable
    const frameLine = altGroup.querySelector('line.loopLine')!;
    expect(elementKeyAtTarget(frameLine, root, model)).toBeNull();

    // ...unless the click point lies inside the label box (the top frame line
    // crosses the chip): then the block wins
    const labelBox = altGroup.querySelector('polygon.labelBox')!;
    vi.spyOn(labelBox, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(elementKeyAtTarget(frameLine, root, model, { x: 50, y: 10 })).toBe('b:1');
    expect(elementKeyAtTarget(frameLine, root, model, { x: 500, y: 500 })).toBeNull();
  });

  it('resolves rect block and box group clicks', async () => {
    const { svg, model } = await renderPipeline(BLOCK_DEMO);
    const root = parseSvg(svg);
    const zip = zipModelToSvg(root, model);

    // rect block: the bare top-level rect (pointer-events:none in the app, so
    // real clicks never target it — synthetic targets still resolve)
    expect(elementKeyAtTarget(zip.blocks[3], root, model)).toBe('b:3');

    // box group: the title text selects it, and so does its inner rect
    const boxG = zip.blocks[0]!;
    expect(elementKeyAtTarget(boxG.querySelector('text'), root, model)).toBe('b:0');
    expect(elementKeyAtTarget(boxG.querySelector('rect'), root, model)).toBe('b:0');
  });

  it('highlights blocks via svgElementForKey', async () => {
    const { svg, model } = await renderPipeline(BLOCK_DEMO);
    const root = parseSvg(svg);
    const zip = zipModelToSvg(root, model);
    expect(svgElementForKey(root, model, 'b:1')).toBe(zip.blocks[1]);
    expect(svgElementForKey(root, model, 'b:3')).toBe(zip.blocks[3]);
    expect(svgElementForKey(root, model, 'b:99')).toBeNull();
  });
});

// --- Screen-coordinate helpers for drag interactions ------------------------

import {
  getParticipantScreenInfo, getNodeScreenInfo, getMessageScreenInfo, getMessageEndpointScreenInfo,
  getEdgeEndpointScreenInfo,
  nearestParticipantAtX,
  sequenceConnectHandlePos, sequenceBottomConnectHandlePos, nodeConnectHandlePositions, nearestConnectHandleAt,
  nearestNodeAtPoint, nearestNodeHandleAt,
  getFlowchartClusterInfo, innermostClusterAtPoint, nodeCenterInCluster, nodeInAnyCluster,
  SEQ_CONNECT_HANDLE_OFFSET, CONNECT_HANDLE_GRAB_RADIUS, NODE_HOVER_PAD, NODE_DROP_PAD,
  ParticipantScreenInfo, ClusterScreenInfo,
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

  it('captures bottom actor box rects (rect.actor-bottom and g.actor-man)', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = seqModel();
    const groups = svg.querySelectorAll('g[data-et="participant"]');
    const byId = new Map<string, Element>();
    groups.forEach(g => { const id = g.getAttribute('data-id'); if (id) byId.set(id, g); });
    mockRect(byId.get('A')!, 0, 10, 100, 40);
    mockRect(byId.get('B')!, 150, 10, 100, 40);
    mockRect(byId.get('C')!, 300, 10, 100, 40);
    // Mock bottom actor rects: A and C are rect.actor-bottom, B is g.actor-man.
    mockRect(svg.querySelector('rect.actor-bottom[name="A"]')!, 0, 326, 100, 50);
    mockRect(svg.querySelector('g.actor-man[name="B"]')!, 150, 320, 100, 56);
    mockRect(svg.querySelector('rect.actor-bottom[name="C"]')!, 300, 326, 100, 50);

    const info = getParticipantScreenInfo(svg, model);
    expect(info[0]).toMatchObject({ id: 'A', bottomTop: 326, bottomBottom: 376 });
    expect(info[1]).toMatchObject({ id: 'B', bottomTop: 320, bottomBottom: 376 });
    expect(info[2]).toMatchObject({ id: 'C', bottomTop: 326, bottomBottom: 376 });
  });

  it('sets bottomTop/bottomBottom to null when no bottom actor exists', () => {
    const svg = parseSvg(SEQ_AUTONUMBER_SVG); // no bottom actors in this fixture
    const model = parseModel(SEQ_AUTONUMBER_CODE);
    const groups = svg.querySelectorAll('g[data-et="participant"]');
    const byId = new Map<string, Element>();
    groups.forEach(g => { const id = g.getAttribute('data-id'); if (id) byId.set(id, g); });
    mockRect(byId.get('A')!, 0, 10, 100, 40);
    mockRect(byId.get('B')!, 150, 10, 100, 40);
    mockRect(byId.get('C')!, 300, 10, 100, 40);

    const info = getParticipantScreenInfo(svg, model);
    expect(info[0].bottomTop).toBeNull();
    expect(info[0].bottomBottom).toBeNull();
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

describe('getEdgeEndpointScreenInfo', () => {
  type Ctm = { a: number; b: number; c: number; d: number; e: number; f: number };
  const IDENTITY: Ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  const edgePaths = (svg: Element) =>
    Array.from(svg.querySelectorAll('g.edgePaths path[data-et="edge"]'));

  const mockPath = (path: Element, d: string | null, ctm: Ctm | null) => {
    if (d === null) path.removeAttribute('d');
    else path.setAttribute('d', d);
    (path as unknown as { getScreenCTM?: () => Ctm | null }).getScreenCTM =
      ctm ? () => ctm : () => null;
  };

  it('returns the path start/end as tail/head, mapped through the screen CTM', () => {
    const svg = parseSvg(FLOW_SVG);
    const paths = edgePaths(svg);
    mockPath(paths[0], 'M10,20 L110,20', IDENTITY);
    mockPath(paths[1], 'M30,40 L130,40', { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 });

    const info = getEdgeEndpointScreenInfo(svg, flowModel());
    expect(info).toHaveLength(2);
    // e:0 A->B: identity CTM — local coordinates are the screen coordinates.
    expect(info[0]).toEqual({ key: 'e:0', fromX: 10, fromY: 20, toX: 110, toY: 20 });
    // e:1 B->C: scale 2 + translate (100, 50).
    expect(info[1]).toEqual({ key: 'e:1', fromX: 160, fromY: 130, toX: 360, toY: 130 });
  });

  it('parses quadratic-curve paths (self-loop shapes) to their first/last points', () => {
    const svg = parseSvg(FLOW_SVG);
    const paths = edgePaths(svg);
    // Real mermaid 12.1 self-loop path (rounded corners via Q commands).
    mockPath(
      paths[0],
      'M49.33333333333333,32L49.33333333333333,19.071067811865476Q49.33333333333333,12 56.404401145198804,12L67.59559885480118,12Q74.66666666666666,12 74.66666666666666,19.071067811865476L74.66666666666666,28',
      IDENTITY,
    );
    mockPath(paths[1], 'M1,2 L3,4', null); // no CTM: skipped

    const info = getEdgeEndpointScreenInfo(svg, flowModel());
    expect(info).toHaveLength(1);
    expect(info[0].key).toBe('e:0');
    expect(info[0].fromX).toBeCloseTo(49.33333333333333, 5);
    expect(info[0].fromY).toBe(32);
    expect(info[0].toX).toBeCloseTo(74.66666666666666, 5);
    expect(info[0].toY).toBe(28);
  });

  it('skips edges without a d attribute, without a CTM, or without an SVG counterpart', () => {
    const svg = parseSvg(FLOW_SVG);
    const paths = edgePaths(svg);
    mockPath(paths[0], null, IDENTITY);        // no d
    mockPath(paths[1], 'M1,2 L3,4', IDENTITY);

    // The model claims a 3rd edge the SVG does not have.
    const model = parseModel(FLOW_CODE + '\n    A --> C');
    const info = getEdgeEndpointScreenInfo(svg, model);
    expect(info.map(e => e.key)).toEqual(['e:1']); // e:0 (no d) and e:2 (no path) skipped
  });
});

describe('nearestParticipantAtX', () => {
  const participants: ParticipantScreenInfo[] = [
    { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: null, bottomBottom: null },
    { key: 'p:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30, bottomTop: null, bottomBottom: null },
    { key: 'p:2', id: 'C', left: 300, right: 400, top: 10, bottom: 50, centerX: 350, centerY: 30, bottomTop: null, bottomBottom: null },
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
    { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: null, bottomBottom: null },
    { key: 'p:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30, bottomTop: null, bottomBottom: null },
    { key: 'p:2', id: 'C', left: 300, right: 400, top: 10, bottom: 50, centerX: 350, centerY: 30, bottomTop: null, bottomBottom: null },
  ];
  const nodes: ParticipantScreenInfo[] = [
    { key: 'n:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: null, bottomBottom: null },
    { key: 'n:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30, bottomTop: null, bottomBottom: null },
    { key: 'n:2', id: 'C', left: 300, right: 400, top: 10, bottom: 50, centerX: 350, centerY: 30, bottomTop: null, bottomBottom: null },
  ];

  describe('sequenceConnectHandlePos', () => {
    it('sits on the lifeline just below the top actor box', () => {
      expect(sequenceConnectHandlePos(participants[0])).toEqual({ x: 50, y: 50 + SEQ_CONNECT_HANDLE_OFFSET });
      expect(sequenceConnectHandlePos(participants[2])).toEqual({ x: 350, y: 50 + SEQ_CONNECT_HANDLE_OFFSET });
    });
  });

  describe('sequenceBottomConnectHandlePos', () => {
    it('sits on the lifeline just above the bottom actor box', () => {
      const p: ParticipantScreenInfo = { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: 326, bottomBottom: 376 };
      expect(sequenceBottomConnectHandlePos(p)).toEqual({ x: 50, y: 326 - SEQ_CONNECT_HANDLE_OFFSET });
    });

    it('returns null when the participant has no bottom actor box', () => {
      expect(sequenceBottomConnectHandlePos(participants[0])).toBeNull();
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
        { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: null, bottomBottom: null },
        { key: 'p:1', id: 'B', left: 15, right: 115, top: 10, bottom: 50, centerX: 65, centerY: 30, bottomTop: null, bottomBottom: null },
      ];
      expect(nearestConnectHandleAt(close, 57, 64)?.participant.key).toBe('p:0');
      expect(nearestConnectHandleAt(close, 58, 64)?.participant.key).toBe('p:1');
    });

    it('returns null for an empty list', () => {
      expect(nearestConnectHandleAt([], 50, 64)).toBeNull();
    });

    describe('with bottom actor handles', () => {
      // Participants with bottom actor boxes at Y=326..376.
      const withBottom: ParticipantScreenInfo[] = [
        { key: 'p:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: 326, bottomBottom: 376 },
        { key: 'p:1', id: 'B', left: 150, right: 250, top: 10, bottom: 50, centerX: 200, centerY: 30, bottomTop: 326, bottomBottom: 376 },
      ];
      const bottomHandleY = 326 - SEQ_CONNECT_HANDLE_OFFSET; // 312

      it('finds the bottom handle within the grab radius', () => {
        const hit = nearestConnectHandleAt(withBottom, 50, bottomHandleY);
        expect(hit?.participant.key).toBe('p:0');
        expect(hit?.handle).toEqual({ x: 50, y: bottomHandleY });
        expect(hit?.handleType).toBe('bottom');
      });

      it('reports handleType "top" for the top handle', () => {
        const hit = nearestConnectHandleAt(withBottom, 50, 50 + SEQ_CONNECT_HANDLE_OFFSET);
        expect(hit?.handleType).toBe('top');
      });

      it('picks the bottom handle when it is closer than the top handle', () => {
        // Y=300 is 14px from the bottom handle (312) and 236px from the top (64).
        const hit = nearestConnectHandleAt(withBottom, 50, 300);
        expect(hit?.handleType).toBe('bottom');
        expect(hit?.handle).toEqual({ x: 50, y: bottomHandleY });
      });

      it('picks the top handle when it is closer than the bottom handle', () => {
        // Y=70 is 6px from the top handle (64) and 242px from the bottom (312).
        const hit = nearestConnectHandleAt(withBottom, 50, 70);
        expect(hit?.handleType).toBe('top');
      });

      it('returns null on the lifeline between the two handles', () => {
        // Y=188 is equidistant (124px) from both handles — beyond the grab radius.
        expect(nearestConnectHandleAt(withBottom, 50, 188)).toBeNull();
      });

      it('finds the bottom handle of the correct participant', () => {
        const hit = nearestConnectHandleAt(withBottom, 200, bottomHandleY);
        expect(hit?.participant.key).toBe('p:1');
        expect(hit?.handleType).toBe('bottom');
      });
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
        { key: 'n:0', id: 'A', left: 0, right: 100, top: 10, bottom: 50, centerX: 50, centerY: 30, bottomTop: null, bottomBottom: null },
        { key: 'n:1', id: 'B', left: 110, right: 210, top: 10, bottom: 50, centerX: 160, centerY: 30, bottomTop: null, bottomBottom: null },
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
        key: 'n:0', id: 'A', left: 0, right: 30, top: 10, bottom: 30, centerX: 15, centerY: 20, bottomTop: null, bottomBottom: null,
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

describe('allMessageLabelElements (wrapped multi-line message labels)', () => {
  it('returns every wrapped text.messageText line in DOM order for a multi-line label', () => {
    const svg = parseSvg(SEQ_WRAPPED_SVG);
    const model = parseModel(SEQ_WRAPPED_CODE);
    const els = allMessageLabelElements(svg, model, 'm:1');
    expect(els).toHaveLength(2);
    expect(els.every((el) => el.matches('text.messageText'))).toBe(true);
    expect(els.map((el) => el.textContent)).toEqual([
      'a very long message',
      'that wraps onto two lines',
    ]);
    // the wrapped lines sit consecutively right before the message line
    const line = svg.querySelector('line[data-id="i2"]')!;
    expect(els[1].nextElementSibling).toBe(line);
    expect(els[0].nextElementSibling).toBe(els[1]);
  });

  it('returns the single label element for a single-line message', () => {
    const svg = parseSvg(SEQ_WRAPPED_SVG);
    const model = parseModel(SEQ_WRAPPED_CODE);
    const els = allMessageLabelElements(svg, model, 'm:0');
    expect(els.map((el) => el.textContent)).toEqual(['first']);
    expect(els[0].nextElementSibling?.matches('[data-et="message"]')).toBe(true);
  });

  it('stops at the previous message line instead of crossing into an earlier message\'s wrapped lines', () => {
    const svg = parseSvg(SEQ_WRAPPED_SVG);
    const model = parseModel(SEQ_WRAPPED_CODE);
    // m:2's label walk must not pick up m:1's wrapped lines, which are
    // separated from it by m:1's message line
    const els = allMessageLabelElements(svg, model, 'm:2');
    expect(els.map((el) => el.textContent)).toEqual(['last']);
  });

  it('returns an empty array for non-message keys and unknown keys', () => {
    const svg = parseSvg(SEQ_WRAPPED_SVG);
    const model = parseModel(SEQ_WRAPPED_CODE);
    expect(allMessageLabelElements(svg, model, 'p:0')).toEqual([]);
    expect(allMessageLabelElements(svg, model, 'nope')).toEqual([]);
  });

  it('returns an empty array for flowchart models', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    expect(allMessageLabelElements(svg, model, 'n:0')).toEqual([]);
  });
});

// --- Flowchart cluster (subgraph) helpers ------------------------------------

const FLOW_SUBGRAPH_SVG = `<svg id="fx-flow-sg" class="flowchart" viewBox="-8 -8 400 200">
<g class="root">
<g class="clusters">
<g class="cluster" id="fx-flow-sg-SG1"><rect x="0" y="0" width="150" height="100"></rect></g>
<g class="cluster" id="fx-flow-sg-SG2"><rect x="200" y="0" width="150" height="100"></rect></g>
</g>
<g class="nodes">
<g class="node default" id="fx-flow-sg-flowchart-A-0"><rect class="basic label-container" x="10" y="10" width="80" height="40"></rect><g class="label"><foreignObject><div><span class="nodeLabel"><p>A</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-sg-flowchart-B-1"><rect class="basic label-container" x="20" y="60" width="80" height="40"></rect><g class="label"><foreignObject><div><span class="nodeLabel"><p>B</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-sg-flowchart-C-2"><rect class="basic label-container" x="210" y="10" width="80" height="40"></rect><g class="label"><foreignObject><div><span class="nodeLabel"><p>C</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-sg-flowchart-D-3"><rect class="basic label-container" x="300" y="120" width="80" height="40"></rect><g class="label"><foreignObject><div><span class="nodeLabel"><p>D</p></span></div></foreignObject></g></g>
</g>
</g>
</svg>`;

const FLOW_SUBGRAPH_CODE = `flowchart TD
    subgraph S1
        A
        B
    end
    subgraph S2
        C
    end
    D`;

function mockFlowSubgraphRects(svg: Element) {
  // Cluster rects
  mockRect(svg.querySelector('#fx-flow-sg-SG1')!, 0, 0, 150, 100);
  mockRect(svg.querySelector('#fx-flow-sg-SG2')!, 200, 0, 150, 100);
  // Node rects (centers inside their respective clusters)
  const byId = new Map<string, Element>();
  svg.querySelectorAll('g.node[id]').forEach(g => {
    const id = g.getAttribute('id') ?? '';
    const m = id.match(/-flowchart-(.+)-\d+$/);
    if (m) byId.set(m[1], g);
  });
  mockRect(byId.get('A')!, 10, 10, 80, 40);    // center (50, 30) — inside SG1
  mockRect(byId.get('B')!, 20, 60, 80, 40);    // center (60, 80) — inside SG1
  mockRect(byId.get('C')!, 210, 10, 80, 40);   // center (250, 30) — inside SG2
  mockRect(byId.get('D')!, 300, 120, 80, 40);  // center (340, 140) — top level
}

describe('getFlowchartClusterInfo', () => {
  it('maps cluster rects to model block keys via member node positions', () => {
    const svg = parseSvg(FLOW_SUBGRAPH_SVG);
    mockFlowSubgraphRects(svg);
    const model = parseModel(FLOW_SUBGRAPH_CODE);
    const nodes = getNodeScreenInfo(svg, model);
    const clusters = getFlowchartClusterInfo(svg, model, nodes);
    expect(clusters).toHaveLength(2);
    const s1 = clusters.find(c => c.blockKey === 'b:0');
    const s2 = clusters.find(c => c.blockKey === 'b:1');
    expect(s1).toMatchObject({ left: 0, top: 0, right: 150, bottom: 100 });
    expect(s2).toMatchObject({ left: 200, top: 0, right: 350, bottom: 100 });
  });

  it('returns an empty list for sequence diagrams', () => {
    const svg = parseSvg(SEQ_SVG);
    const model = parseModel(SEQ_CODE);
    const nodes = getNodeScreenInfo(svg, model);
    expect(getFlowchartClusterInfo(svg, model, nodes)).toEqual([]);
  });

  it('returns an empty list when there are no subgraphs', () => {
    const svg = parseSvg(FLOW_SVG);
    const model = flowModel();
    const nodes = getNodeScreenInfo(svg, model);
    // FLOW_SVG has a cluster but FLOW_CODE has a subgraph — let's use a model without subgraphs
    const noSubModel = parseModel('flowchart TD\n    A --> B');
    expect(getFlowchartClusterInfo(svg, noSubModel, nodes)).toEqual([]);
  });
});

describe('innermostClusterAtPoint', () => {
  const clusters: ClusterScreenInfo[] = [
    { blockKey: 'b:0', left: 0, top: 0, right: 200, bottom: 200, area: 40000 },
    { blockKey: 'b:1', left: 50, top: 50, right: 100, bottom: 100, area: 2500 }, // nested
  ];

  it('returns the smallest cluster containing the point', () => {
    const hit = innermostClusterAtPoint(clusters, 75, 75);
    expect(hit?.blockKey).toBe('b:1');
  });

  it('returns the outer cluster when the point is only in the outer', () => {
    const hit = innermostClusterAtPoint(clusters, 10, 10);
    expect(hit?.blockKey).toBe('b:0');
  });

  it('returns null when the point is outside all clusters', () => {
    expect(innermostClusterAtPoint(clusters, 300, 300)).toBeNull();
  });
});

describe('nodeCenterInCluster / nodeInAnyCluster', () => {
  const node: ParticipantScreenInfo = {
    key: 'n:0', id: 'A', left: 10, right: 90, top: 10, bottom: 50,
    centerX: 50, centerY: 30, bottomTop: null, bottomBottom: null,
  };
  const cluster = { left: 0, top: 0, right: 100, bottom: 100 };

  it('nodeCenterInCluster checks the node center against the rect', () => {
    expect(nodeCenterInCluster(node, cluster)).toBe(true);
    expect(nodeCenterInCluster(node, { left: 60, top: 0, right: 100, bottom: 100 })).toBe(false);
  });

  it('nodeInAnyCluster returns true when the node is inside any cluster', () => {
    expect(nodeInAnyCluster(node, [cluster])).toBe(true);
    expect(nodeInAnyCluster(node, [{ left: 200, top: 200, right: 300, bottom: 300 }])).toBe(false);
    expect(nodeInAnyCluster(node, [])).toBe(false);
  });
});
