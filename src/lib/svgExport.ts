import { StickyNote as StickyNoteType, StickyNoteColor } from './views';

export interface SvgExportOptions {
  notes?: StickyNoteType[];
  showNotes?: boolean;
  isDark?: boolean;
  fileName?: string | null;
}

export const STICKY_NOTE_HEX: Record<StickyNoteColor, {
  bg: string;
  border: string;
  text: string;
  header: string;
  dot: string;
}> = {
  yellow: { bg: '#fef3c7', border: '#fcd34d', text: '#451a03', header: '#fde68a', dot: '#fbbf24' },
  green:  { bg: '#d1fae5', border: '#6ee7b7', text: '#022c22', header: '#a7f3d0', dot: '#34d399' },
  blue:   { bg: '#e0f2fe', border: '#7dd3fc', text: '#082f49', header: '#bae6fd', dot: '#38bdf8' },
  pink:   { bg: '#ffe4e6', border: '#fda4af', text: '#4c0519', header: '#fecdd3', dot: '#fb7185' },
  orange: { bg: '#ffedd5', border: '#fdba74', text: '#431407', header: '#fed7aa', dot: '#fb923c' },
  purple: { bg: '#f3e8ff', border: '#d8b4fe', text: '#3b0764', header: '#e9d5ff', dot: '#c084fc' },
};

export const EMBEDDED_SVG_STYLES = `
/* --- Embedded Diagram Viewer Animations and Visual Styles --- */
@keyframes mermaid-arrow-flow {
  from { stroke-dashoffset: 28; }
  to { stroke-dashoffset: 0; }
}

@keyframes mermaid-arrow-packet {
  0% { stroke-dashoffset: 6; opacity: 0; }
  10% { opacity: 1; }
  85% { opacity: 1; }
  100% { stroke-dashoffset: -100; opacity: 0; }
}

@keyframes mermaid-arrow-cyber {
  from { stroke-dashoffset: 32; }
  to { stroke-dashoffset: 0; }
}

@keyframes mermaid-broken-sender {
  0% { stroke-dashoffset: 28; opacity: 0.9; }
  50% { stroke-dashoffset: 14; opacity: 0.65; }
  100% { stroke-dashoffset: 0; opacity: 0.9; }
}

@keyframes mermaid-broken-network {
  0%, 100% { opacity: 0.9; }
  25% { opacity: 0.7; }
  50% { opacity: 0.4; }
  75% { opacity: 0.85; }
}

@keyframes mermaid-ricochet-recoil {
  0% { stroke-dashoffset: 36; opacity: 0.85; }
  45% { stroke-dashoffset: 0; opacity: 1; }
  55% { stroke-dashoffset: 4; opacity: 0.95; }
  80% { stroke-dashoffset: 18; opacity: 0.55; }
  100% { stroke-dashoffset: 36; opacity: 0.85; }
}

@keyframes mermaid-shockwave-burst {
  0% { r: 3px; opacity: 0.9; stroke-width: 2.2px; }
  100% { r: 24px; opacity: 0; stroke-width: 0.5px; }
}

@keyframes mermaid-alarm-ping {
  0% { transform: scale(0.6); opacity: 1; }
  75% { transform: scale(2.2); opacity: 0; }
  100% { transform: scale(2.2); opacity: 0; }
}

@keyframes mermaid-x-pulse {
  0%, 100% { opacity: 1; filter: drop-shadow(0 0 4px currentColor); }
  50% { opacity: 0.78; filter: drop-shadow(0 0 7px currentColor); }
}

.arrow-anim-flow {
  stroke-dasharray: 8 6 !important;
  animation: mermaid-arrow-flow 1.1s linear infinite !important;
  filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 9px currentColor) !important;
}

.arrow-anim-pulse {
  stroke-dasharray: none !important;
  opacity: 0.65 !important;
  filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 7px currentColor);
}

.arrow-anim-packet-runner {
  stroke-dasharray: 6 100 !important;
  stroke-linecap: round !important;
  animation: var(--packet-animation, mermaid-arrow-packet 1.4s ease-in-out infinite) !important;
  filter:
    drop-shadow(0 0 2px #ffffff)
    drop-shadow(0 0 6px currentColor)
    drop-shadow(0 0 14px currentColor)
    drop-shadow(0 0 24px currentColor) !important;
  pointer-events: none !important;
}

.arrow-anim-cyber {
  stroke-dasharray: 14 8 4 8 !important;
  animation: mermaid-arrow-cyber 0.85s linear infinite !important;
  filter:
    drop-shadow(0 0 2px #ffffff)
    drop-shadow(0 0 6px currentColor)
    drop-shadow(0 0 14px currentColor) !important;
}

.arrow-anim-broken-sender,
.arrow-anim-stutter {
  stroke-dasharray: 8 6 !important;
  animation: mermaid-broken-sender 3.2s ease-in-out infinite !important;
  filter: drop-shadow(0 0 2px currentColor) drop-shadow(0 0 6px currentColor) !important;
}

.arrow-anim-broken-network,
.arrow-anim-ricochet {
  animation: mermaid-broken-network 2.5s ease-in-out infinite !important;
  filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 8px currentColor) !important;
}

.arrow-breaker-cap {
  stroke-linecap: round !important;
  filter: drop-shadow(0 0 4px currentColor) !important;
  pointer-events: none;
}

.arrow-anim-broken-receiver,
.arrow-anim-hesitate {
  stroke-dasharray: 10 6 !important;
  animation: mermaid-ricochet-recoil 3.6s ease-in-out infinite !important;
  filter: drop-shadow(0 0 2px currentColor) drop-shadow(0 0 7px currentColor) !important;
}

.arrow-barrier-wall {
  stroke-linecap: round !important;
  filter: drop-shadow(0 0 5px currentColor) !important;
  pointer-events: none;
}

.arrow-shockwave-burst {
  transform-box: fill-box;
  transform-origin: center;
  animation: mermaid-shockwave-burst 2.6s cubic-bezier(0.1, 0.7, 0.3, 1) infinite;
  pointer-events: none;
  filter: drop-shadow(0 0 5px currentColor);
}

.arrow-alarm-ping {
  transform-box: fill-box;
  transform-origin: center;
  animation: mermaid-alarm-ping 2.2s cubic-bezier(0, 0.2, 0.8, 1) infinite;
  pointer-events: none;
}

.arrow-x-mark {
  transform-box: fill-box;
  transform-origin: center;
  animation: mermaid-x-pulse 1.8s ease-in-out infinite;
  pointer-events: none;
  filter: drop-shadow(0 0 5px currentColor);
}

.arrow-x-mark circle {
  fill: #090d16;
}

.svg-sticky-note {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
`;

/**
 * Escapes characters for XML attribute / text nodes
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Prepares an SVG element for standalone export:
 * - Injects full animation keyframes & styles into <defs><style>
 * - Sets direct SVG presentation attributes on packet runners & markers
 * - Embeds sticky notes into the SVG if present and enabled
 * - Expands viewBox if sticky notes extend past diagram bounds
 * - Strips editor selection artifacts
 * - Formats into standalone XML SVG document
 */
export function prepareSvgForExport(svg: SVGElement, options: SvgExportOptions = {}): string {
  const clone = svg.cloneNode(true) as SVGElement;
  const doc = clone.ownerDocument || document;

  // 1. Ensure required SVG namespaces
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }

  // 2. Remove editor artifacts
  clone.querySelectorAll('.editor-selected').forEach((el) => {
    el.classList.remove('editor-selected');
  });

  // 3. Ensure <defs> is at the very beginning of the SVG so defs + background precede all diagram content
  let defs = clone.querySelector('defs');
  if (!defs) {
    defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
    clone.insertBefore(defs, clone.firstChild);
  } else if (defs !== clone.firstChild) {
    clone.insertBefore(defs, clone.firstChild);
  }

  // Find or create the primary embedded style element
  let embeddedStyle = defs.querySelector('style[data-source="mermaid-viewer-export"]');
  if (!embeddedStyle) {
    embeddedStyle = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    embeddedStyle.setAttribute('type', 'text/css');
    embeddedStyle.setAttribute('data-source', 'mermaid-viewer-export');
    defs.appendChild(embeddedStyle);
  }

  const isDark = !!options.isDark;
  clone.classList.add(isDark ? 'theme-dark' : 'theme-light');

  const actorStyles = isDark ? `
/* --- Sequence Diagram Actor & Lifeline Styles (Dark Mode) --- */
.theme-dark rect.actor:not([data-colored="true"]),
rect.actor:not([data-colored="true"]) {
  stroke: #3b82f6 !important;
  fill: #1e293b !important;
}
.theme-dark line.actor-line,
line.actor-line {
  stroke: #334155 !important;
}
.theme-dark text.actor:not([data-colored="true"]) > tspan,
.theme-dark text.actor:not([data-colored="true"]),
text.actor:not([data-colored="true"]) > tspan,
text.actor:not([data-colored="true"]) {
  fill: #f8fafc !important;
}
.theme-dark .actor-man:not([data-colored="true"]) circle,
.theme-dark .actor-man:not([data-colored="true"]) line,
.actor-man:not([data-colored="true"]) circle,
.actor-man:not([data-colored="true"]) line {
  stroke: #3b82f6 !important;
  fill: #1e293b !important;
}
` : `
/* --- Sequence Diagram Actor & Lifeline Styles (Light Mode) --- */
.actor-man:not([data-colored="true"]) circle,
.actor-man:not([data-colored="true"]) line {
  stroke: #28253D !important;
}
`;

  embeddedStyle.textContent = (embeddedStyle.textContent || '') + '\n' + EMBEDDED_SVG_STYLES + '\n' + actorStyles;

  // 4. Ensure packet runners carry explicit SVG presentation attributes for viewers without CSS support
  clone.querySelectorAll('.arrow-anim-packet-runner').forEach((runner) => {
    runner.setAttribute('pathLength', '100');
    runner.setAttribute('stroke-dasharray', '6 100');
    runner.setAttribute('stroke-linecap', 'round');
    const styleable = runner as Element & { style: CSSStyleDeclaration };
    if (styleable.style) {
      styleable.style.strokeDasharray = '6 100';
      styleable.style.strokeLinecap = 'round';
    }
  });

  // 5. Ensure stick-figure actors carry explicit stroke presentation attributes for viewers without CSS support
  const actorStroke = isDark ? '#3b82f6' : '#28253D';
  const actorFill = isDark ? '#1e293b' : '#ffffff';
  clone.querySelectorAll('.actor-man line').forEach((line) => {
    if (!line.getAttribute('stroke') || line.getAttribute('stroke') === 'none') {
      line.setAttribute('stroke', actorStroke);
    }
  });
  clone.querySelectorAll('.actor-man circle').forEach((circle) => {
    if (!circle.getAttribute('stroke') || circle.getAttribute('stroke') === 'none') {
      circle.setAttribute('stroke', actorStroke);
    }
    if (!circle.getAttribute('fill') || circle.getAttribute('fill') === 'none') {
      circle.setAttribute('fill', actorFill);
    }
  });

  // 5. Parse current viewBox for bounds handling and background rect
  let minX = 0;
  let minY = 0;
  let vbWidth = 800;
  let vbHeight = 600;
  const rawViewBox = clone.getAttribute('viewBox');
  if (rawViewBox) {
    const parts = rawViewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      [minX, minY, vbWidth, vbHeight] = parts;
    }
  } else {
    const w = parseFloat(clone.getAttribute('width') || '800');
    const h = parseFloat(clone.getAttribute('height') || '600');
    if (!isNaN(w) && !isNaN(h)) {
      vbWidth = w;
      vbHeight = h;
      clone.setAttribute('viewBox', `0 0 ${vbWidth} ${vbHeight}`);
    }
  }

  // 6. Embed sticky notes if provided and enabled
  const notes = options.notes || [];
  const showNotes = options.showNotes !== false;

  if (showNotes && notes.length > 0) {
    let maxRight = minX + vbWidth;
    let maxBottom = minY + vbHeight;

    const notesGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    notesGroup.setAttribute('class', 'sticky-notes-export-layer');

    notes.forEach((note) => {
      const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'svg-sticky-note');
      g.setAttribute('data-note-id', note.id);
      g.setAttribute('transform', `translate(${note.x}, ${note.y})`);

      const w = note.width || 160;
      const h = note.height || 100;
      const colors = STICKY_NOTE_HEX[note.color || 'yellow'] || STICKY_NOTE_HEX.yellow;

      // Track bounding box expansion
      if (note.x + w > maxRight) maxRight = note.x + w + 16;
      if (note.y + h > maxBottom) maxBottom = note.y + h + 16;

      // Note background card
      const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('rx', '6');
      rect.setAttribute('ry', '6');
      rect.setAttribute('fill', colors.bg);
      rect.setAttribute('stroke', colors.border);
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.12))');
      g.appendChild(rect);

      // Header strip
      const header = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      header.setAttribute('width', String(w));
      header.setAttribute('height', '18');
      header.setAttribute('rx', '6');
      header.setAttribute('ry', '6');
      header.setAttribute('fill', colors.header);
      g.appendChild(header);

      // Header dot pin
      const dot = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', '12');
      dot.setAttribute('cy', '9');
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', colors.dot);
      g.appendChild(dot);

      // Plain SVG text fallback (lines wrapped)
      const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      textEl.setAttribute('x', '10');
      textEl.setAttribute('y', '32');
      textEl.setAttribute('font-size', '11');
      textEl.setAttribute('fill', colors.text);
      textEl.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');

      const lines = (note.text || '').split('\n');
      lines.forEach((line, idx) => {
        const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', '10');
        if (idx > 0) tspan.setAttribute('dy', '15');
        tspan.textContent = line || ' ';
        textEl.appendChild(tspan);
      });
      g.appendChild(textEl);

      // ForeignObject for rich rendered HTML markdown in browsers
      const fo = doc.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      fo.setAttribute('x', '8');
      fo.setAttribute('y', '20');
      fo.setAttribute('width', String(w - 16));
      fo.setAttribute('height', String(h - 24));

      const div = doc.createElement('div');
      div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      div.style.fontSize = '11px';
      div.style.color = colors.text;
      div.style.lineHeight = '1.35';
      div.style.wordBreak = 'break-word';
      div.style.overflow = 'hidden';
      div.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      div.innerHTML = escapeXml(note.text || '').replace(/\n/g, '<br/>');
      fo.appendChild(div);
      g.appendChild(fo);

      notesGroup.appendChild(g);
    });

    clone.appendChild(notesGroup);

    // Update viewBox if notes exceed boundary
    if (maxRight > minX + vbWidth || maxBottom > minY + vbHeight) {
      vbWidth = maxRight - minX;
      vbHeight = maxBottom - minY;
      clone.setAttribute('viewBox', `${minX} ${minY} ${vbWidth} ${vbHeight}`);
    }
  }

  // 7. Add theme background rect to ensure diagrams with light text are not invisible on white viewers
  const bgRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('class', 'diagram-export-bg');
  bgRect.setAttribute('x', String(minX));
  bgRect.setAttribute('y', String(minY));
  bgRect.setAttribute('width', String(vbWidth));
  bgRect.setAttribute('height', String(vbHeight));
  bgRect.setAttribute('fill', options.isDark ? '#090d16' : '#ffffff');
  // Insert background behind diagram content (right after <defs>)
  if (defs.nextSibling) {
    clone.insertBefore(bgRect, defs.nextSibling);
  } else {
    clone.appendChild(bgRect);
  }

  // 8. Serialize to standalone XML
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(clone);

  if (!source.match(/^<\?xml/)) {
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;
  }

  return source;
}

/**
 * Triggers browser download of the exported SVG
 */
export function exportSvgToFile(svgElement: SVGElement, options: SvgExportOptions = {}): boolean {
  try {
    const source = prepareSvgForExport(svgElement, options);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = options.fileName ? options.fileName.replace(/\.[^/.]+$/, '') : 'diagram';
    link.href = url;
    link.download = `${baseName}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to export SVG:', err);
    return false;
  }
}
