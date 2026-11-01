import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  prepareSvgForExport,
  exportSvgToFile,
  renderSvgToPngBlob,
  exportPngToFile,
  copyPngToClipboard,
  STICKY_NOTE_HEX,
} from './svgExport';
import { StickyNote } from './views';

describe('svgExport', () => {
  const SAMPLE_SVG = `
    <svg id="test-svg" viewBox="0 0 500 400" width="500" height="400">
      <defs>
        <marker id="marker-arrow" markerWidth="6" markerHeight="6"><path d="M 0 0 L 6 3 L 0 6 z"/></marker>
      </defs>
      <line x1="50" y1="100" x2="350" y2="100" class="arrow-anim-pulse" stroke="#00ff9d" />
      <line x1="50" y1="100" x2="350" y2="100" class="arrow-anim-packet-runner editor-selected" stroke="#00ff9d" />
      <text x="50" y="50" class="editor-selected">Alice</text>
    </svg>
  `;

  function createSvgElement(markup: string = SAMPLE_SVG): SVGElement {
    const div = document.createElement('div');
    div.innerHTML = markup.trim();
    return div.querySelector('svg') as SVGElement;
  }

  describe('prepareSvgForExport', () => {
    it('embeds all visual animation keyframes and rules into <defs><style>', () => {
      const svg = createSvgElement();
      const output = prepareSvgForExport(svg);

      expect(output).toContain('<?xml version="1.0" standalone="no"?>');
      expect(output).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(output).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');

      // Keyframes for all arrow animations
      expect(output).toContain('@keyframes mermaid-arrow-flow');
      expect(output).toContain('@keyframes mermaid-arrow-packet');
      expect(output).toContain('@keyframes mermaid-arrow-cyber');
      expect(output).toContain('@keyframes mermaid-broken-sender');
      expect(output).toContain('@keyframes mermaid-broken-network');
      expect(output).toContain('@keyframes mermaid-ricochet-recoil');
      expect(output).toContain('@keyframes mermaid-shockwave-burst');
      expect(output).toContain('@keyframes mermaid-alarm-ping');
      expect(output).toContain('@keyframes mermaid-x-pulse');

      // CSS classes
      expect(output).toContain('.arrow-anim-packet-runner');
      expect(output).toContain('.arrow-anim-flow');
      expect(output).toContain('.arrow-anim-pulse');
      expect(output).toContain('.arrow-anim-cyber');
      expect(output).toContain('.arrow-breaker-cap');
      expect(output).toContain('.arrow-barrier-wall');
    });

    it('sets direct SVG attributes on packet runner elements for viewers without CSS', () => {
      const svg = createSvgElement();
      const output = prepareSvgForExport(svg);

      const div = document.createElement('div');
      div.innerHTML = output;
      const runner = div.querySelector('.arrow-anim-packet-runner')!;
      expect(runner).toBeTruthy();
      expect(runner.getAttribute('pathLength')).toBe('100');
      expect(runner.getAttribute('stroke-dasharray')).toBe('6 100');
      expect(runner.getAttribute('stroke-linecap')).toBe('round');
    });

    it('strips .editor-selected classes from exported SVG', () => {
      const svg = createSvgElement();
      const output = prepareSvgForExport(svg);

      expect(output).not.toContain('editor-selected');
    });

    it('removes the invisible edge hit paths (edit-mode selection targets)', () => {
      const svg = createSvgElement(`
        <svg id="test-svg" viewBox="0 0 500 400">
          <g class="edgePaths">
            <path d="M10,10L90,10" data-et="edge" data-id="L_A_B_0" class="flowchart-link"></path>
            <path d="M10,10L90,10" data-id="L_A_B_0" class="edge-hit" data-et="edge-hit" fill="none" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke" pointer-events="stroke"></path>
          </g>
        </svg>
      `);
      const output = prepareSvgForExport(svg);

      expect(output).not.toContain('edge-hit');
      expect(output).toContain('data-et="edge"');
    });

    it('inserts dark mode background rect when isDark is true', () => {
      const svg = createSvgElement();
      const output = prepareSvgForExport(svg, { isDark: true });

      const div = document.createElement('div');
      div.innerHTML = output;
      const bg = div.querySelector('rect.diagram-export-bg')!;
      expect(bg).toBeTruthy();
      expect(bg.getAttribute('fill')).toBe('#090d16');
      expect(bg.getAttribute('width')).toBe('500');
      expect(bg.getAttribute('height')).toBe('400');
    });

    it('inserts light mode background rect when isDark is false', () => {
      const svg = createSvgElement();
      const output = prepareSvgForExport(svg, { isDark: false });

      const div = document.createElement('div');
      div.innerHTML = output;
      const bg = div.querySelector('rect.diagram-export-bg')!;
      expect(bg).toBeTruthy();
      expect(bg.getAttribute('fill')).toBe('#ffffff');
    });

    it('normalizes preset actor colors and text contrast to match the exported theme', () => {
      const svgWithColoredActor = createSvgElement(`
        <svg id="test-svg" viewBox="0 0 500 400">
          <g data-et="participant" data-id="A" data-colored="true">
            <rect class="actor" data-colored="true" fill="#213b5e" stroke="#213b5e" style="fill: #213b5e !important; stroke: #213b5e !important;"></rect>
            <text class="actor" data-colored="true" fill="#ffffff" style="fill: #ffffff !important;"><tspan data-colored="true" fill="#ffffff" style="fill: #ffffff !important;">Alice</tspan></text>
          </g>
        </svg>
      `);

      // Exporting in light mode (isDark: false) converts #213b5e -> #cfe2f3 and text -> #0f172a
      const lightExport = prepareSvgForExport(svgWithColoredActor, { isDark: false });
      const lightDiv = document.createElement('div');
      lightDiv.innerHTML = lightExport;
      const lightRect = lightDiv.querySelector('rect.actor')!;
      const lightText = lightDiv.querySelector('text.actor')!;
      expect(lightRect.getAttribute('fill')).toBe('#cfe2f3');
      expect(lightText.getAttribute('fill')).toBe('#0f172a');

      // Exporting that light-colored SVG in dark mode (isDark: true) converts #cfe2f3 -> #213b5e and text -> #ffffff
      const lightSvgEl = lightDiv.querySelector('svg') as SVGElement;
      const darkExport = prepareSvgForExport(lightSvgEl, { isDark: true });
      const darkDiv = document.createElement('div');
      darkDiv.innerHTML = darkExport;
      const darkRect = darkDiv.querySelector('rect.actor')!;
      const darkText = darkDiv.querySelector('text.actor')!;
      expect(darkRect.getAttribute('fill')).toBe('#213b5e');
      expect(darkText.getAttribute('fill')).toBe('#ffffff');
    });

    it('embeds sticky notes into SVG with cards, headers, pins, and text', () => {
      const svg = createSvgElement();
      const sampleNotes: StickyNote[] = [
        {
          id: 'note-1',
          x: 100,
          y: 120,
          width: 180,
          height: 110,
          color: 'yellow',
          text: 'Review async flow\n- [ ] checked',
        },
        {
          id: 'note-2',
          x: 320,
          y: 200,
          width: 160,
          height: 90,
          color: 'green',
          text: 'Verified response',
        },
      ];

      const output = prepareSvgForExport(svg, {
        notes: sampleNotes,
        showNotes: true,
      });

      const div = document.createElement('div');
      div.innerHTML = output;

      const noteGroups = div.querySelectorAll('.svg-sticky-note');
      expect(noteGroups).toHaveLength(2);

      const note1 = div.querySelector('[data-note-id="note-1"]')!;
      expect(note1).toBeTruthy();
      expect(note1.getAttribute('transform')).toBe('translate(100, 120)');

      const card1 = note1.querySelector('rect')!;
      expect(card1.getAttribute('fill')).toBe(STICKY_NOTE_HEX.yellow.bg);
      expect(card1.getAttribute('stroke')).toBe(STICKY_NOTE_HEX.yellow.border);

      const pin1 = note1.querySelector('circle')!;
      expect(pin1.getAttribute('fill')).toBe(STICKY_NOTE_HEX.yellow.dot);

      expect(note1.textContent).toContain('Review async flow');
      expect(note1.textContent).toContain('checked');

      // foreignObject content for rich HTML rendering in browsers
      const fo = note1.querySelector('foreignObject')!;
      expect(fo).toBeTruthy();
      expect(fo.innerHTML).toContain('Review async flow');
    });

    it('expands SVG viewBox if sticky notes extend past diagram bounds', () => {
      const svg = createSvgElement(); // viewBox="0 0 500 400"
      const outOfBoundsNotes: StickyNote[] = [
        {
          id: 'note-far',
          x: 600,
          y: 450,
          width: 200,
          height: 120,
          color: 'blue',
          text: 'Outside diagram note',
        },
      ];

      const output = prepareSvgForExport(svg, {
        notes: outOfBoundsNotes,
        showNotes: true,
      });

      const div = document.createElement('div');
      div.innerHTML = output;
      const exportedSvg = div.querySelector('svg')!;
      const viewBox = exportedSvg.getAttribute('viewBox')!;
      const [minX, minY, vbW, vbH] = viewBox.split(' ').map(Number);

      expect(minX).toBe(0);
      expect(minY).toBe(0);
      expect(vbW).toBeGreaterThanOrEqual(816); // 600 + 200 + 16
      expect(vbH).toBeGreaterThanOrEqual(586); // 450 + 120 + 16
    });

    it('does not embed sticky notes when showNotes is false', () => {
      const svg = createSvgElement();
      const sampleNotes: StickyNote[] = [
        {
          id: 'note-hidden',
          x: 100,
          y: 100,
          color: 'yellow',
          text: 'Hidden note',
        },
      ];

      const output = prepareSvgForExport(svg, {
        notes: sampleNotes,
        showNotes: false,
      });

      const div = document.createElement('div');
      div.innerHTML = output;
      expect(div.querySelector('.svg-sticky-note')).toBeNull();
      expect(output).not.toContain('Hidden note');
    });
  });

  describe('exportSvgToFile', () => {
    let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/mock-url');
      revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('serializes SVG and triggers browser download link with base name', () => {
      const svg = createSvgElement();
      const success = exportSvgToFile(svg, {
        fileName: 'architecture.mmd',
        isDark: true,
      });

      expect(success).toBe(true);
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    });

    it('places background rect behind all sequence diagram actors and lifelines (not covering them)', async () => {
      const { renderPipeline } = await import('./editorTestHarness');
      const code = `sequenceDiagram
        actor C as Client
        participant GW as API Gateway
        C->>GW: POST /checkout`;
      const res = await renderPipeline(code);
      const div = document.createElement('div');
      div.innerHTML = res.svg;
      const svgEl = div.querySelector('svg') as SVGElement;
      const exported = prepareSvgForExport(svgEl, { isDark: true });

      const parsed = document.createElement('div');
      parsed.innerHTML = exported;
      const bg = parsed.querySelector('rect.diagram-export-bg')!;
      expect(bg).toBeTruthy();

      // All participant/actor elements must appear AFTER bg in document order
      const actors = parsed.querySelectorAll('g[data-et="participant"], rect.actor, line.actor-line, text.actor, .actor-man');
      expect(actors.length).toBeGreaterThan(0);
      actors.forEach((actor) => {
        // actor must be following bg in document order (not preceding it)
        const position = bg.compareDocumentPosition(actor);
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });

      // Verify actor styles are embedded
      expect(exported).toContain('rect.actor:not([data-colored="true"])');
      expect(exported).toContain('text.actor:not([data-colored="true"])');
      expect(exported).toContain('.actor-man:not([data-colored="true"])');

      // Verify stick figure actor has presentation stroke attributes
      const manLines = parsed.querySelectorAll('.actor-man line');
      expect(manLines.length).toBeGreaterThan(0);
      manLines.forEach((l) => {
        expect(l.getAttribute('stroke')).toBe('#3b82f6');
      });
    });

    it('embeds light mode sequence actor styling and attributes when isDark is false', async () => {
      const { renderPipeline } = await import('./editorTestHarness');
      const code = `sequenceDiagram
        actor C as Client
        participant GW as API Gateway
        C->>GW: POST /checkout`;
      const res = await renderPipeline(code);
      const div = document.createElement('div');
      div.innerHTML = res.svg;
      const svgEl = div.querySelector('svg') as SVGElement;
      const exported = prepareSvgForExport(svgEl, { isDark: false });

      const parsed = document.createElement('div');
      parsed.innerHTML = exported;
      const bg = parsed.querySelector('rect.diagram-export-bg')!;
      expect(bg.getAttribute('fill')).toBe('#ffffff');

      // Verify stick figure actor has light mode stroke presentation attributes
      const manLines = parsed.querySelectorAll('.actor-man line');
      expect(manLines.length).toBeGreaterThan(0);
      manLines.forEach((l) => {
        expect(l.getAttribute('stroke')).toBe('#28253D');
      });
    });
  });

  describe('PNG export and clipboard copy', () => {
    const origImage = globalThis.Image;
    const origClipboardItem = globalThis.ClipboardItem;
    let mockCtx: { scale: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
    let createdCanvasWidth = 0;
    let createdCanvasHeight = 0;

    beforeEach(() => {
      mockCtx = {
        scale: vi.fn(),
        drawImage: vi.fn(),
      };
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tagName, options);
        if (tagName.toLowerCase() === 'canvas') {
          const canvas = el as HTMLCanvasElement;
          Object.defineProperty(canvas, 'getContext', {
            value: vi.fn(() => mockCtx),
          });
          Object.defineProperty(canvas, 'toBlob', {
            value: vi.fn((cb: (blob: Blob | null) => void) => {
              createdCanvasWidth = canvas.width;
              createdCanvasHeight = canvas.height;
              cb(new Blob(['png-bytes'], { type: 'image/png' }));
            }),
          });
        }
        return el;
      }) as typeof document.createElement);

      class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';
        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
      }
      globalThis.Image = MockImage as unknown as typeof Image;
    });

    afterEach(() => {
      globalThis.Image = origImage;
      globalThis.ClipboardItem = origClipboardItem;
      vi.restoreAllMocks();
    });

    it('renderSvgToPngBlob rasterizes SVG at 2x default scale', async () => {
      const svg = createSvgElement(); // viewBox="0 0 500 400"
      const blob = await renderSvgToPngBlob(svg, { isDark: true });
      expect(blob.type).toBe('image/png');
      expect(createdCanvasWidth).toBe(1000);
      expect(createdCanvasHeight).toBe(800);
      expect(mockCtx.scale).toHaveBeenCalledWith(2, 2);
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(1);
    });

    it('exportPngToFile downloads a .png file with baseName', async () => {
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/png');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const svg = createSvgElement();
      const ok = await exportPngToFile(svg, { fileName: 'checkout-flow.mmd', scale: 3 });
      expect(ok).toBe(true);
      expect(createdCanvasWidth).toBe(1500);
      expect(createdCanvasHeight).toBe(1200);
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    });

    it('copyPngToClipboard writes a ClipboardItem with image/png blob', async () => {
      const writeMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { write: writeMock },
        configurable: true,
      });
      class MockClipboardItem {
        items: Record<string, Blob>;
        constructor(items: Record<string, Blob>) {
          this.items = items;
        }
      }
      globalThis.ClipboardItem = MockClipboardItem as unknown as typeof ClipboardItem;

      const svg = createSvgElement();
      const ok = await copyPngToClipboard(svg, { isDark: false });
      expect(ok).toBe(true);
      expect(writeMock).toHaveBeenCalledTimes(1);
      const writtenItem = writeMock.mock.calls[0][0][0] as MockClipboardItem;
      expect(writtenItem.items['image/png']).toBeInstanceOf(Blob);
    });

    it('copyPngToClipboard returns false gracefully when clipboard.write is unavailable', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      Object.defineProperty(navigator, 'clipboard', {
        value: {},
        configurable: true,
      });
      const svg = createSvgElement();
      const ok = await copyPngToClipboard(svg);
      expect(ok).toBe(false);
      expect(errSpy).toHaveBeenCalled();
    });
  });
});
