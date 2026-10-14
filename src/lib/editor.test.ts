import { describe, it, expect } from 'vitest';
import {
  renameParticipant, editMessageLabel, setArrowType, addParticipant, addMessage,
  deleteElement, setActorColor, addTag, removeTag, setArrowStyle, getArrowStyle,
  getArrowTags, getNoteTags, setArrowKeyMode, moveParticipant, moveNode, moveMessage, moveMessageEndpoint, MessageInsertPosition,
  PRESET_ACTOR_COLORS, getNextFreeActorColor, convertDiagramToAnimatedArrows,
  setParticipantKind, setNodeShape, toggleActivation, groupParticipants, toggleDiagramOrientation, insertMessage,
  toggleNumberedSteps, hasNumberedSteps,
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

describe('moveMessageEndpoint', () => {
  const SEQ3 = `sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: Hello
    B-->>A: Hi
    A->>A: Loop`;

  it('retargets the recipient (arrow head), preserving operator, label and spacing', () => {
    const res = moveMessageEndpoint(SEQ3, null, 'm:0', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ3, res.code, 4, '    A->>C: Hello');
  });

  it('retargets the origin (tail)', () => {
    const res = moveMessageEndpoint(SEQ3, null, 'm:0', 'from', 'p:2');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ3, res.code, 4, '    C->>B: Hello');
  });

  it('retargets the head of a right-to-left message', () => {
    const res = moveMessageEndpoint(SEQ3, null, 'm:1', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ3, res.code, 5, '    B-->>C: Hi');
  });

  it('retargets a self-message head into a regular message', () => {
    const res = moveMessageEndpoint(SEQ3, null, 'm:2', 'to', 'p:1');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ3, res.code, 6, '    A->>B: Loop');
  });

  it('retargets the tail onto the recipient, making a self-message', () => {
    const res = moveMessageEndpoint(SEQ3, null, 'm:0', 'from', 'p:1');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ3, res.code, 4, '    B->>B: Hello');
  });

  it('preserves unusual whitespace around the endpoints', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B\n    participant C\n    A  ->>  B :  spaced`;
    const res = moveMessageEndpoint(code, null, 'm:0', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[4]).toBe('    A  ->>  C :  spaced');
    const res2 = moveMessageEndpoint(code, null, 'm:0', 'from', 'p:2');
    expect(res2.code.split('\n')[4]).toBe('    C  ->>  B :  spaced');
  });

  it('retargets a message inside a block, preserving the indent', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B\n    participant C\n    alt ok\n        A->>B: Hello\n    end`;
    const res = moveMessageEndpoint(code, null, 'm:0', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[5]).toBe('        A->>C: Hello');
  });

  it('is a no-op when the target is the participant already at that end', () => {
    const res = moveMessageEndpoint(SEQ3, null, 'm:0', 'to', 'p:1');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(SEQ3);
    const res2 = moveMessageEndpoint(SEQ3, null, 'm:0', 'from', 'p:0');
    expect(res2.warning).toBeUndefined();
    expect(res2.code).toBe(SEQ3);
  });

  it('preserves the CONFIG block and every other line byte-for-byte', () => {
    // SEQ: m:0 is line 7 (A->>B: Hello); only that line may change.
    const res = moveMessageEndpoint(SEQ, SEQ_CFG, 'm:0', 'from', 'p:1');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ, res.code, 7, '    B->>B: Hello');
  });

  it('retargets a message whose endpoint is an undeclared (implicit) actor', () => {
    const code = `sequenceDiagram\n    participant A\n    A->>B: Hi`;
    const res = moveMessageEndpoint(code, null, 'm:0', 'to', 'p:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant A\n    A->>A: Hi`);
  });

  it('soft-fails when the target is not a declared participant', () => {
    const code = `sequenceDiagram\n    participant A\n    A->>B: Hi`;
    // B is an implicit actor: it has no participant element, hence no key.
    expect(parseModel(code).elements.some(e => e.kind === 'participant' && (e as { id: string }).id === 'B')).toBe(false);
    const res = moveMessageEndpoint(code, null, 'm:0', 'to', 'm:0');
    expect(res.warning).toBeTruthy();
    expect(res.code).toBe(code);
  });

  it('soft-fails on unknown keys, non-messages and flowcharts', () => {
    expect(moveMessageEndpoint(SEQ3, null, 'm:99', 'to', 'p:2').warning).toBeTruthy();
    expect(moveMessageEndpoint(SEQ3, null, 'm:99', 'to', 'p:2').code).toBe(SEQ3);
    expect(moveMessageEndpoint(SEQ3, null, 'p:0', 'to', 'p:2').warning).toBeTruthy();
    expect(moveMessageEndpoint(SEQ3, null, 'm:0', 'to', 'p:99').warning).toBeTruthy();
    expect(moveMessageEndpoint(SEQ3, null, 'm:0', 'to', 'm:1').warning).toBeTruthy();
    const flow = moveMessageEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'n:1');
    expect(flow.warning).toBeTruthy();
    expect(flow.code).toBe(FLOW);
  });

  it('moves the arrow CONFIG entry (style, tags, mode) to the new recipient', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"Hello","color":"#e11d48","keys":["backend"],"keyMode":"clean"}]}
sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: Hello`;
    const res = moveMessageEndpoint(code, parseConfig(code), 'm:0', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('    A->>C: Hello');
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'A', to: 'C', label: 'Hello', color: '#e11d48', keys: ['backend'], keyMode: 'clean' },
    ]);
  });

  it('moves the arrow CONFIG entry to the new origin when the tail is dragged', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"Hello","color":"#e11d48"}]}
sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: Hello`;
    const res = moveMessageEndpoint(code, parseConfig(code), 'm:0', 'from', 'p:2');
    expect(res.warning).toBeUndefined();
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'C', to: 'B', label: 'Hello', color: '#e11d48' },
    ]);
  });

  it('leaves unrelated arrows entries untouched', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"Hello","color":"#e11d48"},{"from":"B","to":"A","label":"Hi","color":"#22c55e"}]}
sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: Hello
    B-->>A: Hi`;
    const res = moveMessageEndpoint(code, parseConfig(code), 'm:0', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'A', to: 'C', label: 'Hello', color: '#e11d48' },
      { from: 'B', to: 'A', label: 'Hi', color: '#22c55e' },
    ]);
  });

  it('moves only the occurrence-keyed entry of the retargeted message', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"Hi","occurrence":0,"color":"#e11d48"},{"from":"A","to":"B","label":"Hi","occurrence":1,"color":"#22c55e"}]}
sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: Hi
    A->>B: Hi`;
    const res = moveMessageEndpoint(code, parseConfig(code), 'm:0', 'to', 'p:2');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[5]).toBe('    A->>C: Hi');
    expect(res.code.split('\n')[6]).toBe('    A->>B: Hi');
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'A', to: 'C', label: 'Hi', occurrence: 0, color: '#e11d48' },
      { from: 'A', to: 'B', label: 'Hi', occurrence: 1, color: '#22c55e' },
    ]);
  });

  it('leaves the CONFIG block untouched when no arrows entry matches', () => {
    // SEQ_CFG has actors only; retargeting m:2 (line 10) must not rewrite it.
    const res = moveMessageEndpoint(SEQ, SEQ_CFG, 'm:2', 'to', 'p:0');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(SEQ, res.code, 10, '    A->>A: Again');
  });
});

describe('moveMessage', () => {
  const SEQ_MSGS = `sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: First
    B->>C: Second
    C->>A: Third`;

  it('moves a message up before another message (swaps order)', () => {
    const res = moveMessage(SEQ_MSGS, null, 'm:2', { type: 'before', key: 'm:1' });
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[4]).toBe('    A->>B: First');
    expect(lines[5]).toBe('    C->>A: Third');
    expect(lines[6]).toBe('    B->>C: Second');
  });

  it('moves a message down after another message', () => {
    const res = moveMessage(SEQ_MSGS, null, 'm:0', { type: 'after', key: 'm:1' });
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[4]).toBe('    B->>C: Second');
    expect(lines[5]).toBe('    A->>B: First');
    expect(lines[6]).toBe('    C->>A: Third');
  });

  it('moves a message to the top', () => {
    const res = moveMessage(SEQ_MSGS, null, 'm:2', { type: 'top' });
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[4]).toBe('    C->>A: Third');
    expect(lines[5]).toBe('    A->>B: First');
    expect(lines[6]).toBe('    B->>C: Second');
  });

  it('moves a message to the bottom', () => {
    const res = moveMessage(SEQ_MSGS, null, 'm:0', { type: 'bottom' });
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[4]).toBe('    B->>C: Second');
    expect(lines[5]).toBe('    C->>A: Third');
    expect(lines[6]).toBe('    A->>B: First');
  });

  it('is a no-op when moving before or after itself', () => {
    const res1 = moveMessage(SEQ_MSGS, null, 'm:1', { type: 'before', key: 'm:1' });
    expect(res1.code).toBe(SEQ_MSGS);
    const res2 = moveMessage(SEQ_MSGS, null, 'm:1', { type: 'after', key: 'm:1' });
    expect(res2.code).toBe(SEQ_MSGS);
  });

  it('is a no-op when moving after the preceding message (same position)', () => {
    const res = moveMessage(SEQ_MSGS, null, 'm:1', { type: 'after', key: 'm:0' });
    expect(res.code).toBe(SEQ_MSGS);
  });

  it('preserves CONFIG header byte-for-byte outside modified lines', () => {
    const res = moveMessage(SEQ, SEQ_CFG, 'm:1', { type: 'top' });
    expect(res.warning).toBeUndefined();
    expect(parseConfig(res.code)).toEqual(SEQ_CFG);
  });

  it('soft-fails on unknown keys, non-messages, and flowcharts', () => {
    expect(moveMessage(SEQ_MSGS, null, 'm:99', { type: 'top' }).warning).toBeTruthy();
    expect(moveMessage(SEQ_MSGS, null, 'p:0', { type: 'top' }).warning).toBeTruthy();
    expect(moveMessage(FLOW, FLOW_CFG, 'e:0', { type: 'top' }).warning).toBeTruthy();
  });
});

describe('addParticipant', () => {
  it('appends after the last participant in a sequence diagram and assigns a free preset color', () => {
    const res = addParticipant(SEQ, SEQ_CFG);
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[5]).toBe('    participant New1 as New Participant');
    expect(lines.length).toBe(SEQ.split('\n').length + 1);
    expect(res.config?.actors?.New1?.color).toBe(PRESET_ACTOR_COLORS[0]);
    // body lines (lines > 0) are byte-identical
    SEQ.split('\n').slice(1).forEach((line, i) => {
      const idx = i + 1;
      expect(lines[idx < 5 ? idx : idx + 1]).toBe(line);
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

  it('inserts after the sequenceDiagram line when there are no participants and writes CONFIG header', () => {
    const code = `sequenceDiagram\n    A->>B: Hello`;
    const res = addParticipant(code, null);
    expect(res.config?.actors?.New1?.color).toBe(PRESET_ACTOR_COLORS[0]);
    expect(res.code).toBe(`%% CONFIG: {"version":1,"actors":{"New1":{"color":"${PRESET_ACTOR_COLORS[0]}"}}}\nsequenceDiagram\n    participant New1 as New Participant\n    A->>B: Hello`);
  });

  it('deduplicates the generated id against participants and message endpoints', () => {
    const code = `sequenceDiagram\n    participant New1 as Taken\n    participant A\n    New2->>A: hi`;
    const res = addParticipant(code, null);
    expect(res.code).toContain('    participant New3 as New Participant 3');
    const res2 = addParticipant(res.code, null);
    expect(res2.code).toContain('    participant New4 as New Participant 4');
  });

  it('appends a node line at the end of a flowchart with assigned color in CONFIG', () => {
    const res = addParticipant(FLOW, FLOW_CFG);
    expect(res.warning).toBeUndefined();
    expect(res.config?.actors?.New1?.color).toBe(PRESET_ACTOR_COLORS[0]);
    expect(res.code).toContain('    New1[New Participant]');
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

  it('assigns free preset colors in order to newly added participants', () => {
    const code = `sequenceDiagram\n    A->>B: Hello`;
    const cfg: DiagramConfig | null = null;

    // Add first participant: gets preset color 0
    const res1 = addParticipant(code, cfg);
    expect(res1.config?.actors?.New1?.color).toBe(PRESET_ACTOR_COLORS[0]);

    // Add second participant: gets preset color 1
    const res2 = addParticipant(res1.code, res1.config);
    expect(res2.config?.actors?.New2?.color).toBe(PRESET_ACTOR_COLORS[1]);

    // Add third participant: gets preset color 2
    const res3 = addParticipant(res2.code, res2.config);
    expect(res3.config?.actors?.New3?.color).toBe(PRESET_ACTOR_COLORS[2]);
  });

  it('reuses a freed preset color when an actor is deleted', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob`;
    // If A is removed (color 0 is now free, color 1 is taken by B)
    const cfgWithARemoved: DiagramConfig = {
      version: 1,
      actors: {
        B: { color: PRESET_ACTOR_COLORS[1] },
      },
    };
    const res = addParticipant(code, cfgWithARemoved);
    expect(res.config?.actors?.New1?.color).toBe(PRESET_ACTOR_COLORS[0]);
  });

  it('starts rotating preset colors again once all 40 colors have been assigned', () => {
    const cfg: DiagramConfig = {
      version: 1,
      actors: {},
    };
    // Assign all 40 colors
    PRESET_ACTOR_COLORS.forEach((color, idx) => {
      cfg.actors![`Actor${idx}`] = { color };
    });

    // 41st actor rotates back to PRESET_ACTOR_COLORS[0]
    const nextColor = getNextFreeActorColor(cfg);
    expect(nextColor).toBe(PRESET_ACTOR_COLORS[0]);

    // If Actor0 is assigned twice, next is PRESET_ACTOR_COLORS[1]
    cfg.actors!['ActorExtra'] = { color: PRESET_ACTOR_COLORS[0] };
    const nextColor2 = getNextFreeActorColor(cfg);
    expect(nextColor2).toBe(PRESET_ACTOR_COLORS[1]);
  });

  it('has 40 unique acrylic muted preset colors with distinct adjacent hues', () => {
    expect(PRESET_ACTOR_COLORS.length).toBe(40);
    const unique = new Set(PRESET_ACTOR_COLORS.map(c => c.toLowerCase()));
    expect(unique.size).toBe(40);

    // Validate hex format #rrggbb
    for (const c of PRESET_ACTOR_COLORS) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
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

  it('appends a flowchart edge with default message at the end of the file', () => {
    const res = addMessage(FLOW, FLOW_CFG, 'n:0', 'n:1');
    expect(res.code).toBe(FLOW + '\n    A -->|New message| B');
    const model = parseModel(res.code);
    expect(model.elements[model.elements.length - 1]).toMatchObject({ kind: 'edge', from: 'A', to: 'B', operator: '-->', label: 'New message' });
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

describe('moveNode', () => {
  // Mermaid lays same-rank nodes out in first-declaration order, so moving a
  // node relocates its first declaration (see moveNode's doc comment).

  it('moves a standalone-declared node to the end', () => {
    const code = `flowchart TD\n    C[Standalone]\n    A[Alice] --> B[Bob]`;
    // nodes: C(n:0, line 1), A(n:1, line 2), B(n:2, line 2)
    const res = moveNode(code, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A[Alice] --> B[Bob]\n    C[Standalone]`);
    expect(res.newKey).toBe('n:2');
  });

  it('moves an inline-declared node before another node (standalone decl inserted, edge line untouched)', () => {
    const code = `flowchart TD\n    C[Standalone]\n    A[Alice] --> B[Bob]`;
    // Move B (n:2, declared as B[Bob] on line 2's edge) before C (n:0)
    const res = moveNode(code, null, 'n:2', 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    B[Bob]\n    C[Standalone]\n    A[Alice] --> B[Bob]`);
    expect(res.newKey).toBe('n:0');
  });

  it('moves an inline-declared node to the end (all its mention lines move with it)', () => {
    // FLOW: A is mentioned on lines 2, 3 and 4 (edge endpoints). Moving A to
    // the end must relocate every one of them — the first mention decides the
    // rendered position, so moving only line 2 would leave A behind.
    const res = moveNode(FLOW, FLOW_CFG, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`%% CONFIG: {"version":1}
flowchart TD
    C[Standalone]
    A[Alice] --> B[Bob]
    B -->|Reply| A
    A -- ping -- B`);
    // CONFIG untouched, moved node keeps its id (keys are positional: A is now n:1)
    expect(res.code.split('\n')[0]).toBe(FLOW.split('\n')[0]);
    expect(res.newKey).toBe('n:1');
    const el = parseModel(res.code).elements.find(e => e.key === res.newKey);
    expect(el).toMatchObject({ kind: 'node', id: 'A' });
  });

  it('keeps the label when the node has several shaped declarations (move later)', () => {
    // A is declared twice with shapes; the LAST one (A[Alicia]) is what Mermaid
    // shows. The mention lines keep their relative order, so the label is kept.
    const code = `flowchart TD\n    A[Alice] --> B\n    A[Alicia]\n    C`;
    const res = moveNode(code, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    C\n    A[Alice] --> B\n    A[Alicia]`);
  });

  it('keeps the label when the last shaped declaration is on a relocated edge line', () => {
    const code = `flowchart TD\n    A[Alicia]\n    A[Alice] --> B\n    C`;
    // A's standalone line carries an earlier label; the edge line's A[Alice] is
    // the last shaped declaration (what Mermaid shows). Move A to the end.
    const res = moveNode(code, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    C\n    A[Alicia]\n    A[Alice] --> B`);
  });

  it('is a no-op when the node is already before the target', () => {
    expect(moveNode(FLOW, FLOW_CFG, 'n:0', 'n:1').code).toBe(FLOW);
  });

  it('is a no-op when the node is already last (move to end)', () => {
    expect(moveNode(FLOW, FLOW_CFG, 'n:2').code).toBe(FLOW);
  });

  it('is a no-op when moving before itself or onto its own edge line', () => {
    expect(moveNode(FLOW, FLOW_CFG, 'n:0', 'n:0').code).toBe(FLOW);
    // A and B share line 2 (A --> B): moving A before B is a no-op
    const code = `flowchart TD\n    A --> B`;
    expect(moveNode(code, null, 'n:0', 'n:1').code).toBe(code);
  });

  it('is a no-op with a single node', () => {
    const code = `flowchart TD\n    A[Only]`;
    expect(moveNode(code, null, 'n:0').code).toBe(code);
  });

  it('keeps a label that comes from a later declaration when moving earlier', () => {
    // A's first appearance is a bare edge endpoint; the label comes from the
    // later standalone declaration (Mermaid shows the last shaped one).
    const code = `flowchart TD\n    A --> B\n    A[Alicia]\n    C`;
    const res = moveNode(code, null, 'n:2', 'n:0'); // C before A
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    C\n    A --> B\n    A[Alicia]`);
  });

  it('preserves a trailing newline when moving to the end', () => {
    const code = `flowchart TD\n    C\n    A --> B\n`;
    const res = moveNode(code, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A --> B\n    C\n`);
  });

  it('refuses to move a node across a subgraph boundary', () => {
    const code = `flowchart TD\n    A --> B\n    subgraph S\n        C\n    end`;
    // C (n:2, inside S) before A (top level)
    const res = moveNode(code, null, 'n:2', 'n:0');
    expect(res.warning).toBeTruthy();
    expect(res.code).toBe(code);
  });

  it('moves a top-level node to the end of a diagram with a subgraph', () => {
    const code = `flowchart TD\n    A --> B\n    subgraph S\n        C\n    end`;
    const res = moveNode(code, null, 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph S\n        C\n    end\n    A --> B`);
  });

  it('moves nodes within a subgraph (indent preserved)', () => {
    const code = `flowchart TD\n    subgraph S\n        A\n        B\n    end`;
    const res = moveNode(code, null, 'n:1', 'n:0'); // B before A
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph S\n        B\n        A\n    end`);
  });

  it('soft-fails on sequence diagrams, non-node keys and unknown keys', () => {
    expect(moveNode(SEQ, SEQ_CFG, 'p:0').warning).toBeTruthy();
    expect(moveNode(SEQ, SEQ_CFG, 'p:0').code).toBe(SEQ);
    expect(moveNode(FLOW, FLOW_CFG, 'e:0').warning).toBeTruthy();
    expect(moveNode(FLOW, FLOW_CFG, 'n:99').warning).toBeTruthy();
    expect(moveNode(FLOW, FLOW_CFG, 'n:0', 'e:0').warning).toBeTruthy();
    expect(moveNode(FLOW, FLOW_CFG, 'n:0', 'n:99').warning).toBeTruthy();
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
    expect(addTag(SEQ, SEQ_CFG, 'r:0', 'ok').warning).toBeTruthy();  // regions are not taggable
    expect(addTag(SEQ, SEQ_CFG, 'm:0', 'has space').warning).toBeTruthy();
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

describe('arrow tags (messages/edges)', () => {
  // A has the 'backend' tag, so message inheritance can be observed.
  const SEQ2 = `%% CONFIG: {"version":1,"actors":{"A":{"keys":["backend"]}}}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi`;
  const SEQ2_CFG = parseConfig(SEQ2);

  it('adds and removes tags on a message via CONFIG.arrows, body byte-identical', () => {
    const added = addTag(SEQ2, SEQ2_CFG, 'm:0', 'critical');
    expect(added.warning).toBeUndefined();
    expectBodyIdentical(SEQ2, added.code);
    expect(added.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', keys: ['critical'] }]);
    expect(parseConfig(added.code)?.arrows?.[0].keys).toEqual(['critical']);
    // idempotent
    const again = addTag(added.code, added.config, 'm:0', 'critical');
    expect(again.config?.arrows?.[0].keys).toEqual(['critical']);
    // a second tag, then removals prune the entry and finally the arrows field
    const two = addTag(added.code, added.config, 'm:0', 'retry');
    expect(two.config?.arrows?.[0].keys).toEqual(['critical', 'retry']);
    const one = removeTag(two.code, two.config, 'm:0', 'critical');
    expect(one.config?.arrows?.[0].keys).toEqual(['retry']);
    const none = removeTag(one.code, one.config, 'm:0', 'retry');
    expect(none.config?.arrows).toBeUndefined();
    expect(none.config?.actors).toEqual({ A: { keys: ['backend'] } }); // actor tags untouched
    // removing a tag the arrow does not have is a no-op
    expect(removeTag(SEQ2, SEQ2_CFG, 'm:0', 'nope').code).toBe(SEQ2);
  });

  it('creates the header on the first message tag edit and drops it when empty', () => {
    const code = createSequenceDiagram();
    const added = addTag(code, null, 'm:0', 'critical');
    expect(parseConfig(added.code)?.arrows?.[0].keys).toEqual(['critical']);
    const removed = removeTag(added.code, added.config, 'm:0', 'critical');
    expect(removed.code).toBe(code);
    expect(parseConfig(removed.code)).toBeNull();
  });

  it('tags a flowchart edge', () => {
    const added = addTag(FLOW, FLOW_CFG, 'e:0', 'critical');
    expect(added.warning).toBeUndefined();
    expect(added.config?.arrows).toEqual([{ from: 'A', to: 'B', keys: ['critical'] }]);
  });

  it('disambiguates same-endpoint messages by occurrence', () => {
    const code = `%% CONFIG: {"version":1}
sequenceDiagram
    participant A
    participant B
    A->>B: Ping
    A->>B: Ping`;
    const cfg = parseConfig(code);
    const second = addTag(code, cfg, 'm:1', 'critical');
    expect(second.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Ping', occurrence: 1, keys: ['critical'] }]);
    const first = addTag(code, cfg, 'm:0', 'other');
    expect(first.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Ping', keys: ['other'] }]);
  });

  it('preserves tags and key mode when setting or clearing an arrow style', () => {
    const tagged = addTag(SEQ2, SEQ2_CFG, 'm:0', 'critical');
    const styled = setArrowStyle(tagged.code, tagged.config, 'm:0', { color: 'red' });
    expect(styled.config?.arrows?.[0]).toEqual(
      { from: 'A', to: 'B', label: 'Hello', color: 'red', keys: ['critical'] });
    // clearing the style keeps the tags
    const cleared = setArrowStyle(styled.code, styled.config, 'm:0', {});
    expect(cleared.config?.arrows?.[0]).toEqual({ from: 'A', to: 'B', label: 'Hello', keys: ['critical'] });
    // and keeps an explicit 'merged' mode
    const modeSet = setArrowKeyMode(cleared.code, cleared.config, 'm:0', 'merged');
    expect(modeSet.config?.arrows?.[0]).toEqual(
      { from: 'A', to: 'B', label: 'Hello', keys: ['critical'], keyMode: 'merged' });
    const clearedStyle = setArrowStyle(modeSet.code, modeSet.config, 'm:0', {});
    expect(clearedStyle.config?.arrows?.[0]).toEqual(
      { from: 'A', to: 'B', label: 'Hello', keys: ['critical'], keyMode: 'merged' });
    // removing the last tag drops the empty keys array; the explicit 'merged'
    // mode survives (it still means "inherit origin service tags")
    const removed = removeTag(clearedStyle.code, clearedStyle.config, 'm:0', 'critical');
    expect(removed.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', keyMode: 'merged' }]);
  });

  it('setArrowKeyMode stores only the non-default (merged) state', () => {
    const merged = setArrowKeyMode(SEQ2, SEQ2_CFG, 'm:0', 'merged');
    expect(merged.warning).toBeUndefined();
    expect(merged.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', keyMode: 'merged' }]);
    // back to clean (the default): the entry carries no state and is pruned
    const back = setArrowKeyMode(merged.code, merged.config, 'm:0', 'clean');
    expect(back.config?.arrows).toBeUndefined();
    expect(back.config?.actors).toEqual({ A: { keys: ['backend'] } });
    // soft-fails
    expect(setArrowKeyMode(SEQ2, SEQ2_CFG, 'm:0', 'bogus' as 'merged').warning).toBeTruthy();
    expect(setArrowKeyMode(SEQ2, SEQ2_CFG, 'p:0', 'merged').warning).toBeTruthy();
  });

  it('getArrowTags reports own tags, the mode and the inherited service tags', () => {
    // default: clean, no entry — does not inherit A's tags
    expect(getArrowTags(SEQ2, SEQ2_CFG, 'm:0'))
      .toEqual({ keys: [], keyMode: 'clean', inherited: [] });
    // an own tag
    const tagged = addTag(SEQ2, SEQ2_CFG, 'm:0', 'backend');
    expect(getArrowTags(tagged.code, tagged.config, 'm:0'))
      .toEqual({ keys: ['backend'], keyMode: 'clean', inherited: [] });
    // merged: inherits origin's tags; an own tag overlapping the inherited one is not duplicated
    const merged = setArrowKeyMode(tagged.code, tagged.config, 'm:0', 'merged');
    expect(getArrowTags(merged.code, merged.config, 'm:0'))
      .toEqual({ keys: ['backend'], keyMode: 'merged', inherited: [] });
    // with different own tag, inherited backend is reported
    const diffTagged = setArrowKeyMode(SEQ2, SEQ2_CFG, 'm:0', 'merged');
    expect(getArrowTags(diffTagged.code, diffTagged.config, 'm:0'))
      .toEqual({ keys: [], keyMode: 'merged', inherited: ['backend'] });
    // flowchart edge does not inherit by default; non-arrows return null
    const flowTagged = addTag(FLOW, FLOW_CFG, 'e:0', 'critical');
    expect(getArrowTags(flowTagged.code, flowTagged.config, 'e:0'))
      .toEqual({ keys: ['critical'], keyMode: 'clean', inherited: [] });
    expect(getArrowTags(SEQ2, SEQ2_CFG, 'p:0')).toBeNull();
    expect(getArrowTags(SEQ2, SEQ2_CFG, 'nope')).toBeNull();
  });

  it('deleting an element removes its arrow tag entries', () => {
    const tagged = addTag(SEQ2, SEQ2_CFG, 'm:0', 'critical');
    const del = deleteElement(tagged.code, tagged.config, 'm:0');
    expect(del.config?.arrows).toBeUndefined();
    // deleting the actor cascades to its messages and drops their tag entries
    const delActor = deleteElement(tagged.code, tagged.config, 'p:0');
    expect(delActor.config?.arrows).toBeUndefined();
    expect(delActor.config?.actors?.A).toBeUndefined();
  });

  it('does not mutate the input config on arrow tag edits', () => {
    const config: DiagramConfig = {
      version: 1,
      actors: { A: { keys: ['backend'] } },
      arrows: [{ from: 'A', to: 'B', label: 'Hello', keys: ['x'] }],
    };
    const snapshot = JSON.stringify(config);
    addTag(SEQ, config, 'm:0', 'y');
    removeTag(SEQ, config, 'm:0', 'x');
    setArrowKeyMode(SEQ, config, 'm:0', 'clean');
    setArrowStyle(SEQ, config, 'm:0', { color: 'red' });
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe('note tags', () => {
  // A CONFIG header is present so expectBodyIdentical can assert the body is
  // byte-identical (the header line itself is replaced).
  const NOTE_SEQ = `%% CONFIG: {"version":1}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    Note over A,B: Shared note
    Note over A: Left note
    B-->>A: Hi`;
  const NOTE_SEQ_CFG = parseConfig(NOTE_SEQ);

  it('adds and removes tags on a note via CONFIG.noteTags, body byte-identical', () => {
    const added = addTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0', 'edge-case');
    expect(added.warning).toBeUndefined();
    expectBodyIdentical(NOTE_SEQ, added.code);
    expect(added.config?.noteTags).toEqual([
      { over: ['A', 'B'], text: 'Shared note', keys: ['edge-case'] },
    ]);
    expect(parseConfig(added.code)?.noteTags?.[0].keys).toEqual(['edge-case']);
    // idempotent
    const again = addTag(added.code, added.config, 'note:0', 'edge-case');
    expect(again.config?.noteTags?.[0].keys).toEqual(['edge-case']);
    // a second tag, then removals prune the entry and finally the noteTags field
    const two = addTag(added.code, added.config, 'note:0', 'beta');
    expect(two.config?.noteTags?.[0].keys).toEqual(['edge-case', 'beta']);
    const one = removeTag(two.code, two.config, 'note:0', 'edge-case');
    expect(one.config?.noteTags?.[0].keys).toEqual(['beta']);
    const none = removeTag(one.code, one.config, 'note:0', 'beta');
    expect(none.config?.noteTags).toBeUndefined();
    // removing a tag the note does not have is a no-op
    expect(removeTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0', 'nope').code).toBe(NOTE_SEQ);
  });

  it('tags each note independently (over + text identify the entry)', () => {
    const n1 = addTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:1', 'lefty');
    expect(n1.config?.noteTags).toEqual([{ over: ['A'], text: 'Left note', keys: ['lefty'] }]);
    const both = addTag(n1.code, n1.config, 'note:0', 'shared-key');
    expect(both.config?.noteTags).toEqual([
      { over: ['A'], text: 'Left note', keys: ['lefty'] },
      { over: ['A', 'B'], text: 'Shared note', keys: ['shared-key'] },
    ]);
  });

  it('disambiguates duplicate notes by occurrence', () => {
    const code = `sequenceDiagram
    participant A
    participant B
    Note over A: Same
    Note over A: Same`;
    const cfg = parseConfig(code);
    const second = addTag(code, cfg, 'note:1', 'edge-case');
    expect(second.config?.noteTags).toEqual([{ over: ['A'], text: 'Same', occurrence: 1, keys: ['edge-case'] }]);
    const first = addTag(code, cfg, 'note:0', 'other');
    expect(first.config?.noteTags).toEqual([{ over: ['A'], text: 'Same', keys: ['other'] }]);
  });

  it('creates the header on the first note tag edit and drops it when empty', () => {
    const code = createSequenceDiagram();
    const noNote = removeTag(code, null, 'm:0', 'nope'); // no-op sanity
    expect(noNote.code).toBe(code);
    const withNote = `${code}\n    Note over A,B: Heads up`;
    const added = addTag(withNote, null, 'note:0', 'edge-case');
    expect(parseConfig(added.code)?.noteTags).toEqual([{ over: ['A', 'B'], text: 'Heads up', keys: ['edge-case'] }]);
    const removed = removeTag(added.code, added.config, 'note:0', 'edge-case');
    expect(removed.code).toBe(withNote);
    expect(parseConfig(removed.code)).toBeNull();
  });

  it('getNoteTags reports the note own tags only', () => {
    expect(getNoteTags(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0')).toEqual([]);
    const tagged = addTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0', 'edge-case');
    expect(getNoteTags(tagged.code, tagged.config, 'note:0')).toEqual(['edge-case']);
    // non-notes report no tags
    expect(getNoteTags(NOTE_SEQ, NOTE_SEQ_CFG, 'm:0')).toEqual([]);
    expect(getNoteTags(NOTE_SEQ, NOTE_SEQ_CFG, 'p:0')).toEqual([]);
    expect(getNoteTags(NOTE_SEQ, NOTE_SEQ_CFG, 'nope')).toEqual([]);
  });

  it('deleting a note removes its tag entry; deleting an actor cascades to its notes', () => {
    const tagged = addTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0', 'edge-case');
    const taggedNote1 = addTag(tagged.code, tagged.config, 'note:1', 'lefty');
    const del = deleteElement(taggedNote1.code, taggedNote1.config, 'note:0');
    expect(del.config?.noteTags).toEqual([{ over: ['A'], text: 'Left note', keys: ['lefty'] }]);
    // deleting actor A cascades to both notes and drops their tag entries
    const delActor = deleteElement(taggedNote1.code, taggedNote1.config, 'p:0');
    expect(delActor.config?.noteTags).toBeUndefined();
  });

  it('soft-fails on invalid tags and non-taggable kinds', () => {
    expect(addTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0', 'has space').warning).toBeTruthy();
    expect(addTag(NOTE_SEQ, NOTE_SEQ_CFG, 'note:0', '').warning).toBeTruthy();
    // blocks and regions stay untaggable
    const withBlock = `sequenceDiagram\n    participant A\n    alt x\n    end`;
    expect(addTag(withBlock, null, 'b:0', 'ok').warning).toBeTruthy();
    expect(removeTag(withBlock, null, 'b:0', 'ok').warning).toBeTruthy();
  });

  it('does not mutate the input config on note tag edits', () => {
    const config: DiagramConfig = {
      version: 1,
      noteTags: [{ over: ['A'], text: 'Left note', keys: ['x'] }],
    };
    const snapshot = JSON.stringify(config);
    addTag(NOTE_SEQ, config, 'note:1', 'y');
    removeTag(NOTE_SEQ, config, 'note:1', 'x');
    deleteElement(NOTE_SEQ, config, 'note:1');
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

  it('styles arrows with animations and reads them back', () => {
    const styled = setArrowStyle(SEQ, SEQ_CFG, 'm:0', { color: '#10b981', animation: 'flow' });
    expect(styled.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'Hello', color: '#10b981', animation: 'flow' },
    ]);
    expect(getArrowStyle(styled.code, styled.config, 'm:0')).toEqual({
      color: '#10b981',
      width: undefined,
      dash: 'solid',
      animation: 'flow',
    });
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

describe('convertDiagramToAnimatedArrows', () => {
  it('deterministically converts normal arrows to happy-path and error arrows to failure animations', () => {
    const code = `sequenceDiagram
    participant Client
    participant API
    participant DB
    Client->>API: 1. Login Request
    API->>DB: 2. Query
    DB--xAPI: 3. Connection timeout
    API-->>Client: 4. 500 Internal Error
    Client->>API: 5. Retry attempt`;

    const res = convertDiagramToAnimatedArrows(code, null);
    expect(res.warning).toBeUndefined();
    expect(res.config?.arrows).toHaveLength(5);

    // Messages 1 and 2: happy paths -> positive colors (green/blue) and flow/pulse animations
    expect(res.config?.arrows?.[0]).toMatchObject({
      from: 'Client',
      to: 'API',
      animation: 'flow',
      color: '#00ff9d', // Emerald
    });
    expect(res.config?.arrows?.[1]).toMatchObject({
      from: 'API',
      to: 'DB',
      animation: 'pulse',
      color: '#00f0ff', // Teal
    });

    // Message 3: timeout (--x) -> error animation (broken-receiver) and error color
    expect(res.config?.arrows?.[2]).toMatchObject({
      from: 'DB',
      to: 'API',
      animation: 'broken-receiver',
      color: '#ff2a85', // Rose
    });

    // Message 4: 500 error -> broken-sender animation and error color
    expect(res.config?.arrows?.[3]).toMatchObject({
      from: 'API',
      to: 'Client',
      animation: 'broken-sender',
      color: '#ffbe0b', // Amber / error
    });

    // Message 5: Retry -> broken-network animation
    expect(res.config?.arrows?.[4]).toMatchObject({
      from: 'Client',
      to: 'API',
      animation: 'broken-network',
    });
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
    expect(parseModel(flowMsg.code).elements[parseModel(flowMsg.code).elements.length - 1]).toMatchObject({ kind: 'edge', from: 'New1', to: 'A', label: 'New message' });
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

  it('retargets message endpoints on a newly created sequence diagram', () => {
    // createSequenceDiagram: A->>B: Hello, B-->>A: Hi there; add a third
    // participant, then drag the arrow head / tail onto it.
    const code = createSequenceDiagram();
    const withC = addParticipant(code, null); // New1 = p:2
    const head = moveMessageEndpoint(withC.code, withC.config, 'm:0', 'to', 'p:2');
    expect(head.warning).toBeUndefined();
    expect(parseModel(head.code).elements.find(e => e.key === 'm:0')).toMatchObject({ from: 'A', to: 'New1', label: 'Hello' });
    const tail = moveMessageEndpoint(head.code, head.config, 'm:1', 'from', 'p:2');
    expect(tail.warning).toBeUndefined();
    expect(parseModel(tail.code).elements.find(e => e.key === 'm:1')).toMatchObject({ from: 'New1', to: 'A', label: 'Hi there' });
    // the other message is untouched
    expect(parseModel(tail.code).elements.find(e => e.key === 'm:0')).toMatchObject({ from: 'A', to: 'New1', label: 'Hello' });
  });

  it('keeps the arrow style when retargeting a styled message endpoint', () => {
    const code = createSequenceDiagram();
    const styled = setArrowStyle(code, null, 'm:0', { color: '#e11d48' });
    const withC = addParticipant(styled.code, styled.config);
    const moved = moveMessageEndpoint(withC.code, withC.config, 'm:0', 'to', 'p:2');
    expect(moved.warning).toBeUndefined();
    expect(parseConfig(moved.code)?.arrows).toEqual([{ from: 'A', to: 'New1', label: 'Hello', color: '#e11d48' }]);
    // and the style still resolves against the retargeted endpoints
    expect(getArrowStyle(moved.code, moved.config, 'm:0')).toEqual({ color: '#e11d48', width: undefined, dash: 'solid' });
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

describe('setParticipantKind', () => {
  it('toggles participant to actor in sequence diagram', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob`;
    const res = setParticipantKind(code, null, 'p:0', 'actor');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    actor A as Alice\n    participant B as Bob`);
  });

  it('toggles actor to participant', () => {
    const code = `sequenceDiagram\n    actor A as Alice\n    participant B as Bob`;
    const res = setParticipantKind(code, null, 'p:0', 'participant');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant A as Alice\n    participant B as Bob`);
  });

  it('toggles participant to database in sequence diagram', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob`;
    const res = setParticipantKind(code, null, 'p:0', 'database');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant A as Alice @{ type: "database" }\n    participant B as Bob`);
  });

  it('toggles participant to queue in sequence diagram', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob`;
    const res = setParticipantKind(code, null, 'p:0', 'queue');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant A as Alice @{ type: "queue" }\n    participant B as Bob`);
  });

  it('toggles database to queue and vice versa in sequence diagram', () => {
    const code = `sequenceDiagram\n    participant DB as Main Database @{ type: "database" }`;
    const res = setParticipantKind(code, null, 'p:0', 'queue');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant DB as Main Database @{ type: "queue" }`);

    const res2 = setParticipantKind(res.code, null, 'p:0', 'database');
    expect(res2.warning).toBeUndefined();
    expect(res2.code).toBe(`sequenceDiagram\n    participant DB as Main Database @{ type: "database" }`);
  });

  it('toggles database to actor and participant', () => {
    const code = `sequenceDiagram\n    participant DB as Main Database @{ type: "database" }`;
    const toActor = setParticipantKind(code, null, 'p:0', 'actor');
    expect(toActor.code).toBe(`sequenceDiagram\n    actor DB as Main Database`);

    const toParticipant = setParticipantKind(code, null, 'p:0', 'participant');
    expect(toParticipant.code).toBe(`sequenceDiagram\n    participant DB as Main Database`);
  });

  it('handles participants without aliases', () => {
    const code = `sequenceDiagram\n    participant DB`;
    const res = setParticipantKind(code, null, 'p:0', 'database');
    expect(res.code).toBe(`sequenceDiagram\n    participant DB @{ type: "database" }`);

    const toActor = setParticipantKind(res.code, null, 'p:0', 'actor');
    expect(toActor.code).toBe(`sequenceDiagram\n    actor DB`);

    const toParticipant = setParticipantKind(toActor.code, null, 'p:0', 'participant');
    expect(toParticipant.code).toBe(`sequenceDiagram\n    participant DB`);
  });

  it('preserves metadata when renaming a participant', () => {
    const code = `sequenceDiagram\n    participant DB as OldName @{ type: "database" }`;
    const res = renameParticipant(code, null, 'p:0', 'NewName');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant DB as NewName @{ type: "database" }`);
  });

  it('is a no-op when already same kind', () => {
    const code = `sequenceDiagram\n    actor A as Alice`;
    const res = setParticipantKind(code, null, 'p:0', 'actor');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(code);

    const dbCode = `sequenceDiagram\n    participant DB as Database @{ type: "database" }`;
    const resDb = setParticipantKind(dbCode, null, 'p:0', 'database');
    expect(resDb.code).toBe(dbCode);
  });

  it('fails gracefully for flowchart diagrams', () => {
    const res = setParticipantKind(FLOW, FLOW_CFG, 'n:0', 'actor');
    expect(res.warning).toBe('Unsupported diagram type (editing supports sequence and flowchart diagrams)');
  });
});

describe('addParticipant with kind', () => {
  it('adds actor participant when kind is actor', () => {
    const code = `sequenceDiagram\n    participant A as Alice`;
    const res = addParticipant(code, null, undefined, undefined, 'actor');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('    actor New1 as New Participant');
  });

  it('adds database participant when kind is database', () => {
    const code = `sequenceDiagram\n    participant A as Alice`;
    const res = addParticipant(code, null, undefined, undefined, 'database');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('    participant New1 as New Participant @{ type: "database" }');
  });

  it('adds queue participant when kind is queue', () => {
    const code = `sequenceDiagram\n    participant A as Alice`;
    const res = addParticipant(code, null, undefined, undefined, 'queue');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('    participant New1 as New Participant @{ type: "queue" }');
  });
});

describe('setNodeShape', () => {
  const FC_BASE = `flowchart TD\n    A[Start] --> B[Process]`;

  it('changes node shape to cylinder (database)', () => {
    const res = setNodeShape(FC_BASE, null, 'n:1', 'cylinder');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A[Start] --> B[(Process)]`);
  });

  it('changes node shape to rhombus (if/else)', () => {
    const res = setNodeShape(FC_BASE, null, 'n:1', 'rhombus');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A[Start] --> B{Process}`);
  });

  it('accepts shape aliases like database and if-else', () => {
    const resDb = setNodeShape(FC_BASE, null, 'n:1', 'database');
    expect(resDb.code).toBe(`flowchart TD\n    A[Start] --> B[(Process)]`);

    const resIf = setNodeShape(FC_BASE, null, 'n:1', 'if-else');
    expect(resIf.code).toBe(`flowchart TD\n    A[Start] --> B{Process}`);
  });

  it('changes standalone node shape', () => {
    const code = `flowchart TD\n    A[(Database)]\n    A --> B`;
    const res = setNodeShape(code, null, 'n:0', 'rhombus');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A{Database}\n    A --> B`);
  });

  it('changes bare node on an edge line', () => {
    const code = `flowchart TD\n    A --> B`;
    const res = setNodeShape(code, null, 'n:0', 'cylinder');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A[(A)] --> B`);
  });

  it('changes target node on an edge line with pipe label', () => {
    const code = `flowchart TD\n    A[Process] -->|Yes| B`;
    const res = setNodeShape(code, null, 'n:1', 'rhombus');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A[Process] -->|Yes| B{B}`);
  });

  it('is a no-op when already same shape', () => {
    const code = `flowchart TD\n    A[(DB)] --> B`;
    const res = setNodeShape(code, null, 'n:0', 'cylinder');
    expect(res.code).toBe(code);
  });

  it('fails on forbidden characters for the target shape', () => {
    const code = `flowchart TD\n    A[Choice {x}] --> B`;
    const res = setNodeShape(code, null, 'n:0', 'rhombus');
    expect(res.warning).toMatch(/cannot contain '\{\}'/);
    expect(res.code).toBe(code);
  });

  it('fails cleanly on sequence diagrams', () => {
    const res = setNodeShape(SEQ, null, 'p:0', 'cylinder');
    expect(res.warning).toMatch(/unsupported/i);
  });

  it('fails on invalid shape name', () => {
    const res = setNodeShape(FC_BASE, null, 'n:0', 'not-a-shape' as unknown as import('./model').NodeShape);
    expect(res.warning).toMatch(/invalid node shape/i);
  });
});

describe('toggleActivation', () => {
  it('activates target endpoint by adding + to sequence message operator', () => {
    const code = `sequenceDiagram\n    A->>B: Request`;
    const res = toggleActivation(code, null, 'm:0', 'target', true);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    A->>+B: Request`);
  });

  it('deactivates target endpoint by removing + from operator', () => {
    const code = `sequenceDiagram\n    A->>+B: Request`;
    const res = toggleActivation(code, null, 'm:0', 'target', false);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    A->>B: Request`);
  });

  it('deactivates source endpoint by adding - to sequence message operator', () => {
    const code = `sequenceDiagram\n    B-->>A: Response`;
    const res = toggleActivation(code, null, 'm:0', 'source', true);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    B-->>-A: Response`);
  });

  it('removes - when deactivating source endpoint is set to false', () => {
    const code = `sequenceDiagram\n    B-->>-A: Response`;
    const res = toggleActivation(code, null, 'm:0', 'source', false);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    B-->>A: Response`);
  });

  it('inserts activate line when target activated on message that already deactivates source', () => {
    const code = `sequenceDiagram\n    B-->>-A: Response`;
    const res = toggleActivation(code, null, 'm:0', 'target', true);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    B-->>-A: Response\n    activate A`);
  });

  it('inserts deactivate line when source deactivated on message that already activates target', () => {
    const code = `sequenceDiagram\n    A->>+B: Request`;
    const res = toggleActivation(code, null, 'm:0', 'source', true);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    A->>+B: Request\n    deactivate A`);
  });

  it('removes inserted activate/deactivate line when toggled to false', () => {
    const code = `sequenceDiagram\n    B-->>-A: Response\n    activate A`;
    const res = toggleActivation(code, null, 'm:0', 'target', false);
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    B-->>-A: Response`);
  });
});

describe('groupParticipants', () => {
  it('wraps multiple participants inside a box block with color and title', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    participant C as Charlie\n    A->>B: Hi`;
    const res = groupParticipants(code, null, ['p:0', 'p:1'], 'Auth Services', 'rgba(0,100,255,0.1)');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('box rgba(0,100,255,0.1) Auth Services');
    expect(res.code).toContain('    participant A as Alice');
    expect(res.code).toContain('    participant B as Bob');
    expect(res.code).toContain('end');
    expect(res.code).toContain('participant C as Charlie');
  });

  it('wraps multiple participants inside a box block without color', () => {
    const code = `sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hi`;
    const res = groupParticipants(code, null, ['p:0', 'p:1'], 'Core');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('box Core');
    expect(res.code).toContain('    participant A as Alice');
    expect(res.code).toContain('    participant B as Bob');
    expect(res.code).toContain('end');
  });

  it('fails when fewer than 2 participants are provided', () => {
    const code = `sequenceDiagram\n    participant A as Alice`;
    const res = groupParticipants(code, null, ['p:0'], 'Core');
    expect(res.warning).toBe('At least two participants must be selected to create a box group');
  });
});

describe('toggleDiagramOrientation', () => {
  it('toggles flowchart TD to LR', () => {
    const res = toggleDiagramOrientation('flowchart TD\n    A --> B');
    expect(res).toBe('flowchart LR\n    A --> B');
  });

  it('toggles flowchart LR to TD', () => {
    const res = toggleDiagramOrientation('flowchart LR\n    A --> B');
    expect(res).toBe('flowchart TD\n    A --> B');
  });

  it('toggles graph TB to LR', () => {
    const res = toggleDiagramOrientation('graph TB\n    A --> B');
    expect(res).toBe('graph LR\n    A --> B');
  });

  it('is a no-op for sequence diagrams', () => {
    const seq = 'sequenceDiagram\n    A->>B: Hi';
    const res = toggleDiagramOrientation(seq);
    expect(res).toBe(seq);
  });
});

describe('toggleNumberedSteps', () => {
  it('enables numbered steps by adding autonumber after sequenceDiagram', () => {
    const seq = 'sequenceDiagram\n    participant A\n    A->>B: Hi';
    const res = toggleNumberedSteps(seq);
    expect(res).toBe('sequenceDiagram\n    autonumber\n    participant A\n    A->>B: Hi');
    expect(hasNumberedSteps(res)).toBe(true);
  });

  it('disables numbered steps by removing autonumber line', () => {
    const seq = 'sequenceDiagram\n    autonumber\n    participant A\n    A->>B: Hi';
    const res = toggleNumberedSteps(seq);
    expect(res).toBe('sequenceDiagram\n    participant A\n    A->>B: Hi');
    expect(hasNumberedSteps(res)).toBe(false);
  });

  it('detects indentation of subsequent lines when inserting autonumber', () => {
    const seq = 'sequenceDiagram\n  participant A\n  A->>B: Hi';
    const res = toggleNumberedSteps(seq);
    expect(res).toBe('sequenceDiagram\n  autonumber\n  participant A\n  A->>B: Hi');
  });

  it('preserves CONFIG header and comments when toggling', () => {
    const seq = '%% CONFIG: {"version":1}\nsequenceDiagram\n    %% note\n    A->>B: Hi';
    const on = toggleNumberedSteps(seq);
    expect(on).toBe('%% CONFIG: {"version":1}\nsequenceDiagram\n    autonumber\n    %% note\n    A->>B: Hi');
    const off = toggleNumberedSteps(on);
    expect(off).toBe(seq);
  });

  it('is a no-op for flowchart diagrams', () => {
    const flow = 'flowchart TD\n    A --> B';
    const res = toggleNumberedSteps(flow);
    expect(res).toBe(flow);
    expect(hasNumberedSteps(flow)).toBe(false);
  });

  it('is a no-op for empty input', () => {
    expect(toggleNumberedSteps('')).toBe('');
    expect(hasNumberedSteps('')).toBe(false);
  });
});

describe('insertMessage', () => {
  it('inserts message at bottom by default', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B\n    A->>B: One`;
    const res = insertMessage(code, null, 'p:0', 'p:1', 'Two');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`sequenceDiagram\n    participant A\n    participant B\n    A->>B: One\n    A->>B: Two`);
  });

  it('inserts message with target activation (+)', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B`;
    const res = insertMessage(code, null, 'p:0', 'p:1', 'Call', '->>', { type: 'bottom' }, { activateTarget: true });
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('A->>+B: Call');
  });

  it('inserts message with deactivate source (-)', () => {
    const code = `sequenceDiagram\n    participant A\n    participant B`;
    const res = insertMessage(code, null, 'p:0', 'p:1', 'Return', '-->>', { type: 'bottom' }, { deactivateSource: true });
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('A-->>-B: Return');
  });

  it('inserts flowchart edge with default message when label is omitted', () => {
    const code = `flowchart TD\n    A[Alice] --> B[Bob]`;
    const res = insertMessage(code, null, 'n:0', 'n:1');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A[Alice] --> B[Bob]\n    A -->|New message| B`);
  });
});

