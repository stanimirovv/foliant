import { describe, it, expect } from 'vitest';
import { rewriteArrowStyles, applyArrowStyles, applyNodeColors, ANIMATED_ARROW_PRESETS, ANIMATED_ARROW_COLORS, ALL_ANIMATED_ARROW_COLORS } from './styling';
import { buildActorRewriteMap, transformActors } from './preprocessor';
import { parseModel, MessageElement, EdgeElement } from './model';
import { updateViewsData, DiagramConfig } from './views';
import { createSequenceDiagram, createFlowchartDiagram, parseConfig, renderPipeline, applyStyles, svgText } from './editorTestHarness';
import { setArrowStyle, setActorColor, addTag } from './editor';
import { buildSelectionMap } from './svgmap';
import { SEQ_SVG, SEQ_CODE, FLOW_SVG, FLOW_CODE, parseSvgRoot } from './svgTestFixtures';

// jsdom's CSSOM normalizes hex colors to rgb(); named colors pass through.
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const styleOf = (el: Element | null) => (el as unknown as SVGElement).style;

const baseConfig: DiagramConfig = {
  version: 1,
  actors: {
    A: { color: 'red', keys: ['backend'] },
    B: { color: 'red', keys: ['backend'] },
    C: { color: 'blue', keys: ['frontend'] },
    D: { keys: ['internal'] },
  },
  arrows: [
    { from: 'A', to: 'B', label: 'internal call', color: 'red' },
    { from: 'A', to: 'C', label: 'external call', width: 2 },
    { from: 'C', to: 'D', label: 'to internal', dash: 'dotted', occurrence: 1 },
  ],
};

describe('rewriteArrowStyles', () => {
  it('rewrites endpoints through mergeByColor', () => {
    const res = rewriteArrowStyles(baseConfig, { mergeByColor: ['red'] });
    expect(res?.arrows).toEqual([
      { from: 'MergedColor_red', to: 'MergedColor_red', label: 'internal call', color: 'red' },
      { from: 'MergedColor_red', to: 'C', label: 'external call', width: 2 },
      { from: 'C', to: 'D', label: 'to internal', dash: 'dotted', occurrence: 1 },
    ]);
  });

  it('rewrites endpoints through mergeByKeys', () => {
    const res = rewriteArrowStyles(baseConfig, { mergeByKeys: ['backend'] });
    expect(res?.arrows?.[0]).toMatchObject({ from: 'MergedKey_backend', to: 'MergedKey_backend' });
    expect(res?.arrows?.[1]).toMatchObject({ from: 'MergedKey_backend', to: 'C' });
    expect(res?.arrows?.[2]).toMatchObject({ from: 'C', to: 'D' });
  });

  it('rewrites endpoints through mergeCleanByColor and mergeCleanByKeys', () => {
    const byColor = rewriteArrowStyles(baseConfig, { mergeCleanByColor: ['red'] });
    expect(byColor?.arrows?.[0]).toMatchObject({ from: 'MergedColor_red', to: 'MergedColor_red' });
    const byKeys = rewriteArrowStyles(baseConfig, { mergeCleanByKeys: ['backend'] });
    expect(byKeys?.arrows?.[0]).toMatchObject({ from: 'MergedKey_backend', to: 'MergedKey_backend' });
  });

  it('keeps entries whose endpoints are hidden as-is (inert)', () => {
    const res = rewriteArrowStyles(baseConfig, { hideColors: ['blue'] });
    // C is hidden: no renames apply, the config is returned unchanged
    expect(res).toBe(baseConfig);
    const res2 = rewriteArrowStyles(baseConfig, { hideKeys: ['backend'] });
    expect(res2).toBe(baseConfig);
  });

  it('preserves arrow tags and key mode when rewriting endpoints for merging', () => {
    const config: DiagramConfig = {
      version: 1,
      actors: { A: { keys: ['backend'] }, B: { keys: ['backend'] } },
      arrows: [
        { from: 'A', to: 'B', label: 'Fetch', keys: ['critical'], keyMode: 'clean' },
        { from: 'A', to: 'B', label: 'Fetch', color: 'red', keys: ['retry'] },
      ],
    };
    const res = rewriteArrowStyles(config, { mergeByKeys: ['backend'] });
    expect(res?.arrows).toEqual([
      { from: 'MergedKey_backend', to: 'MergedKey_backend', label: 'Fetch', keys: ['critical'], keyMode: 'clean' },
      { from: 'MergedKey_backend', to: 'MergedKey_backend', label: 'Fetch', color: 'red', keys: ['retry'] },
    ]);
  });

  it('combines merge and hide', () => {
    const res = rewriteArrowStyles(baseConfig, { mergeByColor: ['red'], hideKeys: ['internal'] });
    expect(res?.arrows).toEqual([
      { from: 'MergedColor_red', to: 'MergedColor_red', label: 'internal call', color: 'red' },
      { from: 'MergedColor_red', to: 'C', label: 'external call', width: 2 },
      // D is hidden: kept as-is (inert)
      { from: 'C', to: 'D', label: 'to internal', dash: 'dotted', occurrence: 1 },
    ]);
  });

  it('preserves label and occurrence fields untouched', () => {
    const res = rewriteArrowStyles(baseConfig, { mergeByColor: ['red'] });
    expect(res?.arrows?.[0].label).toBe('internal call');
    expect(res?.arrows?.[2].occurrence).toBe(1);
    expect(res?.arrows?.[2].dash).toBe('dotted');
  });

  it('returns the input unchanged when there is nothing to rewrite', () => {
    expect(rewriteArrowStyles(null, { mergeByColor: ['red'] })).toBeNull();
    const noArrows: DiagramConfig = { version: 1, actors: { A: { color: 'red' } } };
    expect(rewriteArrowStyles(noArrows, { mergeByColor: ['red'] })).toBe(noArrows);
    // no options: no renames
    expect(rewriteArrowStyles(baseConfig, {})).toBe(baseConfig);
  });

  it('does not mutate the input config', () => {
    const snapshot = JSON.stringify(baseConfig);
    rewriteArrowStyles(baseConfig, { mergeByColor: ['red'], hideKeys: ['internal'] });
    expect(JSON.stringify(baseConfig)).toBe(snapshot);
  });
});

describe('buildActorRewriteMap', () => {
  it('computes rename, hide, clean and groups', () => {
    const map = buildActorRewriteMap(baseConfig, {
      mergeByColor: ['red'],
      mergeCleanByKeys: ['frontend'],
      hideKeys: ['internal'],
    });
    expect(Object.fromEntries(map.rename)).toEqual({
      A: 'MergedColor_red',
      B: 'MergedColor_red',
      C: 'MergedKey_frontend',
    });
    expect(Array.from(map.hide)).toEqual(['D']);
    expect(Array.from(map.clean)).toEqual(['MergedKey_frontend']);
    expect(map.groups).toEqual([
      { name: 'MergedColor_red', alias: 'Merged red', actors: ['A', 'B'] },
      { name: 'MergedKey_frontend', alias: 'Merged frontend', actors: ['C'] },
    ]);
  });

  it('returns empty maps for null config or empty actors', () => {
    const empty = buildActorRewriteMap(null, {});
    expect(empty.rename.size).toBe(0);
    expect(empty.hide.size).toBe(0);
    expect(empty.clean.size).toBe(0);
    expect(empty.groups).toEqual([]);
    const noActors = buildActorRewriteMap({ version: 1 }, { mergeByColor: ['red'] });
    expect(noActors.rename.size).toBe(0);
  });

  it('derives MergedColor_/MergedKey_ names with the same sanitization as before', () => {
    const map = buildActorRewriteMap(
      { version: 1, actors: { A: { color: '#e11d48' }, B: { keys: ['my key'] } } },
      { mergeByColor: ['#e11d48'], mergeByKeys: ['my key'] }
    );
    expect(map.rename.get('A')).toBe('MergedColor_e11d48');
    expect(map.rename.get('B')).toBe('MergedKey_mykey');
    expect(map.groups[0].alias).toBe('Merged #e11d48');
    expect(map.groups[1].alias).toBe('Merged my key');
  });
});

describe('create -> change -> verify (harness)', () => {
  it('sequence: styled arrows follow the merge through transformActors + parseModel', () => {
    const raw = createSequenceDiagram();
    const config: DiagramConfig = {
      version: 1,
      actors: { A: { keys: ['backend'] }, B: { keys: ['backend'] } },
      arrows: [{ from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' }],
    };
    const code = updateViewsData(raw, config);

    // default: no rewriting; the processed element matches the stored endpoints
    const def = rewriteArrowStyles(parseConfig(code), {});
    expect(def?.arrows).toEqual(config.arrows);
    const defMsg = parseModel(transformActors(code, parseConfig(code), {}))
      .elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'Hello') as MessageElement;
    expect(defMsg).toMatchObject({ from: 'A', to: 'B' });
    expect(def?.arrows?.[0].from).toBe(defMsg.from);
    expect(def?.arrows?.[0].to).toBe(defMsg.to);

    // merged by key: the style is rewritten to the merged self-call endpoints
    const merged = rewriteArrowStyles(parseConfig(code), { mergeByKeys: ['backend'] });
    expect(merged?.arrows).toEqual([
      { from: 'MergedKey_backend', to: 'MergedKey_backend', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' },
    ]);
    const mergedMsg = parseModel(transformActors(code, parseConfig(code), { mergeByKeys: ['backend'] }))
      .elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'Hello') as MessageElement;
    expect(mergedMsg).toMatchObject({ from: 'MergedKey_backend', to: 'MergedKey_backend' });
    expect(merged?.arrows?.[0].from).toBe(mergedMsg.from);
    expect(merged?.arrows?.[0].to).toBe(mergedMsg.to);

    // clean merge: the self-call is dropped; the style is rewritten but inert
    const clean = rewriteArrowStyles(parseConfig(code), { mergeCleanByKeys: ['backend'] });
    expect(clean?.arrows?.[0]).toMatchObject({ from: 'MergedKey_backend', to: 'MergedKey_backend' });
    const cleanModel = parseModel(transformActors(code, parseConfig(code), { mergeCleanByKeys: ['backend'] }));
    expect(cleanModel.elements.some(e => e.kind === 'message' && (e as MessageElement).label === 'Hello')).toBe(false);

    // hidden: the actors' lines are gone; the style keeps raw endpoints (inert)
    const hidden = rewriteArrowStyles(parseConfig(code), { hideKeys: ['backend'] });
    expect(hidden?.arrows).toEqual(config.arrows);
    const hiddenModel = parseModel(transformActors(code, parseConfig(code), { hideKeys: ['backend'] }));
    expect(hiddenModel.elements.filter(e => e.kind === 'message')).toHaveLength(0);
  });

  it('flowchart: edge styles are rewritten to the merged node endpoints', () => {
    const raw = createFlowchartDiagram();
    const config: DiagramConfig = {
      version: 1,
      actors: { A: { keys: ['backend'] }, B: { keys: ['backend'] } },
      arrows: [{ from: 'A', to: 'B', color: 'red' }],
    };
    const code = updateViewsData(raw, config);

    const merged = rewriteArrowStyles(parseConfig(code), { mergeByKeys: ['backend'] });
    expect(merged?.arrows).toEqual([{ from: 'MergedKey_backend', to: 'MergedKey_backend', color: 'red' }]);

    const processed = transformActors(code, parseConfig(code), { mergeByKeys: ['backend'] });
    const edge = parseModel(processed).elements.find(e => e.kind === 'edge') as EdgeElement;
    expect(edge).toMatchObject({ from: 'MergedKey_backend', to: 'MergedKey_backend' });
    expect(merged?.arrows?.[0].from).toBe(edge.from);
    expect(merged?.arrows?.[0].to).toBe(edge.to);
  });
});

describe('applyArrowStyles (sequence fixture)', () => {
  const model = parseModel(SEQ_CODE);
  const config: DiagramConfig = {
    version: 1,
    arrows: [{ from: 'A', to: 'B', label: 'm1', color: '#e11d48', width: 3, dash: 'dashed' }],
  };
  const out = applyArrowStyles(SEQ_SVG, model, config);
  const root = parseSvgRoot(out);

  it('sets stroke, stroke-width and stroke-dasharray on the right line', () => {
    const line = root.querySelector('line[data-id="i1"]')!;
    expect(styleOf(line).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(line).strokeWidth).toBe('3');
    expect(styleOf(line).strokeDasharray).toBe('8 6');
  });

  it('clones the marker with a unique id and recolors the clone', () => {
    const line = root.querySelector('line[data-id="i1"]')!;
    const ref = line.getAttribute('marker-end')!;
    const markerId = ref.match(/^url\(#(.+)\)$/)![1];
    expect(markerId).toBe('fx-seq-arrowhead--styled-0');
    const clone = Array.from(root.querySelectorAll('marker')).find(m => m.getAttribute('id') === markerId)!;
    expect(clone).toBeTruthy();
    const path = clone.querySelector('path')!;
    expect(styleOf(path).fill).toBe(rgb('#e11d48'));
    expect(styleOf(path).stroke).toBe(rgb('#e11d48'));
    // the original marker is untouched
    const original = root.querySelector('marker[id="fx-seq-arrowhead"] path')!;
    expect(original.getAttribute('style')).toBeNull();
  });

  it('leaves unstyled elements unchanged', () => {
    const other = root.querySelector('line[data-id="i2"]')!;
    expect(styleOf(other).stroke).toBe('');
    expect(styleOf(other).strokeDasharray).toBe('');
    const selfCall = root.querySelector('path[data-id="i4"]')!;
    expect(selfCall.getAttribute('marker-end')).toBe('url(#fx-seq-arrowhead)');
  });

  it('supports dotted and solid dash styles', () => {
    const dotted = applyArrowStyles(SEQ_SVG, model, {
      version: 1,
      arrows: [{ from: 'B', to: 'A', label: 'm2', dash: 'dotted' }],
    });
    const dottedLine = parseSvgRoot(dotted).querySelector('line[data-id="i2"]')!;
    expect(styleOf(dottedLine).strokeDasharray).toBe('2 4');
    // no color -> no marker cloning
    expect(dottedLine.getAttribute('marker-end')).toBe('url(#fx-seq-arrowhead)');

    const solid = applyArrowStyles(SEQ_SVG, model, {
      version: 1,
      arrows: [{ from: 'B', to: 'A', label: 'm2', color: 'red', dash: 'solid' }],
    });
    const solidLine = parseSvgRoot(solid).querySelector('line[data-id="i2"]')!;
    expect(styleOf(solidLine).strokeDasharray).toBe('none');
  });

  it('applies animation class to the styled SVG line', () => {
    const out = applyArrowStyles(SEQ_SVG, model, {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'm1', animation: 'flow' }],
    });
    const root = parseSvgRoot(out);
    const line = root.querySelector('line[data-id="i1"]')!;
    expect(line.classList.contains('arrow-anim-flow')).toBe(true);
  });

  it('exports 6 animated arrow presets and 10 base colors (5 positive, 5 error)', () => {
    expect(ANIMATED_ARROW_PRESETS).toHaveLength(6);
    expect(ANIMATED_ARROW_COLORS.positive).toHaveLength(5);
    expect(ANIMATED_ARROW_COLORS.error).toHaveLength(5);
    expect(ALL_ANIMATED_ARROW_COLORS).toHaveLength(10);
  });

  it('disambiguates same-endpoint arrows by occurrence', () => {
    const dupModel = parseModel(`sequenceDiagram
    participant A
    participant B
    A->>B: ping
    A->>B: ping`);
    const out2 = applyArrowStyles(SEQ_SVG.replace(/<text class="messageText">m1<\/text>/, '<text class="messageText">ping</text>')
      .replace(/<text class="messageText">m2<\/text>/, '<text class="messageText">ping</text>'), dupModel, {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'ping', color: 'red', occurrence: 1 }],
    });
    const root2 = parseSvgRoot(out2);
    const first = root2.querySelector('line[data-id="i1"]')!;
    const second = root2.querySelector('line[data-id="i2"]')!;
    expect(styleOf(first).stroke).toBe('');
    expect(styleOf(second).stroke).toBe('red');
  });

  it('is a byte-identical no-op when there is nothing to style', () => {
    expect(applyArrowStyles(SEQ_SVG, model, null)).toBe(SEQ_SVG);
    expect(applyArrowStyles(SEQ_SVG, model, { version: 1 })).toBe(SEQ_SVG);
    expect(applyArrowStyles(SEQ_SVG, model, { version: 1, arrows: [] })).toBe(SEQ_SVG);
    // no matching element -> unchanged
    expect(applyArrowStyles(SEQ_SVG, model, { version: 1, arrows: [{ from: 'X', to: 'Y', color: 'red' }] })).toBe(SEQ_SVG);
  });

  it('soft-fails on unparseable SVG', () => {
    expect(applyArrowStyles('not an svg at all', model, config)).toBe('not an svg at all');
    expect(applyArrowStyles('', model, config)).toBe('');
  });

  it('soft-fails when a styled arrow has no SVG counterpart (NFR-01)', () => {
    // model has one message more than the SVG has lines: the zip falls back to
    // label matching, the unmatched arrow maps to null, and styling is a
    // byte-identical no-op instead of a throw
    const bigger = parseModel(`${SEQ_CODE}\n    A->>C: extra`);
    const withExtra: DiagramConfig = {
      version: 1,
      arrows: [{ from: 'A', to: 'C', label: 'extra', color: 'red' }],
    };
    expect(applyArrowStyles(SEQ_SVG, bigger, withExtra)).toBe(SEQ_SVG);
  });
});

describe('applyArrowStyles (flowchart fixture)', () => {
  const model = parseModel(FLOW_CODE);
  const config: DiagramConfig = {
    version: 1,
    arrows: [{ from: 'B', to: 'C', label: 'Reply', color: 'red', width: 4, dash: 'dotted' }],
  };
  const out = applyArrowStyles(FLOW_SVG, model, config);
  const root = parseSvgRoot(out);

  it('styles the right edge path', () => {
    const path = root.querySelector('path[data-id="L_B_C_0"]')!;
    expect(styleOf(path).stroke).toBe('red');
    expect(styleOf(path).strokeWidth).toBe('4');
    expect(styleOf(path).strokeDasharray).toBe('2 4');
    const other = root.querySelector('path[data-id="L_A_B_0"]')!;
    expect(styleOf(other).stroke).toBe('');
  });

  it('clones the flowchart marker and recolors it', () => {
    const path = root.querySelector('path[data-id="L_B_C_0"]')!;
    const markerId = path.getAttribute('marker-end')!.match(/^url\(#(.+)\)$/)![1];
    expect(markerId).toContain('--styled-');
    const clone = Array.from(root.querySelectorAll('marker')).find(m => m.getAttribute('id') === markerId)!;
    expect(styleOf(clone.querySelector('path')!).fill).toBe('red');
  });

  it('makes the edge label inherit the stroke color', () => {
    const span = root.querySelector('g.edgeLabel span.edgeLabel')!;
    expect(styleOf(span).fill).toBe('red');
    expect(styleOf(span).color).toBe('red');
  });
});

describe('applyNodeColors', () => {
  it('fills flowchart node shapes from CONFIG.actors colors', () => {
    const out = applyNodeColors(FLOW_SVG, {
      version: 1,
      actors: { A: { color: 'red' }, C: { color: '#00ff00' } },
    });
    const root = parseSvgRoot(out);
    const a = root.querySelector('g.node[id$="-A-0"] .label-container')!;
    expect(styleOf(a).fill).toBe('red');
    expect(styleOf(a).stroke).toBe('red');
    const c = root.querySelector('g.node[id$="-C-7"] .label-container')!;
    expect(styleOf(c).fill).toBe(rgb('#00ff00'));
    const b = root.querySelector('g.node[id$="-B-1"] .label-container')!;
    expect(b.getAttribute('style')).toBeNull();
  });

  it('resolves MergedColor_ ids to the raw config color (incl. hex)', () => {
    const svg = FLOW_SVG.replace('fx-flow-flowchart-A-0', 'fx-flow-flowchart-MergedColor_e11d48-3');
    const out = applyNodeColors(svg, { version: 1, actors: { X: { color: '#e11d48' } } });
    const rect = parseSvgRoot(out).querySelector('g.node[id$="-MergedColor_e11d48-3"] .label-container')!;
    expect(styleOf(rect).fill).toBe(rgb('#e11d48'));
  });

  it('leaves MergedKey_ nodes at the neutral default', () => {
    const svg = FLOW_SVG.replace('fx-flow-flowchart-A-0', 'fx-flow-flowchart-MergedKey_backend-3');
    const out = applyNodeColors(svg, { version: 1, actors: { X: { keys: ['backend'] } } });
    const rect = parseSvgRoot(out).querySelector('g.node[id$="-MergedKey_backend-3"] .label-container')!;
    expect(rect.getAttribute('style')).toBeNull();
  });

  it('is a no-op for sequence diagrams and missing actors', () => {
    const config: DiagramConfig = { version: 1, actors: { A: { color: 'red' } } };
    expect(applyNodeColors(SEQ_SVG, config)).toBe(SEQ_SVG);
    expect(applyNodeColors(FLOW_SVG, null)).toBe(FLOW_SVG);
    expect(applyNodeColors(FLOW_SVG, { version: 1 })).toBe(FLOW_SVG);
    expect(applyNodeColors(FLOW_SVG, { version: 1, actors: {} })).toBe(FLOW_SVG);
    expect(applyNodeColors('garbage', config)).toBe('garbage');
  });
});

describe('create -> change -> verify (render pipeline, EDITING_PLAN.md Step 5)', () => {
  it('sequence: setArrowStyle -> renderPipeline -> applyStyles -> styled SVG + selection map', async () => {
    const raw = createSequenceDiagram();
    const res = setArrowStyle(raw, null, 'm:0', { color: '#e11d48', width: 3, dash: 'dashed' });
    expect(res.warning).toBeUndefined();
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' },
    ]);

    const { svg, processedCode, model, config } = await renderPipeline(res.code);
    const styled = applyStyles(svg, processedCode, config);
    const root = parseSvgRoot(styled);

    const line = root.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(line).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(line).strokeWidth).toBe('3');
    expect(styleOf(line).strokeDasharray).toBe('8 6');

    const markerId = line.getAttribute('marker-end')!.match(/^url\(#(.+)\)$/)![1];
    expect(markerId).toContain('--styled-');
    const clone = Array.from(root.querySelectorAll('marker')).find(m => m.getAttribute('id') === markerId)!;
    expect(styleOf(clone.querySelector('path')!).fill).toBe(rgb('#e11d48'));

    const other = root.querySelector('[data-et="message"][data-from="B"]')!;
    expect(styleOf(other).stroke).toBe('');

    // the styled processed element still maps back to its raw element
    const map = buildSelectionMap(res.code, processedCode, config, {});
    const rawMsg = parseModel(res.code).elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'Hello')!;
    const processedMsg = model.elements.find(e => e.kind === 'message' && (e as MessageElement).label === 'Hello')!;
    expect(map.get(processedMsg.key)?.key).toBe(rawMsg.key);

    // labels survive styling
    expect(svgText(styled)).toContain('Hello');
    expect(svgText(styled)).toContain('Hi there');
  });

  it('flowchart: setArrowStyle + setActorColor -> styled edge and colored node', async () => {
    const raw = createFlowchartDiagram();
    const styled1 = setArrowStyle(raw, null, 'e:1', { color: 'red', dash: 'dotted' });
    const styled2 = setActorColor(styled1.code, styled1.config, 'n:0', 'blue');
    expect(styled2.config?.actors).toEqual({ A: { color: 'blue' } });

    const { svg, processedCode, config } = await renderPipeline(styled2.code);
    const out = applyStyles(svg, processedCode, config);
    const root = parseSvgRoot(out);

    const edge = root.querySelector('path[data-et="edge"][data-id="L_B_A_0"]')!;
    expect(styleOf(edge).stroke).toBe('red');
    expect(styleOf(edge).strokeDasharray).toBe('2 4');
    const markerId = edge.getAttribute('marker-end')!.match(/^url\(#(.+)\)$/)![1];
    const clone = Array.from(root.querySelectorAll('marker')).find(m => m.getAttribute('id') === markerId)!;
    expect(styleOf(clone.querySelector('path')!).fill).toBe('red');
    // the edge label inherits the color
    const label = root.querySelector('g.edgeLabel span.edgeLabel')!;
    expect(styleOf(label).fill).toBe('red');

    const nodeA = root.querySelector('g.node[id*="flowchart-A-"] .label-container')!;
    expect(styleOf(nodeA).fill).toBe('blue');
    const nodeB = root.querySelector('g.node[id*="flowchart-B-"] .label-container')!;
    expect(styleOf(nodeB).fill).toBe('');  // real mermaid renders style="" on node shapes
  });

  it('flowchart: merged nodes get their color from the MergedColor_ id', async () => {
    const raw = `flowchart TD
    A[Alice] --> B[Bob]`;
    const config: DiagramConfig = {
      version: 1,
      actors: { A: { color: '#e11d48' }, B: { color: '#e11d48' } },
    };
    const code = updateViewsData(raw, config);
    const { svg, processedCode, config: resolved } = await renderPipeline(code, { mergeByColor: ['#e11d48'] });
    const out = applyStyles(svg, processedCode, resolved, { mergeByColor: ['#e11d48'] });
    const root = parseSvgRoot(out);
    const merged = root.querySelector('g.node[id*="flowchart-MergedColor_e11d48-"] .label-container')!;
    expect(merged).toBeTruthy();
    expect(styleOf(merged).fill).toBe(rgb('#e11d48'));
  });
});

describe('Step 11 — panel dispatch -> merge/hide integration (create -> change -> verify)', () => {
  it('flowchart: node colors set via the panel dispatch render as node fills', async () => {
    // create a new flowchart, then change it with the same transforms the
    // panel dispatches (setActorColor per node)
    const raw = createFlowchartDiagram();
    const c1 = setActorColor(raw, null, 'n:0', '#e11d48');
    const c2 = setActorColor(c1.code, c1.config, 'n:1', '#2563eb');
    expect(c2.config?.actors).toEqual({ A: { color: '#e11d48' }, B: { color: '#2563eb' } });

    // verify: full render pipeline -> applyNodeColors -> SVG fills
    const { svg, processedCode, config } = await renderPipeline(c2.code);
    const out = applyStyles(svg, processedCode, config);
    const root = parseSvgRoot(out);
    const nodeA = root.querySelector('g.node[id*="flowchart-A-"] .label-container')!;
    const nodeB = root.querySelector('g.node[id*="flowchart-B-"] .label-container')!;
    expect(styleOf(nodeA).fill).toBe(rgb('#e11d48'));
    expect(styleOf(nodeB).fill).toBe(rgb('#2563eb'));
  });

  it('sequence: component color flows through the box grouping', async () => {
    const raw = createSequenceDiagram();
    const colored = setActorColor(raw, null, 'p:0', '#e11d48');
    const { processedCode } = await renderPipeline(colored.code);
    // transformActors reads config.actors[id].color and regroups the
    // participant into a box block
    expect(processedCode).toContain('box #e11d48');
    expect(processedCode.indexOf('participant A as Alice')).toBeGreaterThan(processedCode.indexOf('box #e11d48'));
  });

  it('sequence: tagged actors merged by key — the internal styled arrow follows merge / clean / un-merge', async () => {
    // create a new sequence diagram; tag both actors and style their arrow
    // with the same transforms the panel dispatches
    const raw = createSequenceDiagram();
    const t1 = addTag(raw, null, 'p:0', 'backend');
    const t2 = addTag(t1.code, t1.config, 'p:1', 'backend');
    const styled = setArrowStyle(t2.code, t2.config, 'm:0', { color: '#e11d48', width: 3 });
    expect(styled.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3 },
    ]);

    // merged by key: A and B collapse into one actor; the internal arrow
    // renders as a merged self-call that carries the style
    const merged = await renderPipeline(styled.code, { mergeByKeys: ['backend'] });
    const mergedOut = applyStyles(merged.svg, merged.processedCode, merged.config, { mergeByKeys: ['backend'] });
    const mergedRoot = parseSvgRoot(mergedOut);
    const selfCall = mergedRoot.querySelector('[data-et="message"][data-from^="MergedKey_"][data-to^="MergedKey_"]');
    expect(selfCall).toBeTruthy();
    expect(styleOf(selfCall).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(selfCall).strokeWidth).toBe('3');
    expect(svgText(mergedOut)).toContain('Hello');

    // clean merge: the internal self-call is dropped — and its style with it
    const clean = await renderPipeline(styled.code, { mergeCleanByKeys: ['backend'] });
    const cleanOut = applyStyles(clean.svg, clean.processedCode, clean.config, { mergeCleanByKeys: ['backend'] });
    const cleanRoot = parseSvgRoot(cleanOut);
    expect(cleanRoot.querySelector('[data-et="message"]')).toBeNull();

    // un-merged (default): the original arrow carries the style again
    const plain = await renderPipeline(styled.code);
    const plainOut = applyStyles(plain.svg, plain.processedCode, plain.config);
    const plainRoot = parseSvgRoot(plainOut);
    const arrow = plainRoot.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(arrow).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(arrow).strokeWidth).toBe('3');
    expect(svgText(plainOut)).toContain('Hello');
  });
});
