// Step 13 — NFR-04 performance smoke test + NFR-01 soft-fail at scale.
// The ~2000-line diagram is GENERATED at test time (EDITING_PLAN.md Step 13:
// the fixture is never committed — diagrams/ is user data). The styling pass
// runs against a synthetic SVG that mirrors the confirmed Mermaid 12.1
// structure (see svgTestFixtures.ts): jsdom's fixed geometry polyfill makes a
// real 2000-line mermaid.render unusable, and the NFR targets the
// O(elements) post-process, not mermaid itself (the existing 500 ms render
// debounce absorbs the re-render scheduling).

import { describe, it, expect } from 'vitest';
import { parseModel, DiagramModel, MessageElement } from './model';
import { processMermaid, transformActors } from './preprocessor';
import { rewriteArrowStyles, applyArrowStyles, applyNodeColors } from './styling';
import { parseViewsData } from './views';
import { editMessageLabel, deleteElement, setArrowStyle } from './editor';
import { parseSvgRoot, rgb, styleOf } from './svgTestFixtures';

const MESSAGE_COUNT = 1997; // + header + 2 participants = 2000 lines

// A brand-new sequence diagram, generated at test time (never a repo fixture).
function createBigSequenceDiagram(messages: number): string {
  const parts: string[] = [
    'sequenceDiagram',
    '    participant A as Alice',
    '    participant B as Bob',
  ];
  for (let i = 0; i < messages; i++) {
    const from = i % 2 === 0 ? 'A' : 'B';
    const to = i % 2 === 0 ? 'B' : 'A';
    parts.push(`    ${from}->>${to}: Message number ${i} with some label text`);
  }
  return parts.join('\n');
}

// A synthetic render of the diagram, mirroring the Mermaid 12.1 structure the
// svgmap zip relies on (participants by data-id, messages by source order
// with data-from/data-to, one messageText sibling per line).
function bigSequenceSvg(model: DiagramModel): string {
  const messages = model.elements.filter((e): e is MessageElement => e.kind === 'message');
  const parts: string[] = ['<svg id="big" aria-roledescription="sequence">'];
  ['A', 'B'].forEach((id, i) => {
    parts.push(
      `<g><line id="actor${i}" class="actor-line 200" data-et="life-line" data-id="${id}"></line>` +
      `<g id="root-${i}" data-et="participant" data-type="participant" data-id="${id}">` +
      `<rect class="actor actor-top" name="${id}"></rect>` +
      `<text class="actor actor-box"><tspan>${id}</tspan></text></g></g>`
    );
  });
  parts.push('<defs><marker id="big-arrowhead" refX="7.9" refY="5"><path d="M -1 0 L 10 5 L 0 10 z"></path></marker></defs>');
  messages.forEach((m, i) => {
    parts.push(`<text class="messageText">${m.label ?? ''}</text>`);
    parts.push(
      `<line class="messageLine0" data-et="message" data-id="i${i + 1}" data-from="${m.from}" data-to="${m.to}" stroke="none" marker-end="url(#big-arrowhead)"></line>`
    );
  });
  parts.push('</svg>');
  return parts.join('\n');
}

describe('NFR-04 performance smoke test (Step 13)', () => {
  it('parses and styles a ~2000-line diagram well under the 500 ms render debounce', () => {
    // create: a brand-new ~2000-line diagram
    const raw = createBigSequenceDiagram(MESSAGE_COUNT);
    expect(raw.split('\n')).toHaveLength(2000);

    // change: style three arrows through the same transform the panel dispatches
    let code = raw;
    for (const [key, color, width] of [['m:0', '#e11d48', 3], ['m:500', '#0ea5e9', 2], ['m:1000', '#22c55e', 1]] as const) {
      const res = setArrowStyle(code, parseViewsData(code), key, { color, width, dash: 'dashed' });
      expect(res.warning).toBeUndefined();
      code = res.code;
    }
    const config = parseViewsData(code);
    expect(config?.arrows).toHaveLength(3);

    // verify: time the whole post-process (everything except mermaid.render) —
    // the same calls DiagramViewer makes after each render
    const svg = bigSequenceSvg(parseModel(code));
    const started = performance.now();
    const model = parseModel(code);
    const actorTransformed = transformActors(code, config, {});
    const { code: processed, warnings } = processMermaid(actorTransformed, { isRegionVisible: () => true });
    const resolved = rewriteArrowStyles(config, {});
    const styled = applyArrowStyles(svg, parseModel(processed), resolved);
    const final = applyNodeColors(styled, resolved);
    const elapsed = performance.now() - started;
    console.log(`NFR-04 smoke: ${model.elements.length} elements, post-process ${elapsed.toFixed(1)} ms (budget 400 ms)`);

    expect(warnings).toEqual([]);
    // Generous budget: measured ~150 ms idle, ~280 ms under full-suite load;
    // still under the 500 ms render debounce. An O(n^2) regression takes orders
    // of magnitude longer at n=2000 and fails this by far.
    expect(elapsed).toBeLessThan(400);

    // the styles landed on the right lines (positional zip, endpoints match)
    const root = parseSvgRoot(final);
    const lines = Array.from(root.querySelectorAll('[data-et="message"]'));
    expect(lines).toHaveLength(MESSAGE_COUNT);
    const styled0 = lines[0];
    expect(styleOf(styled0).stroke).toBe(rgb('#e11d48'));
    expect(styleOf(styled0).strokeWidth).toBe('3');
    expect(styleOf(styled0).strokeDasharray).toBe('8 6');
    expect(styled0.getAttribute('marker-end')).toContain('--styled-');
    expect(styleOf(lines[500]).stroke).toBe(rgb('#0ea5e9'));
    expect(styleOf(lines[1000]).stroke).toBe(rgb('#22c55e'));
    // unstyled messages untouched
    expect(styleOf(lines[1]).stroke).toBe('');
    expect(lines[1].getAttribute('marker-end')).toBe('url(#big-arrowhead)');
    // one recolored marker clone per styled arrow
    const clones = Array.from(root.querySelectorAll('marker[id*="--styled-"]'));
    expect(clones).toHaveLength(3);
  });

  it('create -> change -> verify at scale: an unclosed region soft-fails the pipeline; intact edits apply, broken-area edits no-op with a warning', () => {
    // create: a brand-new ~2000-line diagram
    const raw = createBigSequenceDiagram(MESSAGE_COUNT);
    // change: break it — an unclosed region around the last 100 messages
    const lines = raw.split('\n');
    lines.splice(lines.length - 100, 0, '    %% @region-start: perf-check');
    const broken = lines.join('\n');

    // the pipeline soft-fails and hands the ORIGINAL code to the renderer
    const actorTransformed = transformActors(broken, null, {});
    const { code: processed, warnings } = processMermaid(actorTransformed, { isRegionVisible: () => true });
    expect(processed).toBe(broken);
    expect(warnings).toEqual(['Unclosed region tag: perf-check']);

    // parseModel still recognizes the intact elements and the broken region
    const model = parseModel(broken);
    expect(model.elements.find(e => e.key === 'r:0')).toMatchObject({ kind: 'region', regionType: 'perf-check' });
    expect(model.elements.some(e => e.key === 'm:0')).toBe(true);

    // edits to intact elements still apply
    const edited = editMessageLabel(broken, null, 'm:0', 'Updated first message');
    expect(edited.warning).toBeUndefined();
    expect(edited.code).toContain('A->>B: Updated first message');

    // edits to the broken area are no-ops with a warning
    const del = deleteElement(broken, null, 'r:0');
    expect(del.warning).toBe(`Cannot delete element of kind 'region'`);
    expect(del.code).toBe(broken);
    const unknown = editMessageLabel(broken, null, 'm:999999', 'x');
    expect(unknown.warning).toBe('Element m:999999 is not a message or edge');
    expect(unknown.code).toBe(broken);
  });
});
