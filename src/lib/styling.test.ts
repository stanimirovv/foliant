import { describe, it, expect } from 'vitest';
import { rewriteArrowStyles } from './styling';
import { buildActorRewriteMap, transformActors } from './preprocessor';
import { parseModel, MessageElement, EdgeElement } from './model';
import { updateViewsData, DiagramConfig } from './views';
import { createSequenceDiagram, createFlowchartDiagram, parseConfig } from './editorTestHarness';

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
