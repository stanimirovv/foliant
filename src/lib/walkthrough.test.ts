import { describe, it, expect } from 'vitest';
import {
  buildWalkthroughPlan,
  computeActiveStepBounds,
  computeFlowchartLevels,
  dimTargetsForStep,
  panTargetForStep,
  renderWalkthroughStepBox,
  WALKTHROUGH_DIM_OPACITY,
  WALKTHROUGH_MAX_ZOOM,
  WALKTHROUGH_MIN_ZOOM,
  WALKTHROUGH_STEP_BOX_COLOR,
} from './walkthrough';
import { parseModel } from './model';
import { DiagramConfig, parseViewsData } from './views';
import { renderDiagramWithView, EMPTY_DIAGRAM_VIEW_SELECTION } from './diagramView';
import { addEdgeHitPaths } from './styling';
import { applyStyles, renderPipeline } from './editorTestHarness';
import {
  FLOW_CODE,
  FLOW_SVG,
  parseSvgRoot,
  SEQ_AUTONUMBER_CODE,
  SEQ_AUTONUMBER_SVG,
  SEQ_CODE,
  SEQ_SVG,
  SEQ_WRAPPED_CODE,
  SEQ_WRAPPED_SVG,
} from './svgTestFixtures';

describe('walkthrough constants', () => {
  it('exports zoom bounds and dim opacity', () => {
    expect(WALKTHROUGH_MIN_ZOOM).toBe(0.2);
    expect(WALKTHROUGH_MAX_ZOOM).toBe(8);
    expect(WALKTHROUGH_DIM_OPACITY).toBe(0.2);
  });
});

describe('buildWalkthroughPlan — null / unsupported / empty cases', () => {
  it('returns null for empty string, prose, or unsupported diagram types', () => {
    expect(buildWalkthroughPlan('', null)).toBeNull();
    expect(buildWalkthroughPlan('Just some plain text', null)).toBeNull();
    expect(buildWalkthroughPlan('classDiagram\n  Animal <|-- Duck', null)).toBeNull();
    expect(buildWalkthroughPlan('stateDiagram-v2\n  [*] --> Still', null)).toBeNull();
  });

  it('returns null for sequence diagram with zero messages', () => {
    const code = `sequenceDiagram
      participant A
      participant B
      Note over A,B: Only a note`;
    expect(buildWalkthroughPlan(code, null)).toBeNull();
  });

  it('returns null for flowchart with zero edges (isolated nodes only)', () => {
    const code = `flowchart TD
      A[Alpha]
      B[Beta]`;
    expect(buildWalkthroughPlan(code, null)).toBeNull();
  });
});

describe('buildWalkthroughPlan — sequence diagrams', () => {
  it('builds one step per message in source order with cumulative reveal and participants always revealed', () => {
    const code = `sequenceDiagram
      participant A
      participant B
      participant C
      A->>B: First
      B-->>A: Second
      A->>A: Self call
      A->>C: Fourth`;
    const plan = buildWalkthroughPlan(code, null);
    expect(plan).not.toBeNull();
    expect(plan!.type).toBe('sequence');
    expect(plan!.steps).toHaveLength(4);

    // Step 0
    expect(plan!.steps[0]).toMatchObject({
      index: 0,
      keys: ['m:0'],
      panKey: 'm:0',
      label: 'First',
      revealedKeys: ['p:0', 'p:1', 'p:2', 'm:0'],
      dimmedKeys: ['m:1', 'm:2', 'm:3'],
      noteKeys: [],
      stickyNoteIds: [],
    });

    // Step 1
    expect(plan!.steps[1]).toMatchObject({
      index: 1,
      keys: ['m:1'],
      panKey: 'm:1',
      label: 'Second',
      revealedKeys: ['p:0', 'p:1', 'p:2', 'm:0', 'm:1'],
      dimmedKeys: ['m:2', 'm:3'],
    });

    // Step 2 (self-message)
    expect(plan!.steps[2]).toMatchObject({
      index: 2,
      keys: ['m:2'],
      panKey: 'm:2',
      label: 'Self call',
      revealedKeys: ['p:0', 'p:1', 'p:2', 'm:0', 'm:1', 'm:2'],
      dimmedKeys: ['m:3'],
    });

    // Step 3 (last)
    expect(plan!.steps[3]).toMatchObject({
      index: 3,
      keys: ['m:3'],
      panKey: 'm:3',
      label: 'Fourth',
      revealedKeys: ['p:0', 'p:1', 'p:2', 'm:0', 'm:1', 'm:2', 'm:3'],
      dimmedKeys: [],
    });
  });

  it('attaches notes before first message to step 0, between messages to preceding message, and trailing notes to last step', () => {
    const code = `sequenceDiagram
      participant A
      participant B
      Note over A: Pre-note 1
      Note over A,B: Pre-note 2
      A->>B: Msg 1
      Note over A,B: Mid-note
      B-->>A: Msg 2
      Note over B: Post-note 1
      Note over A,B: Post-note 2`;
    const plan = buildWalkthroughPlan(code, null)!;
    expect(plan.steps).toHaveLength(2);

    // Step 0 gets pre-notes (note:0, note:1) AND mid-note (note:2) because Msg 1 precedes mid-note
    expect(plan.steps[0].noteKeys).toEqual(['note:0', 'note:1', 'note:2']);
    expect(plan.steps[0].dimmedKeys).toEqual(['m:1', 'note:3', 'note:4']);
    expect(plan.steps[0].revealedKeys).toContain('note:0');
    expect(plan.steps[0].revealedKeys).toContain('note:2');

    // Step 1 gets trailing notes (note:3, note:4)
    expect(plan.steps[1].noteKeys).toEqual(['note:3', 'note:4']);
    expect(plan.steps[1].dimmedKeys).toEqual([]);
    expect(plan.steps[1].revealedKeys).toEqual([
      'p:0', 'p:1', 'm:0', 'm:1', 'note:0', 'note:1', 'note:2', 'note:3', 'note:4',
    ]);
  });

  it('produces identical step models with autonumber on and off, and steps normally inside alt/loop/opt/par/rect blocks', () => {
    const base = `sequenceDiagram
      participant A
      participant B
      A->>B: Ping
      loop Every min
        B-->>A: Pong
      end
      alt Success
        A->>B: Done
      end`;
    const withAuto = base.replace('sequenceDiagram', 'sequenceDiagram\n      autonumber');
    const planBase = buildWalkthroughPlan(base, null)!;
    const planAuto = buildWalkthroughPlan(withAuto, null)!;
    expect(planAuto.steps).toEqual(planBase.steps);
    expect(planBase.steps).toHaveLength(3);
    expect(planBase.steps.map((s) => s.label)).toEqual(['Ping', 'Pong', 'Done']);
  });

  it('attaches sticky notes by shared own/inherited/participant/note tags and leaves untagged notes unattached', () => {
    const code = `sequenceDiagram
      participant A
      participant B
      A->>B: StepOne
      Note over A,B: MidNote
      B-->>A: StepTwo`;
    const config: DiagramConfig = {
      version: 1,
      actors: {
        B: { keys: ['svc-b'] },
      },
      arrows: [
        { from: 'A', to: 'B', label: 'StepOne', keys: ['tag-m0'] },
        { from: 'B', to: 'A', label: 'StepTwo', keys: ['tag-m1'], keyMode: 'merged' },
      ],
      noteTags: [
        { over: ['A', 'B'], text: 'MidNote', keys: ['tag-note'] },
      ],
      notes: [
        { id: 'untagged', x: 0, y: 0, text: 'Always visible' },
        { id: 'on-m0', x: 0, y: 0, text: 'On m0', keys: ['tag-m0', 'tag-m0'] }, // duplicate tag
        { id: 'on-m1', x: 0, y: 0, text: 'On m1', keys: ['tag-m1'] },
        { id: 'on-note', x: 0, y: 0, text: 'On note', keys: ['tag-note'] },
        { id: 'on-inherited', x: 0, y: 0, text: 'Via B', keys: ['svc-b'] },
      ],
    };
    const plan = buildWalkthroughPlan(code, config)!;
    // Step 0 reveals p:0, p:1 (has svc-b), m:0 (has tag-m0), note:0 (has tag-note)
    expect(plan.steps[0].stickyNoteIds).toEqual(['on-m0', 'on-note', 'on-inherited']);
    expect(plan.steps[0].stickyNoteIds).not.toContain('untagged');
    expect(plan.steps[0].stickyNoteIds).not.toContain('on-m1');

    // Step 1 also reveals m:1 (has tag-m1 and inherited svc-b)
    expect(plan.steps[1].stickyNoteIds).toEqual(['on-m0', 'on-m1', 'on-note', 'on-inherited']);
  });
});

describe('computeFlowchartLevels & buildWalkthroughPlan — flowcharts', () => {
  it('computes linear chain of n nodes -> n steps', () => {
    const code = `flowchart TD
      A --> B
      B --> C
      C --> D`;
    const plan = buildWalkthroughPlan(code, null)!;
    expect(plan.type).toBe('flowchart');
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0].keys).toEqual(['n:0']);
    expect(plan.steps[1].keys).toEqual(['n:1', 'e:0']);
    expect(plan.steps[2].keys).toEqual(['n:2', 'e:1']);
    expect(plan.steps[3].keys).toEqual(['n:3', 'e:2']);
  });

  it('computes diamond (A->B, A->C, B->D, C->D) -> 3 steps', () => {
    const code = `flowchart TD
      A --> B
      A --> C
      B --> D
      C --> D`;
    const plan = buildWalkthroughPlan(code, null)!;
    expect(plan.steps).toHaveLength(3);

    expect(plan.steps[0]).toMatchObject({
      index: 0,
      keys: ['n:0'],
      panKey: 'n:0',
      label: 'Depth 1 · 1 node · 0 edges',
      revealedKeys: ['n:0'],
      dimmedKeys: ['n:1', 'n:2', 'n:3', 'e:0', 'e:1', 'e:2', 'e:3'],
    });

    expect(plan.steps[1]).toMatchObject({
      index: 1,
      keys: ['n:1', 'n:2', 'e:0', 'e:1'],
      panKey: 'n:1',
      label: 'Depth 2 · 2 nodes · 2 edges',
      revealedKeys: ['n:0', 'n:1', 'n:2', 'e:0', 'e:1'],
      dimmedKeys: ['n:3', 'e:2', 'e:3'],
    });

    expect(plan.steps[2]).toMatchObject({
      index: 2,
      keys: ['n:3', 'e:2', 'e:3'],
      panKey: 'n:3',
      label: 'Depth 3 · 1 node · 2 edges',
      revealedKeys: ['n:0', 'n:1', 'n:2', 'n:3', 'e:0', 'e:1', 'e:2', 'e:3'],
      dimmedKeys: [],
    });
  });

  it('computes the worked diamond+loop example (A->B, A->C, B->D, C->D, D->E, E->B) -> 4 steps', () => {
    const code = `flowchart TD
      A --> B
      A --> C
      B --> D
      C --> D
      D --> E
      E --> B`;
    const plan = buildWalkthroughPlan(code, null)!;
    expect(plan.steps).toHaveLength(4);
    // Back edge E -> B (e:5) reveals at step 3 (depth 3) with E (n:4)
    expect(plan.steps[3].keys).toEqual(['n:4', 'e:4', 'e:5']);
  });

  it('places skip edge target at longest-path depth (A->B->D plus A->D puts D at depth 2 -> 3 steps)', () => {
    const code = `flowchart TD
      A --> B
      B --> D
      A --> D`;
    const model = parseModel(code);
    const levels = computeFlowchartLevels(model);
    expect(levels.maxDepth).toBe(2);
    // A=n:0 (0), B=n:1 (1), D=n:2 (2)
    expect(levels.nodeDepth.get('n:0')).toBe(0);
    expect(levels.nodeDepth.get('n:1')).toBe(1);
    expect(levels.nodeDepth.get('n:2')).toBe(2);
    // Skip edge A->D (e:2) has max(0, 2) = 2
    expect(levels.edgeLevel.get('e:2')).toBe(2);

    const plan = buildWalkthroughPlan(code, null)!;
    expect(plan.steps).toHaveLength(3);
  });

  it('handles self-loops and pure cycle-only components (first node in source order acts as entry)', () => {
    const selfLoopCode = `flowchart TD
      A --> A
      A --> B`;
    const selfPlan = buildWalkthroughPlan(selfLoopCode, null)!;
    expect(selfPlan.steps).toHaveLength(2);
    // Self-loop e:0 has level max(0, 0) = 0, so it reveals at step 0 with A
    expect(selfPlan.steps[0].keys).toEqual(['n:0', 'e:0']);
    expect(selfPlan.steps[1].keys).toEqual(['n:1', 'e:1']);

    const pureCycleCode = `flowchart TD
      X --> Y
      Y --> Z
      Z --> X`;
    const cyclePlan = buildWalkthroughPlan(pureCycleCode, null)!;
    expect(cyclePlan.steps).toHaveLength(3);
    // X=0, Y=1, Z=2; Z->X (e:2) is back edge revealing at depth 2
    expect(cyclePlan.steps[0].keys).toEqual(['n:0']);
    expect(cyclePlan.steps[1].keys).toEqual(['n:1', 'e:0']);
    expect(cyclePlan.steps[2].keys).toEqual(['n:2', 'e:1', 'e:2']);
  });

  it('handles disconnected components, isolated nodes, subgraphs, subgraph-to-subgraph edges, direction LR, and parallel/chained edges', () => {
    const code = `flowchart LR
      ISO[Isolated Node]
      subgraph SG1
        A --> B
      end
      subgraph SG2
        P --> Q
      end
      SG1 --> SG2
      X --> Y --> Z
      X --> Y`;
    const model = parseModel(code);
    const levels = computeFlowchartLevels(model);
    // ISO is isolated (never dimmed, in no step's keys, in revealedKeys from step 0)
    const isoNode = model.elements.find((e) => e.kind === 'node' && e.id === 'ISO')!;
    expect(levels.isolated).toContain(isoNode.key);
    expect(levels.nodeDepth.has(isoNode.key)).toBe(false);

    // X -> Y -> Z gives maxDepth 2 -> 3 steps
    expect(levels.maxDepth).toBe(2);
    const plan = buildWalkthroughPlan(code, null)!;
    expect(plan.steps).toHaveLength(3);
    for (const step of plan.steps) {
      expect(step.keys).not.toContain(isoNode.key);
      expect(step.revealedKeys).toContain(isoNode.key);
      expect(step.dimmedKeys).not.toContain(isoNode.key);
    }

    // Parallel edges X --> Y both reveal at depth 1
    const xyEdges = model.elements.filter(
      (e) => e.kind === 'edge' && e.from === 'X' && e.to === 'Y',
    );
    expect(xyEdges).toHaveLength(2);
    expect(plan.steps[1].keys).toContain(xyEdges[0].key);
    expect(plan.steps[1].keys).toContain(xyEdges[1].key);
  });

  it('satisfies the step-count independence property: same depth structure with different node/edge counts yields identical step count', () => {
    const narrow = `flowchart TD
      A --> B
      B --> C`;
    const wide = `flowchart TD
      A1 --> B1
      A1 --> B2
      A1 --> B3
      A2 --> B2
      A2 --> B4
      B1 --> C1
      B2 --> C1
      B3 --> C2
      B4 --> C2
      B4 --> C3`;
    const planNarrow = buildWalkthroughPlan(narrow, null)!;
    const planWide = buildWalkthroughPlan(wide, null)!;
    expect(planNarrow.steps).toHaveLength(3);
    expect(planWide.steps).toHaveLength(3);
  });

  it('excludes elements hidden by a saved view when given rendered code from renderDiagramWithView', () => {
    const raw = `%% CONFIG: {"version":1,"arrows":[{"from":"B","to":"C","label":"HiddenStep","keys":["secret"]}]}
sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: VisibleStep
    B->>C: HiddenStep`;
    const config = parseViewsData(raw);
    const rendered = renderDiagramWithView(raw, config, {
      ...EMPTY_DIAGRAM_VIEW_SELECTION,
      hideKeys: ['secret'],
    });
    const plan = buildWalkthroughPlan(rendered.code, config)!;
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].label).toBe('VisibleStep');
  });
});

describe('dimTargetsForStep & panTargetForStep — static fixtures & real renders', () => {
  it('resolves sequence dim targets, active targets, and pan target on SEQ_SVG', () => {
    const svg = parseSvgRoot(SEQ_SVG);
    const model = parseModel(SEQ_CODE);
    const plan = buildWalkthroughPlan(SEQ_CODE, null)!;

    // Step 0: m:0 active; m:1, m:2, m:3 and note:0 (between m:1 and m:2) dimmed
    const step0 = dimTargetsForStep(svg, model, plan, 0);
    const activeIds0 = step0.active.map((el) => el.getAttribute('data-id') ?? el.textContent);
    expect(activeIds0).toContain('i1');
    expect(activeIds0).toContain('m1');

    const dimmedIds0 = step0.dimmed.map((el) => el.getAttribute('data-id') ?? el.textContent);
    expect(dimmedIds0).toContain('i2');
    expect(dimmedIds0).toContain('m2');
    expect(dimmedIds0).toContain('i3'); // note:0
    expect(dimmedIds0).toContain('i4');
    expect(dimmedIds0).toContain('i5');

    // Pan target is message label text.messageText
    const pan0 = panTargetForStep(svg, model, plan, 0);
    expect(pan0?.tagName.toLowerCase()).toBe('text');
    expect(pan0?.textContent).toBe('m1');
  });

  it('includes every wrapped label line in active/dimmed so the step box covers multi-line text (SEQ_WRAPPED_SVG)', () => {
    const svg = parseSvgRoot(SEQ_WRAPPED_SVG);
    const model = parseModel(SEQ_WRAPPED_CODE);
    const plan = buildWalkthroughPlan(SEQ_WRAPPED_CODE, null)!;
    expect(plan.steps).toHaveLength(3);

    // Step 0: m:0 active with its single-line label; m:1 (wrapped label) and
    // m:2 dimmed — the dimmed set contains BOTH of m:1's wrapped text lines
    const step0 = dimTargetsForStep(svg, model, plan, 0);
    const activeTexts0 = step0.active.filter((el) => el.classList.contains('messageText'));
    expect(activeTexts0.map((el) => el.textContent)).toEqual(['first']);
    const dimmedTexts0 = step0.dimmed.filter((el) => el.classList.contains('messageText'));
    expect(dimmedTexts0.map((el) => el.textContent)).toEqual([
      'a very long message',
      'that wraps onto two lines',
      'last',
    ]);

    // Step 1: m:1 active — its label wraps onto two rendered text lines, and
    // BOTH are in the active set alongside the arrow
    const step1 = dimTargetsForStep(svg, model, plan, 1);
    const activeTexts1 = step1.active.filter((el) => el.classList.contains('messageText'));
    expect(activeTexts1.map((el) => el.textContent)).toEqual([
      'a very long message',
      'that wraps onto two lines',
    ]);
    const activeIds1 = step1.active.map((el) => el.getAttribute('data-id') ?? el.textContent);
    expect(activeIds1).toContain('i2');

    // m:2 is dimmed with its single-line label; none of m:1's wrapped lines
    // leak into the dimmed set
    const dimmedTexts1 = step1.dimmed.filter((el) => el.classList.contains('messageText'));
    expect(dimmedTexts1.map((el) => el.textContent)).toEqual(['last']);

    // The green step box spans BOTH wrapped lines plus the arrow: with the
    // jsdom getBBox stub, text bounds fall back to x/y + stub 100x20, so the
    // union is minX=50 (arrow), minY=130 (first wrapped line), maxX=200 (text
    // stub width), maxY=165 (second line y=145 + stub height 20). Padding 10.
    // Covering only the line nearest the arrow would give y=135 instead of 120.
    const bounds1 = computeActiveStepBounds(svg, step1.active);
    expect(bounds1).toEqual({ x: 40, y: 120, width: 170, height: 55 });
  });

  it('associates and dims autonumber sequenceNumber badges on SEQ_AUTONUMBER_SVG', () => {
    const svg = parseSvgRoot(SEQ_AUTONUMBER_SVG);
    const model = parseModel(SEQ_AUTONUMBER_CODE);
    const plan = buildWalkthroughPlan(SEQ_AUTONUMBER_CODE, null)!;

    const step0 = dimTargetsForStep(svg, model, plan, 0);
    const dimmedBadges = step0.dimmed.filter((el) => el.classList.contains('sequenceNumber'));
    expect(dimmedBadges.map((b) => b.textContent)).toEqual(['2', '3']);

    const step1 = dimTargetsForStep(svg, model, plan, 1);
    const dimmedBadges1 = step1.dimmed.filter((el) => el.classList.contains('sequenceNumber'));
    expect(dimmedBadges1.map((b) => b.textContent)).toEqual(['3']);
  });

  it('dims arrow animation overlays alongside their base message or edge', () => {
    const raw = `%% CONFIG: {"version":1,"arrows":[{"from":"B","to":"A","label":"m2","animation":"pulse"},{"from":"A","to":"C","label":"m4","animation":"broken-sender"}]}
${SEQ_CODE}`;
    const config = parseViewsData(raw);
    const styledSvg = applyStyles(SEQ_SVG, SEQ_CODE, config, {}, raw);
    const svg = parseSvgRoot(styledSvg);
    const model = parseModel(SEQ_CODE);
    const plan = buildWalkthroughPlan(SEQ_CODE, config)!;

    const step0 = dimTargetsForStep(svg, model, plan, 0);
    expect(step0.dimmed.some((el) => el.classList.contains('arrow-anim-packet-runner'))).toBe(true);
    expect(step0.dimmed.some((el) => el.classList.contains('arrow-barrier-wall'))).toBe(true);
    expect(step0.dimmed.some((el) => el.classList.contains('arrow-shockwave-burst'))).toBe(true);
    expect(step0.dimmed.some((el) => el.classList.contains('arrow-x-mark'))).toBe(true);
  });

  it('resolves flowchart dim targets (nodes, edges, edgeLabels, edge-hit paths) and never dims g.cluster on FLOW_SVG', () => {
    const withHits = addEdgeHitPaths(FLOW_SVG);
    const svg = parseSvgRoot(withHits);
    const model = parseModel(FLOW_CODE);
    const plan = buildWalkthroughPlan(FLOW_CODE, null)!;

    // Step 0: A (n:0) active; B, C, L_A_B_0, L_B_C_0 + Reply edgeLabel + edge-hit dimmed
    const step0 = dimTargetsForStep(svg, model, plan, 0);
    expect(step0.active.map((el) => el.getAttribute('id'))).toEqual(['fx-flow-flowchart-A-0']);
    expect(step0.dimmed.some((el) => el.getAttribute('id') === 'fx-flow-flowchart-B-1')).toBe(true);
    expect(step0.dimmed.some((el) => el.getAttribute('id') === 'fx-flow-flowchart-C-7')).toBe(true);
    expect(step0.dimmed.some((el) => el.getAttribute('data-id') === 'L_B_C_0' && el.classList.contains('edge-hit'))).toBe(true);
    expect(step0.dimmed.some((el) => el.classList.contains('edgeLabel'))).toBe(true);
    expect(step0.dimmed.some((el) => el.classList.contains('cluster'))).toBe(false);

    const pan0 = panTargetForStep(svg, model, plan, 0);
    expect(pan0?.getAttribute('id')).toBe('fx-flow-flowchart-A-0');
  });

  it('works against real Mermaid renders via renderPipeline (sequence + flowchart)', async () => {
    const seqRes = await renderPipeline(`sequenceDiagram
      autonumber
      participant A as Alice
      participant B as Bob
      A->>B: Hello
      Note over A,B: Handshake
      B-->>A: World`);
    const seqStyled = applyStyles(seqRes.svg, seqRes.processedCode, seqRes.config);
    const seqSvg = parseSvgRoot(seqStyled);
    const seqPlan = buildWalkthroughPlan(seqRes.processedCode, seqRes.config)!;
    expect(seqPlan.steps).toHaveLength(2);

    const seqTargets0 = dimTargetsForStep(seqSvg, seqRes.model, seqPlan, 0);
    expect(seqTargets0.active.length).toBeGreaterThanOrEqual(2);
    expect(seqTargets0.dimmed.length).toBeGreaterThanOrEqual(2);
    expect(panTargetForStep(seqSvg, seqRes.model, seqPlan, 0)).not.toBeNull();

    const flowRes = await renderPipeline(`flowchart TD
      ISO[Isolated]
      subgraph SG
        A[Start] --> B[Mid]
      end
      B -->|Done| C[End]`);
    const flowStyled = applyStyles(flowRes.svg, flowRes.processedCode, flowRes.config);
    const flowSvg = parseSvgRoot(flowStyled);
    const flowPlan = buildWalkthroughPlan(flowRes.processedCode, flowRes.config)!;
    expect(flowPlan.steps).toHaveLength(3);

    const flowTargets0 = dimTargetsForStep(flowSvg, flowRes.model, flowPlan, 0);
    expect(flowTargets0.dimmed.some((el) => el.classList.contains('cluster'))).toBe(false);
    expect(panTargetForStep(flowSvg, flowRes.model, flowPlan, 0)).not.toBeNull();
  });

  it('computes and renders a dashed green highlight rectangle around the active step elements', () => {
    const svg = parseSvgRoot(SEQ_AUTONUMBER_SVG);
    const model = parseModel(SEQ_AUTONUMBER_CODE);
    const plan = buildWalkthroughPlan(SEQ_AUTONUMBER_CODE, null)!;

    const step0 = dimTargetsForStep(svg, model, plan, 0);
    const bounds0 = computeActiveStepBounds(svg, step0.active);
    expect(bounds0).not.toBeNull();

    const step1 = dimTargetsForStep(svg, model, plan, 1);
    const bounds1 = computeActiveStepBounds(svg, step1.active);
    expect(bounds1).not.toBeNull();
    // Step 1 is further down vertically than Step 0
    expect(bounds1!.y).toBeGreaterThan(bounds0!.y);

    const rect = renderWalkthroughStepBox(svg, step0.active);
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('class')).toBe('walkthrough-step-box');
    expect(rect?.getAttribute('stroke')).toBe(WALKTHROUGH_STEP_BOX_COLOR);
    expect(rect?.getAttribute('stroke-dasharray')).toBe('8 6');
    expect(rect?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(svg.querySelector('.walkthrough-step-box')).toBe(rect);

    expect(computeActiveStepBounds(svg, [])).toBeNull();
    expect(renderWalkthroughStepBox(svg, [])).toBeNull();
  });
});
