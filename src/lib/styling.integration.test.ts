// R-07 integration proof (EDITING_PLAN.md Step 12): arrows follow the rules
// of the merging, end to end at the transform/render level. The full chain
// raw -> transformActors -> processMermaid -> parseModel -> mermaid.render ->
// applyArrowStyles/applyNodeColors runs on a freshly created diagram under
// default / merged / clean / hidden and the rendered SVG is asserted in each
// state (create -> change -> verify: the diagram and all styles are produced
// by the same editor transforms the panel dispatches).

import { describe, it, expect } from 'vitest';
import { renderPipeline, applyStyles, svgText, parseConfig } from './editorTestHarness';
import { setActorColor, setArrowStyle, addTag, editMessageLabel } from './editor';
import { ActorTransformOptions } from './preprocessor';
import { parseSvgRoot, rgb, styleOf } from './svgTestFixtures';

// Fixture: two same-color actors (A, B) with an internal styled arrow, an
// external styled arrow to a differently-colored actor (C), and a styled
// arrow to an actor that gets hidden (D).
function buildFixture(): string {
  const raw = `sequenceDiagram
    participant A as Api
    participant B as Db
    participant C as Cache
    participant D as Logger
    A->>B: query Db
    B-->>A: result
    A->>C: read cache
    C-->>A: hit
    A->>D: log event`;
  const cA = setActorColor(raw, null, 'p:0', 'red');
  const cB = setActorColor(cA.code, cA.config, 'p:1', 'red');
  const tA = addTag(cB.code, cB.config, 'p:0', 'backend');
  const tB = addTag(tA.code, tA.config, 'p:1', 'backend');
  const cC = setActorColor(tB.code, tB.config, 'p:2', 'blue');
  const cD = setActorColor(cC.code, cC.config, 'p:3', 'gray');
  const s1 = setArrowStyle(cD.code, cD.config, 'm:0', { color: '#e11d48', width: 3 }); // internal
  const s2 = setArrowStyle(s1.code, s1.config, 'm:2', { color: '#2563eb' });              // external
  const s3 = setArrowStyle(s2.code, s2.config, 'm:4', { dash: 'dotted' });               // to hidden actor
  expect(s3.warning).toBeUndefined();
  return s3.code;
}

async function renderState(code: string, options: ActorTransformOptions) {
  const { svg, processedCode, config } = await renderPipeline(code, options);
  const out = applyStyles(svg, processedCode, config, options);
  return { root: parseSvgRoot(out), text: svgText(out) };
}

describe('R-07 integration: arrows follow the rules of the merging (Step 12)', () => {
  it('builds the fixture with the expected CONFIG', () => {
    const config = parseConfig(buildFixture());
    expect(config?.actors).toEqual({
      A: { color: 'red', keys: ['backend'] },
      B: { color: 'red', keys: ['backend'] },
      C: { color: 'blue' },
      D: { color: 'gray' },
    });
    expect(config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'query Db', color: '#e11d48', width: 3 },
      { from: 'A', to: 'C', label: 'read cache', color: '#2563eb' },
      { from: 'A', to: 'D', label: 'log event', dash: 'dotted' },
    ]);
  });

  it('default: original styles on the original arrows', async () => {
    const code = buildFixture();
    const { root, text } = await renderState(code, {});

    const internal = root.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(internal).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(internal).strokeWidth).toBe('3');
    const external = root.querySelector('[data-et="message"][data-from="A"][data-to="C"]')!;
    expect(styleOf(external).stroke).toBe(rgb('#2563eb'));
    const toHidden = root.querySelector('[data-et="message"][data-from="A"][data-to="D"]')!;
    expect(styleOf(toHidden).strokeDasharray).toBe('2 4');
    expect(text).toContain('query Db');
    expect(text).toContain('read cache');
    expect(text).toContain('log event');
  });

  it('merged: the internal arrow renders as a merged self-call WITH style; the external arrow is restyled to the merged endpoints', async () => {
    const code = buildFixture();
    const { root, text } = await renderState(code, { mergeByKeys: ['backend'] });

    // A and B collapsed into one actor: two self-calls ('query Db', 'result')
    const selfCalls = Array.from(
      root.querySelectorAll('[data-et="message"][data-from="MergedKey_backend"][data-to="MergedKey_backend"]')
    );
    expect(selfCalls).toHaveLength(2);
    // exactly the internal arrow carries its style onto the merged self-call
    const styled = selfCalls.filter(el => styleOf(el).stroke === rgb('#e11d48'));
    expect(styled).toHaveLength(1);
    expect(styleOf(styled[0]).strokeWidth).toBe('3');
    expect(text).toContain('query Db');

    // the external arrow was restyled to the merged endpoints
    const external = root.querySelector('[data-et="message"][data-from="MergedKey_backend"][data-to="C"]')!;
    expect(styleOf(external).stroke).toBe(rgb('#2563eb'));
    // the arrow to D is unaffected by the merge
    const toD = root.querySelector('[data-et="message"][data-from="MergedKey_backend"][data-to="D"]')!;
    expect(styleOf(toD).strokeDasharray).toBe('2 4');
  });

  it('clean: the internal self-call is dropped and its style is inert with it', async () => {
    const code = buildFixture();
    const { root, text } = await renderState(code, { mergeCleanByKeys: ['backend'] });

    // both internal messages are gone
    expect(text).not.toContain('query Db');
    expect(text).not.toContain('result');
    expect(root.querySelectorAll('[data-et="message"]')).toHaveLength(3);
    // the internal style is inert: nothing carries it anywhere
    expect(root.querySelector('[style*="rgb(225, 29, 72)"]')).toBeNull();

    // the external and hidden-target arrows keep their styles
    const external = root.querySelector('[data-et="message"][data-from="MergedKey_backend"][data-to="C"]')!;
    expect(styleOf(external).stroke).toBe(rgb('#2563eb'));
    const toD = root.querySelector('[data-et="message"][data-from="MergedKey_backend"][data-to="D"]')!;
    expect(styleOf(toD).strokeDasharray).toBe('2 4');
  });

  it('hidden: the hidden actor’s arrow is dropped and its style is inert with it', async () => {
    const code = buildFixture();
    const { root, text } = await renderState(code, { hideColors: ['gray'] });

    // the arrow to the hidden actor is gone
    expect(text).not.toContain('log event');
    expect(root.querySelector('[data-et="message"][data-to="D"]')).toBeNull();
    // its dash style is inert: nothing carries it anywhere
    expect(root.querySelector('[style*="stroke-dasharray: 2 4"]')).toBeNull();

    // the other styled arrows are untouched
    const internal = root.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(internal).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(internal).strokeWidth).toBe('3');
    const external = root.querySelector('[data-et="message"][data-from="A"][data-to="C"]')!;
    expect(styleOf(external).stroke).toBe(rgb('#2563eb'));
  });

  it('un-merge / un-hide: the original arrows and their styles come back', async () => {
    const code = buildFixture();
    // merge, then go back to default: styles are keyed by raw endpoints, so
    // they match the original arrows again
    const merged = await renderState(code, { mergeByKeys: ['backend'], hideColors: ['gray'] });
    expect(merged.text).not.toContain('log event');
    expect(merged.text).not.toContain('query Db result');

    const back = await renderState(code, {});
    const internal = back.root.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(internal).stroke).toBe(rgb('#e11d48'));
    const toHidden = back.root.querySelector('[data-et="message"][data-from="A"][data-to="D"]')!;
    expect(styleOf(toHidden).strokeDasharray).toBe('2 4');
    expect(back.text).toContain('log event');
  });
});

describe('editMessageLabel keeps the rendered arrow style', () => {
  it('re-renders with the same stroke color after the arrow text changes', async () => {
    const raw = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;
    const styled = setArrowStyle(raw, null, 'm:0', { color: '#e11d48', width: 3 });
    const before = await renderState(styled.code, {});
    const arrowBefore = before.root.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(arrowBefore).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(arrowBefore).strokeWidth).toBe('3');

    const edited = editMessageLabel(styled.code, styled.config, 'm:0', 'Hey');
    expect(edited.warning).toBeUndefined();
    const after = await renderState(edited.code, {});
    const arrowAfter = after.root.querySelector('[data-et="message"][data-from="A"][data-to="B"]')!;
    expect(styleOf(arrowAfter).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(arrowAfter).strokeWidth).toBe('3');
    expect(after.text).toContain('Hey');
    expect(after.text).not.toContain('Hello');
  });
});
