// Arrow style resolution and SVG post-processing (EDITING_PLAN.md 4.6, 4.9).
// Styles are STORED in CONFIG.arrows against RAW endpoints, but RESOLVED
// against post-transform actor names, so they follow the rules of merging.

import { ActorTransformOptions, buildActorRewriteMap } from './preprocessor';
import { ArrowStyle, DiagramConfig, ArrowAnimationType } from './views';
import { DiagramModel, ModelElement } from './model';
import { zipModelToSvg } from './svgmap';

export interface AnimatedArrowPreset {
  id: ArrowAnimationType;
  name: string;
  description: string;
  isError?: boolean;
}

export const ANIMATED_ARROW_PRESETS: AnimatedArrowPreset[] = [
  { id: 'flow', name: 'Stream', description: 'Smooth continuous flow' },
  { id: 'pulse', name: 'Glowing Orb', description: 'Full line with traveling glowing packet' },
  { id: 'cyber', name: 'Cyber Glow', description: 'High-velocity neon tracer' },
  { id: 'broken-sender', name: 'Broken Sender', description: 'X at origin: sender fails or sends broken request', isError: true },
  { id: 'broken-network', name: 'Broken Network', description: 'X in transit: network severed / dropped mid-flight', isError: true },
  { id: 'broken-receiver', name: 'Broken Receiver', description: 'X on arrival: receiver crashes / rejects receipt', isError: true },
];

export const ANIMATED_ARROW_COLORS = {
  positive: [
    { name: 'Emerald', hex: '#10b981' },
    { name: 'Teal', hex: '#06b6d4' },
    { name: 'Ocean', hex: '#0ea5e9' },
    { name: 'Indigo', hex: '#3b82f6' },
    { name: 'Mint', hex: '#059669' },
  ],
  error: [
    { name: 'Amber', hex: '#f59e0b' },
    { name: 'Flame', hex: '#f97316' },
    { name: 'Rose', hex: '#f43f5e' },
    { name: 'Crimson', hex: '#ef4444' },
    { name: 'Ruby', hex: '#dc2626' },
  ],
} as const;

export const ALL_ANIMATED_ARROW_COLORS = [
  ...ANIMATED_ARROW_COLORS.positive,
  ...ANIMATED_ARROW_COLORS.error,
];

// Map every arrows[].from/to through the same actor-rewrite map transformActors
// uses. Entries whose endpoints were hidden are kept as-is: they are inert,
// because the arrows themselves are gone with the hidden actors.
export function rewriteArrowStyles(config: DiagramConfig | null, options: ActorTransformOptions): DiagramConfig | null {
  if (!config || !config.arrows || config.arrows.length === 0) return config;
  const { rename } = buildActorRewriteMap(config, options);
  if (rename.size === 0) return config;

  let changed = false;
  const arrows = config.arrows.map(a => {
    const from = rename.get(a.from) ?? a.from;
    const to = rename.get(a.to) ?? a.to;
    if (from !== a.from || to !== a.to) changed = true;
    return { ...a, from, to };
  });
  if (!changed) return config;
  return { ...config, arrows };
}

// ---------------------------------------------------------------------------
// SVG post-processing (plan 4.6). Both functions take the rendered SVG as a
// string, mutate a parsed copy, and serialize it back. They are no-ops
// (returning the input byte-identical) when there is nothing to style, and
// never throw on unexpected SVG structure — worst case an element is left
// unstyled (soft-fail, NFR-01).
//
// Parsing uses text/html (not image/svg+xml): mermaid emits HTML entities
// inside foreignObject labels that would make strict XML parsing fail, and
// DiagramViewer injects the string via dangerouslySetInnerHTML (HTML).
// ---------------------------------------------------------------------------

type Styleable = Element & { style: CSSStyleDeclaration };

const DASH_PATTERNS: Record<string, string> = {
  dashed: '8 6',
  dotted: '2 4',
};

function parseSvgRoot(svg: string): Element | null {
  try {
    const doc = new DOMParser().parseFromString(svg, 'text/html');
    return doc.querySelector('svg');
  } catch {
    return null;
  }
}

// 0-based occurrence of el among same-(kind, from, to, label) arrows —
// identical semantics to editor.ts elementOccurrence.
function arrowOccurrence(model: DiagramModel, el: ModelElement): number {
  if (el.kind !== 'message' && el.kind !== 'edge') return 0;
  let occurrence = 0;
  for (const e of model.elements) {
    if (e === el) break;
    if ((e.kind === 'message' || e.kind === 'edge') &&
        e.from === el.from && e.to === el.to && (e.label ?? undefined) === (el.label ?? undefined)) {
      occurrence++;
    }
  }
  return occurrence;
}

function findArrowStyle(arrows: ArrowStyle[], model: DiagramModel, el: ModelElement): ArrowStyle | null {
  if (el.kind !== 'message' && el.kind !== 'edge') return null;
  const occurrence = arrowOccurrence(model, el);
  const found = arrows.find(a =>
    a.from === el.from && a.to === el.to &&
    (a.label ?? undefined) === (el.label ?? undefined) &&
    (a.occurrence ?? 0) === occurrence);
  return found ?? null;
}

// Clones the marker referenced by the given marker-* attribute, recolors the
// clone's shapes, and points the attribute at the clone (avoids the shared
// marker last-write-wins problem). Markers are looked up inside this SVG
// only: marker/filter ids are render-id prefixed and several diagrams can
// share one document.
function recolorMarker(root: Element, arrow: Element, attr: string, color: string, counter: { n: number }): boolean {
  const ref = arrow.getAttribute(attr);
  if (!ref) return false;
  const m = ref.match(/^url\(#(.+)\)$/);
  if (!m) return false;
  const markerId = m[1];
  let original: Element | null = null;
  const markers = Array.from(root.querySelectorAll('marker'));
  for (const mk of markers) {
    if (mk.getAttribute('id') === markerId) {
      original = mk;
      break;
    }
  }
  if (!original || !original.parentNode) return false;
  const clone = original.cloneNode(true) as Element;
  const newId = `${markerId}--styled-${counter.n++}`;
  clone.setAttribute('id', newId);
  clone.querySelectorAll('path, polygon, circle').forEach(shape => {
    (shape as Styleable).style.fill = color;
    (shape as Styleable).style.stroke = color;
  });
  original.parentNode.insertBefore(clone, original.nextSibling);
  arrow.setAttribute(attr, `url(#${newId})`);
  return true;
}

// Applies CONFIG.arrows to a rendered SVG. Styles are resolved against the
// processed model (post-transform endpoints, via rewriteArrowStyles).
export function applyArrowStyles(svg: string, model: DiagramModel, config: DiagramConfig | null): string {
  if (!config || !config.arrows || config.arrows.length === 0) return svg;
  if (model.type !== 'sequence' && model.type !== 'flowchart') return svg;
  const root = parseSvgRoot(svg);
  if (!root) return svg;

  try {
    const zip = zipModelToSvg(root, model);
    const isFlowchart = model.type === 'flowchart';
    // data-id -> edge label group (flowchart edge labels inherit the color)
    const labelByDataId = new Map<string, Element>();
    if (isFlowchart) {
      root.querySelectorAll('g.edgeLabel g.label[data-id]').forEach(l => {
        const d = l.getAttribute('data-id');
        if (d && !labelByDataId.has(d)) labelByDataId.set(d, l);
      });
    }

    const arrows: ModelElement[] = model.elements.filter(e => e.kind === 'message' || e.kind === 'edge');
    const zipped = isFlowchart ? zip.edges : zip.messages;
    const counter = { n: 0 };
    let changed = false;

    arrows.forEach((el, i) => {
      const style = findArrowStyle(config.arrows!, model, el);
      if (!style) return;
      const target = zipped[i];
      if (!target) return;  // soft-fail: no SVG counterpart

      const styleable = target as Styleable;
      if (style.color) {
        styleable.style.stroke = style.color;
        recolorMarker(root, target, 'marker-end', style.color, counter);
        recolorMarker(root, target, 'marker-start', style.color, counter);
        if (isFlowchart) {
          const dataId = target.getAttribute('data-id');
          const label = dataId ? labelByDataId.get(dataId) : undefined;
          const span = label ? label.querySelector('span.edgeLabel') : null;
          if (span) {
            (span as Styleable).style.fill = style.color;
            (span as Styleable).style.color = style.color;
          }
        }
      }
      if (style.width !== undefined) {
        styleable.style.strokeWidth = String(style.width);
      }
      if (style.dash === 'dashed' || style.dash === 'dotted') {
        styleable.style.strokeDasharray = DASH_PATTERNS[style.dash];
      } else if (style.dash === 'solid') {
        // 'none' (not removal): mermaid's class CSS is dashed for some arrow
        // types, and the explicit solid style must win in every case.
        styleable.style.strokeDasharray = 'none';
      }
      if (style.animation && style.animation !== 'none') {
        target.classList.add(`arrow-anim-${style.animation}`);
        const effectiveColor = style.color || '#ef4444';
        injectArrowEnhancement(target, style.animation, effectiveColor, style.width);
      }
      changed = true;
    });

    return changed ? root.outerHTML : svg;
  } catch {
    return svg;
  }
}

function createXMark(doc: Document, cx: number, cy: number, color: string, className: string, withBg = false): Element {
  const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', `arrow-x-mark ${className}`);
  g.setAttribute('transform', `translate(${cx}, ${cy})`);
  if (withBg) {
    const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', '#ffffff');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '1.5');
    g.appendChild(circle);
  }
  const l1 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
  l1.setAttribute('x1', '-4.5');
  l1.setAttribute('y1', '-4.5');
  l1.setAttribute('x2', '4.5');
  l1.setAttribute('y2', '4.5');
  l1.setAttribute('stroke', color);
  l1.setAttribute('stroke-width', '2.2');
  l1.setAttribute('stroke-linecap', 'round');
  g.appendChild(l1);

  const l2 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
  l2.setAttribute('x1', '-4.5');
  l2.setAttribute('y1', '4.5');
  l2.setAttribute('x2', '4.5');
  l2.setAttribute('y2', '-4.5');
  l2.setAttribute('stroke', color);
  l2.setAttribute('stroke-width', '2.2');
  l2.setAttribute('stroke-linecap', 'round');
  g.appendChild(l2);

  return g;
}

function injectArrowEnhancement(target: Element, anim: ArrowAnimationType, color: string, width?: number) {
  const doc = target.ownerDocument;
  if (!doc) return;
  const isLine = target.tagName.toLowerCase() === 'line';

  if (anim === 'pulse') {
    // Glowing Orb: target remains the full solid line rail; runner carries the glowing orb from start to end
    const runner = target.cloneNode(false) as Element;
    runner.removeAttribute('id');
    runner.removeAttribute('marker-end');
    runner.removeAttribute('marker-start');
    runner.setAttribute('pathLength', '100');
    runner.setAttribute('class', 'arrow-anim-packet-runner');
    const runnerStyle = runner as Styleable;
    runnerStyle.style.stroke = color;
    runnerStyle.style.strokeWidth = `${Math.max((width ?? 2) + 2, 4)}px`;
    runnerStyle.style.opacity = '1';
    target.parentNode?.insertBefore(runner, target.nextSibling);
    return;
  }

  if (isLine) {
    const x1 = parseFloat(target.getAttribute('x1') || '0');
    const y1 = parseFloat(target.getAttribute('y1') || '0');
    const x2 = parseFloat(target.getAttribute('x2') || '0');
    const y2 = parseFloat(target.getAttribute('y2') || '0');
    const dx = x2 >= x1 ? 1 : -1;

    if (anim === 'broken-sender' || anim === 'stutter') {
      const cx = x1 + dx * 14;
      const cy = y1;
      const xMark = createXMark(doc, cx, cy, color, 'arrow-x-sender', false);
      target.parentNode?.insertBefore(xMark, target.nextSibling);
    } else if (anim === 'broken-network' || anim === 'ricochet') {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const xMark = createXMark(doc, cx, cy, color, 'arrow-x-network', true);
      target.parentNode?.insertBefore(xMark, target.nextSibling);
    } else if (anim === 'broken-receiver' || anim === 'hesitate') {
      const cx = x2 - dx * 14;
      const cy = y2;
      const xMark = createXMark(doc, cx, cy, color, 'arrow-x-receiver', false);
      target.parentNode?.insertBefore(xMark, target.nextSibling);
    }
  }
}

// Applies CONFIG.actors colors to flowchart node shapes (plan 4.6).
// Sequence-diagram component colors need no post-processing — they flow
// through the `box <color>` mechanism in transformActors.
function resolveNodeColor(nodeId: string, config: DiagramConfig): string | null {
  if (nodeId.startsWith('MergedKey_')) return null;  // merged-by-key: neutral default
  if (nodeId.startsWith('MergedColor_')) {
    // Recover the raw color from config: the merged name is sanitized
    // (non-alphanumerics stripped), so "#e11d48" became "e11d48".
    const suffix = nodeId.slice('MergedColor_'.length);
    const actors = config.actors ?? {};
    const found = Object.keys(actors)
      .map(k => actors[k].color)
      .find(c => c !== undefined && c.replace(/[^A-Za-z0-9]/g, '') === suffix);
    if (found) return found;
    return /^[A-Za-z]+$/.test(suffix) ? suffix : null;  // named colors survive sanitization
  }
  const meta = (config.actors ?? {})[nodeId];
  return meta && meta.color ? meta.color : null;
}

export function applyNodeColors(svg: string, config: DiagramConfig | null): string {
  if (!config || !config.actors) return svg;
  const root = parseSvgRoot(svg);
  if (!root) return svg;
  // Flowchart nodes only (the sequence svg has no class="flowchart").
  const rootClass = root.getAttribute('class') ?? '';
  const role = root.getAttribute('aria-roledescription') ?? '';
  if (!rootClass.split(/\s+/).includes('flowchart') && role !== 'flowchart-v2') return svg;

  try {
    let changed = false;
    root.querySelectorAll('g.node[id]').forEach(g => {
      const id = g.getAttribute('id');
      if (!id) return;
      const m = id.match(/-flowchart-(.+)-(\d+)$/);
      if (!m) return;
      const color = resolveNodeColor(m[1], config);
      if (!color) return;
      const shape = g.querySelector('.label-container');
      if (!shape) return;
      (shape as Styleable).style.fill = color;
      (shape as Styleable).style.stroke = color;
      changed = true;
    });
    return changed ? root.outerHTML : svg;
  } catch {
    return svg;
  }
}
