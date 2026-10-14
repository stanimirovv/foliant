// Shared create -> change -> verify test harness (EDITING_PLAN.md Section 4.13).
// Every step's integration tests create a brand-new diagram through these
// helpers (never a pre-existing repo fixture) and drive it through the same
// code path the UI uses.

import { parseViewsData, DiagramConfig } from './views';
import { DiagramModel, parseModel } from './model';
import { ActorTransformOptions, PreprocessorOptions, processMermaid, transformActors } from './preprocessor';
import { applyArrowStyles, applyNodeColors, reorderSequenceLayers, markPanExclusionTargets, rewriteArrowStyles } from './styling';

export function createSequenceDiagram(): string {
  return `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;
}

export function createFlowchartDiagram(): string {
  return `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A`;
}

export function parseConfig(code: string): DiagramConfig | null {
  return parseViewsData(code);
}

// --- Render pipeline (EDITING_PLAN.md Step 5) -------------------------------
// Mirrors the ClientPage pipeline exactly: parse CONFIG -> transformActors ->
// processMermaid -> mermaid.render. mermaid is imported lazily so pure
// transform tests never pay for it; the jsdom geometry polyfill lives in
// vitest.setup.ts.

export interface RenderPipelineOptions extends ActorTransformOptions, Partial<PreprocessorOptions> {}

export interface RenderPipelineResult {
  svg: string;                 // raw mermaid render of the processed code
  processedCode: string;       // post transformActors + processMermaid
  model: DiagramModel;         // parsed from processedCode
  config: DiagramConfig | null; // arrow styles resolved to post-transform endpoints
}

let mermaidPromise: Promise<{ render: (id: string, code: string) => Promise<{ svg: string }> }> | null = null;
let renderCounter = 0;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => {
      m.default.initialize({ startOnLoad: false });
      return m.default;
    });
  }
  return mermaidPromise;
}

export async function renderPipeline(rawCode: string, options: RenderPipelineOptions = {}): Promise<RenderPipelineResult> {
  const config = parseConfig(rawCode);
  const actorTransformed = transformActors(rawCode, config, options);
  const { code: processedCode } = processMermaid(actorTransformed, {
    isRegionVisible: options.isRegionVisible ?? (() => true),
  });
  const mermaid = await loadMermaid();
  const id = `test-svg-${renderCounter++}`;
  const { svg } = await mermaid.render(id, processedCode);
  return {
    svg,
    processedCode,
    model: parseModel(processedCode),
    config: rewriteArrowStyles(config, options),
  };
}

// Applies the resolved arrow styles + node colors + pan-exclusion marking to
// a rendered SVG — the same calls DiagramViewer makes after mermaid.render.
export function applyStyles(svg: string, processedCode: string, config: DiagramConfig | null, options: ActorTransformOptions = {}): string {
  const model = parseModel(processedCode);
  const resolved = rewriteArrowStyles(config, options);
  let out = reorderSequenceLayers(svg);
  out = applyArrowStyles(out, model, resolved);
  out = applyNodeColors(out, resolved);
  out = markPanExclusionTargets(out);
  return out;
}

// All visible text of an SVG, whitespace-collapsed (assertion helper).
export function svgText(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'text/html');
  const root = doc.querySelector('svg');
  if (!root) return '';
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
}
