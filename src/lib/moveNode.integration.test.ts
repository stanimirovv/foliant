// Render-level verification for moveNode: the transform's whole point is
// changing the rendered position of a node, so assert against real mermaid
// layout output (same harness the svgmap/styling integration tests use).

import { describe, it, expect } from 'vitest';
import { renderPipeline } from './editorTestHarness';
import { moveNode } from './editor';

// Node id -> {x, y, label} from a rendered flowchart SVG.
async function nodeLayout(code: string) {
  const { svg } = await renderPipeline(code);
  const doc = new DOMParser().parseFromString(svg, 'text/html');
  const out: Record<string, { x: number; y: number; label: string }> = {};
  doc.querySelectorAll('g.node[id]').forEach(el => {
    const id = el.getAttribute('id') ?? '';
    const m = id.match(/-flowchart-(.+)-\d+$/);
    if (!m) return;
    const t = el.getAttribute('transform') ?? '';
    const tm = t.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
    const label = el.querySelector('.nodeLabel')?.textContent?.trim() ?? '';
    out[m[1]] = { x: tm ? parseFloat(tm[1]) : NaN, y: tm ? parseFloat(tm[2]) : NaN, label };
  });
  return out;
}

describe('moveNode (rendered layout)', () => {
  it('moves a standalone-declared node to the end', async () => {
    const code = `flowchart TD\n    C[Standalone]\n    A[Alice] --> B[Bob]`;
    const res = moveNode(code, null, 'n:0');
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.C.x).toBeGreaterThan(layout.A.x);
    expect(layout.C.label).toBe('Standalone');
  });

  it('moves an inline-declared node before another node', async () => {
    const code = `flowchart TD\n    A[Alice] --> B[Bob]\n    C[Standalone]`;
    const res = moveNode(code, null, 'n:2', 'n:0'); // C before A
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.C.x).toBeLessThan(layout.A.x);
    expect(layout.C.label).toBe('Standalone');
  });

  it('moves a node with several edges to the end (all mention lines move)', async () => {
    const code = `flowchart TD\n    A[Alice] --> B[Bob]\n    B -->|Reply| A\n    A -- ping --> B\n    C[Standalone]`;
    const res = moveNode(code, null, 'n:0'); // A to end
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.A.x).toBeGreaterThan(layout.C.x);
    expect(layout.A.label).toBe('Alice');
  });

  it('moves an inline-declared node to the end (edge line relocation)', async () => {
    const code = `flowchart TD\n    A[Alice] --> B[Bob]\n    C`;
    const res = moveNode(code, null, 'n:0'); // A to end
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.A.x).toBeGreaterThan(layout.C.x);
    expect(layout.A.label).toBe('Alice');
  });

  it('keeps the label when the relocated declaration is not the last shaped one', async () => {
    const code = `flowchart TD\n    A[Alice] --> B\n    A[Alicia]\n    C`;
    const res = moveNode(code, null, 'n:0'); // A to end
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.A.label).toBe('Alicia');
    expect(layout.A.x).toBeGreaterThan(layout.C.x);
  });

  it('keeps the label when the relocated declaration is the last shaped one', async () => {
    const code = `flowchart TD\n    A[Alicia]\n    A[Alice] --> B\n    C`;
    const res = moveNode(code, null, 'n:0'); // A to end
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.A.label).toBe('Alice');
    expect(layout.A.x).toBeGreaterThan(layout.C.x);
  });

  it('reorders along the vertical axis in LR flowcharts', async () => {
    const code = `flowchart LR\n    A --> B\n    C`;
    const res = moveNode(code, null, 'n:0'); // A to end
    expect(res.warning).toBeUndefined();
    const layout = await nodeLayout(res.code);
    expect(layout.A.y).toBeGreaterThan(layout.C.y);
  });
});
