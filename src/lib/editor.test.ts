import { describe, it, expect } from 'vitest';
import {
  renameParticipant, editMessageLabel, setArrowType, addParticipant, addMessage,
  deleteElement, setActorColor, addTag, removeTag, setArrowStyle, getArrowStyle,
  moveParticipant, MessageInsertPosition,
} from './editor';
import { parseModel } from './model';
import { processMermaid, transformActors } from './preprocessor';
import { updateViewsData, DiagramConfig } from './views';
import { createSequenceDiagram, createFlowchartDiagram, parseConfig } from './editorTestHarness';

// Fixture with a CONFIG header, a comment, a region and blank lines: every
// transform must preserve all of them byte-for-byte.
const SEQ = `%% CONFIG: {"version":1,"actors":{"A":{"color":"red"}}}
sequenceDiagram
    %% a comment
    participant A as Alice
    participant B as Bob

    %% @region-start: flow=login
    A->>B: Hello
    B-->>A: Hi
    %% @region-end
    A->>B: Again`;
const SEQ_CFG = parseConfig(SEQ);

const FLOW = `%% CONFIG: {"version":1}
flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A
    A -- ping -- B
    C[Standalone]`;
const FLOW_CFG = parseConfig(FLOW);

// Assert that exactly one line changed and it equals expectedLine.
function expectOnlyLineChanged(before: string, after: string, lineIndex: number, expectedLine: string) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  expect(afterLines.length).toBe(beforeLines.length);
  afterLines.forEach((line, i) => {
    if (i === lineIndex) {
      expect(line).toBe(expectedLine);
    } else {
      expect(line).toBe(beforeLines[i]);
    }
  });
}

// Assert every line except the CONFIG line (0) is byte-identical.
function expectBodyIdentical(before: string, after: string) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  expect(afterLines.length).toBe(beforeLines.length);
  for (let i = 1; i < beforeLines.length; i++) {
    expect(afterLines[i]).toBe(beforeLines[i]);
  }
}

function keysOf(code: string, kind: string): string[] {
  return parseModel(code).elements.filter(e => e.kind === kind).map(e => e.key);
}

describe('renameParticipant', () => {
  it('renames a sequence participant with an existing alias', () => {
    const res = renameParticipant(SEQ, SEQ_CFG, 'p:0', 'Alicia');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ, res.code, 3, '    participant A as Alicia');
  });

  it('adds the as clause when missing', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B`;
    const res = renameParticipant(code, null, 'p:0', 'Alice');
    expect(res.code).toBe(`sequenceDiagram\n    participant A as Alice\n    participant B`);
  });

  it('drops the as clause on an empty alias', () => {
    const res = renameParticipant(SEQ, SEQ_CFG, 'p:0', '');
    expectOnlyLineChanged(SEQ, res.code, 3, '    participant A');
  });

  it('preserves the participant/actor keyword', () => {
    const code = `sequenceDiagram\n    actor C as Client`;
    const res = renameParticipant(code, null, 'p:0', 'User');
    expect(res.code).toBe(`sequenceDiagram\n    actor C as User`);
  });

  it('renames a flowchart node inside its defining shape on an edge line', () => {
    const res = renameParticipant(FLOW, FLOW_CFG, 'n:0', 'Alicia');
    expectOnlyLineChanged(FLOW, res.code, 2, '    A[Alicia] --> B[Bob]');
  });

  it('renames a flowchart node on a standalone line', () => {
    const res = renameParticipant(FLOW, FLOW_CFG, 'n:2', 'Solo');
    expectOnlyLineChanged(FLOW, res.code, 5, '    C[Solo]');
  });

  it('injects a shape for a bare flowchart node', () => {
    const code = `flowchart TD\n    A --> B`;
    const res = renameParticipant(code, null, 'n:0', 'Alpha');
    expect(res.code).toBe(`flowchart TD\n    A[Alpha] --> B`);
  });

  it('drops the shape on an empty alias so the id becomes the label', () => {
    const res = renameParticipant(FLOW, FLOW_CFG, 'n:0', '');
    expectOnlyLineChanged(FLOW, res.code, 2, '    A --> B[Bob]');
  });

  it('is a no-op for a bare node with an empty alias', () => {
    const code = `flowchart TD\n    A --> B`;
    const res = renameParticipant(code, null, 'n:0', '');
    expect(res.code).toBe(code);
    expect(res.warning).toBeUndefined();
  });

  it('preserves the cylinder shape delimiters', () => {
    const code = `flowchart TD\n    DB[(Database)] --> A`;
    const res = renameParticipant(code, null, 'n:0', 'Data Store');
    expect(res.code).toBe(`flowchart TD\n    DB[(Data Store)] --> A`);
  });

  it('preserves the round shape delimiters', () => {
    const code = `flowchart TD\n    B(Round) --> A`;
    const res = renameParticipant(code, null, 'n:0', 'Capsule');
    expect(res.code).toBe(`flowchart TD\n    B(Capsule) --> A`);
  });

  it('soft-fails on labels that would break the shape, newlines, and wrong kinds', () => {
    expect(renameParticipant(FLOW, FLOW_CFG, 'n:0', 'bad]label').warning).toBeTruthy();
    expect(renameParticipant(FLOW, FLOW_CFG, 'n:0', 'bad]label').code).toBe(FLOW);
    expect(renameParticipant(SEQ, SEQ_CFG, 'p:0', 'two\nlines').warning).toBeTruthy();
    expect(renameParticipant(SEQ, SEQ_CFG, 'm:0', 'X').warning).toBeTruthy();
    expect(renameParticipant(SEQ, SEQ_CFG, 'p:99', 'X').warning).toBeTruthy();
  });
});

describe('editMessageLabel', () => {
  it('rewrites the text after the colon in a sequence message', () => {
    const res = editMessageLabel(SEQ, SEQ_CFG, 'm:0', 'Hey');
    expectOnlyLineChanged(SEQ, res.code, 7, '    A->>B: Hey');
  });

  it('clears a sequence label back to the bare form', () => {
    const res = editMessageLabel(SEQ, SEQ_CFG, 'm:0', '');
    expectOnlyLineChanged(SEQ, res.code, 7, '    A->>B');
  });

  it('adds a label to a bare sequence message', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B\n    A--B`;
    const res = editMessageLabel(code, null, 'm:0', 'Yo');
    expect(res.code).toBe(`sequenceDiagram\n    participant A\n    participant B\n    A--B: Yo`);
  });

  it('preserves whitespace around the operator and colon', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B\n    A ->> B : Hello`;
    const res = editMessageLabel(code, null, 'm:0', 'X');
    expect(res.code).toBe(`sequenceDiagram\n    participant A\n    participant B\n    A ->> B : X`);
  });

  it('keeps labels containing colons intact', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B\n    A->>B: Error: Invalid Credentials`;
    const res = editMessageLabel(code, null, 'm:0', 'Error: 401');
    expect(res.code).toBe(`sequenceDiagram\n    participant A\n    participant B\n    A->>B: Error: 401`);
  });

  it('rewrites a flowchart pipe label', () => {
    const res = editMessageLabel(FLOW, FLOW_CFG, 'e:1', 'Yo');
    expectOnlyLineChanged(FLOW, res.code, 3, '    B -->|Yo| A');
  });

  it('clears a flowchart pipe label', () => {
    const res = editMessageLabel(FLOW, FLOW_CFG, 'e:1', '');
    expectOnlyLineChanged(FLOW, res.code, 3, '    B --> A');
  });

  it('injects a pipe label into a plain flowchart edge', () => {
    const res = editMessageLabel(FLOW, FLOW_CFG, 'e:0', 'X');
    expectOnlyLineChanged(FLOW, res.code, 2, '    A[Alice] -->|X| B[Bob]');
  });

  it('is a no-op when clearing a plain flowchart edge', () => {
    const res = editMessageLabel(FLOW, FLOW_CFG, 'e:0', '');
    expect(res.code).toBe(FLOW);
    expect(res.warning).toBeUndefined();
  });

  it('rewrites and clears an open-text flowchart edge label', () => {
    const res = editMessageLabel(FLOW, FLOW_CFG, 'e:2', 'pong');
    expectOnlyLineChanged(FLOW, res.code, 4, '    A -- pong -- B');
    const cleared = editMessageLabel(FLOW, FLOW_CFG, 'e:2', '');
    expectOnlyLineChanged(FLOW, cleared.code, 4, '    A -- B');
  });

  it('soft-fails on newlines, wrong kinds and unknown keys', () => {
    expect(editMessageLabel(SEQ, SEQ_CFG, 'm:0', 'a\nb').warning).toBeTruthy();
    expect(editMessageLabel(SEQ, SEQ_CFG, 'p:0', 'X').warning).toBeTruthy();
    expect(editMessageLabel(SEQ, SEQ_CFG, 'm:99', 'X').warning).toBeTruthy();
  });
});

describe('setArrowType', () => {
  it('replaces every sequence operator, preserving the label', () => {
    const ops = ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)'];
    for (const op of ops) {
      const res = setArrowType(SEQ, SEQ_CFG, 'm:0', op);
      expect(res.warning).toBeUndefined();
      expectOnlyLineChanged(SEQ, res.code, 7, `    A${op}B: Hello`);
    }
  });

  it('supports the bare sequence line operators', () => {
    for (const op of ['-', '--']) {
      const res = setArrowType(SEQ, SEQ_CFG, 'm:0', op);
      expectOnlyLineChanged(SEQ, res.code, 7, `    A${op}B: Hello`);
    }
  });

  it('replaces the operator on a labeled flowchart edge, preserving the label', () => {
    const res = setArrowType(FLOW, FLOW_CFG, 'e:1', '==>');
    expectOnlyLineChanged(FLOW, res.code, 3, '    B ==>|Reply| A');
  });

  it('replaces the operator on a plain flowchart edge', () => {
    const res = setArrowType(FLOW, FLOW_CFG, 'e:0', '==>');
    expectOnlyLineChanged(FLOW, res.code, 2, '    A[Alice] ==> B[Bob]');
  });

  it('normalizes the open-text form to a pipe edge', () => {
    const res = setArrowType(FLOW, FLOW_CFG, 'e:2', '-->');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(FLOW, res.code, 4, '    A --> |ping| B');
  });

  it('supports the bidirectional flowchart operators', () => {
    const res = setArrowType(FLOW, FLOW_CFG, 'e:0', '<-->');
    expectOnlyLineChanged(FLOW, res.code, 2, '    A[Alice] <--> B[Bob]');
  });

  it('soft-fails on unknown operators and cross-diagram operators', () => {
    expect(setArrowType(SEQ, SEQ_CFG, 'm:0', '==>').warning).toBeTruthy();
    expect(setArrowType(SEQ, SEQ_CFG, 'm:0', '==>').code).toBe(SEQ);
    expect(setArrowType(FLOW, FLOW_CFG, 'e:0', '->>').warning).toBeTruthy();
    expect(setArrowType(SEQ, SEQ_CFG, 'p:0', '-->').warning).toBeTruthy();
  });
});

describe('addParticipant', () => {
  it('appends after the last participant in a sequence diagram', () => {
    const res = addParticipant(SEQ, SEQ_CFG);
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[5]).toBe('    participant New1 as New Participant');
    expect(lines.length).toBe(SEQ.split('\n').length + 1);
    // everything else is byte-identical
    SEQ.split('\n').forEach((line, i) => {
      expect(lines[i < 5 ? i : i + 1]).toBe(line);
    });
    const model = parseModel(res.code);
    expect(model.elements.filter(e => e.kind === 'participant').map(e => (e as { id: string }).id)).toEqual(['A', 'B', 'New1']);
  });

  it('inserts after the given element key', () => {
    const res = addParticipant(SEQ, SEQ_CFG, 'p:0');
    const lines = res.code.split('\n');
    expect(lines[4]).toBe('    participant New1 as New Participant');
    expect(lines[5]).toBe('    participant B as Bob');
  });

  it('inserts after the sequenceDiagram line when there are no participants', () => {
    const code = `sequenceDiagram\n    A->>B: Hello`;
    const res = addParticipant(code, null);
    expect(res.code).toBe(`sequenceDiagram\n    participant New1 as New Participant\n    A->>B: Hello`);
  });

  it('deduplicates the generated id against participants and message endpoints', () => {
    const code = `sequenceDiagram\n    participant New1 as Taken\n    participant A\n    New2->>A: hi`;
    const res = addParticipant(code, null);
    expect(res.code).toContain('    participant New3 as New Participant 3');
    const res2 = addParticipant(res.code, null);
    expect(res2.code).toContain('    participant New4 as New Participant 4');
  });

  it('appends a node line at the end of a flowchart', () => {
    const res = addParticipant(FLOW, FLOW_CFG);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(FLOW + '\n    New1[New Participant]');
    const model = parseModel(res.code);
    const nodes = model.elements.filter(e => e.kind === 'node');
    expect(nodes[nodes.length - 1]).toMatchObject({ id: 'New1', label: 'New Participant', shape: 'rect' });
  });

  it('keeps a trailing newline when appending to a flowchart', () => {
    const res = addParticipant(FLOW + '\n', FLOW_CFG);
    expect(res.code.endsWith('    New1[New Participant]\n')).toBe(true);
  });

  it('soft-fails on an unknown afterKey', () => {
    const res = addParticipant(SEQ, SEQ_CFG, 'p:99');
    expect(res.warning).toBeTruthy();
    expect(res.code).toBe(SEQ);
  });
});

describe('addMessage', () => {
  it('appends a sequence message at the end of the file', () => {
    const res = addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(SEQ + '\n    A->>B: New message');
    const model = parseModel(res.code);
    expect(model.elements[model.elements.length - 1]).toMatchObject({ kind: 'message', from: 'A', to: 'B', label: 'New message' });
  });

  it('inserts after the given message', () => {
    const res = addMessage(SEQ, SEQ_CFG, 'p:1', 'p:0', { type: 'after', key: 'm:0' });
    const lines = res.code.split('\n');
    expect(lines[8]).toBe('    B->>A: New message');
    expect(lines[7]).toBe('    A->>B: Hello');
  });

  it('appends a flowchart edge at the end of the file', () => {
    const res = addMessage(FLOW, FLOW_CFG, 'n:0', 'n:1');
    expect(res.code).toBe(FLOW + '\n    A --> B');
    const model = parseModel(res.code);
    expect(model.elements[model.elements.length - 1]).toMatchObject({ kind: 'edge', from: 'A', to: 'B', operator: '-->' });
  });

  it('keeps a trailing newline when appending', () => {
    const res = addMessage(SEQ + '\n', SEQ_CFG, 'p:0', 'p:1');
    expect(res.code.endsWith('    A->>B: New message\n')).toBe(true);
  });

  it('soft-fails on non-component endpoints and unknown position key', () => {
    expect(addMessage(SEQ, SEQ_CFG, 'm:0', 'p:1').warning).toBeTruthy();
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:99').warning).toBeTruthy();
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'after', key: 'm:99' }).warning).toBeTruthy();
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'after', key: 'm:99' }).code).toBe(SEQ);
  });

  it('inserts at the top (after the last participant declaration)', () => {
    const res = addMessage(SEQ, SEQ_CFG, 'p:1', 'p:0', { type: 'top' });
    const lines = res.code.split('\n');
    // SEQ: line 0=CONFIG, 1=sequenceDiagram, 2=comment, 3=participant A, 4=participant B, 5=blank
    // Top insertion goes right after the last participant (line 4), so at line 5.
    expect(lines[5]).toBe('    B->>A: New message');
    expect(lines[6]).toBe(''); // the original blank line shifts down
    expect(lines[7]).toBe('    %% @region-start: flow=login');
  });

  it('inserts before the given element', () => {
    const res = addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'before', key: 'm:1' });
    const lines = res.code.split('\n');
    // m:1 is "B-->>A: Hi" at line 8; the new message goes at line 8, pushing Hi to line 9.
    expect(lines[8]).toBe('    A->>B: New message');
    expect(lines[9]).toBe('    B-->>A: Hi');
  });

  it('inserts at the top of a diagram with no messages yet', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob`;
    const res = addMessage(code, null, 'p:0', 'p:1', { type: 'top' });
    expect(res.code).toBe(`sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: New message`);
  });

  it('preserves CONFIG, comments, regions and blank lines on positional insert', () => {
    for (const pos of [
      { type: 'top' },
      { type: 'before', key: 'm:0' },
      { type: 'after', key: 'm:1' },
      { type: 'bottom' },
    ] as MessageInsertPosition[]) {
      const res = addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', pos);
      expect(res.warning).toBeUndefined();
      // CONFIG line 0 and comment line 2 are byte-identical
      expect(res.code.split('\n')[0]).toBe(SEQ.split('\n')[0]);
      expect(res.code.split('\n')[2]).toBe(SEQ.split('\n')[2]);
      // region tags survive
      expect(res.code).toContain('%% @region-start: flow=login');
      expect(res.code).toContain('%% @region-end');
    }
  });

  it('reports the created element key (newKey) for every insert position', () => {
    // SEQ has 3 messages (m:0..m:2); FLOW has 3 edges (e:0..e:2).
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1').newKey).toBe('m:3'); // bottom
    expect(addMessage(SEQ + '\n', SEQ_CFG, 'p:0', 'p:1').newKey).toBe('m:3'); // bottom, trailing newline
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'top' }).newKey).toBe('m:0');
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'before', key: 'm:1' }).newKey).toBe('m:1');
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'after', key: 'm:1' }).newKey).toBe('m:2');
    expect(addMessage(FLOW, FLOW_CFG, 'n:0', 'n:1').newKey).toBe('e:3');
    // The reported key resolves to the created element in the resulting code.
    const res = addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1', { type: 'after', key: 'm:0' });
    const el = parseModel(res.code).elements.find(e => e.key === res.newKey);
    expect(el).toMatchObject({ kind: 'message', from: 'A', to: 'B', label: 'New message' });
    // Failed transforms report no newKey.
    expect(addMessage(SEQ, SEQ_CFG, 'p:0', 'p:99').newKey).toBeUndefined();
  });
});

describe('moveParticipant', () => {
  const SEQ3 = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    A->>B: Hello
    B->>C: Hi
    C-->>A: Done`;

  it('moves a participant before another participant', () => {
    // Move C before A: [C, A, B]
    const res = moveParticipant(SEQ3, null, 'p:2', 'p:0');
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[1]).toBe('    participant C as Carol');
    expect(lines[2]).toBe('    participant A as Alice');
    expect(lines[3]).toBe('    participant B as Bob');
    // Messages are untouched
    expect(lines[4]).toBe('    A->>B: Hello');
    expect(lines[5]).toBe('    B->>C: Hi');
    expect(lines[6]).toBe('    C-->>A: Done');
  });

  it('moves a participant to the end (beforeKey undefined)', () => {
    // Move A to end: [B, C, A]
    const res = moveParticipant(SEQ3, null, 'p:0');
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[1]).toBe('    participant B as Bob');
    expect(lines[2]).toBe('    participant C as Carol');
    expect(lines[3]).toBe('    participant A as Alice');
    // Messages are untouched
    expect(lines[4]).toBe('    A->>B: Hello');
  });

  it('reports the moved participant key (newKey) after a reorder', () => {
    // Keys are positional: moving A (p:0) to the end makes it p:2.
    expect(moveParticipant(SEQ3, null, 'p:0').newKey).toBe('p:2');
    // Moving C (p:2) to the front makes it p:0.
    expect(moveParticipant(SEQ3, null, 'p:2', 'p:0').newKey).toBe('p:0');
    // The reported key resolves to the moved participant in the resulting code.
    const res = moveParticipant(SEQ3, null, 'p:1', 'p:0');
    const el = parseModel(res.code).elements.find(e => e.key === res.newKey);
    expect(el).toMatchObject({ kind: 'participant', id: 'B' });
  });

  it('moves a participant before the next one (swap adjacent)', () => {
    // Move A before B is a no-op (A is already before B)
    const res = moveParticipant(SEQ3, null, 'p:0', 'p:1');
    expect(res.code).toBe(SEQ3);
  });

  it('moves a participant before the previous one (swap adjacent backwards)', () => {
    // Move B before A: [B, A, C]
    const res = moveParticipant(SEQ3, null, 'p:1', 'p:0');
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[1]).toBe('    participant B as Bob');
    expect(lines[2]).toBe('    participant A as Alice');
    expect(lines[3]).toBe('    participant C as Carol');
  });

  it('preserves CONFIG, comments, regions and messages byte-for-byte', () => {
    const res = moveParticipant(SEQ, SEQ_CFG, 'p:1', 'p:0');
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    // SEQ: line 0=CONFIG, 1=sequenceDiagram, 2=comment, 3=participant A, 4=participant B, 5=blank
    // After moving B before A: 0=CONFIG, 1=sequenceDiagram, 2=comment, 3=participant B, 4=participant A, 5=blank
    expect(lines[0]).toBe(SEQ.split('\n')[0]);
    expect(lines[1]).toBe('sequenceDiagram');
    expect(lines[2]).toBe('    %% a comment');
    // participants swapped
    expect(lines[3]).toBe('    participant B as Bob');
    expect(lines[4]).toBe('    participant A as Alice');
    // All message/region lines preserved
    expect(res.code).toContain('A->>B: Hello');
    expect(res.code).toContain('B-->>A: Hi');
    expect(res.code).toContain('A->>B: Again');
    expect(res.code).toContain('%% @region-start: flow=login');
    expect(res.code).toContain('%% @region-end');
  });

  it('is a no-op when moving before itself', () => {
    const res = moveParticipant(SEQ3, null, 'p:1', 'p:1');
    expect(res.code).toBe(SEQ3);
    expect(res.warning).toBeUndefined();
  });

  it('is a no-op with a single participant', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    A->>A: Self`;
    const res = moveParticipant(code, null, 'p:0');
    expect(res.code).toBe(code);
  });

  it('soft-fails on non-participant keys, unknown keys, and flowchart diagrams', () => {
    expect(moveParticipant(SEQ3, null, 'm:0', 'p:0').warning).toBeTruthy();
    expect(moveParticipant(SEQ3, null, 'p:0', 'm:0').warning).toBeTruthy();
    expect(moveParticipant(SEQ3, null, 'p:99').warning).toBeTruthy();
    expect(moveParticipant(FLOW, FLOW_CFG, 'n:0').warning).toBeTruthy();
    expect(moveParticipant(SEQ3, null, 'p:0', 'p:99').code).toBe(SEQ3);
  });

  it('reorders participants on a diagram with interleaved messages', () => {
    const code = `sequenceDiagram
    participant A as Alice
    A->>B: hello
    participant C as Carol
    C->>A: hi`;
    // Move C before A: participant C's declaration moves up, messages stay
    const res = moveParticipant(code, null, 'p:1', 'p:0');
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[1]).toBe('    participant C as Carol');
    expect(lines[2]).toBe('    participant A as Alice');
    expect(lines[3]).toBe('    A->>B: hello');
    expect(lines[4]).toBe('    C->>A: hi');
  });
});

describe('deleteElement', () => {
  const SEQ_DEL = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    A->>B: AB
    B->>A: BA
    A->>C: AC
    Note over B: about B
    Note over A,B: span`;

  it('deletes a message line only', () => {
    const res = deleteElement(SEQ, SEQ_CFG, 'm:1');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual([]);
    const expected = SEQ.split('\n').filter((_, i) => i !== 8).join('\n');
    expect(res.code).toBe(expected);
  });

  it('cascades a participant delete to its messages and notes, but not unrelated lines', () => {
    const res = deleteElement(SEQ_DEL, null, 'p:1');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual(['m:0', 'm:1', 'note:0', 'note:1']);
    expect(res.code).toBe(`sequenceDiagram
    participant A as Alice
    participant C as Carol
    A->>C: AC`);
  });

  it('deletes a note line only', () => {
    const res = deleteElement(SEQ_DEL, null, 'note:0');
    expect(res.cascaded).toEqual([]);
    expect(res.code).toBe(SEQ_DEL.split('\n').filter((_, i) => i !== 7).join('\n'));
  });

  it('cleans up CONFIG actors and arrow styles of the removed elements', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"A":{"color":"red"},"B":{"keys":["backend"]}},"arrows":[{"from":"A","to":"B","label":"AB","color":"red"},{"from":"A","to":"C","label":"AC","width":2}]}
sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: AB
    A->>C: AC`;
    const res = deleteElement(code, parseConfig(code), 'p:1');
    const cfg = res.config;
    expect(cfg?.actors).toEqual({ A: { color: 'red' } });
    expect(cfg?.arrows).toEqual([{ from: 'A', to: 'C', label: 'AC', width: 2 }]);
    // round-trips through the persisted header
    expect(parseConfig(res.code)).toEqual(cfg);
  });

  it('preserves a malformed CONFIG header (no data loss)', () => {
    const code = `%% CONFIG: {not json}
sequenceDiagram
    participant A
    participant B
    A->>B: Hello`;
    const res = deleteElement(code, null, 'm:0');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[0]).toBe('%% CONFIG: {not json}');
  });

  it('soft-fails on blocks, unknown keys and unsupported diagrams', () => {
    const withBlock = `sequenceDiagram\n    participant A\n    alt X\n    A->>A: self\n    end`;
    expect(deleteElement(withBlock, null, 'b:0').warning).toBeTruthy();
    expect(deleteElement(withBlock, null, 'b:0').code).toBe(withBlock);
    expect(deleteElement(SEQ, SEQ_CFG, 'p:99').warning).toBeTruthy();
    expect(deleteElement('classDiagram\n    A --> B', null, 'n:0').warning).toBeTruthy();
  });

  it('cascades a flowchart node delete without eating lines shared with its edges', () => {
    const flow = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A
    New1[New Participant]
    A --> B`;
    const res = deleteElement(flow, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual(['e:0', 'e:1', 'e:2']);
    expect(res.code).toBe(`flowchart TD
    B[Bob]
    New1[New Participant]`);
  });

  it('keeps the surviving endpoint when the defining line uses the open-text edge form', () => {
    const flow = `flowchart TD
    A[Alice] -- hello --> B[Bob]
    A --> B`;
    const res = deleteElement(flow, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual(['e:0', 'e:1']);
    expect(res.code).toBe(`flowchart TD
    B[Bob]`);
  });

  it('removes a shared edge line outright when the other endpoint is declared earlier', () => {
    const flow = `flowchart TD
    B[Bob]
    A[Alice] --> B
    A --> B`;
    const res = deleteElement(flow, null, 'n:1');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual(['e:0', 'e:1']);
    expect(res.code).toBe(`flowchart TD
    B[Bob]`);
  });

  it('keeps endpoint declarations when deleting the edge line that first declares them', () => {
    const flow = `flowchart TD
    A[Alice] --> B[Bob]
    B --> C`;
    const res = deleteElement(flow, null, 'e:0');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual([]);
    expect(res.code).toBe(`flowchart TD
    A[Alice]
    B[Bob]
    B --> C`);
  });

  it('removes an edge line outright when its endpoints are declared earlier', () => {
    const flow = `flowchart TD
    A[Alice]
    B[Bob]
    A --> B`;
    const res = deleteElement(flow, null, 'e:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD
    A[Alice]
    B[Bob]`);
  });

  it('removes a self-loop line once when deleting its node', () => {
    const flow = `flowchart TD
    A[Alice] --> A
    B[Bob]`;
    const res = deleteElement(flow, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.cascaded).toEqual(['e:0']);
    expect(res.code).toBe(`flowchart TD
    B[Bob]`);
  });
});

describe('setActorColor / addTag / removeTag', () => {
  it('sets a component color in CONFIG and keeps the body byte-identical', () => {
    const res = setActorColor(SEQ, SEQ_CFG, 'p:1', 'blue');
    expect(res.warning).toBeUndefined();
    expectBodyIdentical(SEQ, res.code);
    expect(res.config?.actors).toEqual({ A: { color: 'red' }, B: { color: 'blue' } });
    expect(parseConfig(res.code)).toEqual(res.config);
  });

  it('creates the CONFIG header on the first color edit', () => {
    const code = createSequenceDiagram();
    const res = setActorColor(code, null, 'p:0', 'green');
    expect(res.code.startsWith('%% CONFIG: {"version":1,"actors":{"A":{"color":"green"}}}')).toBe(true);
    expect(res.code.endsWith(code)).toBe(true);
    expect(parseConfig(res.code)?.actors?.A.color).toBe('green');
  });

  it('clears a color and prunes the actor entry, then the empty header', () => {
    const res = setActorColor(SEQ, SEQ_CFG, 'p:0', '');
    expect(res.config?.actors).toBeUndefined();
    expect(res.config && 'actors' in res.config).toBe(false);
    expect(res.code).toBe(SEQ.split('\n').slice(1).join('\n'));
    expect(parseConfig(res.code)).toBeNull();
  });

  it('preserves existing tags when setting a color', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"A":{"keys":["backend"]}}}
sequenceDiagram
    participant A`;
    const res = setActorColor(code, parseConfig(code), 'p:0', 'red');
    expect(res.config?.actors?.A).toEqual({ keys: ['backend'], color: 'red' });
  });

  it('adds and removes tags in CONFIG', () => {
    const added = addTag(SEQ, SEQ_CFG, 'p:1', 'backend');
    expect(added.config?.actors?.B).toEqual({ keys: ['backend'] });
    expect(parseConfig(added.code)?.actors?.B.keys).toEqual(['backend']);
    // idempotent
    const addedAgain = addTag(added.code, added.config, 'p:1', 'backend');
    expect(addedAgain.config?.actors?.B.keys).toEqual(['backend']);
    // add a second tag, then remove the first
    const two = addTag(added.code, added.config, 'p:1', 'database');
    expect(two.config?.actors?.B.keys).toEqual(['backend', 'database']);
    const removed = removeTag(two.code, two.config, 'p:1', 'backend');
    expect(removed.config?.actors?.B.keys).toEqual(['database']);
    const removedAll = removeTag(removed.code, removed.config, 'p:1', 'database');
    expect(removedAll.config?.actors?.B).toBeUndefined();
  });

  it('creates the header on the first tag edit and drops it when empty', () => {
    const code = createSequenceDiagram();
    const added = addTag(code, null, 'p:0', 'backend');
    expect(parseConfig(added.code)?.actors?.A.keys).toEqual(['backend']);
    const removed = removeTag(added.code, added.config, 'p:0', 'backend');
    expect(removed.code).toBe(code);
    expect(parseConfig(removed.code)).toBeNull();
  });

  it('survives an updateViewsData round trip', () => {
    const res = addTag(SEQ, SEQ_CFG, 'p:1', 'backend');
    const rewritten = updateViewsData(res.code, res.config);
    expect(rewritten).toBe(res.code);
    expect(parseConfig(rewritten)).toEqual(res.config);
  });

  it('soft-fails on invalid tags and wrong kinds', () => {
    expect(addTag(SEQ, SEQ_CFG, 'p:0', 'has space').warning).toBeTruthy();
    expect(addTag(SEQ, SEQ_CFG, 'p:0', 'has,comma').warning).toBeTruthy();
    expect(addTag(SEQ, SEQ_CFG, 'p:0', '').warning).toBeTruthy();
    expect(addTag(SEQ, SEQ_CFG, 'm:0', 'ok').warning).toBeTruthy();
    expect(removeTag(SEQ, SEQ_CFG, 'p:0', 'nope').code).toBe(SEQ);
  });

  it('does not mutate the input config', () => {
    const config: DiagramConfig = { version: 1, actors: { A: { color: 'red' } } };
    const snapshot = JSON.stringify(config);
    setActorColor(SEQ, config, 'p:1', 'blue');
    addTag(SEQ, config, 'p:1', 'backend');
    setArrowStyle(SEQ, config, 'm:0', { color: 'red' });
    deleteElement(SEQ, config, 'm:0');
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe('setArrowStyle', () => {
  it('upserts an arrow style into CONFIG.arrows keyed by raw endpoints', () => {
    const res = setArrowStyle(SEQ, SEQ_CFG, 'm:0', { color: '#e11d48', width: 3, dash: 'dashed' });
    expect(res.warning).toBeUndefined();
    expectBodyIdentical(SEQ, res.code);
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' },
    ]);
    expect(parseConfig(res.code)?.arrows).toEqual(res.config?.arrows);
  });

  it('replaces the existing style on overwrite', () => {
    const first = setArrowStyle(SEQ, SEQ_CFG, 'm:0', { color: 'red', width: 2 });
    const second = setArrowStyle(first.code, first.config, 'm:0', { color: '', width: 5, dash: 'solid' });
    expect(second.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', width: 5 }]);
  });

  it('disambiguates duplicate arrows by occurrence', () => {
    const code = `sequenceDiagram
    participant A
    participant B
    A->>B: Same
    A->>B: Same`;
    const res = setArrowStyle(code, null, 'm:1', { color: 'red' });
    expect(res.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Same', occurrence: 1, color: 'red' }]);
    const first = setArrowStyle(code, null, 'm:0', { color: 'blue' });
    expect(first.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Same', color: 'blue' }]);
  });

  it('matches unlabeled arrows without a label field', () => {
    const code = `sequenceDiagram
    participant A
    participant B
    A->>B: Hello
    A--B`;
    const res = setArrowStyle(code, null, 'm:1', { width: 2 });
    expect(res.config?.arrows).toEqual([{ from: 'A', to: 'B', width: 2 }]);
  });

  it('removes the entry when the style is cleared', () => {
    const styled = setArrowStyle(SEQ, SEQ_CFG, 'm:0', { color: 'red', width: 2, dash: 'dotted' });
    const cleared = setArrowStyle(styled.code, styled.config, 'm:0', { color: '', width: undefined, dash: 'solid' });
    expect(cleared.config?.arrows).toBeUndefined();
    // header kept: actors still carry state
    expect(parseConfig(cleared.code)?.actors).toEqual({ A: { color: 'red' } });
  });

  it('creates the header on the first style edit; body untouched', () => {
    const code = createSequenceDiagram();
    const res = setArrowStyle(code, null, 'm:0', { color: 'red' });
    expect(res.code.endsWith(code)).toBe(true);
    expect(parseConfig(res.code)?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', color: 'red' }]);
  });

  it('styles flowchart edges by their raw endpoints', () => {
    const res = setArrowStyle(FLOW, FLOW_CFG, 'e:1', { color: 'blue', dash: 'dotted' });
    expect(res.config?.arrows).toEqual([{ from: 'B', to: 'A', label: 'Reply', color: 'blue', dash: 'dotted' }]);
  });

  it('soft-fails on invalid widths and wrong kinds', () => {
    for (const width of [0, 11, 1.5, -1]) {
      const res = setArrowStyle(SEQ, SEQ_CFG, 'm:0', { width });
      expect(res.warning).toBeTruthy();
      expect(res.code).toBe(SEQ);
    }
    expect(setArrowStyle(SEQ, SEQ_CFG, 'p:0', { color: 'red' }).warning).toBeTruthy();
    expect(setArrowStyle(SEQ, SEQ_CFG, 'm:99', { color: 'red' }).warning).toBeTruthy();
  });
});

describe('preservation (NFR-02)', () => {
  it('keeps the CONFIG line, comments, region tags and blank lines byte-identical across text transforms', () => {
    const transforms: Array<() => string> = [
      () => renameParticipant(SEQ, SEQ_CFG, 'p:1', 'Bobby').code,
      () => editMessageLabel(SEQ, SEQ_CFG, 'm:0', 'Hey').code,
      () => setArrowType(SEQ, SEQ_CFG, 'm:1', '-x').code,
      () => addMessage(SEQ, SEQ_CFG, 'p:0', 'p:1').code,
      () => deleteElement(SEQ, SEQ_CFG, 'm:2').code,
    ];
    for (const t of transforms) {
      const out = t();
      const beforeLines = SEQ.split('\n');
      const afterLines = out.split('\n');
      // line 0 (CONFIG), line 2 (comment), lines 6 and 9 (region tags) unchanged
      for (const i of [0, 2, 6, 9]) {
        expect(afterLines[i]).toBe(beforeLines[i]);
      }
    }
  });

  it('preserves indentation of the edited line', () => {
    const code = `sequenceDiagram\n        participant A as Alice\n        A->>A: deep`;
    const res = editMessageLabel(code, null, 'm:0', 'X');
    expect(res.code).toBe(`sequenceDiagram\n        participant A as Alice\n        A->>A: X`);
  });
});

describe('soft-fail (NFR-01)', () => {
  it('is a no-op with a warning on unsupported diagram types', () => {
    const code = `classDiagram\n    A --> B`;
    for (const res of [
      renameParticipant(code, null, 'n:0', 'X'),
      editMessageLabel(code, null, 'e:0', 'X'),
      setArrowType(code, null, 'e:0', '-->'),
      addParticipant(code, null),
      addMessage(code, null, 'n:0', 'n:1'),
      deleteElement(code, null, 'e:0'),
      setActorColor(code, null, 'n:0', 'red'),
      addTag(code, null, 'n:0', 'k'),
      removeTag(code, null, 'n:0', 'k'),
      setArrowStyle(code, null, 'e:0', { color: 'red' }),
    ]) {
      expect(res.warning).toBeTruthy();
      expect(res.code).toBe(code);
    }
  });

  it('is a no-op with a warning on empty input', () => {
    expect(renameParticipant('', null, 'p:0', 'X').warning).toBeTruthy();
    expect(deleteElement('', null, 'p:0').warning).toBeTruthy();
  });
});

describe('create -> change -> verify (harness)', () => {
  it('renames a participant on a newly created sequence diagram', () => {
    const code = createSequenceDiagram();
    const res = renameParticipant(code, null, 'p:0', 'Alicia');
    expect(res.warning).toBeUndefined();
    const model = parseModel(res.code);
    expect(model.elements.find(e => e.key === 'p:0')).toMatchObject({ kind: 'participant', id: 'A', alias: 'Alicia' });
    // every other line byte-identical
    const before = code.split('\n');
    res.code.split('\n').forEach((line, i) => {
      if (i !== 1) expect(line).toBe(before[i]);
    });
  });

  it('renames a node on a newly created flowchart diagram', () => {
    const code = createFlowchartDiagram();
    const res = renameParticipant(code, null, 'n:1', 'Bobby');
    expect(res.warning).toBeUndefined();
    const model = parseModel(res.code);
    expect(model.elements.find(e => e.key === 'n:1')).toMatchObject({ kind: 'node', id: 'B', label: 'Bobby' });
    expect(res.code.split('\n')[1]).toBe('    A[Alice] --> B[Bobby]');
  });

  it('edits a message label on a newly created sequence diagram', () => {
    const code = createSequenceDiagram();
    const res = editMessageLabel(code, null, 'm:0', 'Hello!');
    expect(res.code.split('\n')[3]).toBe('    A->>B: Hello!');
    expect(parseModel(res.code).elements.find(e => e.key === 'm:0')).toMatchObject({ label: 'Hello!' });
  });

  it('edits an edge label on a newly created flowchart diagram', () => {
    const code = createFlowchartDiagram();
    const res = editMessageLabel(code, null, 'e:1', 'Yo');
    expect(res.code.split('\n')[2]).toBe('    B -->|Yo| A');
    expect(parseModel(res.code).elements.find(e => e.key === 'e:1')).toMatchObject({ label: 'Yo' });
  });

  it('changes arrow types on newly created diagrams', () => {
    const seq = setArrowType(createSequenceDiagram(), null, 'm:0', '-->>');
    expect(parseModel(seq.code).elements.find(e => e.key === 'm:0')).toMatchObject({ operator: '-->>', label: 'Hello' });
    const flow = setArrowType(createFlowchartDiagram(), null, 'e:0', '==>');
    expect(parseModel(flow.code).elements.find(e => e.key === 'e:0')).toMatchObject({ operator: '==>' });
  });

  it('adds participants and messages on newly created diagrams', () => {
    const seq = addParticipant(createSequenceDiagram(), null);
    let model = parseModel(seq.code);
    expect(keysOf(seq.code, 'participant')).toEqual(['p:0', 'p:1', 'p:2']);
    const withMsg = addMessage(seq.code, seq.config, 'p:2', 'p:0');
    model = parseModel(withMsg.code);
    expect(model.elements[model.elements.length - 1]).toMatchObject({ kind: 'message', from: 'New1', to: 'A', label: 'New message' });

    const flow = addParticipant(createFlowchartDiagram(), null);
    expect(keysOf(flow.code, 'node')).toEqual(['n:0', 'n:1', 'n:2']);
    const flowMsg = addMessage(flow.code, flow.config, 'n:2', 'n:0');
    expect(parseModel(flowMsg.code).elements[parseModel(flowMsg.code).elements.length - 1]).toMatchObject({ kind: 'edge', from: 'New1', to: 'A' });
  });

  it('deletes with cascade on a newly created sequence diagram', () => {
    const code = createSequenceDiagram();
    const res = deleteElement(code, null, 'p:1');
    expect(res.cascaded).toEqual(['m:0', 'm:1']);
    const model = parseModel(res.code);
    expect(model.elements.map(e => e.key)).toEqual(['p:0']);
  });

  it('reorders participants on a newly created sequence diagram', () => {
    // createSequenceDiagram: participants A, B; messages A->>B: Hello, B-->>A: Hi there
    const code = createSequenceDiagram();
    // Add a third participant, then move it before A
    const withC = addParticipant(code, null);
    const moved = moveParticipant(withC.code, withC.config, 'p:2', 'p:0');
    expect(moved.warning).toBeUndefined();
    const model = parseModel(moved.code);
    const participantIds = model.elements.filter(e => e.kind === 'participant').map(e => (e as { id: string }).id);
    expect(participantIds).toEqual(['New1', 'A', 'B']);
    // Messages are untouched
    const messages = model.elements.filter(e => e.kind === 'message');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ from: 'A', to: 'B', label: 'Hello' });
    // The rendered diagram still parses and the new order is reflected
    const { code: processed } = processMermaid(moved.code, { isRegionVisible: () => true });
    const processedModel = parseModel(processed);
    const processedIds = processedModel.elements.filter(e => e.kind === 'participant').map(e => (e as { id: string }).id);
    expect(processedIds).toEqual(['New1', 'A', 'B']);
  });

  it('inserts messages at top, between, and bottom on a newly created sequence diagram', () => {
    const code = createSequenceDiagram();
    // Insert at top: before the first message (Hello)
    const atTop = addMessage(code, null, 'p:1', 'p:0', { type: 'top' });
    const topLines = atTop.code.split('\n');
    // createSequenceDiagram: line 0=sequenceDiagram, 1=participant A, 2=participant B, 3=A->>B: Hello, 4=B-->>A: Hi there
    // Top insert goes after participant B (line 2), so at line 3
    expect(topLines[3]).toBe('    B->>A: New message');
    expect(topLines[4]).toBe('    A->>B: Hello');
    const topModel = parseModel(atTop.code);
    expect(topModel.elements.filter(e => e.kind === 'message').map(e => e.key)).toEqual(['m:0', 'm:1', 'm:2']);
    expect(topModel.elements.find(e => e.key === 'm:0')).toMatchObject({ from: 'B', to: 'A', label: 'New message' });

    // Insert between the two existing messages (after m:0 = Hello)
    const between = addMessage(code, null, 'p:0', 'p:1', { type: 'after', key: 'm:0' });
    const betweenLines = between.code.split('\n');
    expect(betweenLines[4]).toBe('    A->>B: New message');
    expect(betweenLines[3]).toBe('    A->>B: Hello');
    expect(betweenLines[5]).toBe('    B-->>A: Hi there');

    // Insert before the last message
    const before = addMessage(code, null, 'p:0', 'p:1', { type: 'before', key: 'm:1' });
    const beforeLines = before.code.split('\n');
    expect(beforeLines[4]).toBe('    A->>B: New message');
    expect(beforeLines[5]).toBe('    B-->>A: Hi there');

    // Insert at bottom (default)
    const atBottom = addMessage(code, null, 'p:0', 'p:1');
    expect(atBottom.code.endsWith('    A->>B: New message')).toBe(true);
  });

  it('sets colors, tags and arrow styles on newly created diagrams and verifies via CONFIG + model', () => {
    const seq = createSequenceDiagram();
    const colored = setActorColor(seq, null, 'p:0', 'red');
    expect(parseConfig(colored.code)?.actors?.A.color).toBe('red');
    const tagged = addTag(colored.code, colored.config, 'p:0', 'backend');
    expect(parseConfig(tagged.code)?.actors?.A.keys).toEqual(['backend']);
    const styled = setArrowStyle(tagged.code, tagged.config, 'm:0', { color: '#e11d48', width: 3, dash: 'dashed' });
    expect(parseConfig(styled.code)?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' }]);
    // the raw text body is untouched by all three config transforms
    expect(styled.code.endsWith(seq)).toBe(true);
    // the model still reflects the raw diagram
    expect(parseModel(styled.code).elements.filter(e => e.kind === 'message')).toHaveLength(2);

    const flow = createFlowchartDiagram();
    const flowColored = setActorColor(flow, null, 'n:0', 'blue');
    expect(parseConfig(flowColored.code)?.actors?.A.color).toBe('blue');
    const flowStyled = setArrowStyle(flowColored.code, flowColored.config, 'e:0', { width: 2, dash: 'dotted' });
    expect(parseConfig(flowStyled.code)?.arrows).toEqual([{ from: 'A', to: 'B', width: 2, dash: 'dotted' }]);
  });
});

describe('getArrowStyle', () => {
  it('returns null for unstyled arrows, components and unknown keys', () => {
    const seq = createSequenceDiagram();
    expect(getArrowStyle(seq, null, 'm:0')).toBeNull();
    expect(getArrowStyle(seq, null, 'p:0')).toBeNull();
    expect(getArrowStyle(seq, null, 'nope')).toBeNull();
  });

  it('reads back the stored style, normalizing a missing dash to solid', () => {
    const seq = createSequenceDiagram();
    const styled = setArrowStyle(seq, null, 'm:0', { color: '#e11d48', width: 3, dash: 'dashed' });
    expect(getArrowStyle(styled.code, styled.config, 'm:0')).toEqual({ color: '#e11d48', width: 3, dash: 'dashed' });
  });

  it('disambiguates same-(from,to,label) arrows by occurrence', () => {
    const seq = createSequenceDiagram();
    // two identical A->>B: New message arrows after m:0
    const twice = addMessage(seq, null, 'p:0', 'p:1', { type: 'after', key: 'm:0' });
    const thrice = addMessage(twice.code, twice.config, 'p:0', 'p:1', { type: 'after', key: 'm:0' });
    expect(getArrowStyle(thrice.code, thrice.config, 'm:1')).toBeNull();
    // style the SECOND of the identical arrows (occurrence 1)
    const styled = setArrowStyle(thrice.code, thrice.config, 'm:2', { color: 'blue' });
    expect(getArrowStyle(styled.code, styled.config, 'm:1')).toBeNull();
    expect(getArrowStyle(styled.code, styled.config, 'm:2')).toEqual({ color: 'blue', dash: 'solid' });
  });
});

describe('soft-fail on a broken diagram (NFR-01, Step 13)', () => {
  // An unclosed region: the preprocessor soft-fails and renders the original
  // code; the editor must still edit recognized elements and refuse
  // broken-area edits with a warning, never corrupt the file.
  const BROKEN = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    %% @region-start: flow=checkout
    A->>B: Hello
    B-->>A: Hi there`;

  it('parseModel still recognizes the elements of a broken diagram', () => {
    const model = parseModel(BROKEN);
    expect(model.type).toBe('sequence');
    const keys = model.elements.map(e => e.key);
    expect(keys).toEqual(['p:0', 'p:1', 'r:0', 'm:0', 'm:1']);
    expect(model.elements.find(e => e.key === 'r:0')).toMatchObject({ kind: 'region', regionType: 'flow', value: 'checkout' });
  });

  it('the pipeline soft-fails and hands the original code to the renderer', () => {
    const { code, warnings } = processMermaid(transformActors(BROKEN, null, {}), { isRegionVisible: () => true });
    expect(code).toBe(BROKEN);
    expect(warnings).toEqual(['Unclosed region tag: flow=checkout']);
  });

  it('edits to recognized elements still apply', () => {
    const renamed = renameParticipant(BROKEN, null, 'p:1', 'Robert');
    expect(renamed.warning).toBeUndefined();
    expect(renamed.code).toContain('participant B as Robert');

    const labeled = editMessageLabel(BROKEN, null, 'm:0', 'Hey');
    expect(labeled.warning).toBeUndefined();
    expect(labeled.code).toContain('A->>B: Hey');

    const retyped = setArrowType(BROKEN, null, 'm:1', '->>');
    expect(retyped.warning).toBeUndefined();
    expect(retyped.code).toContain('B->>A: Hi there');
  });

  it('edits to the broken area are no-ops with a warning', () => {
    const del = deleteElement(BROKEN, null, 'r:0');
    expect(del.warning).toBe(`Cannot delete element of kind 'region'`);
    expect(del.code).toBe(BROKEN);

    const unknown = deleteElement(BROKEN, null, 'r:9');
    expect(unknown.warning).toBe('Unknown element key: r:9');
    expect(unknown.code).toBe(BROKEN);

    const wrongKind = editMessageLabel(BROKEN, null, 'p:0', 'x');
    expect(wrongKind.warning).toBe('Element p:0 is not a message or edge');
    expect(wrongKind.code).toBe(BROKEN);
  });

  it('invalid edits on recognized elements are no-ops with a warning', () => {
    const badTag = addTag(BROKEN, null, 'p:0', 'bad tag!');
    expect(badTag.warning).toBe('Invalid tag: bad tag!');
    expect(badTag.code).toBe(BROKEN);

    const badWidth = setArrowStyle(BROKEN, null, 'm:0', { width: 99 });
    expect(badWidth.warning).toBe('Arrow width must be an integer between 1 and 10');
    expect(badWidth.code).toBe(BROKEN);

    const multiline = renameParticipant(BROKEN, null, 'p:0', 'two\nlines');
    expect(multiline.warning).toBe('Label must be a single line');
    expect(multiline.code).toBe(BROKEN);
  });
});
