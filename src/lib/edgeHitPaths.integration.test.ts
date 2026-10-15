// Integration: the invisible per-edge hit paths (addEdgeHitPaths) on real
// mermaid renders. Unlabeled flowchart edges render as a single ~2px-stroke
// path with fill:none, so without a hit path their only click target is the
// stroke itself. These tests drive the same pipeline DiagramViewer runs
// (renderPipeline + applyStyles) and verify that every model edge — including
// chained and parallel edges — gets exactly one fat, invisible, selectable
// hit path that resolves back to the right model edge.

import { describe, it, expect } from 'vitest';
import { renderPipeline, applyStyles } from './editorTestHarness';
import { parseModel } from './model';
import { zipModelToSvg, elementKeyAtTarget, EDGE_HIT_CLASS } from './svgmap';
import { EDGE_HIT_STROKE_WIDTH, PAN_EXCLUDE_CLASS } from './styling';
import { DiagramConfig } from './views';
import { parseSvgRoot } from './svgTestFixtures';

// Obfuscated actors (never the user's real diagram data). Includes a chain
// (W --> X --> Z) and a parallel edge (W --> X twice) to prove the hit paths
// zip 1:1 with the model edges.
const FLOW = `flowchart LR
    W["Widget"] --> X["Gadget"]
    X -->|ships to| Y["Doohickey"]
    Y --> Z["Gizmo"]
    W --> X --> Z`;

describe('edge hit paths (render pipeline)', () => {
  it('adds exactly one hit path per model edge, mirroring the visible paths 1:1', async () => {
    const res = await renderPipeline(FLOW);
    const styled = applyStyles(res.svg, res.processedCode, res.config);
    const root = parseSvgRoot(styled);
    const model = parseModel(res.processedCode);

    const visible = Array.from(root.querySelectorAll('g.edgePaths path[data-et="edge"]'));
    const hits = Array.from(root.querySelectorAll(`g.edgePaths path.${EDGE_HIT_CLASS}`));
    expect(visible.length).toBe(5);
    expect(hits.length).toBe(5);
    // mermaid gives every edge a distinct data-id, so the parallel pair
    // (W --> X twice) is individually addressable
    expect(new Set(visible.map(el => el.getAttribute('data-id'))).size).toBe(5);
    // each hit path mirrors its visible path's data-id and geometry
    hits.forEach((hit, i) => {
      expect(hit.getAttribute('data-id')).toBe(visible[i].getAttribute('data-id'));
      expect(hit.getAttribute('d')).toBe(visible[i].getAttribute('d'));
      expect(hit.getAttribute('stroke')).toBe('transparent');
      expect(hit.getAttribute('stroke-width')).toBe(String(EDGE_HIT_STROKE_WIDTH));
      expect(hit.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(hit.getAttribute('pointer-events')).toBe('stroke');
      expect(hit.getAttribute('fill')).toBe('none');
    });

    // the model<->SVG zip is undisturbed: every model edge maps to its
    // visible path by position, with no fallback warnings
    const zip = zipModelToSvg(root, model);
    expect(zip.warnings).toEqual([]);
    expect(zip.edges.length).toBe(5);
    zip.edges.forEach((el, i) => {
      expect(el).toBe(visible[i]);
    });
    // the parallel W --> X edges (model e:0 and e:3) zip to distinct paths
    expect(zip.edges[0]!.getAttribute('data-id')).not.toBe(zip.edges[3]!.getAttribute('data-id'));
  });

  it('resolves a click on every hit path to the right model edge', async () => {
    const res = await renderPipeline(FLOW);
    const styled = applyStyles(res.svg, res.processedCode, res.config);
    const root = parseSvgRoot(styled);
    const model = parseModel(res.processedCode);

    const hits = Array.from(root.querySelectorAll(`g.edgePaths path.${EDGE_HIT_CLASS}`));
    expect(hits.length).toBe(5);
    const expectedKeys = model.elements.filter(e => e.kind === 'edge').map(e => e.key);
    expect(expectedKeys).toEqual(['e:0', 'e:1', 'e:2', 'e:3', 'e:4']);
    hits.forEach((hit, i) => {
      expect(elementKeyAtTarget(hit, root, model)).toBe(expectedKeys[i]);
    });
    // the parallel W --> X edges (occurrences 0 and 1) resolve to distinct keys
    expect(elementKeyAtTarget(hits[0], root, model)).not.toBe(elementKeyAtTarget(hits[3], root, model));
  });

  it('tags every hit path as a pan-exclusion target', async () => {
    const res = await renderPipeline(FLOW);
    const styled = applyStyles(res.svg, res.processedCode, res.config);
    const root = parseSvgRoot(styled);
    expect(root.querySelectorAll(`path.${EDGE_HIT_CLASS}.${PAN_EXCLUDE_CLASS}`).length).toBe(5);
  });

  it('inserts the hit path after the arrow-animation overlays of a styled edge', async () => {
    const res = await renderPipeline(FLOW);
    const config: DiagramConfig = {
      version: 1,
      arrows: [{ from: 'X', to: 'Y', label: 'ships to', color: '#e11d48', animation: 'pulse' }],
    };
    const styled = applyStyles(res.svg, res.processedCode, config);
    const root = parseSvgRoot(styled);
    const model = parseModel(res.processedCode);

    const kids = Array.from(root.querySelector('g.edgePaths')!.children);
    const kind = (el: Element) =>
      el.classList.contains('arrow-anim-packet-runner') ? 'runner'
        : el.classList.contains(EDGE_HIT_CLASS) ? 'hit'
        : 'edge';
    // every edge is immediately followed by its hit path; the styled edge's
    // animation overlay sits between the visible path and its hit path
    expect(kids.map(kind)).toEqual([
      'edge', 'hit',
      'edge', 'runner', 'hit',
      'edge', 'hit',
      'edge', 'hit',
      'edge', 'hit',
    ]);
    const styledEdge = kids[2];
    const runner = kids[3];
    const styledHit = kids[4];
    expect(runner.previousElementSibling).toBe(styledEdge);
    expect(styledHit.previousElementSibling).toBe(runner);
    expect(styledHit.getAttribute('data-id')).toBe(styledEdge.getAttribute('data-id'));

    // the styled edge is still selectable through its hit path
    expect(elementKeyAtTarget(styledHit, root, model)).toBe('e:1');
  });
});
