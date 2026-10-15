// Arrow style resolution and SVG post-processing (EDITING_PLAN.md 4.6, 4.9).
// Styles are STORED in CONFIG.arrows against RAW endpoints, but RESOLVED
// against post-transform actor names, so they follow the rules of merging.

import { ActorTransformOptions, buildActorRewriteMap } from './preprocessor';
import { ArrowStyle, DiagramConfig, ArrowAnimationType } from './views';
import { DiagramModel, ModelElement } from './model';
import { zipModelToSvg, EDGE_HIT_CLASS } from './svgmap';

export interface AnimatedArrowPreset {
  id: ArrowAnimationType;
  name: string;
  description: string;
  isError?: boolean;
}

export const ANIMATED_ARROW_PRESETS: AnimatedArrowPreset[] = [
  { id: 'flow', name: 'Stream', description: 'Smooth continuous flow with glowing tracer' },
  { id: 'pulse', name: 'Glowing Orb', description: 'Full line with traveling glowing packet' },
  { id: 'cyber', name: 'Cyber Glow', description: 'High-velocity neon tracer' },
  { id: 'broken-sender', name: 'Broken Sender', description: 'HTTP 500 panic glitch & alarm at origin lifeline', isError: true },
  { id: 'broken-network', name: 'Broken Network', description: 'Severed gap in transit; broken connection', isError: true },
  { id: 'broken-receiver', name: 'Broken Receiver', description: 'Arrival barrier wall & shockwave burst; target rejected/crashed', isError: true },
];

export const ANIMATED_ARROW_COLORS = {
  positive: [
    { name: 'Emerald', hex: '#00ff9d' },
    { name: 'Teal', hex: '#00f0ff' },
    { name: 'Ocean', hex: '#00bfff' },
    { name: 'Indigo', hex: '#4f8cff' },
    { name: 'Mint', hex: '#38ef7d' },
  ],
  error: [
    { name: 'Amber', hex: '#ffbe0b' },
    { name: 'Flame', hex: '#ff6600' },
    { name: 'Rose', hex: '#ff2a85' },
    { name: 'Crimson', hex: '#ff3366' },
    { name: 'Ruby', hex: '#ff1744' },
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

    // For sequence diagrams, identify pulse/dot animated arrows in chronological/top-to-bottom order
    const pulseIndices: number[] = [];
    if (!isFlowchart) {
      arrows.forEach((el, i) => {
        const style = findArrowStyle(config.arrows!, model, el);
        if (style && style.animation === 'pulse' && zipped[i]) {
          pulseIndices.push(i);
        }
      });
    }
    const pulseTotal = pulseIndices.length;
    const keyframesRules: string[] = [];

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
        const pulseSeqIndex = style.animation === 'pulse' && !isFlowchart ? pulseIndices.indexOf(i) : -1;
        const seqInfo = pulseSeqIndex >= 0 ? { index: pulseSeqIndex, total: pulseTotal } : undefined;
        injectArrowEnhancement(target, style.animation, effectiveColor, style.width, seqInfo, keyframesRules);
      }
      changed = true;
    });

    if (keyframesRules.length > 0) {
      let defs = root.querySelector('defs');
      if (!defs) {
        defs = root.ownerDocument ? root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'defs') : null;
        if (defs) root.insertBefore(defs, root.firstChild);
      }
      if (defs && root.ownerDocument) {
        const styleEl = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleEl.setAttribute('type', 'text/css');
        styleEl.textContent = keyframesRules.join('\n');
        defs.appendChild(styleEl);
      }
    }

    return changed ? root.outerHTML : svg;
  } catch {
    return svg;
  }
}

function createXMark(
  doc: Document,
  cx: number,
  cy: number,
  color: string,
  className: string,
  variant: 'default' | 'badge' | 'alarm' = 'default'
): Element {
  const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', `arrow-x-mark ${className}`);
  g.setAttribute('transform', `translate(${cx}, ${cy})`);
  const gStyle = g as Styleable;
  gStyle.style.color = color;

  if (variant === 'alarm') {
    // Ping radar wave radiating from origin lifeline
    const ping = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ping.setAttribute('class', 'arrow-alarm-ping');
    ping.setAttribute('r', '10');
    ping.setAttribute('fill', 'none');
    ping.setAttribute('stroke', color);
    ping.setAttribute('stroke-width', '1.6');
    const pingStyle = ping as Styleable;
    pingStyle.style.color = color;
    pingStyle.style.stroke = color;
    g.appendChild(ping);

    // Alarm badge background
    const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', '#ef4444');
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '1.5');
    g.appendChild(circle);

    // Crisp white cross
    const l1 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    l1.setAttribute('x1', '-3.5');
    l1.setAttribute('y1', '-3.5');
    l1.setAttribute('x2', '3.5');
    l1.setAttribute('y2', '3.5');
    l1.setAttribute('stroke', '#ffffff');
    l1.setAttribute('stroke-width', '2.2');
    l1.setAttribute('stroke-linecap', 'round');
    g.appendChild(l1);

    const l2 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    l2.setAttribute('x1', '-3.5');
    l2.setAttribute('y1', '3.5');
    l2.setAttribute('x2', '3.5');
    l2.setAttribute('y2', '-3.5');
    l2.setAttribute('stroke', '#ffffff');
    l2.setAttribute('stroke-width', '2.2');
    l2.setAttribute('stroke-linecap', 'round');
    g.appendChild(l2);

    return g;
  }

  if (variant === 'badge') {
    const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '8.5');
    circle.setAttribute('fill', 'var(--background, #090d16)');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '2');
    const cStyle = circle as Styleable;
    cStyle.style.stroke = color;
    g.appendChild(circle);
  }

  const l1 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
  l1.setAttribute('x1', '-4');
  l1.setAttribute('y1', '-4');
  l1.setAttribute('x2', '4');
  l1.setAttribute('y2', '4');
  l1.setAttribute('stroke', color);
  l1.setAttribute('stroke-width', '2.2');
  l1.setAttribute('stroke-linecap', 'round');
  const l1Style = l1 as Styleable;
  l1Style.style.stroke = color;
  g.appendChild(l1);

  const l2 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
  l2.setAttribute('x1', '-4');
  l2.setAttribute('y1', '4');
  l2.setAttribute('x2', '4');
  l2.setAttribute('y2', '-4');
  l2.setAttribute('stroke', color);
  l2.setAttribute('stroke-width', '2.2');
  l2.setAttribute('stroke-linecap', 'round');
  const l2Style = l2 as Styleable;
  l2Style.style.stroke = color;
  g.appendChild(l2);

  return g;
}

function injectShockwaveBurst(
  doc: Document,
  cx: number,
  cy: number,
  color: string,
  extraClass: string = ''
): Element {
  const shockwave = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
  shockwave.setAttribute('class', `arrow-shockwave-burst ${extraClass}`.trim());
  shockwave.setAttribute('cx', String(cx));
  shockwave.setAttribute('cy', String(cy));
  shockwave.setAttribute('r', '3');
  shockwave.setAttribute('fill', 'none');
  shockwave.setAttribute('stroke', color);
  shockwave.setAttribute('stroke-width', '2');
  const sStyle = shockwave as Styleable;
  sStyle.style.stroke = color;
  sStyle.style.color = color;

  // Cross-browser SMIL animations for reliable circle expansion (WebKit/Safari and Chromium)
  const animR = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animR.setAttribute('attributeName', 'r');
  animR.setAttribute('values', '3;24');
  animR.setAttribute('dur', '2.6s');
  animR.setAttribute('repeatCount', 'indefinite');
  shockwave.appendChild(animR);

  const animOp = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animOp.setAttribute('attributeName', 'opacity');
  animOp.setAttribute('values', '0.9;0');
  animOp.setAttribute('dur', '2.6s');
  animOp.setAttribute('repeatCount', 'indefinite');
  shockwave.appendChild(animOp);

  const animSw = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
  animSw.setAttribute('attributeName', 'stroke-width');
  animSw.setAttribute('values', '2.2;0.5');
  animSw.setAttribute('dur', '2.6s');
  animSw.setAttribute('repeatCount', 'indefinite');
  shockwave.appendChild(animSw);

  return shockwave;
}

interface ArrowEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function extractArrowEndpoints(target: Element): ArrowEndpoints | null {
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'line') {
    const x1 = parseFloat(target.getAttribute('x1') || '0');
    const y1 = parseFloat(target.getAttribute('y1') || '0');
    const x2 = parseFloat(target.getAttribute('x2') || '0');
    const y2 = parseFloat(target.getAttribute('y2') || '0');
    return { x1, y1, x2, y2 };
  }
  if (tagName === 'path') {
    const d = target.getAttribute('d');
    if (!d) return null;
    const coordPairs = Array.from(d.matchAll(/(-?[\d.]+)[ ,]+(-?[\d.]+)/g));
    if (coordPairs.length < 2) return null;
    const first = coordPairs[0];
    const last = coordPairs[coordPairs.length - 1];
    return {
      x1: parseFloat(first[1]),
      y1: parseFloat(first[2]),
      x2: parseFloat(last[1]),
      y2: parseFloat(last[2]),
    };
  }
  return null;
}

function injectArrowEnhancement(
  target: Element,
  anim: ArrowAnimationType,
  color: string,
  width?: number,
  sequenceInfo?: { index: number; total: number },
  keyframesRules?: string[]
) {
  const doc = target.ownerDocument;
  if (!doc) return;

  if (anim === 'pulse') {
    // Glowing Orb: target remains the full solid line rail; runner carries the glowing orb from start to end
    const runner = target.cloneNode(false) as Element;
    runner.removeAttribute('id');
    runner.removeAttribute('data-et');
    runner.removeAttribute('data-id');
    runner.removeAttribute('marker-end');
    runner.removeAttribute('marker-start');
    runner.setAttribute('pathLength', '100');
    runner.setAttribute('class', 'arrow-anim-packet-runner');
    const runnerStyle = runner as Styleable;
    runnerStyle.style.stroke = color;
    runnerStyle.style.strokeWidth = `${Math.max((width ?? 2) + 2, 4)}px`;

    const seqTotal = sequenceInfo ? sequenceInfo.total : 1;
    const seqIndex = sequenceInfo ? sequenceInfo.index : 0;
    runner.setAttribute('data-seq-index', String(seqIndex));
    runner.setAttribute('data-seq-total', String(seqTotal));

    if (seqTotal > 1) {
      const stepDuration = 1.2;
      const totalDuration = parseFloat((seqTotal * stepDuration).toFixed(2));
      const animName = `mermaid-arrow-packet-seq-${seqTotal}-${seqIndex}`;
      runnerStyle.style.setProperty('--packet-animation', `${animName} ${totalDuration}s ease-in-out infinite`);
      runnerStyle.style.setProperty('animation', `${animName} ${totalDuration}s ease-in-out infinite`, 'important');

      if (keyframesRules) {
        const startPct = (seqIndex / seqTotal) * 100;
        const endPct = ((seqIndex + 1) / seqTotal) * 100;
        const slotWidth = endPct - startPct;
        const fade1 = (startPct + 0.1 * slotWidth).toFixed(2);
        const fade2 = (startPct + 0.85 * slotWidth).toFixed(2);
        const sPct = startPct.toFixed(2);
        const ePct = endPct.toFixed(2);

        const rule = `@keyframes ${animName} {
  ${startPct > 0 ? `0%, ${(startPct - 0.01).toFixed(2)}% { stroke-dashoffset: 6; opacity: 0; }` : ''}
  ${sPct}% { stroke-dashoffset: 6; opacity: 0; }
  ${fade1}% { opacity: 1; }
  ${fade2}% { opacity: 1; }
  ${ePct}% { stroke-dashoffset: -100; opacity: 0; }
  ${endPct < 100 ? `${(endPct + 0.01).toFixed(2)}%, 100% { stroke-dashoffset: 6; opacity: 0; }` : ''}
}`;
        if (!keyframesRules.some(r => r.includes(animName))) {
          keyframesRules.push(rule);
        }
      }

      // SMIL animation elements for SVG-native viewers
      const animOffset = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
      animOffset.setAttribute('attributeName', 'stroke-dashoffset');
      animOffset.setAttribute('values', '6;-100');
      animOffset.setAttribute('dur', `${stepDuration}s`);
      animOffset.setAttribute('fill', 'freeze');
      animOffset.setAttribute('id', `seq-runner-anim-${seqIndex}`);
      if (seqIndex === 0) {
        animOffset.setAttribute('begin', `0s; seq-runner-anim-${seqTotal - 1}.end`);
      } else {
        animOffset.setAttribute('begin', `seq-runner-anim-${seqIndex - 1}.end`);
      }
      runner.appendChild(animOffset);

      const animOpacity = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
      animOpacity.setAttribute('attributeName', 'opacity');
      animOpacity.setAttribute('values', '0;1;1;0');
      animOpacity.setAttribute('keyTimes', '0;0.1;0.85;1');
      animOpacity.setAttribute('dur', `${stepDuration}s`);
      animOpacity.setAttribute('fill', 'freeze');
      if (seqIndex === 0) {
        animOpacity.setAttribute('begin', `0s; seq-runner-anim-${seqTotal - 1}.end`);
      } else {
        animOpacity.setAttribute('begin', `seq-runner-anim-${seqIndex - 1}.end`);
      }
      runner.appendChild(animOpacity);
    } else {
      runnerStyle.style.opacity = '1';

      const animOffset = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
      animOffset.setAttribute('attributeName', 'stroke-dashoffset');
      animOffset.setAttribute('values', '6;-100');
      animOffset.setAttribute('dur', '1.4s');
      animOffset.setAttribute('repeatCount', 'indefinite');
      runner.appendChild(animOffset);

      const animOpacity = doc.createElementNS('http://www.w3.org/2000/svg', 'animate');
      animOpacity.setAttribute('attributeName', 'opacity');
      animOpacity.setAttribute('values', '0;1;1;0');
      animOpacity.setAttribute('keyTimes', '0;0.1;0.85;1');
      animOpacity.setAttribute('dur', '1.4s');
      animOpacity.setAttribute('repeatCount', 'indefinite');
      runner.appendChild(animOpacity);
    }

    target.parentNode?.insertBefore(runner, target.nextSibling);
    return;
  }

  const coords = extractArrowEndpoints(target);
  if (!coords) return;

  const { x1, y1, x2, y2 } = coords;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const nx = -uy;
  const ny = ux;

  if (anim === 'broken-sender' || anim === 'stutter') {
    // 1. Origin barrier wall at sender lifeline / node
    const barrier = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    barrier.setAttribute('class', 'arrow-barrier-wall');
    barrier.setAttribute('x1', String(x1 - nx * 12));
    barrier.setAttribute('y1', String(y1 - ny * 12));
    barrier.setAttribute('x2', String(x1 + nx * 12));
    barrier.setAttribute('y2', String(y1 + ny * 12));
    barrier.setAttribute('stroke', color);
    barrier.setAttribute('stroke-width', '3');
    barrier.setAttribute('stroke-linecap', 'round');
    const bStyle = barrier as Styleable;
    bStyle.style.stroke = color;
    bStyle.style.color = color;
    bStyle.style.strokeWidth = '3px';
    target.parentNode?.insertBefore(barrier, target.nextSibling);

    // 2. Expanding neon shockwave burst circle at sender origin (identical to receiver!)
    const shockwave = injectShockwaveBurst(doc, x1, y1, color, 'arrow-sender-burst');
    target.parentNode?.insertBefore(shockwave, target.nextSibling);

    // 3. Sender origin error mark badge
    const cx = x1 + ux * 14;
    const cy = y1 + uy * 14;
    const xMark = createXMark(doc, cx, cy, color, 'arrow-x-sender', 'badge');
    target.parentNode?.insertBefore(xMark, target.nextSibling);
  } else if (anim === 'broken-network' || anim === 'ricochet') {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const gap = Math.min(46, Math.max(24, len * 0.38));
    const halfSeg = Math.max(0, (len - gap) / 2);
    const xCut1 = midX - ux * (gap / 2);
    const yCut1 = midY - uy * (gap / 2);
    const xCut2 = midX + ux * (gap / 2);
    const yCut2 = midY + uy * (gap / 2);

    // Physically sever the line or path in the center using dash pattern
    const targetStyle = target as Styleable;
    targetStyle.style.strokeDasharray = `${halfSeg} ${gap} ${len + 100}`;
    targetStyle.style.strokeDashoffset = '0';

    // Left/start cutoff breaker cap
    const cap1 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    cap1.setAttribute('class', 'arrow-breaker-cap');
    cap1.setAttribute('x1', String(xCut1 - nx * 7));
    cap1.setAttribute('y1', String(yCut1 - ny * 7));
    cap1.setAttribute('x2', String(xCut1 + nx * 7));
    cap1.setAttribute('y2', String(yCut1 + ny * 7));
    cap1.setAttribute('stroke', color);
    cap1.setAttribute('stroke-width', '2.8');
    cap1.setAttribute('stroke-linecap', 'round');
    const cap1Style = cap1 as Styleable;
    cap1Style.style.stroke = color;
    cap1Style.style.color = color;
    cap1Style.style.strokeWidth = '2.8px';
    target.parentNode?.insertBefore(cap1, target.nextSibling);

    // Right/end cutoff breaker cap
    const cap2 = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    cap2.setAttribute('class', 'arrow-breaker-cap');
    cap2.setAttribute('x1', String(xCut2 - nx * 7));
    cap2.setAttribute('y1', String(yCut2 - ny * 7));
    cap2.setAttribute('x2', String(xCut2 + nx * 7));
    cap2.setAttribute('y2', String(yCut2 + ny * 7));
    cap2.setAttribute('stroke', color);
    cap2.setAttribute('stroke-width', '2.8');
    cap2.setAttribute('stroke-linecap', 'round');
    const cap2Style = cap2 as Styleable;
    cap2Style.style.stroke = color;
    cap2Style.style.color = color;
    cap2Style.style.strokeWidth = '2.8px';
    target.parentNode?.insertBefore(cap2, target.nextSibling);

    // Central floating broken connection badge
    const xMark = createXMark(doc, midX, midY, color, 'arrow-x-network', 'badge');
    target.parentNode?.insertBefore(xMark, target.nextSibling);
  } else if (anim === 'broken-receiver' || anim === 'hesitate') {
    // Rejection barrier wall at target lifeline / node
    const barrier = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    barrier.setAttribute('class', 'arrow-barrier-wall');
    barrier.setAttribute('x1', String(x2 - nx * 12));
    barrier.setAttribute('y1', String(y2 - ny * 12));
    barrier.setAttribute('x2', String(x2 + nx * 12));
    barrier.setAttribute('y2', String(y2 + ny * 12));
    barrier.setAttribute('stroke', color);
    barrier.setAttribute('stroke-width', '3');
    barrier.setAttribute('stroke-linecap', 'round');
    const bStyle = barrier as Styleable;
    bStyle.style.stroke = color;
    bStyle.style.color = color;
    bStyle.style.strokeWidth = '3px';
    target.parentNode?.insertBefore(barrier, target.nextSibling);

    // Expanding neon shockwave burst ring on collision
    const shockwave = injectShockwaveBurst(doc, x2, y2, color);
    target.parentNode?.insertBefore(shockwave, target.nextSibling);

    // Rejection crosshead badge
    const cx = x2 - ux * 14;
    const cy = y2 - uy * 14;
    const xMark = createXMark(doc, cx, cy, color, 'arrow-x-receiver', 'badge');
    target.parentNode?.insertBefore(xMark, target.nextSibling);
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

function isLightColor(colorStr: string): boolean {
  const c = colorStr.trim().toLowerCase();
  if (c.startsWith('#')) {
    const raw = c.slice(1);
    let r = 0, g = 0, b = 0;
    if (raw.length === 3) {
      r = parseInt(raw[0] + raw[0], 16);
      g = parseInt(raw[1] + raw[1], 16);
      b = parseInt(raw[2] + raw[2], 16);
    } else if (raw.length === 6) {
      r = parseInt(raw.slice(0, 2), 16);
      g = parseInt(raw.slice(2, 4), 16);
      b = parseInt(raw.slice(4, 6), 16);
    }
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 160;
  }
  const lightNames = ['yellow', 'cyan', 'white', 'lightgreen', 'lightblue', 'pink', 'lightgray', 'lightgrey'];
  return lightNames.includes(c);
}

export function applyNodeColors(svg: string, config: DiagramConfig | null): string {
  if (!config || !config.actors) return svg;
  const root = parseSvgRoot(svg);
  if (!root) return svg;
  // Flowchart nodes vs sequence diagram actors.
  const rootClass = root.getAttribute('class') ?? '';
  const role = root.getAttribute('aria-roledescription') ?? '';
  const isFlowchart = rootClass.split(/\s+/).includes('flowchart') || role === 'flowchart-v2';

  try {
    let changed = false;
    if (isFlowchart) {
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
    }

    // Sequence diagrams: color participant boxes and actor stick figures
    const actorEntries = Object.keys(config.actors);
    if (actorEntries.length === 0) return svg;

    for (const actorId of actorEntries) {
      const color = resolveNodeColor(actorId, config);
      if (!color) continue;
      const textColor = isLightColor(color) ? '#0f172a' : '#ffffff';

      // 1. Participant top groups: g[data-et="participant"]
      root.querySelectorAll('g[data-et="participant"]').forEach(g => {
        if (g.getAttribute('data-id') === actorId) {
          g.setAttribute('data-colored', 'true');
          g.querySelectorAll('rect').forEach(rect => {
            rect.setAttribute('data-colored', 'true');
            (rect as Styleable).style.setProperty('fill', color, 'important');
            (rect as Styleable).style.setProperty('stroke', color, 'important');
            rect.setAttribute('fill', color);
            rect.setAttribute('stroke', color);
            changed = true;
          });
          g.querySelectorAll('circle').forEach(c => {
            c.setAttribute('data-colored', 'true');
            (c as Styleable).style.setProperty('fill', color, 'important');
            (c as Styleable).style.setProperty('stroke', color, 'important');
            c.setAttribute('fill', color);
            c.setAttribute('stroke', color);
            changed = true;
          });
          g.querySelectorAll('line, path').forEach(l => {
            l.setAttribute('data-colored', 'true');
            (l as Styleable).style.setProperty('stroke', color, 'important');
            l.setAttribute('stroke', color);
            changed = true;
          });
          g.querySelectorAll('text.actor, text.actor-box, text').forEach(t => {
            t.setAttribute('data-colored', 'true');
            (t as Styleable).style.setProperty('fill', textColor, 'important');
            t.setAttribute('fill', textColor);
            t.querySelectorAll('tspan').forEach(ts => {
              ts.setAttribute('data-colored', 'true');
              (ts as Styleable).style.setProperty('fill', textColor, 'important');
              ts.setAttribute('fill', textColor);
            });
            changed = true;
          });
        }
      });

      // 2. Rectangles by name attribute (matches bottom boxes and direct rect.actor)
      root.querySelectorAll('rect.actor, rect').forEach(rect => {
        if (rect.getAttribute('name') === actorId) {
          rect.setAttribute('data-colored', 'true');
          (rect as Styleable).style.setProperty('fill', color, 'important');
          (rect as Styleable).style.setProperty('stroke', color, 'important');
          rect.setAttribute('fill', color);
          rect.setAttribute('stroke', color);
          changed = true;

          const parent = rect.parentElement;
          if (parent) {
            parent.setAttribute('data-colored', 'true');
            parent.querySelectorAll('text.actor, text.actor-box, text').forEach(t => {
              t.setAttribute('data-colored', 'true');
              (t as Styleable).style.setProperty('fill', textColor, 'important');
              t.setAttribute('fill', textColor);
              t.querySelectorAll('tspan').forEach(ts => {
                ts.setAttribute('data-colored', 'true');
                (ts as Styleable).style.setProperty('fill', textColor, 'important');
                ts.setAttribute('fill', textColor);
              });
              changed = true;
            });
          }
        }
      });

      // 3. Stick figures by name attribute (matches bottom stick figures)
      root.querySelectorAll('g.actor-man, .actor-man').forEach(man => {
        if (man.getAttribute('name') === actorId) {
          man.setAttribute('data-colored', 'true');
          (man as Styleable).style.setProperty('fill', color, 'important');
          (man as Styleable).style.setProperty('stroke', color, 'important');
          man.querySelectorAll('circle').forEach(c => {
            c.setAttribute('data-colored', 'true');
            (c as Styleable).style.setProperty('fill', color, 'important');
            (c as Styleable).style.setProperty('stroke', color, 'important');
            c.setAttribute('fill', color);
            c.setAttribute('stroke', color);
            changed = true;
          });
          man.querySelectorAll('line, path').forEach(l => {
            l.setAttribute('data-colored', 'true');
            (l as Styleable).style.setProperty('stroke', color, 'important');
            l.setAttribute('stroke', color);
            changed = true;
          });
          const parent = man.parentElement;
          if (parent) {
            parent.setAttribute('data-colored', 'true');
            parent.querySelectorAll('text.actor, text.actor-man, text').forEach(t => {
              t.setAttribute('data-colored', 'true');
              (t as Styleable).style.setProperty('fill', textColor, 'important');
              t.setAttribute('fill', textColor);
              t.querySelectorAll('tspan').forEach(ts => {
                ts.setAttribute('data-colored', 'true');
                (ts as Styleable).style.setProperty('fill', textColor, 'important');
                ts.setAttribute('fill', textColor);
              });
              changed = true;
            });
          }
        }
      });
    }

    return changed ? root.outerHTML : svg;
  } catch {
    return svg;
  }
}

/**
 * Reorders sequence diagram SVG elements so that:
 * 1. Defs and styles are preserved at the top of the SVG.
 * 2. Every decoration (background rects, box clusters, control structures, notes, activations)
 *    is placed at the bottom layer.
 * 3. Actors (lifelines, top/bottom actor boxes, actor-man stick figures) are above decorations.
 * 4. Arrows and messages (message lines, labels, animations) are ALWAYS on top.
 *
 * In addition, ensures decorative background area rectangles cannot intercept pointer events.
 */
export function reorderSequenceLayers(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, 'text/html');
    const root = doc.querySelector('svg');
    if (!root) return svg;

    const roleDesc = root.getAttribute('aria-roledescription');
    const isSequence =
      roleDesc === 'sequence' ||
      root.querySelector('line.actor-line, .actor, [data-et="participant"]') !== null;
    if (!isSequence) return svg;

    // 1. Ensure background area rects cannot intercept clicks/pointer events
    root.querySelectorAll('rect.rect').forEach(rect => {
      rect.setAttribute('pointer-events', 'none');
      (rect as Styleable).style.setProperty('pointer-events', 'none');
    });

    // 2. Classify direct children of <svg> into layer buckets
    const children = Array.from(root.children);
    const headerNodes: Element[] = [];
    const decorationNodes: Element[] = [];
    const otherNodes: Element[] = [];
    const actorNodes: Element[] = [];
    const messageNodes: Element[] = [];

    const isDecoration = (el: Element): boolean => {
      if (el.matches('rect.rect')) return true;
      if (el.matches('g') && el.querySelector('rect.rect') && !el.querySelector('.actor, [data-et="participant"], [data-et="message"]')) {
        return true;
      }
      if (el.matches('g[data-et="control-structure"]') || el.matches('.loopLine, .labelBox') || el.querySelector('.loopLine, .labelBox')) {
        return true;
      }
      if (el.matches('g[data-et="note"]') || el.matches('rect.note') || el.querySelector('rect.note, text.noteText')) {
        return true;
      }
      if (el.matches('rect[class*="activation"]') || el.querySelector('rect[class*="activation"]')) {
        return true;
      }
      return false;
    };

    const isActor = (el: Element): boolean => {
      if (el.matches('g[data-et="participant"], .actor-man, line.actor-line, rect.actor, text.actor')) {
        return true;
      }
      if (el.querySelector('.actor, .actor-man, .actor-line, [data-et="participant"]')) {
        return true;
      }
      return false;
    };

    const isMessage = (el: Element): boolean => {
      if (
        el.matches(
          '[data-et="message"], .messageLine0, .messageLine1, text.messageText, [class*="arrow-anim-"], .arrow-x-mark, .arrow-barrier-wall, .arrow-shockwave-burst'
        )
      ) {
        return true;
      }
      if (el.querySelector('[data-et="message"], .messageLine0, .messageLine1, text.messageText')) {
        return true;
      }
      return false;
    };

    for (const child of children) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'style' || tag === 'filter') {
        headerNodes.push(child);
      } else if (isDecoration(child)) {
        decorationNodes.push(child);
      } else if (isActor(child)) {
        actorNodes.push(child);
      } else if (isMessage(child)) {
        messageNodes.push(child);
      } else {
        otherNodes.push(child);
      }
    }

    // Re-append in exact layer order: Header -> Decorations -> Other -> Actors -> Messages
    const ordered = [...headerNodes, ...decorationNodes, ...otherNodes, ...actorNodes, ...messageNodes];
    for (const node of ordered) {
      root.appendChild(node);
    }

    return root.outerHTML;
  } catch {
    return svg;
  }
}

// --- Pan exclusion marking ---------------------------------------------------

// react-zoom-pan-pinch builds the exclusion selector for each
// `panning.excluded` entry E as `.react-transform-wrapper E` plus `.E`
// variants (with `*` descendant variants) and calls Element.matches() with
// it on every mouse-down inside the wrapper. E must therefore be a bare
// class name — an attribute or dotted selector produces an invalid selector
// and matches() throws, which surfaced as an unhandled error in tests and
// silently killed drag-panning in edit mode in real browsers.
export const PAN_EXCLUDE_CLASS = 'pan-exclude';

// --- Edge hit targets ---------------------------------------------------------
// Mermaid renders each flowchart edge as a single ~2px-stroke path with
// fill:none, so an unlabeled edge's only click target is the stroke itself —
// a band that shrinks to sub-pixel width when zoomed out. To make edges
// reliably selectable, every edge path gets an invisible sibling "hit path":
// same geometry (d) and data-id, but a transparent stroke of constant screen
// width (vector-effect="non-scaling-stroke") with pointer-events="stroke".
// The hit path is inserted AFTER the edge's arrow-animation overlays
// (applyArrowStyles injects them right after the path), so their pixels
// resolve to the edge too; mermaid paints g.nodes above g.edgePaths, so a
// hit path can never steal a node click. elementKeyAtTarget resolves hit
// paths to model edges via data-id; svgExport strips them.

// Width (screen px, thanks to non-scaling-stroke) of the invisible per-edge
// hit band. Sized like the connect-handle grab radius (CONNECT_HANDLE_GRAB_RADIUS
// = 13) so edge selection feels as forgiving as handle grabbing.
export const EDGE_HIT_STROKE_WIDTH = 12;

// Render-pipeline post-process step. Runs after applyArrowStyles (which adds
// the per-edge animation overlays) and before markPanExclusionTargets (which
// tags the hit paths as pan-exclusion targets).
export function addEdgeHitPaths(svg: string): string {
  const root = parseSvgRoot(svg);
  if (!root) return svg;
  try {
    if (root.querySelector(`path.${EDGE_HIT_CLASS}`)) return svg;  // idempotent
    const doc = root.ownerDocument;
    if (!doc) return svg;
    const paths = Array.from(root.querySelectorAll('g.edgePaths path[data-et="edge"]'));
    if (paths.length === 0) return svg;
    for (const path of paths) {
      const hit = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = path.getAttribute('d');
      if (d) hit.setAttribute('d', d);
      const dataId = path.getAttribute('data-id');
      if (dataId) hit.setAttribute('data-id', dataId);
      hit.setAttribute('class', EDGE_HIT_CLASS);
      hit.setAttribute('data-et', EDGE_HIT_CLASS);
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', String(EDGE_HIT_STROKE_WIDTH));
      hit.setAttribute('vector-effect', 'non-scaling-stroke');
      hit.setAttribute('pointer-events', 'stroke');
      // Insert after the edge path and any arrow-animation overlays injected
      // after it (sibling elements that are not real edge paths), so the hit
      // path paints above them and their pixels select the edge as well.
      let anchor: Element = path;
      let next = anchor.nextElementSibling;
      while (
        next &&
        !next.matches('path[data-et="edge"]') &&
        !(next.matches('path') && next.classList.contains(EDGE_HIT_CLASS))
      ) {
        anchor = next;
        next = anchor.nextElementSibling;
      }
      anchor.parentNode?.insertBefore(hit, anchor.nextSibling);
    }
    return root.outerHTML;
  } catch {
    return svg;
  }
}

// Drag targets in edit mode: sequence participants (top boxes, lifelines,
// bottom boxes/men), messages (line/path + label), notes, flowchart nodes,
// the arrow animation overlays created by applyArrowStyles, and the flowchart
// edge hit paths created by addEdgeHitPaths. The marker is added to the
// element itself; the library's `.E *` variant also covers descendants.
const PAN_EXCLUDE_TARGETS = [
  'g[data-et="participant"]',
  'line.actor-line',
  'rect.actor',
  'g.actor-man',
  '[data-et="message"]',
  'text.messageText',
  '.arrow-anim-packet-runner',
  '.arrow-x-mark',
  'g[data-et="note"]',
  'g.node',
  `path.${EDGE_HIT_CLASS}`,
];

// Render-pipeline post-process step. Runs after applyArrowStyles, which
// creates the .arrow-anim-packet-runner / .arrow-x-mark overlays.
export function markPanExclusionTargets(svg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, 'text/html');
    const root = doc.querySelector('svg');
    if (!root) return svg;
    root.querySelectorAll(PAN_EXCLUDE_TARGETS.join(', ')).forEach(el => {
      el.classList.add(PAN_EXCLUDE_CLASS);
    });
    return root.outerHTML;
  } catch {
    return svg;
  }
}

