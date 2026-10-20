import { describe, it, expect } from 'vitest';
import {
  renameParticipant, editMessageLabel, setArrowType, addParticipant, addMessage,
  deleteElement, setActorColor, addTag, removeTag, setArrowStyle, setGlobalArrowStyle, getArrowStyle,
  getArrowTags, getNoteTags, getStickyNoteTags, setArrowKeyMode, moveParticipant, moveNode, moveMessage, moveMessageEndpoint, moveEdgeEndpoint, MessageInsertPosition,
  PRESET_ACTOR_COLORS, getNextFreeActorColor, convertDiagramToAnimatedArrows,
  setParticipantKind, setNodeShape, toggleActivation, groupParticipants, groupNodes, toggleDiagramOrientation, insertMessage,
  toggleNumberedSteps, hasNumberedSteps, addSequenceNote, editNoteText, setNotePlacement, setNoteSpan,
  setBlockTitle, setBlockType, unwrapBlock, deleteBlock, hexToRgbColor, rgbToHexColor, DEFAULT_RECT_COLOR,
  canWrapSelection, wrapInBlock, wrapInRegion,
} from './editor';
import { parseModel } from './model';
import { processMermaid, transformActors } from './preprocessor';
import { updateViewsData, DiagramConfig } from './views';
import { buildSubgraphTagIndex, collectSubgraphTags } from './subgraphTags';
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

describe('editMessageLabel arrow CONFIG migration', () => {
  // Arrow CONFIG entries are keyed by (from, to, label, occurrence): a label
  // edit must re-key the arrow's own entry so its style, tags and tag mode
  // survive the rename instead of being orphaned (the color reset bug).
  const withArrows = (arrows: string, body: string) =>
    `%% CONFIG: {"version":1,"arrows":[${arrows}]}\n${body}`;
  const SEQ_BODY = 'sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello';

  it('keeps the full arrow style when the sequence label changes', () => {
    const code = withArrows(
      '{"from":"A","to":"B","label":"Hello","color":"#e11d48","width":3,"dash":"dashed","animation":"hesitate"}',
      SEQ_BODY);
    const res = editMessageLabel(code, parseConfig(code), 'm:0', 'Hey');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('    A->>B: Hey');
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'Hey', color: '#e11d48', width: 3, dash: 'dashed', animation: 'hesitate' },
    ]);
    // The CONFIG line embedded in the code carries the migrated entry.
    expect(parseConfig(res.code)?.arrows).toEqual(res.config?.arrows);
    // The panel-facing lookup still resolves the style for the edited arrow.
    expect(getArrowStyle(res.code, res.config, 'm:0')).toEqual({
      color: '#e11d48', width: 3, dash: 'dashed', animation: 'hesitate',
    });
  });

  it('carries the arrow tags and tag mode over the label change', () => {
    const code = withArrows(
      '{"from":"A","to":"B","label":"Hello","keys":["backend"],"keyMode":"merged"}',
      SEQ_BODY);
    const res = editMessageLabel(code, parseConfig(code), 'm:0', 'Hey');
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'Hey', keys: ['backend'], keyMode: 'merged' },
    ]);
    expect(getArrowTags(res.code, res.config, 'm:0')).toEqual({
      keys: ['backend'], keyMode: 'merged', inherited: [],
    });
  });

  it('drops the occurrence when a styled duplicate is renamed to a unique label', () => {
    const code = withArrows(
      '{"from":"A","to":"B","label":"x","occurrence":1,"color":"#e11d48"}',
      'sequenceDiagram\n    participant A\n    participant B\n    A->>B: x\n    A->>B: x');
    // m:1 is the second 'x' (occurrence 1); renaming it to 'y' makes it the
    // only 'y', i.e. occurrence 0 (stored as absent).
    const res = editMessageLabel(code, parseConfig(code), 'm:1', 'y');
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'y', color: '#e11d48' },
    ]);
    expect(getArrowStyle(res.code, res.config, 'm:1')).toEqual({ color: '#e11d48', dash: 'solid' });
  });

  it('shifts sibling occurrences when the edited arrow leaves a duplicated label group', () => {
    const code = withArrows(
      '{"from":"A","to":"B","label":"x","color":"#2563eb"},{"from":"A","to":"B","label":"x","occurrence":1,"color":"#e11d48"}',
      'sequenceDiagram\n    participant A\n    participant B\n    A->>B: x\n    A->>B: x');
    // Renaming the first 'x' removes it from the group: the second 'x' drops
    // to occurrence 0 and must keep its own style.
    const res = editMessageLabel(code, parseConfig(code), 'm:0', 'y');
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'y', color: '#2563eb' },
      { from: 'A', to: 'B', label: 'x', color: '#e11d48' },
    ]);
    expect(getArrowStyle(res.code, res.config, 'm:0')?.color).toBe('#2563eb');
    expect(getArrowStyle(res.code, res.config, 'm:1')?.color).toBe('#e11d48');
  });

  it('shifts sibling occurrences when the edited arrow joins a label group ahead of a styled sibling', () => {
    const code = withArrows(
      '{"from":"A","to":"B","label":"x","color":"#e11d48"},{"from":"A","to":"B","label":"y","color":"#2563eb"}',
      'sequenceDiagram\n    participant A\n    participant B\n    A->>B: x\n    A->>B: y');
    // Renaming the first arrow to 'y' inserts it ahead of the styled 'y': the
    // edited arrow takes occurrence 0 and the sibling shifts to occurrence 1.
    const res = editMessageLabel(code, parseConfig(code), 'm:0', 'y');
    expect(res.config?.arrows).toEqual([
      { from: 'A', to: 'B', label: 'y', color: '#e11d48' },
      { from: 'A', to: 'B', label: 'y', occurrence: 1, color: '#2563eb' },
    ]);
    expect(getArrowStyle(res.code, res.config, 'm:0')?.color).toBe('#e11d48');
    expect(getArrowStyle(res.code, res.config, 'm:1')?.color).toBe('#2563eb');
  });

  it('re-keys the entry to the label-less form when the label is cleared', () => {
    const code = withArrows('{"from":"A","to":"B","label":"Hello","color":"#e11d48"}', SEQ_BODY);
    const res = editMessageLabel(code, parseConfig(code), 'm:0', '');
    expect(res.code).toContain('    A->>B');
    expect(res.config?.arrows).toEqual([{ from: 'A', to: 'B', color: '#e11d48' }]);
    expect(getArrowStyle(res.code, res.config, 'm:0')).toEqual({ color: '#e11d48', dash: 'solid' });
  });

  it('keeps a flowchart edge color when its label changes', () => {
    const code = withArrows('{"from":"A","to":"B","label":"Hi","color":"#e11d48"}',
      'flowchart TD\n    A -->|Hi| B');
    const res = editMessageLabel(code, parseConfig(code), 'e:0', 'Yo');
    expect(res.code).toContain('    A -->|Yo| B');
    expect(res.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Yo', color: '#e11d48' }]);
    expect(getArrowStyle(res.code, res.config, 'e:0')).toEqual({ color: '#e11d48', dash: 'solid' });
  });

  it('leaves the CONFIG untouched when the edited arrow has no entry', () => {
    const code = withArrows('{"from":"A","to":"B","label":"other","color":"#e11d48"}', SEQ_BODY);
    const cfg = parseConfig(code);
    const res = editMessageLabel(code, cfg, 'm:0', 'Hey');
    expect(res.config).toBe(cfg);
    expect(res.code.split('\n')[0]).toBe(code.split('\n')[0]);
  });

  it('is a config no-op when the label text is unchanged', () => {
    const code = withArrows('{"from":"A","to":"B","label":"Hello","color":"#e11d48"}', SEQ_BODY);
    const cfg = parseConfig(code);
    const res = editMessageLabel(code, cfg, 'm:0', 'Hello');
    expect(res.config).toBe(cfg);
    expect(res.code.split('\n')[0]).toBe(code.split('\n')[0]);
  });

  it('adds no CONFIG line when there is no config', () => {
    const code = 'sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hello';
    const res = editMessageLabel(code, null, 'm:0', 'Hey');
    expect(res.config).toBeNull();
    expect(res.code).toBe('sequenceDiagram\n    participant A\n    participant B\n    A->>B: Hey');
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

describe('moveEdgeEndpoint', () => {
  // FLOW: A[Alice] --> B[Bob]  (e:0, line 2)
  //       B -->|Reply| A       (e:1, line 3)
  //       A -- ping -- B       (e:2, line 4)
  //       C[Standalone]        (n:2, line 5)

  it('retargets the head (target node), preserving operator, label and spacing', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    // B's first (shaped) declaration lived on the retargeted endpoint, so it
    // is preserved as a standalone line — B keeps its label and stays visible.
    expect(res.code).toBe(`%% CONFIG: {"version":1}
flowchart TD
    A[Alice] --> C
    B[Bob]
    B -->|Reply| A
    A -- ping -- B
    C[Standalone]`);
    expect(res.newKey).toBe('e:0');
  });

  it('retargets the tail (origin node)', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'from', 'n:2');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`%% CONFIG: {"version":1}
flowchart TD
    C --> B[Bob]
    A[Alice]
    B -->|Reply| A
    A -- ping -- B
    C[Standalone]`);
  });

  it('retargets the head of a labeled (pipe) edge, keeping the label', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:1', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(FLOW, res.code, 3, '    B -->|Reply| C');
  });

  it('retargets the head of an open-text edge, keeping the label', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:2', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(FLOW, res.code, 4, '    A -- ping -- C');
  });

  it('retargets the tail of an open-text edge', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:2', 'from', 'n:2');
    expect(res.warning).toBeUndefined();
    expectOnlyLineChanged(FLOW, res.code, 4, '    C -- ping -- B');
  });

  it('preserves unusual whitespace around the endpoints', () => {
    const code = `flowchart TD\n    A  -->  B`;
    const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:0');
    expect(res.warning).toBeUndefined();
    // B's only declaration was the retargeted endpoint: preserved standalone.
    expect(res.code).toBe(`flowchart TD\n    A  -->  A\n    B`);
  });

  it('is a no-op when the target is the node already at that end', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'n:1');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(FLOW);
    const res2 = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'from', 'n:0');
    expect(res2.warning).toBeUndefined();
    expect(res2.code).toBe(FLOW);
  });

  it('retargets the head onto the origin node, making a self-loop', () => {
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'n:0');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`%% CONFIG: {"version":1}
flowchart TD
    A[Alice] --> A
    B[Bob]
    B -->|Reply| A
    A -- ping -- B
    C[Standalone]`);
  });

  it('retargets a self-loop head into a regular edge', () => {
    const code = `flowchart TD\n    A --> A\n    B[Bob]`;
    const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:1');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A --> B\n    B[Bob]`);
  });

  it('keeps the replaced node visible with its label when its only declaration was the retargeted endpoint', () => {
    const code = `flowchart TD\n    A --> B[Bob]\n    C[Charlie]`;
    const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A --> C\n    B[Bob]\n    C[Charlie]`);
    // B survives as a node with its label.
    const b = parseModel(res.code).elements.find(e => e.kind === 'node' && (e as { id: string }).id === 'B');
    expect(b).toMatchObject({ kind: 'node', label: 'Bob' });
  });

  it('keeps a bare replaced node visible when it has no other declaration', () => {
    const code = `flowchart TD\n    A --> B\n    C[Charlie]`;
    const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A --> C\n    B\n    C[Charlie]`);
  });

  it('does not duplicate the declaration when the replaced node is still on the rewritten line', () => {
    const code = `flowchart TD\n    A --> B --> A\n    C[Charlie]`;
    // Retarget the head of A --> B (the middle endpoint) onto C: the chain
    // splits, B keeps its declaration on the right half.
    const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    A --> C\n    B --> A\n    C[Charlie]`);
  });

  describe('chained edges (A --> B --> C)', () => {
    const CHAIN = `flowchart TD\n    A --> B --> C\n    D[Dave]`;
    // edges: e:0 A->B (segment 0), e:1 B->C (segment 1); nodes n:0..n:3

    it('splits the chain when the head of the first link is retargeted, keeping the second link intact', () => {
      const res = moveEdgeEndpoint(CHAIN, null, 'e:0', 'to', 'n:3');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A --> D\n    B --> C\n    D[Dave]`);
      expect(res.newKey).toBe('e:0');
      // The second link is untouched: still B -> C.
      const edges = parseModel(res.code).elements.filter(e => e.kind === 'edge');
      expect(edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->D', 'B->C']);
    });

    it('splits the chain when the tail of the second link is retargeted, keeping the first link intact', () => {
      const res = moveEdgeEndpoint(CHAIN, null, 'e:1', 'from', 'n:3');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A --> B\n    D --> C\n    D[Dave]`);
      expect(res.newKey).toBe('e:1');
      const edges = parseModel(res.code).elements.filter(e => e.kind === 'edge');
      expect(edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->B', 'D->C']);
    });

    it('replaces the last endpoint in place (no split), preserving the replaced node declaration', () => {
      const res = moveEdgeEndpoint(CHAIN, null, 'e:1', 'to', 'n:3');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A --> B --> D\n    C\n    D[Dave]`);
      expect(res.newKey).toBe('e:1');
    });

    it('replaces the first endpoint in place (no split), preserving the replaced node declaration', () => {
      const res = moveEdgeEndpoint(CHAIN, null, 'e:0', 'from', 'n:3');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    D --> B --> C\n    A\n    D[Dave]`);
      expect(res.newKey).toBe('e:0');
    });

    it('splits a three-link chain at the middle link head, preserving both neighbours', () => {
      const code = `flowchart TD\n    A --> B --> C --> E\n    D[Dave]`;
      // edges: e:0 A->B, e:1 B->C, e:2 C->E; retarget e:1's head (C) onto D
      const res = moveEdgeEndpoint(code, null, 'e:1', 'to', 'n:4');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A --> B --> D\n    C --> E\n    D[Dave]`);
      const edges = parseModel(res.code).elements.filter(e => e.kind === 'edge');
      expect(edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->B', 'B->D', 'C->E']);
    });

    it('splits a three-link chain at the middle link tail, preserving both neighbours', () => {
      const code = `flowchart TD\n    A --> B --> C --> E\n    D[Dave]`;
      // retarget e:1's tail (B) onto D
      const res = moveEdgeEndpoint(code, null, 'e:1', 'from', 'n:4');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A --> B\n    D --> C --> E\n    D[Dave]`);
      const edges = parseModel(res.code).elements.filter(e => e.kind === 'edge');
      expect(edges.map(e => `${e.from}->${e.to}`)).toEqual(['A->B', 'D->C', 'C->E']);
    });

    it('preserves shapes and labels on the untouched side of a split', () => {
      const code = `flowchart TD\n    A["x"] --> B["y"] --> C["z"]\n    D[Dave]`;
      const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:3');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A["x"] --> D\n    B["y"] --> C["z"]\n    D[Dave]`);
    });

    it('preserves a pipe label on the retargeted link of a split', () => {
      const code = `flowchart TD\n    A -->|go| B --> C\n    D[Dave]`;
      const res = moveEdgeEndpoint(code, null, 'e:0', 'to', 'n:3');
      expect(res.warning).toBeUndefined();
      expect(res.code).toBe(`flowchart TD\n    A -->|go| D\n    B --> C\n    D[Dave]`);
    });
  });

  it('moves the arrow CONFIG entry (style, tags, mode) to the new endpoint', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"go","color":"#e11d48","keys":["backend"],"keyMode":"clean"}]}
flowchart TD
    A -->|go| B
    B --> C
    D[Dave]`;
    const res = moveEdgeEndpoint(code, parseConfig(code), 'e:0', 'to', 'n:3');
    expect(res.warning).toBeUndefined();
    expect(res.code).toContain('    A -->|go| D');
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'A', to: 'D', label: 'go', color: '#e11d48', keys: ['backend'], keyMode: 'clean' },
    ]);
  });

  it('moves the arrow CONFIG entry to the new origin when the tail is dragged', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","color":"#e11d48"}]}
flowchart TD
    A --> B
    D[Dave]`;
    const res = moveEdgeEndpoint(code, parseConfig(code), 'e:0', 'from', 'n:2');
    expect(res.warning).toBeUndefined();
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'D', to: 'B', color: '#e11d48' },
    ]);
  });

  it('leaves unrelated arrows entries untouched', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","color":"#e11d48"},{"from":"B","to":"A","color":"#22c55e"}]}
flowchart TD
    A --> B
    B --> A
    D[Dave]`;
    const res = moveEdgeEndpoint(code, parseConfig(code), 'e:0', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    expect(parseConfig(res.code)?.arrows).toEqual([
      { from: 'A', to: 'D', color: '#e11d48' },
      { from: 'B', to: 'A', color: '#22c55e' },
    ]);
  });

  it('preserves the CONFIG block and every other line byte-for-byte', () => {
    // FLOW: e:0 is on line 2; that line is rewritten and B's preserved
    // declaration lands right after it — everything else is byte-identical.
    const res = moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'n:2');
    expect(res.warning).toBeUndefined();
    const lines = res.code.split('\n');
    expect(lines[0]).toBe(FLOW.split('\n')[0]);
    expect(lines[1]).toBe('flowchart TD');
    expect(lines[2]).toBe('    A[Alice] --> C');
    expect(lines[3]).toBe('    B[Bob]');
    expect(lines.slice(4)).toEqual(FLOW.split('\n').slice(3));
  });

  it('soft-fails on sequence diagrams, non-edges, unknown keys and non-node targets', () => {
    const seq = moveEdgeEndpoint(SEQ, SEQ_CFG, 'm:0', 'to', 'p:1');
    expect(seq.warning).toBeTruthy();
    expect(seq.code).toBe(SEQ);
    expect(moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:99', 'to', 'n:1').warning).toBeTruthy();
    expect(moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:99', 'to', 'n:1').code).toBe(FLOW);
    expect(moveEdgeEndpoint(FLOW, FLOW_CFG, 'n:0', 'to', 'n:1').warning).toBeTruthy();
    expect(moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'n:99').warning).toBeTruthy();
    expect(moveEdgeEndpoint(FLOW, FLOW_CFG, 'e:0', 'to', 'e:1').warning).toBeTruthy();
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

describe('sequence notes (addSequenceNote / editNoteText / setNotePlacement / setNoteSpan)', () => {
  // Lines: 0 sequenceDiagram, 1 participant A, 2 participant B, 3 A->>B: Hello,
  // 4 activate B, 5 B-->>A: Hi, 6 Note over A,B: greeting
  const NOTE_EDIT_SEQ = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    activate B
    B-->>A: Hi
    Note over A,B: greeting`;
  const NOTE_EDIT_CFG = parseConfig(NOTE_EDIT_SEQ);

  describe('addSequenceNote', () => {
    it('creates a note over the first participant after the last message/note', () => {
      const res = addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG);
      expect(res.warning).toBeUndefined();
      expect(res.code.split('\n')).toEqual([
        ...NOTE_EDIT_SEQ.split('\n'),
        '    Note over A: New note',
      ]);
      expect(res.newKey).toBe('note:1');
      expect(parseModel(res.code).elements.find(e => e.key === 'note:1'))
        .toMatchObject({ kind: 'note', placement: 'over', over: ['A'], text: 'New note', lineStart: 7, lineEnd: 7 });
    });

    it('honours overKey (a participant key)', () => {
      const res = addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, { overKey: 'p:1' });
      expect(res.code).toContain('    Note over B: New note');
    });

    it('honours afterKey: the note lands directly after that element', () => {
      const res = addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, { afterKey: 'm:1' });
      const lines = res.code.split('\n');
      expect(lines[5]).toBe('    B-->>A: Hi');
      expect(lines[6]).toBe('    Note over A: New note');
      expect(lines[7]).toBe('    Note over A,B: greeting');
      // the new note sorts before the existing one, so it takes key note:0
      expect(res.newKey).toBe('note:0');
      const created = parseModel(res.code).elements.find(e => e.key === 'note:0');
      expect(created).toMatchObject({ kind: 'note', text: 'New note', lineStart: 6, lineEnd: 6 });
    });

    it('hops over activate/deactivate companion lines of the anchor message (N9)', () => {
      const res = addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, { afterKey: 'm:0' });
      const lines = res.code.split('\n');
      expect(lines[3]).toBe('    A->>B: Hello');
      expect(lines[4]).toBe('    activate B');
      expect(lines[5]).toBe('    Note over A: New note');
      expect(lines[6]).toBe('    B-->>A: Hi');
    });

    it('falls back to the first implicit actor when there are no participants (N10)', () => {
      const code = `sequenceDiagram
    A->>B: Hello
    B-->>A: Hi`;
      const res = addSequenceNote(code, null);
      expect(res.warning).toBeUndefined();
      expect(res.code.split('\n')[3]).toBe('    Note over A: New note');
      expect(res.newKey).toBe('note:0');
    });

    it('refuses with a warning when there are no actors at all (N11)', () => {
      const code = `sequenceDiagram
    autonumber`;
      const res = addSequenceNote(code, null);
      expect(res.code).toBe(code);
      expect(res.warning).toBe('Add a participant first');
    });

    it('soft-fails on flowcharts and unknown keys', () => {
      expect(addSequenceNote(FLOW, FLOW_CFG).warning).toBeTruthy();
      expect(addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, { overKey: 'm:0' }).warning).toBeTruthy();
      expect(addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, { overKey: 'nope' }).warning).toBeTruthy();
      expect(addSequenceNote(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, { afterKey: 'nope' }).warning).toBeTruthy();
    });
  });

  describe('editNoteText', () => {
    it('rewrites only the text span, byte-preserving the rest (N1/N3)', () => {
      const res = editNoteText(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'Contains: colon #hash');
      expect(res.warning).toBeUndefined();
      expectOnlyLineChanged(NOTE_EDIT_SEQ, res.code, 6, '    Note over A,B: Contains: colon #hash');
    });

    it('allows empty text and drops the space after the colon', () => {
      const res = editNoteText(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', '');
      expectOnlyLineChanged(NOTE_EDIT_SEQ, res.code, 6, '    Note over A,B:');
    });

    it('preserves unusual spacing around the colon', () => {
      const code = `sequenceDiagram
    participant A
      Note  over  A : spaced`;
      const res = editNoteText(code, null, 'note:0', 'new');
      expectOnlyLineChanged(code, res.code, 2, '      Note  over  A : new');
    });

    it('refuses newlines (N2) and non-note keys', () => {
      expect(editNoteText(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'a\nb').warning).toBeTruthy();
      expect(editNoteText(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'a\nb').code).toBe(NOTE_EDIT_SEQ);
      expect(editNoteText(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'm:0', 'x').warning).toBeTruthy();
      expect(editNoteText(FLOW, FLOW_CFG, 'note:0', 'x').warning).toBeTruthy();
    });

    it('is a no-op when the text is unchanged', () => {
      const res = editNoteText(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'greeting');
      expect(res.code).toBe(NOTE_EDIT_SEQ);
      expect(res.config).toBe(NOTE_EDIT_CFG);
    });
  });

  describe('setNotePlacement', () => {
    it('switches over -> left of on a single-actor note', () => {
      const code = `sequenceDiagram
    participant A
    participant B
    Note over A: solo`;
      const res = setNotePlacement(code, null, 'note:0', 'left of');
      expect(res.warning).toBeUndefined();
      expectOnlyLineChanged(code, res.code, 3, '    Note left of A: solo');
      expect(parseModel(res.code).elements.find(e => e.kind === 'note')).toMatchObject({ placement: 'left of' });
    });

    it('refuses left of / right of on a multi-actor span (N4)', () => {
      const res = setNotePlacement(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'right of');
      expect(res.code).toBe(NOTE_EDIT_SEQ);
      expect(res.warning).toBeTruthy();
    });

    it('refuses invalid placements and non-note keys', () => {
      expect(setNotePlacement(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'beside' as never).warning).toBeTruthy();
      expect(setNotePlacement(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'p:0', 'over').warning).toBeTruthy();
    });

    it('is a no-op when the placement is unchanged', () => {
      const res = setNotePlacement(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'over');
      expect(res.code).toBe(NOTE_EDIT_SEQ);
    });
  });

  describe('setNoteSpan', () => {
    it('rewrites the id list, dedupes and keeps order (N13)', () => {
      const res = setNoteSpan(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', ['B', 'A', 'B']);
      expect(res.warning).toBeUndefined();
      expectOnlyLineChanged(NOTE_EDIT_SEQ, res.code, 6, '    Note over B,A: greeting');
    });

    it('refuses empty spans and unknown ids (N5)', () => {
      expect(setNoteSpan(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', []).warning).toBeTruthy();
      const res = setNoteSpan(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', ['A', 'Z']);
      expect(res.code).toBe(NOTE_EDIT_SEQ);
      expect(res.warning).toBeTruthy();
    });

    it('allows implicit actors (message endpoints) in the span (N6)', () => {
      const code = `sequenceDiagram
    A->>B: Hello
    Note over A: x`;
      const res = setNoteSpan(code, null, 'note:0', ['A', 'B']);
      expect(res.warning).toBeUndefined();
      expectOnlyLineChanged(code, res.code, 2, '    Note over A,B: x');
    });

    it('refuses a multi-actor span on a left of note (N4)', () => {
      const code = `sequenceDiagram
    participant A
    participant B
    Note left of A: x`;
      const res = setNoteSpan(code, null, 'note:0', ['A', 'B']);
      expect(res.code).toBe(code);
      expect(res.warning).toBeTruthy();
    });

    it('is a no-op when the span is unchanged', () => {
      const res = setNoteSpan(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', ['A', 'B']);
      expect(res.code).toBe(NOTE_EDIT_SEQ);
    });
  });

  describe('CONFIG noteTags retargeting (R-04, N7/N8)', () => {
    it('a tagged note keeps its keys through text, placement and span edits (N7)', () => {
      const tagged = addTag(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'k1');
      expect(tagged.config?.noteTags).toEqual([{ over: ['A', 'B'], text: 'greeting', keys: ['k1'] }]);

      const edited = editNoteText(tagged.code, tagged.config, 'note:0', 'renamed');
      expect(edited.config?.noteTags).toEqual([{ over: ['A', 'B'], text: 'renamed', keys: ['k1'] }]);
      expect(parseConfig(edited.code)?.noteTags).toEqual([{ over: ['A', 'B'], text: 'renamed', keys: ['k1'] }]);
      expect(getNoteTags(edited.code, edited.config, 'note:0')).toEqual(['k1']);

      const respanned = setNoteSpan(edited.code, edited.config, 'note:0', ['A']);
      expect(respanned.config?.noteTags).toEqual([{ over: ['A'], text: 'renamed', keys: ['k1'] }]);

      // single-actor note keeps working through a placement edit
      const placed = setNotePlacement(respanned.code, respanned.config, 'note:0', 'left of');
      expect(placed.config?.noteTags).toEqual([{ over: ['A'], text: 'renamed', keys: ['k1'] }]);
      expect(getNoteTags(placed.code, placed.config, 'note:0')).toEqual(['k1']);
    });

    it('a duplicate-note tag follows the edited note, not its twin (N8)', () => {
      const code = `sequenceDiagram
    participant A
    Note over A: Same
    Note over A: Same`;
      const cfg = parseConfig(code);
      const taggedFirst = addTag(code, cfg, 'note:0', 'first');
      const taggedBoth = addTag(taggedFirst.code, taggedFirst.config, 'note:1', 'second');
      expect(taggedBoth.config?.noteTags).toEqual([
        { over: ['A'], text: 'Same', keys: ['first'] },
        { over: ['A'], text: 'Same', occurrence: 1, keys: ['second'] },
      ]);
      // edit the SECOND note's text: its entry (occurrence 1) follows it and
      // drops to occurrence 0 in the new (over, text) group
      const edited = editNoteText(taggedBoth.code, taggedBoth.config, 'note:1', 'Changed');
      expect(edited.config?.noteTags).toEqual([
        { over: ['A'], text: 'Same', keys: ['first'] },
        { over: ['A'], text: 'Changed', keys: ['second'] },
      ]);
      expect(getNoteTags(edited.code, edited.config, 'note:0')).toEqual(['first']);
      expect(getNoteTags(edited.code, edited.config, 'note:1')).toEqual(['second']);
    });

    it('a tag survives a span edit that changes the occurrence group', () => {
      const code = `sequenceDiagram
    participant A
    participant B
    Note over A: Same
    Note over A,B: Same`;
      const tagged = addTag(code, null, 'note:0', 'k1');
      expect(tagged.config?.noteTags).toEqual([{ over: ['A'], text: 'Same', keys: ['k1'] }]);
      // span note:0 to A,B: it joins the other note's (over, text) group —
      // as occurrence 0, because it still sorts first in source order
      const respanned = setNoteSpan(tagged.code, tagged.config, 'note:0', ['A', 'B']);
      expect(respanned.config?.noteTags).toEqual([{ over: ['A', 'B'], text: 'Same', keys: ['k1'] }]);
      expect(getNoteTags(respanned.code, respanned.config, 'note:0')).toEqual(['k1']);
      expect(getNoteTags(respanned.code, respanned.config, 'note:1')).toEqual([]);
    });

    it('deleting a note drops its tag entry (deleteElement path, R-03)', () => {
      const tagged = addTag(NOTE_EDIT_SEQ, NOTE_EDIT_CFG, 'note:0', 'k1');
      const del = deleteElement(tagged.code, tagged.config, 'note:0');
      expect(del.warning).toBeUndefined();
      expect(del.config?.noteTags).toBeUndefined();
      expect(del.code).not.toContain('Note over A,B: greeting');
      expect(parseConfig(del.code)).toBeNull();
    });
  });
});

describe('sequence blocks (setBlockTitle / setBlockType / unwrapBlock / deleteBlock)', () => {
  const BLOCK_SEQ = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    alt has else
        A->>B: m1
    else other
        B-->>A: m2
    end
    loop retry
        A->>B: m3
    end
    rect rgb(1,2,3)
        A->>B: r1
    end
    box red BoxOne
        participant C
    end`;
  // b:0 alt (has else) 4-8, b:1 loop 9-11, b:2 rect 12-14, b:3 box 15-17

  describe('setBlockTitle', () => {
    it('edits a labeled block title, changing only the header line', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:1', 'retry loop');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 9, '    loop retry loop');
      expect(r.config).toBeNull();
    });

    it('clears the title to a bare keyword line', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:1', '');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 9, '    loop');
    });

    it('accepts an rgb(...) title for rect and round-trips through parseModel', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:2', 'rgb(200,150,255)');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 12, '    rect rgb(200,150,255)');
      const el = parseModel(r.code).elements.find(e => e.key === 'b:2');
      expect(el).toMatchObject({ kind: 'block', blockType: 'rect', title: 'rgb(200,150,255)' });
    });

    it('clears a rect title to a bare rect line', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:2', '');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 12, '    rect');
    });

    it('refuses a non-rgb rect title (edge B10)', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:2', 'red');
      expect(r.warning).toContain('rgb(...)');
      expect(r.code).toBe(BLOCK_SEQ);
    });

    it('refuses an out-of-range rgb title', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:2', 'rgb(300,0,0)');
      expect(r.warning).toContain('rgb(...)');
      expect(r.code).toBe(BLOCK_SEQ);
    });

    it('refuses to edit a box title (color + name are encoded, edge B11)', () => {
      const r = setBlockTitle(BLOCK_SEQ, null, 'b:3', 'blue BoxOne');
      expect(r.warning).toContain('box');
      expect(r.code).toBe(BLOCK_SEQ);
    });

    it('refuses multi-line titles, unknown keys, non-blocks and flowcharts', () => {
      expect(setBlockTitle(BLOCK_SEQ, null, 'b:1', 'a\nb').warning).toContain('single line');
      expect(setBlockTitle(BLOCK_SEQ, null, 'b:99', 'x').warning).toContain('not a block');
      expect(setBlockTitle(BLOCK_SEQ, null, 'm:0', 'x').warning).toContain('not a block');
      expect(setBlockTitle(FLOW, FLOW_CFG, 'b:0', 'x').warning).toBeTruthy();
    });

    it('converts hex <-> rgb for the rect color row (edge B10)', () => {
      expect(hexToRgbColor('#c896ff')).toBe('rgb(200,150,255)');
      expect(hexToRgbColor('#010203')).toBe('rgb(1,2,3)');
      expect(hexToRgbColor('#fff')).toBeNull();
      expect(hexToRgbColor('red')).toBeNull();
      expect(rgbToHexColor('rgb(200,150,255)')).toBe('#c896ff');
      expect(rgbToHexColor('rgb(200, 150, 255)')).toBe('#c896ff');
      expect(rgbToHexColor('rgb(1,2,3)')).toBe('#010203');
      expect(rgbToHexColor('red')).toBeNull();
      expect(rgbToHexColor('rgb(300,0,0)')).toBeNull();
      expect(DEFAULT_RECT_COLOR).toBe('rgb(200,150,255)');
    });
  });

  describe('setBlockType', () => {
    it('converts between the labeled types, changing only the keyword', () => {
      const r = setBlockType(BLOCK_SEQ, null, 'b:1', 'par');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 9, '    par retry');
    });

    it('is a no-op for the same type', () => {
      const r = setBlockType(BLOCK_SEQ, null, 'b:1', 'loop');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(BLOCK_SEQ);
    });

    it('refuses conversion when the span contains else/and separators (edge B5)', () => {
      const r = setBlockType(BLOCK_SEQ, null, 'b:0', 'loop');
      expect(r.warning).toContain('else/and');
      expect(r.code).toBe(BLOCK_SEQ);
      // same-type "conversion" of an alt with else is still a no-op
      const same = setBlockType(BLOCK_SEQ, null, 'b:0', 'alt');
      expect(same.warning).toBeUndefined();
      expect(same.code).toBe(BLOCK_SEQ);
    });

    it('converting to rect supplies the default rgb title (edge W11)', () => {
      const r = setBlockType(BLOCK_SEQ, null, 'b:1', 'rect');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 9, `    rect ${DEFAULT_RECT_COLOR}`);
    });

    it('converting to rect keeps an existing rgb title', () => {
      const r = setBlockType(BLOCK_SEQ, null, 'b:2', 'alt');
      expect(r.warning).toBeUndefined();
      expectOnlyLineChanged(BLOCK_SEQ, r.code, 12, '    alt rgb(1,2,3)');
      const back = setBlockType(r.code, null, 'b:2', 'rect');
      expectOnlyLineChanged(r.code, back.code, 12, '    rect rgb(1,2,3)');
    });

    it('refuses box/subgraph as source and target (edge B11)', () => {
      expect(setBlockType(BLOCK_SEQ, null, 'b:3', 'alt').warning).toContain('box');
      expect(setBlockType(BLOCK_SEQ, null, 'b:1', 'box').warning).toContain("'box'");
      expect(setBlockType(BLOCK_SEQ, null, 'b:99', 'alt').warning).toContain('not a block');
      expect(setBlockType(FLOW, FLOW_CFG, 'b:0', 'alt').warning).toBeTruthy();
    });
  });

  describe('unwrapBlock', () => {
    it('drops header and end and de-indents the content one level', () => {
      const r = unwrapBlock(BLOCK_SEQ, null, 'b:1');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
    alt has else
        A->>B: m1
    else other
        B-->>A: m2
    end
    A->>B: m3
    rect rgb(1,2,3)
        A->>B: r1
    end
    box red BoxOne
        participant C
    end`);
    });

    it('drops else/and separator lines and warns about them (edge B6)', () => {
      const r = unwrapBlock(BLOCK_SEQ, null, 'b:0');
      expect(r.warning).toBe('1 separator line removed');
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
    A->>B: m1
    B-->>A: m2
    loop retry
        A->>B: m3
    end
    rect rgb(1,2,3)
        A->>B: r1
    end
    box red BoxOne
        participant C
    end`);
    });

    it('de-indents only lines that start with headerIndent + 4 spaces (edge B7)', () => {
      const hand = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
alt weird
      A->>B: deep
  A->>B: shallow
end
    A->>B: after`;
      const r = unwrapBlock(hand, null, 'b:0');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
  A->>B: deep
  A->>B: shallow
    A->>B: after`);
    });

    it('leaves blank lines byte-identical while unwrapping', () => {
      const withBlank = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    loop blank
        A->>B: m1

        A->>B: m2
    end`;
      const r = unwrapBlock(withBlank, null, 'b:0');
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
    A->>B: m1

    A->>B: m2`);
    });

    it('unwraps the outer block of a nested pair and keeps the inner one intact', () => {
      const nested = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    alt outer
        A->>B: m1
        loop inner
            A->>B: m2
        end
    end`;
      const r = unwrapBlock(nested, null, 'b:0');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
    A->>B: m1
    loop inner
        A->>B: m2
    end`);
      // the inner block still parses at its new span
      const inner = parseModel(r.code).elements.find(e => e.kind === 'block' && e.blockType === 'loop');
      expect(inner).toMatchObject({ title: 'inner', lineStart: 5, lineEnd: 7 });
    });

    it('unwraps an unclosed block by dropping only the header (edge B8)', () => {
      const unclosed = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    loop never closed
        A->>B: m1`;
      const r = unwrapBlock(unclosed, null, 'b:0');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
        A->>B: m1`);
    });

    it('refuses unknown keys, non-blocks and flowcharts', () => {
      expect(unwrapBlock(BLOCK_SEQ, null, 'b:99').warning).toContain('not a block');
      expect(unwrapBlock(BLOCK_SEQ, null, 'm:0').warning).toContain('not a block');
      expect(unwrapBlock(FLOW, FLOW_CFG, 'b:0').warning).toBeTruthy();
    });
  });

  describe('deleteBlock', () => {
    it('drops the span, cascades contained messages/notes and prunes CONFIG (edge B9)', () => {
      const tagged = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"m1","keys":["k1"]},{"from":"A","to":"B","label":"m3","color":"red"}],"noteTags":[{"over":["A","B"],"text":"note inside","keys":["k2"]}]}
sequenceDiagram
    participant A
    participant B
    A->>B: m0
    loop del me
        A->>B: m1
        Note over A,B: note inside
        A->>B: m3
    end
    A->>B: after`;
      const r = deleteBlock(tagged, parseConfig(tagged), 'b:0', { withContent: true });
      expect(r.warning).toBeUndefined();
      expect(r.cascaded).toEqual(['m:1', 'note:0', 'm:2']);
      // every CONFIG entry was pruned, so the CONFIG line itself is dropped
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0
    A->>B: after`);
      expect(r.config?.arrows).toBeUndefined();
      expect(r.config?.noteTags).toBeUndefined();
      expect(parseConfig(r.code)).toBeNull();
    });

    it('does not renumber occurrences of surviving CONFIG entries (edge B9)', () => {
      const dup = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","label":"dup","occurrence":2,"keys":["keep"]}]}
sequenceDiagram
    participant A
    participant B
    A->>B: dup
    loop del me
        A->>B: dup
    end
    A->>B: dup`;
      const r = deleteBlock(dup, parseConfig(dup), 'b:0', { withContent: true });
      expect(r.warning).toBeUndefined();
      expect(r.cascaded).toEqual(['m:1']);
      // the surviving entry still points at occurrence 2 (not renumbered to 1)
      expect(r.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'dup', occurrence: 2, keys: ['keep'] }]);
      expect(r.code).toContain('A->>B: dup');
      expect(r.code.split('A->>B: dup')).toHaveLength(3);  // two surviving copies
    });

    it('drops participants declared inside the span and prunes their actor entries', () => {
      const boxed = `%% CONFIG: {"version":1,"actors":{"C":{"color":"red"}}}
sequenceDiagram
    participant A
    box red BoxOne
        participant C
    end
    A->>B: m0`;
      const r = deleteBlock(boxed, parseConfig(boxed), 'b:0', { withContent: true });
      expect(r.warning).toBeUndefined();
      expect(r.cascaded).toEqual([]);
      // the actor entry was pruned, so the CONFIG line itself is dropped
      expect(r.code).toBe(`sequenceDiagram
    participant A
    A->>B: m0`);
      expect(r.config?.actors).toBeUndefined();
      expect(parseConfig(r.code)).toBeNull();
    });

    it('deletes an unclosed block through EOF (edge B8)', () => {
      const unclosed = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    loop never closed
        A->>B: m1`;
      const r = deleteBlock(unclosed, null, 'b:0', { withContent: true });
      expect(r.warning).toBeUndefined();
      expect(r.cascaded).toEqual(['m:1']);
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: m0`);
    });

    it('withContent: false unwraps instead', () => {
      const r = deleteBlock(BLOCK_SEQ, null, 'b:1', { withContent: false });
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(unwrapBlock(BLOCK_SEQ, null, 'b:1').code);
    });

    it('refuses unknown keys, non-blocks and flowcharts', () => {
      expect(deleteBlock(BLOCK_SEQ, null, 'b:99').warning).toContain('not a block');
      expect(deleteBlock(BLOCK_SEQ, null, 'm:0').warning).toContain('not a block');
      expect(deleteBlock(FLOW, FLOW_CFG, 'b:0').warning).toBeTruthy();
    });
  });
});

describe('wrapInBlock / wrapInRegion (canWrapSelection)', () => {
  const WRAP_SEQ = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    A->>B: m1

    %% a comment
    B-->>A: m2
    A->>B: m3`;
  // lines: 0 sequenceDiagram, 1 p:0, 2 p:1, 3 m:0, 4 m:1, 5 blank, 6 comment,
  //        7 m:2, 8 m:3

  const WRAP_BLOCK_SEQ = `sequenceDiagram
    participant A
    participant B
    A->>B: before
    alt cond
        A->>B: arm1
    else other
        B-->>A: arm2
    end
    loop retry
        A->>B: in1
        A->>B: in2
    end
    A->>B: after`;
  // lines: 0 seq, 1 p:0, 2 p:1, 3 m:0, 4 b:0 alt(4-8), 5 m:1, 6 else, 7 m:2,
  //        8 end, 9 b:1 loop(9-12), 10 m:3, 11 m:4, 12 end, 13 m:5

  const WRAP_COMPANION_SEQ = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    activate B
    A->>B: m1
    deactivate B
    A->>B: m2`;
  // lines: 3 m:0, 4 activate (companion of m:0), 5 m:1, 6 deactivate
  //        (companion of m:1), 7 m:2

  const WRAP_REGION_SEQ = `sequenceDiagram
    participant A
    participant B
    %% @region-start: existing
    A->>B: m0
    A->>B: m1
    %% @region-end
    A->>B: m2`;
  // lines: 3 r:0, 4 m:0, 5 m:1, 6 region-end comment, 7 m:2

  const WRAP_REGION_START_SEQ = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    %% @region-start: inner
    A->>B: m1`;
  // lines: 3 m:0, 4 r:0, 5 m:1

  const WRAP_CFG_SEQ = `%% CONFIG: {"version":1}
sequenceDiagram
    participant A
    participant B
    A->>B: m0
    A->>B: m1`;
  // lines: 0 c:0, 1 sequenceDiagram, 2 p:0, 3 p:1, 4 m:0, 5 m:1

  const WRAP_NOTE_SEQ = `sequenceDiagram
    participant A
    participant B
    A->>B: m0
    Note over A: hello
    A->>B: m1`;
  // lines: 3 m:0, 4 note:0, 5 m:1

  describe('canWrapSelection', () => {
    it('accepts a contiguous selection in both modes', () => {
      const model = parseModel(WRAP_SEQ);
      expect(canWrapSelection(WRAP_SEQ, model, ['m:0', 'm:1'], 'block')).toEqual({ ok: true });
      expect(canWrapSelection(WRAP_SEQ, model, ['m:0', 'm:1'], 'region')).toEqual({ ok: true });
    });

    it('accepts a span containing blank lines and %% comments (W1)', () => {
      const model = parseModel(WRAP_SEQ);
      // span 3..8: the blank line and the %% comment sit between selected
      // messages and are fine; every message inside is selected
      const keys = ['m:0', 'm:1', 'm:2', 'm:3'];
      expect(canWrapSelection(WRAP_SEQ, model, keys, 'block')).toEqual({ ok: true });
      expect(canWrapSelection(WRAP_SEQ, model, keys, 'region')).toEqual({ ok: true });
    });

    it('accepts a message+note selection (both wrappable kinds, W4)', () => {
      const model = parseModel(WRAP_NOTE_SEQ);
      expect(canWrapSelection(WRAP_NOTE_SEQ, model, ['m:0', 'note:0'], 'block')).toEqual({ ok: true });
    });

    it('refuses a non-contiguous selection (W1)', () => {
      const model = parseModel(WRAP_SEQ);
      const r = canWrapSelection(WRAP_SEQ, model, ['m:0', 'm:2'], 'block');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('contiguous');
      const rRegion = canWrapSelection(WRAP_SEQ, model, ['m:0', 'm:2'], 'region');
      expect(rRegion.ok).toBe(false);
    });

    it('refuses mixed-kind selections and unknown keys (W4)', () => {
      const model = parseModel(WRAP_SEQ);
      const mixed = canWrapSelection(WRAP_SEQ, model, ['p:0', 'm:0', 'm:1'], 'block');
      expect(mixed.ok).toBe(false);
      if (!mixed.ok) expect(mixed.reason).toContain('Only messages and notes');
      const unknown = canWrapSelection(WRAP_SEQ, model, ['m:0', 'm:99'], 'block');
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.reason).toContain('Unknown element key');
    });

    it('requires at least two distinct keys', () => {
      const model = parseModel(WRAP_SEQ);
      expect(canWrapSelection(WRAP_SEQ, model, ['m:0'], 'block').ok).toBe(false);
      expect(canWrapSelection(WRAP_SEQ, model, [], 'block').ok).toBe(false);
      expect(canWrapSelection(WRAP_SEQ, model, ['m:0', 'm:0'], 'block').ok).toBe(false);
    });

    it('is order-insensitive (W5)', () => {
      const model = parseModel(WRAP_SEQ);
      expect(canWrapSelection(WRAP_SEQ, model, ['m:1', 'm:0'], 'block')).toEqual({ ok: true });
    });

    it('refuses messages in two alt arms (W2, else separator)', () => {
      const model = parseModel(WRAP_BLOCK_SEQ);
      const r = canWrapSelection(WRAP_BLOCK_SEQ, model, ['m:1', 'm:2'], 'block');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('else');
    });

    it('refuses a span crossing into or out of a block (W2)', () => {
      const model = parseModel(WRAP_BLOCK_SEQ);
      // before the block vs inside the alt: the alt header sits inside the span
      const into = canWrapSelection(WRAP_BLOCK_SEQ, model, ['m:0', 'm:1'], 'block');
      expect(into.ok).toBe(false);
      if (!into.ok) expect(into.reason).toContain('block header');
      // inside the alt vs inside the loop: the end + loop header sit inside
      const across = canWrapSelection(WRAP_BLOCK_SEQ, model, ['m:2', 'm:3'], 'block');
      expect(across.ok).toBe(false);
      if (!across.ok) expect(across.reason).toContain('block end');
    });

    it('allows wrapping fully inside a single block arm (W2 depth check)', () => {
      const model = parseModel(WRAP_BLOCK_SEQ);
      expect(canWrapSelection(WRAP_BLOCK_SEQ, model, ['m:3', 'm:4'], 'block')).toEqual({ ok: true });
    });

    it('absorbs trailing activate/deactivate companion lines into the span (W3)', () => {
      const model = parseModel(WRAP_COMPANION_SEQ);
      expect(canWrapSelection(WRAP_COMPANION_SEQ, model, ['m:0', 'm:1'], 'block')).toEqual({ ok: true });
      expect(canWrapSelection(WRAP_COMPANION_SEQ, model, ['m:0', 'm:1'], 'region')).toEqual({ ok: true });
    });

    it('refuses a region wrap spanning an existing %% @region-end line (W9)', () => {
      const model = parseModel(WRAP_REGION_SEQ);
      const r = canWrapSelection(WRAP_REGION_SEQ, model, ['m:0', 'm:1', 'm:2'], 'region');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('@region-end');
    });

    it('refuses a region wrap containing a %% @region-start line (W9, via W1 contiguity)', () => {
      const model = parseModel(WRAP_REGION_START_SEQ);
      // the region-start line is a model element inside the span; contiguity
      // (checked first) refuses before the region-tag scan runs
      const r = canWrapSelection(WRAP_REGION_START_SEQ, model, ['m:0', 'm:1'], 'region');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('contiguous');
    });

    it('refuses a block wrap across a region tag (W1 contiguity)', () => {
      const model = parseModel(WRAP_REGION_START_SEQ);
      expect(canWrapSelection(WRAP_REGION_START_SEQ, model, ['m:0', 'm:1'], 'block').ok).toBe(false);
    });

    it('allows region wraps around block structure lines (W10)', () => {
      const model = parseModel(WRAP_BLOCK_SEQ);
      // the span 5..7 contains the else separator — fine for regions
      expect(canWrapSelection(WRAP_BLOCK_SEQ, model, ['m:1', 'm:2'], 'region')).toEqual({ ok: true });
    });

    it('refuses flowcharts (sequence-only)', () => {
      const model = parseModel(FLOW);
      expect(canWrapSelection(FLOW, model, ['n:0', 'n:1'], 'block').ok).toBe(false);
      expect(canWrapSelection(FLOW, model, ['n:0', 'n:1'], 'region').ok).toBe(false);
    });
  });

  describe('wrapInBlock', () => {
    it('wraps a contiguous selection with a bare keyword header (W12)', () => {
      const r = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'alt');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    alt
        A->>B: m0
        A->>B: m1
    end

    %% a comment
    B-->>A: m2
    A->>B: m3`);
    });

    it('wraps with a title for each wrappable block type', () => {
      for (const t of ['alt', 'opt', 'loop', 'par'] as const) {
        const r = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], t, 'title');
        expect(r.warning).toBeUndefined();
        expect(r.code).toContain(`\n    ${t} title\n        A->>B: m0\n        A->>B: m1\n    end\n`);
      }
    });

    it('wraps messages and notes together', () => {
      const r = wrapInBlock(WRAP_NOTE_SEQ, null, ['m:0', 'note:0'], 'loop', 'retry');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    loop retry
        A->>B: m0
        Note over A: hello
    end
    A->>B: m1`);
    });

    it('re-indents only the span lines, blank lines untouched (NFR-02)', () => {
      const r = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1', 'm:2', 'm:3'], 'opt', 'maybe');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    opt maybe
        A->>B: m0
        A->>B: m1

        %% a comment
        B-->>A: m2
        A->>B: m3
    end`);
    });

    it('absorbs trailing companion lines into the block (W3)', () => {
      const r = wrapInBlock(WRAP_COMPANION_SEQ, null, ['m:0', 'm:1'], 'loop', 'retry');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    loop retry
        A->>B: m0
        activate B
        A->>B: m1
        deactivate B
    end
    A->>B: m2`);
    });

    it('is order-insensitive (W5)', () => {
      const a = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'loop', 'x');
      const b = wrapInBlock(WRAP_SEQ, null, ['m:1', 'm:0'], 'loop', 'x');
      expect(a.code).toBe(b.code);
      expect(a.newKey).toBe(b.newKey);
    });

    it('wraps fully inside a single block arm, nesting correctly (W2)', () => {
      const r = wrapInBlock(WRAP_BLOCK_SEQ, null, ['m:3', 'm:4'], 'opt', 'choice');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: before
    alt cond
        A->>B: arm1
    else other
        B-->>A: arm2
    end
    loop retry
        opt choice
            A->>B: in1
            A->>B: in2
        end
    end
    A->>B: after`);
    });

    it('returns the new block key (newKey) at the header line', () => {
      const r = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'loop', 'retry');
      expect(r.newKey).toBe('b:0');
      const el = parseModel(r.code).elements.find(e => e.key === r.newKey);
      expect(el).toMatchObject({ kind: 'block', blockType: 'loop', title: 'retry', lineStart: 3, lineEnd: 6 });
      // with existing blocks the new key continues the sequence
      const r2 = wrapInBlock(WRAP_BLOCK_SEQ, null, ['m:3', 'm:4'], 'opt');
      expect(r2.newKey).toBe('b:2');
      const el2 = parseModel(r2.code).elements.find(e => e.key === 'b:2');
      expect(el2).toMatchObject({ kind: 'block', blockType: 'opt', lineStart: 10, lineEnd: 13 });
    });

    it('rect defaults to the default color and validates rgb(...) titles (W11)', () => {
      const def = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'rect');
      expect(def.warning).toBeUndefined();
      expect(def.code).toContain('\n    rect rgb(200,150,255)\n');
      const el = parseModel(def.code).elements.find(e => e.key === def.newKey);
      expect(el).toMatchObject({ kind: 'block', blockType: 'rect', title: DEFAULT_RECT_COLOR });

      const custom = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'rect', 'rgb(1,2,3)');
      expect(custom.warning).toBeUndefined();
      expect(custom.code).toContain('\n    rect rgb(1,2,3)\n');

      const bad = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'rect', 'red');
      expect(bad.warning).toContain('rgb(...)');
      expect(bad.code).toBe(WRAP_SEQ);
      const outOfRange = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'rect', 'rgb(300,0,0)');
      expect(outOfRange.warning).toContain('rgb(...)');
      expect(outOfRange.code).toBe(WRAP_SEQ);
    });

    it('refuses multi-line titles, box/subgraph and flowcharts (W12)', () => {
      expect(wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'loop', 'a\nb').warning).toContain('single line');
      expect(wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'box').warning).toContain('box');
      expect(wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1'], 'subgraph').warning).toContain('subgraph');
      expect(wrapInBlock(FLOW, FLOW_CFG, ['n:0', 'n:1'], 'loop').warning).toBeTruthy();
    });

    it('refuses non-contiguous and block-crossing selections with the check reason', () => {
      const nonContig = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:2'], 'loop');
      expect(nonContig.warning).toContain('contiguous');
      expect(nonContig.code).toBe(WRAP_SEQ);
      const crossArm = wrapInBlock(WRAP_BLOCK_SEQ, null, ['m:1', 'm:2'], 'loop');
      expect(crossArm.warning).toContain('else');
      expect(crossArm.code).toBe(WRAP_BLOCK_SEQ);
    });

    it('keeps the CONFIG line untouched and passes config through', () => {
      const cfg = parseConfig(WRAP_CFG_SEQ);
      const r = wrapInBlock(WRAP_CFG_SEQ, cfg, ['m:0', 'm:1'], 'loop');
      expect(r.warning).toBeUndefined();
      expect(r.config).toBe(cfg);
      expect(r.code).toBe(`%% CONFIG: {"version":1}
sequenceDiagram
    participant A
    participant B
    loop
        A->>B: m0
        A->>B: m1
    end`);
    });

    it('undo round trip: unwrapBlock restores the pre-wrap bytes (W14)', () => {
      const r = wrapInBlock(WRAP_SEQ, null, ['m:0', 'm:1', 'm:2', 'm:3'], 'opt', 'maybe');
      expect(unwrapBlock(r.code, null, r.newKey!).code).toBe(WRAP_SEQ);
      const nested = wrapInBlock(WRAP_BLOCK_SEQ, null, ['m:3', 'm:4'], 'opt', 'choice');
      expect(unwrapBlock(nested.code, null, nested.newKey!).code).toBe(WRAP_BLOCK_SEQ);
    });
  });

  describe('wrapInRegion', () => {
    it('inserts the region tags at the span indent, content byte-untouched (NFR-02)', () => {
      const r = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:1'], 'section');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    %% @region-start: section
    A->>B: m0
    A->>B: m1
    %% @region-end

    %% a comment
    B-->>A: m2
    A->>B: m3`);
      expect(r.newKey).toBe('r:0');
      const el = parseModel(r.code).elements.find(e => e.key === 'r:0');
      expect(el).toMatchObject({ kind: 'region', regionType: 'section', lineStart: 3, lineEnd: 3 });
    });

    it('supports a type=value region', () => {
      const r = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:1'], 'section', 'intro');
      expect(r.warning).toBeUndefined();
      expect(r.code).toContain('\n    %% @region-start: section=intro\n');
      const el = parseModel(r.code).elements.find(e => e.key === r.newKey);
      expect(el).toMatchObject({ kind: 'region', regionType: 'section', value: 'intro' });
    });

    it('continues the region key sequence when regions already exist', () => {
      const r = wrapInRegion(WRAP_REGION_SEQ, null, ['m:0', 'm:1'], 'outer');
      expect(r.warning).toBeUndefined();
      expect(r.newKey).toBe('r:1');
    });

    it('validates type and value (W8)', () => {
      for (const bad of ['', 'foo bar', 'a=b', 'ü']) {
        const r = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:1'], bad);
        expect(r.warning).toContain('Region type');
        expect(r.code).toBe(WRAP_SEQ);
      }
      const badValue = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:1'], 'ok', 'a b');
      expect(badValue.warning).toContain('Region value');
      expect(badValue.code).toBe(WRAP_SEQ);
      // an empty value is allowed and produces a bare region
      const bare = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:1'], 'ok', '');
      expect(bare.warning).toBeUndefined();
      expect(bare.code).toContain('\n    %% @region-start: ok\n');
    });

    it('refuses a span containing an existing region tag (W9)', () => {
      const r = wrapInRegion(WRAP_REGION_SEQ, null, ['m:0', 'm:1', 'm:2'], 'outer');
      expect(r.warning).toContain('@region-end');
      expect(r.code).toBe(WRAP_REGION_SEQ);
      const start = wrapInRegion(WRAP_REGION_START_SEQ, null, ['m:0', 'm:1'], 'outer');
      expect(start.warning).toContain('contiguous');
      expect(start.code).toBe(WRAP_REGION_START_SEQ);
    });

    it('allows wrapping around block structure lines (W10)', () => {
      const r = wrapInRegion(WRAP_BLOCK_SEQ, null, ['m:1', 'm:2'], 'part');
      expect(r.warning).toBeUndefined();
      expect(r.code).toBe(`sequenceDiagram
    participant A
    participant B
    A->>B: before
    alt cond
        %% @region-start: part
        A->>B: arm1
    else other
        B-->>A: arm2
        %% @region-end
    end
    loop retry
        A->>B: in1
        A->>B: in2
    end
    A->>B: after`);
    });

    it('refuses non-contiguous selections and flowcharts', () => {
      const r = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:2'], 'x');
      expect(r.warning).toContain('contiguous');
      expect(r.code).toBe(WRAP_SEQ);
      expect(wrapInRegion(FLOW, FLOW_CFG, ['n:0', 'n:1'], 'x').warning).toBeTruthy();
    });

    it('undo round trip: splicing out the two tag lines restores the input (W14)', () => {
      const r = wrapInRegion(WRAP_SEQ, null, ['m:0', 'm:1', 'm:2', 'm:3'], 'section', 'intro');
      const original = WRAP_SEQ.split('\n');
      const lines = r.code.split('\n');
      expect(lines[3]).toBe('    %% @region-start: section=intro');
      expect(lines.slice(4, 10)).toEqual(original.slice(3, 9));
      expect(lines[10]).toBe('    %% @region-end');
      expect([...lines.slice(0, 3), ...lines.slice(4, 10), ...lines.slice(11)]).toEqual(original);
    });
  });
});

describe('sticky note tags', () => {
  // Sticky notes live in CONFIG.notes, keyed by `sticky:<id>`; the tag rides
  // on the note's own `keys` field. The diagram body must stay byte-identical.
  const STICKY_SEQ = `%% CONFIG: {"version":1,"notes":[{"id":"note_1","x":120,"y":80,"text":"Remember this","color":"blue"},{"id":"note_2","x":300,"y":200,"text":"Second note"}]}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi`;
  const STICKY_SEQ_CFG = parseConfig(STICKY_SEQ);

  it('adds and removes tags on a sticky note via its CONFIG.notes keys, body byte-identical', () => {
    const added = addTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:note_1', 'edge-case');
    expect(added.warning).toBeUndefined();
    expectBodyIdentical(STICKY_SEQ, added.code);
    expect(added.config?.notes?.[0]).toEqual({ id: 'note_1', x: 120, y: 80, text: 'Remember this', color: 'blue', keys: ['edge-case'] });
    expect(parseConfig(added.code)?.notes?.[0].keys).toEqual(['edge-case']);
    // the other note is untouched
    expect(added.config?.notes?.[1]).toEqual({ id: 'note_2', x: 300, y: 200, text: 'Second note' });
    // idempotent
    const again = addTag(added.code, added.config, 'sticky:note_1', 'edge-case');
    expect(again.config?.notes?.[0].keys).toEqual(['edge-case']);
    // a second tag, then removals drop the keys field but keep the note
    const two = addTag(added.code, added.config, 'sticky:note_1', 'beta');
    expect(two.config?.notes?.[0].keys).toEqual(['edge-case', 'beta']);
    const one = removeTag(two.code, two.config, 'sticky:note_1', 'edge-case');
    expect(one.config?.notes?.[0]).toEqual({ id: 'note_1', x: 120, y: 80, text: 'Remember this', color: 'blue', keys: ['beta'] });
    const none = removeTag(one.code, one.config, 'sticky:note_1', 'beta');
    expect(none.config?.notes?.[0]).toEqual({ id: 'note_1', x: 120, y: 80, text: 'Remember this', color: 'blue' });
    // removing a tag the note does not have is a no-op
    expect(removeTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:note_1', 'nope').code).toBe(STICKY_SEQ);
  });

  it('tags each sticky note independently (the CONFIG id identifies the note)', () => {
    const n1 = addTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:note_2', 'lefty');
    expect(n1.config?.notes?.[1].keys).toEqual(['lefty']);
    expect(n1.config?.notes?.[0].keys).toBeUndefined();
    const both = addTag(n1.code, n1.config, 'sticky:note_1', 'shared-key');
    expect(both.config?.notes?.[0].keys).toEqual(['shared-key']);
    expect(both.config?.notes?.[1].keys).toEqual(['lefty']);
  });

  it('tags sticky notes regardless of diagram type (CONFIG-only operation)', () => {
    const unknown = `not a mermaid diagram at all\n    whatever`;
    const cfg: DiagramConfig = { version: 1, notes: [{ id: 'n1', x: 0, y: 0, text: 'hi' }] };
    const added = addTag(unknown, cfg, 'sticky:n1', 'edge-case');
    expect(added.warning).toBeUndefined();
    expect(added.config?.notes?.[0].keys).toEqual(['edge-case']);
    expect(added.code.startsWith('%% CONFIG: ')).toBe(true);
    expect(added.code.endsWith(unknown)).toBe(true);
  });

  it('soft-fails on invalid tags and unknown sticky ids', () => {
    expect(addTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:note_1', 'has space').warning).toBeTruthy();
    expect(addTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:note_1', '').warning).toBeTruthy();
    expect(addTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:nope', 'ok').warning).toBeTruthy();
    expect(removeTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:nope', 'ok').code).toBe(STICKY_SEQ);
  });

  it('getStickyNoteTags reports the sticky note own tags only', () => {
    expect(getStickyNoteTags(STICKY_SEQ_CFG, 'sticky:note_1')).toEqual([]);
    const tagged = addTag(STICKY_SEQ, STICKY_SEQ_CFG, 'sticky:note_1', 'edge-case');
    expect(getStickyNoteTags(tagged.config, 'sticky:note_1')).toEqual(['edge-case']);
    // non-sticky keys report no tags
    expect(getStickyNoteTags(tagged.config, 'p:0')).toEqual([]);
    expect(getStickyNoteTags(tagged.config, 'note:0')).toEqual([]);
    expect(getStickyNoteTags(tagged.config, 'sticky:nope')).toEqual([]);
    expect(getStickyNoteTags(null, 'sticky:note_1')).toEqual([]);
  });

  it('does not mutate the input config on sticky tag edits', () => {
    const config: DiagramConfig = {
      version: 1,
      notes: [{ id: 'note_1', x: 1, y: 2, text: 'hi', keys: ['x'] }],
    };
    const snapshot = JSON.stringify(config);
    addTag(STICKY_SEQ, config, 'sticky:note_1', 'y');
    removeTag(STICKY_SEQ, config, 'sticky:note_1', 'x');
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

describe('setGlobalArrowStyle', () => {
  it('sets the default color and width, creating the CONFIG header; body untouched', () => {
    const code = createSequenceDiagram();
    const res = setGlobalArrowStyle(code, null, { color: '#e11d48', width: 3 });
    expect(res.warning).toBeUndefined();
    expect(res.code.endsWith(code)).toBe(true);  // header prepended, body untouched
    expect(res.config?.defaultArrowStyle).toEqual({ color: '#e11d48', width: 3 });
    expect(parseConfig(res.code)?.defaultArrowStyle).toEqual({ color: '#e11d48', width: 3 });
  });

  it('merges per field: setting one default keeps the other', () => {
    const first = setGlobalArrowStyle(SEQ, SEQ_CFG, { color: 'red' });
    const second = setGlobalArrowStyle(first.code, first.config, { width: 4 });
    expect(second.config?.defaultArrowStyle).toEqual({ color: 'red', width: 4 });
    const third = setGlobalArrowStyle(second.code, second.config, { color: 'blue' });
    expect(third.config?.defaultArrowStyle).toEqual({ color: 'blue', width: 4 });
  });

  it('clears fields individually and removes the key when both are cleared', () => {
    const styled = setGlobalArrowStyle(SEQ, SEQ_CFG, { color: 'red', width: 4 });
    const clearedColor = setGlobalArrowStyle(styled.code, styled.config, { color: '' });
    expect(clearedColor.config?.defaultArrowStyle).toEqual({ width: 4 });
    const clearedAll = setGlobalArrowStyle(clearedColor.code, clearedColor.config, { width: undefined });
    expect(clearedAll.config?.defaultArrowStyle).toBeUndefined();
    // actors still carry state, so the header stays
    expect(parseConfig(clearedAll.code)?.actors).toEqual({ A: { color: 'red' } });
  });

  it('removes the CONFIG header when the default was the only state', () => {
    const code = createSequenceDiagram();
    const styled = setGlobalArrowStyle(code, null, { color: 'red' });
    const cleared = setGlobalArrowStyle(styled.code, styled.config, { color: '' });
    expect(cleared.code).toBe(code);
    expect(parseConfig(cleared.code)).toBeNull();
  });

  it('preserves per-arrow entries and other config state', () => {
    const res = setGlobalArrowStyle(SEQ, SEQ_CFG, { color: 'red', width: 2 });
    expect(res.config?.actors).toEqual({ A: { color: 'red' } });
    expectBodyIdentical(SEQ, res.code);
    const withArrow = setArrowStyle(SEQ, SEQ_CFG, 'm:0', { color: 'blue' });
    const both = setGlobalArrowStyle(withArrow.code, withArrow.config, { width: 5 });
    expect(both.config?.arrows).toEqual([{ from: 'A', to: 'B', label: 'Hello', color: 'blue' }]);
    expect(both.config?.defaultArrowStyle).toEqual({ width: 5 });
  });

  it('is a no-op when nothing changes', () => {
    const styled = setGlobalArrowStyle(SEQ, SEQ_CFG, { color: 'red', width: 2 });
    const again = setGlobalArrowStyle(styled.code, styled.config, { color: 'red' });
    expect(again.code).toBe(styled.code);
    expect(again.config).toBe(styled.config);
    const cleared = setGlobalArrowStyle(SEQ, SEQ_CFG, { color: '' });
    expect(cleared.code).toBe(SEQ);
    expect(cleared.config).toBe(SEQ_CFG);
  });

  it('soft-fails on invalid widths', () => {
    for (const width of [0, 11, 1.5, -1]) {
      const res = setGlobalArrowStyle(SEQ, SEQ_CFG, { width });
      expect(res.warning).toBeTruthy();
      expect(res.code).toBe(SEQ);
    }
  });

  it('does not mutate the input config', () => {
    const config: DiagramConfig = { version: 1, defaultArrowStyle: { color: 'red' } };
    const snapshot = JSON.stringify(config);
    setGlobalArrowStyle(SEQ, config, { color: 'blue', width: 3 });
    setGlobalArrowStyle(SEQ, config, { color: '' });
    expect(JSON.stringify(config)).toBe(snapshot);
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

describe('groupNodes', () => {
  it('wraps standalone-declared nodes into a subgraph block, moving their declaration lines', () => {
    const code = `flowchart TD\n    A[Alice]\n    B[Bob]\n    C[Charlie]\n    A --> B`;
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Core Services');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Core Services\n        A[Alice]\n        B[Bob]\n    end\n    C[Charlie]\n    A --> B`);
  });

  it('inserts declarations for edge-declared nodes and leaves the edge lines untouched', () => {
    const code = `flowchart TD\n    A[Alice] --> B[Bob]\n    C[Charlie]`;
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Group');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Group\n        A[Alice]\n        B[Bob]\n    end\n    A[Alice] --> B[Bob]\n    C[Charlie]`);
  });

  it('handles a mix of standalone and edge-declared nodes', () => {
    const code = `flowchart TD\n    A[Alice]\n    B[Bob] --> C[Charlie]`;
    // A (n:0) is standalone on line 1; B (n:1) is first declared on the edge line 2.
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Mixed');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Mixed\n        A[Alice]\n        B[Bob]\n    end\n    B[Bob] --> C[Charlie]`);
  });

  it('does not pull non-selected endpoints of a shared edge line into the group', () => {
    const code = `flowchart TD\n    A --> B --> C`;
    // Group A and B only: the edge line stays outside the subgraph, so C
    // (first declared on that line) is NOT part of the group.
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Pair');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Pair\n        A\n        B\n    end\n    A --> B --> C`);
    const index = buildSubgraphTagIndex(res.code);
    expect(index.actorKeys.get('A')).toEqual(['pair']);
    expect(index.actorKeys.get('B')).toEqual(['pair']);
    expect(index.actorKeys.has('C')).toBe(false);
  });

  it('tags the grouped nodes through the zero-config subgraph pipeline', () => {
    const code = `flowchart TD\n    A[Alice]\n    B[Bob]\n    A --> B`;
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Auth Services');
    expect(res.warning).toBeUndefined();
    // The title slugifies to the structural tag key; no CONFIG line is written.
    expect(res.code).not.toContain('CONFIG');
    expect(res.config).toBeNull();
    const tags = collectSubgraphTags(res.code);
    expect(tags).toEqual([{ key: 'auth-services', title: 'Auth Services', lineStart: 1, lineEnd: 4 }]);
    const index = buildSubgraphTagIndex(res.code);
    expect(index.actorKeys.get('A')).toEqual(['auth-services']);
    expect(index.actorKeys.get('B')).toEqual(['auth-services']);
  });

  it('keeps the nodes in their original relative order inside the block', () => {
    const code = `flowchart TD\n    A[Alice]\n    X[Extra]\n    B[Bob]`;
    // B (n:2) listed before A (n:0): the block still orders them by source line.
    const res = groupNodes(code, null, ['n:2', 'n:0'], 'Order');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Order\n        A[Alice]\n        B[Bob]\n    end\n    X[Extra]`);
  });

  it('supports an empty title (a visual-only group with no structural tag)', () => {
    const code = `flowchart TD\n    A[Alice]\n    B[Bob]`;
    const res = groupNodes(code, null, ['n:0', 'n:1'], '   ');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph\n        A[Alice]\n        B[Bob]\n    end`);
    expect(collectSubgraphTags(res.code)).toEqual([]);
  });

  it('nests inside an existing subgraph', () => {
    const code = `flowchart TD\n    subgraph Outer\n        A[Alice]\n        B[Bob]\n    end\n    C[Charlie]`;
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Inner');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Outer\n        subgraph Inner\n            A[Alice]\n            B[Bob]\n        end\n    end\n    C[Charlie]`);
    // Both the inner and the outer group tag the nodes (nested groups stack,
    // outermost first — the source order of the blocks).
    const index = buildSubgraphTagIndex(res.code);
    expect(index.actorKeys.get('A')).toEqual(['outer', 'inner']);
    expect(index.actorKeys.get('B')).toEqual(['outer', 'inner']);
  });

  it('preserves the CONFIG block and every other line byte-for-byte', () => {
    const res = groupNodes(FLOW, FLOW_CFG, ['n:0', 'n:1'], 'Core');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[0]).toBe(FLOW.split('\n')[0]);
    // FLOW line 2 (A[Alice] --> B[Bob]) declares both selected nodes: it stays
    // byte-identical, the block is inserted before it.
    expect(res.code).toContain('    A[Alice] --> B[Bob]');
    expect(res.code).toContain('    subgraph Core');
    expect(res.code).toContain('    end');
    // B -->|Reply| A and A -- ping -- B and C[Standalone] are untouched.
    expect(res.code).toContain('    B -->|Reply| A');
    expect(res.code).toContain('    A -- ping -- B');
    expect(res.code).toContain('    C[Standalone]');
  });

  it('preserves a trailing newline', () => {
    const code = `flowchart TD\n    A[Alice]\n    B[Bob]\n`;
    const res = groupNodes(code, null, ['n:0', 'n:1'], 'Core');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD\n    subgraph Core\n        A[Alice]\n        B[Bob]\n    end\n`);
  });

  it('soft-fails with fewer than two nodes, on sequence diagrams, and on non-node keys', () => {
    const res = groupNodes(FLOW, FLOW_CFG, ['n:0'], 'Core');
    expect(res.warning).toBe('At least two nodes must be selected to create a subgraph');
    expect(res.code).toBe(FLOW);
    const seq = groupNodes(SEQ, SEQ_CFG, ['p:0', 'p:1'], 'Core');
    expect(seq.warning).toBeTruthy();
    expect(seq.code).toBe(SEQ);
    expect(groupNodes(FLOW, FLOW_CFG, ['n:0', 'e:0'], 'Core').warning).toBeTruthy();
    expect(groupNodes(FLOW, FLOW_CFG, ['n:0', 'n:99'], 'Core').warning).toBeTruthy();
    expect(groupNodes(FLOW, FLOW_CFG, ['n:0', 'n:1'], 'a\nb').warning).toBeTruthy();
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

