// Step 13 — risk #2 verification: the model<->SVG zip on a real complex
// diagram. diagrams/complex.mmd is a committed repo fixture (read-only here):
// a 112-line sequence diagram with nested regions, a rect block and notes.
// Rendered with every region visible, the positional zip must map every model
// element without falling back (no count/endpoint mismatch warnings).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPipeline } from './editorTestHarness';
import { zipModelToSvg } from './svgmap';
import { parseSvgRoot } from './svgTestFixtures';

const complexCode = readFileSync(join(process.cwd(), 'diagrams/complex.mmd'), 'utf-8');

describe('risk #2: zip on diagrams/complex.mmd (Step 13)', () => {
  it('maps every element of the complex fixture without fallback warnings', async () => {
    const { svg, model } = await renderPipeline(complexCode, {});
    const zip = zipModelToSvg(parseSvgRoot(svg), model);

    // sanity: the fixture really is complex
    expect(zip.participants.length).toBeGreaterThanOrEqual(5);
    expect(zip.messages.length).toBeGreaterThanOrEqual(20);
    expect(zip.notes.length).toBeGreaterThanOrEqual(1);

    // no count/endpoint mismatch, no unmapped element
    expect(zip.warnings).toEqual([]);
    expect(zip.participants.every(Boolean)).toBe(true);
    expect(zip.messages.every(Boolean)).toBe(true);
    expect(zip.notes.every(Boolean)).toBe(true);
  });
});
