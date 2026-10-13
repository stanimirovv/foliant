import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prepareSvgForExport, exportSvgToFile, STICKY_NOTE_HEX } from './svgExport';
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
  });
});
