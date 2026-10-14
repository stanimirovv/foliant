import { describe, it, expect } from 'vitest';
import { parseViewsData, updateViewsData, DiagramConfig, addStickyNote, updateStickyNote, deleteStickyNote, StickyNote } from './views';
import { createSequenceDiagram, createFlowchartDiagram } from './editorTestHarness';

describe('Views parsing and updating', () => {
  it('parses valid views data from the first line with %% VIEWS:', () => {
    const code = `%% VIEWS: {"version":1,"views":[{"name":"Test","hiddenPaths":["a","b"]}]}
sequenceDiagram
  A->>B: Hello`;
    const data = parseViewsData(code);
    expect(data).toEqual({
      version: 1,
      views: [{ name: 'Test', hiddenPaths: ['a', 'b'] }]
    });
  });

  it('parses valid views data from the first line with %% CONFIG:', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"A":{"color":"red"}}}
sequenceDiagram
  A->>B: Hello`;
    const data = parseViewsData(code);
    expect(data).toEqual({
      version: 1,
      actors: { A: { color: 'red' } }
    });
  });

  it('adds config data to code without config using %% CONFIG:', () => {
    const code = `sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = {
      version: 1,
      views: [{ name: 'New View', hiddenPaths: ['path1'] }]
    };
    const newCode = updateViewsData(code, config);
    expect(newCode).toBe(`%% CONFIG: {"version":1,"views":[{"name":"New View","hiddenPaths":["path1"]}]}
sequenceDiagram
  A->>B: Hello`);
  });

  it('removes config line if config is null or empty', () => {
    const code = `%% CONFIG: {"version":1,"views":[{"name":"View to delete","hiddenPaths":["path2"]}]}
sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = {
      version: 1,
      views: [],
      actors: {}
    };
    const newCode = updateViewsData(code, config);
    expect(newCode).toBe(`sequenceDiagram
  A->>B: Hello`);
  });
});

describe('CONFIG arrows (ArrowStyle)', () => {
  const arrows = [
    { from: 'C', to: 'API', label: 'POST /login', color: '#e11d48', width: 3, dash: 'dashed' as const },
    { from: 'Auth', to: 'DB', color: 'blue', width: 1, dash: 'solid' as const, occurrence: 2 },
  ];

  it('round-trips arrows through parse/update', () => {
    const code = `sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = { version: 1, arrows };
    const newCode = updateViewsData(code, config);
    const parsed = parseViewsData(newCode);
    expect(parsed).toEqual({ version: 1, arrows });
    expect(parsed?.arrows).toEqual(arrows);
  });

  it('keeps the header when only arrows exist', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B"}]}
sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = { version: 1, arrows: [{ from: 'A', to: 'B' }] };
    const newCode = updateViewsData(code, config);
    expect(newCode.startsWith('%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B"}]}')).toBe(true);
    expect(parseViewsData(newCode)?.arrows).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('removes the header when views, actors and arrows are all empty', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"A","to":"B","color":"red"}]}
sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = { version: 1, views: [], actors: {}, arrows: [] };
    const newCode = updateViewsData(code, config);
    expect(newCode).toBe(`sequenceDiagram
  A->>B: Hello`);
    expect(parseViewsData(newCode)).toBeNull();
  });

  it('parses old headers without arrows to arrows === undefined', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"A":{"color":"red"}}}
sequenceDiagram
  A->>B: Hello`;
    const parsed = parseViewsData(code);
    expect(parsed).toEqual({ version: 1, actors: { A: { color: 'red' } } });
    expect(parsed?.arrows).toBeUndefined();
  });

  it('still returns null on malformed JSON', () => {
    const code = `%% CONFIG: {not json}
sequenceDiagram
  A->>B: Hello`;
    expect(parseViewsData(code)).toBeNull();
  });

  it('preserves arrows alongside views and actors', () => {
    const config: DiagramConfig = {
      version: 1,
      views: [{ name: 'V', hiddenPaths: ['flow=x'] }],
      actors: { A: { color: 'red', keys: ['backend'] } },
      arrows,
    };
    const newCode = updateViewsData('sequenceDiagram\n  A->>B: Hello', config);
    const parsed = parseViewsData(newCode);
    expect(parsed).toEqual(config);
  });
});

describe('CONFIG arrows — create -> change -> verify (harness)', () => {
  it('creates a new diagram, adds arrows, and verifies the round trip with a byte-identical body', () => {
    for (const diagram of [createSequenceDiagram(), createFlowchartDiagram()]) {
      const config: DiagramConfig = {
        version: 1,
        arrows: [{ from: 'A', to: 'B', label: 'Hello', color: '#e11d48', width: 3, dash: 'dashed' }],
      };
      const newCode = updateViewsData(diagram, config);
      // Body is byte-identical; only the header line is added on top.
      expect(newCode.endsWith(diagram)).toBe(true);
      const parsed = parseViewsData(newCode);
      expect(parsed?.arrows).toEqual(config.arrows);
      // The header is the first line and valid JSON.
      const firstLine = newCode.split('\n')[0];
      expect(firstLine.startsWith('%% CONFIG: ')).toBe(true);
      expect(() => JSON.parse(firstLine.slice('%% CONFIG: '.length))).not.toThrow();
    }
  });

  it('creates a new diagram whose config becomes empty -> header removed', () => {
    const diagram = createSequenceDiagram();
    const withArrows = updateViewsData(diagram, { version: 1, arrows: [{ from: 'A', to: 'B' }] });
    expect(parseViewsData(withArrows)?.arrows).toHaveLength(1);
    const emptied = updateViewsData(withArrows, { version: 1, arrows: [] });
    expect(emptied).toBe(diagram);
    expect(parseViewsData(emptied)).toBeNull();
  });

  it('round-trips note tag entries and keeps a noteTags-only config', () => {
    const diagram = createSequenceDiagram();
    const config: DiagramConfig = {
      version: 1,
      noteTags: [{ over: ['A', 'B'], text: 'Shared note', keys: ['edge-case'] }],
    };
    const newCode = updateViewsData(diagram, config);
    expect(newCode.endsWith(diagram)).toBe(true);
    expect(parseViewsData(newCode)?.noteTags).toEqual(config.noteTags);
    // Emptying noteTags removes the header entirely (no other state left).
    const emptied = updateViewsData(newCode, { version: 1, noteTags: [] });
    expect(emptied).toBe(diagram);
    expect(parseViewsData(emptied)).toBeNull();
  });
});

describe('CONFIG notes (StickyNote)', () => {
  const notes: StickyNote[] = [
    { id: 'note-1', x: 100, y: 150, text: 'First discussion thought', color: 'yellow' },
    { id: 'note-2', x: 300, y: 250, text: 'Second thought: **bold**', color: 'blue' },
  ];

  it('round-trips sticky notes through parse/update', () => {
    const code = `sequenceDiagram\n  A->>B: Hello`;
    const config: DiagramConfig = { version: 1, notes };
    const newCode = updateViewsData(code, config);
    const parsed = parseViewsData(newCode);
    expect(parsed?.notes).toEqual(notes);
  });

  it('adds, updates, and deletes sticky notes using helper functions', () => {
    const code = `sequenceDiagram\n  A->>B: Hello`;
    const note1: StickyNote = { id: 'n1', x: 50, y: 80, text: 'Hello note', color: 'green' };
    
    // Add
    const codeWithNote = addStickyNote(code, note1);
    expect(parseViewsData(codeWithNote)?.notes).toEqual([note1]);

    // Update
    const codeUpdated = updateStickyNote(codeWithNote, 'n1', { text: 'Updated note', x: 120 });
    expect(parseViewsData(codeUpdated)?.notes).toEqual([
      { id: 'n1', x: 120, y: 80, text: 'Updated note', color: 'green' }
    ]);

    // Delete
    const codeDeleted = deleteStickyNote(codeUpdated, 'n1');
    expect(parseViewsData(codeDeleted)).toBeNull();
    expect(codeDeleted).toBe(code);
  });

  it('removes the header when views, actors, arrows, and notes are all empty', () => {
    const code = `%% CONFIG: {"version":1,"notes":[{"id":"n1","x":0,"y":0,"text":"T"}]}\nsequenceDiagram\n  A->>B: Hello`;
    const config: DiagramConfig = { version: 1, views: [], actors: {}, arrows: [], notes: [] };
    const newCode = updateViewsData(code, config);
    expect(newCode).toBe(`sequenceDiagram\n  A->>B: Hello`);
    expect(parseViewsData(newCode)).toBeNull();
  });
});

describe('CONFIG views with actor options', () => {
  it('parses and round-trips saved views with actor merge/hide settings', () => {
    const code = `sequenceDiagram\n  A->>B: Hello`;
    const config: DiagramConfig = {
      version: 1,
      views: [
        {
          name: 'Backend Clean View',
          hiddenPaths: ['flow=login/edge'],
          mergeColors: ['red'],
          mergeCleanColors: ['blue'],
          hideColors: ['yellow'],
          mergeKeys: ['backend'],
          mergeCleanKeys: ['db'],
          hideKeys: ['legacy'],
        },
      ],
    };
    const newCode = updateViewsData(code, config);
    const parsed = parseViewsData(newCode);
    expect(parsed?.views).toEqual(config.views);
  });
});

