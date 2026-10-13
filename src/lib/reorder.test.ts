import { describe, it, expect } from 'vitest';
import { resolveParticipantReorder, ReorderContext } from './reorder';
import { parseModel } from './model';
import { moveParticipant } from './editor';
import { transformActors, processMermaid } from './preprocessor';
import { parseConfig } from './editorTestHarness';

// Fixture A: no CONFIG — the processed diagram is the raw diagram, so the
// rendered order equals the declaration order and reordering is free.
const PLAIN = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    A->>B: Hello
    B->>C: Hi`;

// Fixture B: CONFIG actor colors — transformActors regroups the participants
// (uncolored first, then one box per color), so the rendered order is NOT the
// declaration order:
//   raw:       Auth, DB, API, C
//   rendered:  C, [red: Auth, DB], [blue: API]
const COLORED = `%% CONFIG: {"version":1,"actors":{"Auth":{"color":"red"},"DB":{"color":"red"},"API":{"color":"blue"}}}
sequenceDiagram
    participant Auth as Auth Service
    participant DB as Database
    participant API as API Gateway
    participant C as Client
    Auth->>API: ping`;

// Fixture C: same colors, but the blue box renders first (the shape of
// diagrams/main.mmd):
//   raw:       C, API, Auth, DB
//   rendered:  C, [blue: API], [red: Auth, DB]
const BLUE_FIRST = `%% CONFIG: {"version":1,"actors":{"Auth":{"color":"red"},"DB":{"color":"red"},"API":{"color":"blue"}}}
sequenceDiagram
    participant C as Client
    participant API as API Gateway
    participant Auth as Auth Service
    participant DB as Database
    Auth->>API: ping`;

const ctxFor = (code: string): ReorderContext => ({
  config: parseConfig(code),
  actorOptions: {},
  isRegionVisible: () => true,
});

// Run the same processing pipeline ClientPage uses for the viewer.
const processedOf = (code: string, ctx: ReorderContext): string =>
  processMermaid(transformActors(code, ctx.config, ctx.actorOptions), {
    isRegionVisible: ctx.isRegionVisible,
  }).code;

const participantIds = (code: string): string[] =>
  parseModel(code).elements.filter(e => e.kind === 'participant').map(e => e.id);

describe('resolveParticipantReorder', () => {
  describe('plain diagram (rendered order == raw order)', () => {
    const ctx = ctxFor(PLAIN);
    const processed = processedOf(PLAIN, ctx);

    it('matches the direct raw edit at the extremes', () => {
      // Drag A (leftmost) to the far right.
      const res = resolveParticipantReorder(PLAIN, processed, 'p:0', null, ctx);
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(moveParticipant(PLAIN, null, 'p:0', undefined).code);
      expect(participantIds(res.code)).toEqual(['B', 'C', 'A']);
      expect(res.newKey).toBe('p:2');
      // Drag C (rightmost) to the far left.
      const res2 = resolveParticipantReorder(PLAIN, processed, 'p:2', 'p:0', ctx);
      expect(participantIds(res2.code)).toEqual(['C', 'A', 'B']);
      expect(res2.newKey).toBe('p:0');
    });

    it('resolves a middle drop to the direct raw edit', () => {
      const res = resolveParticipantReorder(PLAIN, processed, 'p:1', 'p:0', ctx);
      expect(participantIds(res.code)).toEqual(['B', 'A', 'C']);
    });

    it('is a no-op when the drop position equals the current position', () => {
      // A is already before B.
      const res = resolveParticipantReorder(PLAIN, processed, 'p:0', 'p:1', ctx);
      expect(res.code).toBe(PLAIN);
      expect(res.warning).toBeUndefined();
    });
  });

  describe('colored diagram (colors do not create artificial boxes)', () => {
    const ctx = ctxFor(COLORED);
    const processed = processedOf(COLORED, ctx);

    it('rendered order matches declaration order', () => {
      expect(participantIds(processed)).toEqual(['Auth', 'DB', 'API', 'C']);
    });

    it('moves the rightmost participant to the far left', () => {
      // Drag C (processed p:3) before Auth (processed p:0).
      const res = resolveParticipantReorder(COLORED, processed, 'p:3', 'p:0', ctx);
      expect(res.warning).toBeUndefined();
      expect(participantIds(processedOf(res.code, ctx))).toEqual(['C', 'Auth', 'DB', 'API']);
      expect(participantIds(res.code)).toEqual(['C', 'Auth', 'DB', 'API']);
      expect(res.newKey).toBe('p:0');
    });

    it('moves a participant to the far right', () => {
      // Drag Auth (processed p:0) to the end.
      const res = resolveParticipantReorder(COLORED, processed, 'p:0', null, ctx);
      expect(res.warning).toBeUndefined();
      expect(participantIds(processedOf(res.code, ctx))).toEqual(['DB', 'API', 'C', 'Auth']);
    });

    it('is a silent no-op when the drop position equals the current rendered position', () => {
      // Auth is already rendered before DB (processed p:1).
      const res = resolveParticipantReorder(COLORED, processed, 'p:0', 'p:1', ctx);
      expect(res.code).toBe(COLORED);
      expect(res.warning).toBeUndefined();
    });

    it('soft-fails on unknown processed keys', () => {
      expect(resolveParticipantReorder(COLORED, processed, 'p:99', null, ctx).warning).toBeTruthy();
      expect(resolveParticipantReorder(COLORED, processed, 'p:0', 'p:99', ctx).warning).toBeTruthy();
    });
  });

  // Exhaustive matrix: every participant x every drop gap (before each other
  // participant, plus the end). Expected orders are derived by hand from the
  // grouping rules — uncolored participants render first, then one
  // contiguous box per color (box order = first appearance in the raw order,
  // members in raw order) — so a single-line raw move can only produce orders
  // reachable under those rules. `hint: true` marks drops whose target is
  // unreachable and where no raw edit improves on the current position: the
  // resolver must then return a no-op WITH a warning (never a silent no-op,
  // never a wrong move).
  const expectDrop = (
    raw: string,
    ctx: ReorderContext,
    rendered: string[],
    fromId: string,
    beforeId: string | null,
    expected: string[],
    hint: boolean,
  ) => {
    const processed = processedOf(raw, ctx);
    const res = resolveParticipantReorder(
      raw,
      processed,
      `p:${rendered.indexOf(fromId)}`,
      beforeId === null ? null : `p:${rendered.indexOf(beforeId)}`,
      ctx,
    );
    if (hint) {
      expect(res.warning).toBeTruthy();
      expect(res.code).toBe(raw); // stuck drop: no rewrite
    } else {
      expect(res.warning).toBeUndefined();
    }
    expect(participantIds(processedOf(res.code, ctx))).toEqual(expected);
    if (res.code !== raw) {
      // A committed move selects the dragged participant in the new code.
      expect(res.newKey).toBe(`p:${participantIds(res.code).indexOf(fromId)}`);
    } else {
      // A silent no-op is only correct when already at the target.
      expect(expected).toEqual(rendered);
    }
  };

  describe('matrix: plain diagram (every drop lands exactly)', () => {
    const ctx = ctxFor(PLAIN);
    const rendered = ['A', 'B', 'C'];
    for (let f = 0; f < rendered.length; f++) {
      for (let b = 0; b <= rendered.length; b++) {
        const beforeId = b === rendered.length ? null : rendered[b];
        if (beforeId === rendered[f]) continue; // the viewer never offers the dragged participant's own gap
        const rest = rendered.filter(id => id !== rendered[f]);
        const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
        const expected = [...rest];
        expected.splice(at, 0, rendered[f]);
        it(`drag ${rendered[f]} before ${beforeId ?? '(end)'} -> [${expected.join(', ')}]`, () => {
          expectDrop(PLAIN, ctx, rendered, rendered[f], beforeId, expected, false);
        });
      }
    }
  });

  describe('matrix: colored diagram (every drop lands exactly)', () => {
    const ctx = ctxFor(COLORED);
    const rendered = ['Auth', 'DB', 'API', 'C'];
    for (let f = 0; f < rendered.length; f++) {
      for (let b = 0; b <= rendered.length; b++) {
        const beforeId = b === rendered.length ? null : rendered[b];
        if (beforeId === rendered[f]) continue;
        const rest = rendered.filter(id => id !== rendered[f]);
        const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
        const expected = [...rest];
        expected.splice(at, 0, rendered[f]);
        it(`drag ${rendered[f]} before ${beforeId ?? '(end)'} -> [${expected.join(', ')}]`, () => {
          expectDrop(COLORED, ctx, rendered, rendered[f], beforeId, expected, false);
        });
      }
    }
  });

  describe('matrix: blue first colored diagram (every drop lands exactly)', () => {
    const ctx = ctxFor(BLUE_FIRST);
    const rendered = ['C', 'API', 'Auth', 'DB'];
    for (let f = 0; f < rendered.length; f++) {
      for (let b = 0; b <= rendered.length; b++) {
        const beforeId = b === rendered.length ? null : rendered[b];
        if (beforeId === rendered[f]) continue;
        const rest = rendered.filter(id => id !== rendered[f]);
        const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
        const expected = [...rest];
        expected.splice(at, 0, rendered[f]);
        it(`drag ${rendered[f]} before ${beforeId ?? '(end)'} -> [${expected.join(', ')}]`, () => {
          expectDrop(BLUE_FIRST, ctx, rendered, rendered[f], beforeId, expected, false);
        });
      }
    }
  });
});
