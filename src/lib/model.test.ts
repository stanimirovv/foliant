import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseModel } from './model';
import { createSequenceDiagram, createFlowchartDiagram } from './editorTestHarness';

const mainCode = fs.readFileSync(path.join(process.cwd(), 'diagrams/main.mmd'), 'utf-8');
const taggedCode = fs.readFileSync(path.join(process.cwd(), 'diagrams/tagged-diagram.mmd'), 'utf-8');

describe('parseModel — repo fixtures', () => {
  it('parses diagrams/main.mmd (sequence) into the exact element list', () => {
    const model = parseModel(mainCode);
    expect(model.type).toBe('sequence');
    expect(model.elements).toEqual([
      { key: 'c:0', kind: 'config', lineStart: 0, lineEnd: 0 },
      { key: 'p:0', kind: 'participant', id: 'C', alias: 'Client', lineStart: 2, lineEnd: 2 },
      { key: 'p:1', kind: 'participant', id: 'API', alias: 'API Gateway', lineStart: 3, lineEnd: 3 },
      { key: 'p:2', kind: 'participant', id: 'Auth', alias: 'Auth Service', lineStart: 4, lineEnd: 4 },
      { key: 'p:3', kind: 'participant', id: 'DB', alias: 'Database', lineStart: 5, lineEnd: 5 },
      { key: 'r:0', kind: 'region', regionType: 'flow', value: 'login', lineStart: 7, lineEnd: 7 },
      { key: 'm:0', kind: 'message', from: 'C', to: 'API', operator: '->>', label: 'POST /login', lineStart: 8, lineEnd: 8 },
      { key: 'm:1', kind: 'message', from: 'API', to: 'Auth', operator: '->>', label: 'Validate Credentials', lineStart: 9, lineEnd: 9 },
      { key: 'r:1', kind: 'region', regionType: 'note', lineStart: 11, lineEnd: 11 },
      { key: 'note:0', kind: 'note', over: ['API', 'Auth'], text: 'Passwords must be hashed via bcrypt', lineStart: 12, lineEnd: 12 },
      { key: 'r:2', kind: 'region', regionType: 'edge-case', value: 'invalid-password', lineStart: 15, lineEnd: 15 },
      { key: 'm:2', kind: 'message', from: 'Auth', to: 'API', operator: '-->>', label: '401 Unauthorized', lineStart: 16, lineEnd: 16 },
      { key: 'm:3', kind: 'message', from: 'API', to: 'C', operator: '-->>', label: 'Error: Invalid Credentials', lineStart: 17, lineEnd: 17 },
      { key: 'm:4', kind: 'message', from: 'Auth', to: 'DB', operator: '->>', label: 'Fetch User Data', lineStart: 20, lineEnd: 20 },
      { key: 'm:5', kind: 'message', from: 'DB', to: 'Auth', operator: '-->>', label: 'User Record', lineStart: 21, lineEnd: 21 },
      { key: 'm:6', kind: 'message', from: 'Auth', to: 'API', operator: '-->>', label: 'JWT Token', lineStart: 22, lineEnd: 22 },
      { key: 'm:7', kind: 'message', from: 'API', to: 'C', operator: '-->>', label: '200 OK + Token', lineStart: 23, lineEnd: 23 },
    ]);
  });

  it('parses diagrams/tagged-diagram.mmd (flowchart) into the exact element list', () => {
    const model = parseModel(taggedCode);
    expect(model.type).toBe('flowchart');
    expect(model.elements).toEqual([
      { key: 'c:0', kind: 'config', lineStart: 0, lineEnd: 0 },
      { key: 'n:0', kind: 'node', id: 'U', label: 'User', shape: 'rect', lineStart: 2, lineEnd: 2 },
      { key: 'n:1', kind: 'node', id: 'API', label: 'API Gateway', shape: 'rect', lineStart: 2, lineEnd: 2 },
      { key: 'e:0', kind: 'edge', from: 'U', to: 'API', operator: '-->', lineStart: 2, lineEnd: 2 },
      { key: 'r:0', kind: 'region', regionType: 'flow', value: 'login', lineStart: 4, lineEnd: 4 },
      { key: 'b:0', kind: 'block', blockType: 'subgraph', title: 'Login Flow', lineStart: 5, lineEnd: 20 },
      { key: 'n:2', kind: 'node', id: 'Auth', label: 'Auth Service', shape: 'rect', lineStart: 6, lineEnd: 6 },
      { key: 'e:1', kind: 'edge', from: 'API', to: 'Auth', operator: '-->', lineStart: 6, lineEnd: 6 },
      { key: 'r:1', kind: 'region', regionType: 'tag', value: 'beta', lineStart: 8, lineEnd: 8 },
      { key: 'n:3', kind: 'node', id: 'Bio', label: 'Biometrics Service', shape: 'rect', lineStart: 9, lineEnd: 9 },
      { key: 'e:2', kind: 'edge', from: 'Auth', to: 'Bio', operator: '-->', lineStart: 9, lineEnd: 9 },
      { key: 'e:3', kind: 'edge', from: 'Bio', to: 'Auth', operator: '-->', lineStart: 10, lineEnd: 10 },
      { key: 'r:2', kind: 'region', regionType: 'tag', value: 'experimental', lineStart: 13, lineEnd: 13 },
      { key: 'n:4', kind: 'node', id: 'Quant', label: 'Quantum Crypto', shape: 'rect', lineStart: 14, lineEnd: 14 },
      { key: 'e:4', kind: 'edge', from: 'Auth', to: 'Quant', operator: '-->', lineStart: 14, lineEnd: 14 },
      { key: 'e:5', kind: 'edge', from: 'Quant', to: 'Auth', operator: '-->', lineStart: 15, lineEnd: 15 },
      { key: 'n:5', kind: 'node', id: 'DB', label: 'Database', shape: 'cylinder', lineStart: 18, lineEnd: 18 },
      { key: 'e:6', kind: 'edge', from: 'Auth', to: 'DB', operator: '-->', lineStart: 18, lineEnd: 18 },
      { key: 'e:7', kind: 'edge', from: 'DB', to: 'Auth', operator: '-->', lineStart: 19, lineEnd: 19 },
      { key: 'e:8', kind: 'edge', from: 'Auth', to: 'API', operator: '-->', label: '200 OK', lineStart: 23, lineEnd: 23 },
      { key: 'e:9', kind: 'edge', from: 'API', to: 'U', operator: '-->', label: 'Success', lineStart: 24, lineEnd: 24 },
    ]);
  });
});

describe('parseModel — sequence operators', () => {
  it('parses every sequence operator of Section 4.8, including bare lines', () => {
    const ops = ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)'];
    const bareOps = ['-', '--'];
    const code = `sequenceDiagram
    participant A
    participant B
${ops.map((op, i) => `    A${op}B: msg ${i}`).join('\n')}
${bareOps.map((op, i) => `    A${op}B: bare ${i}`).join('\n')}`;
    const model = parseModel(code);
    const messages = model.elements.filter(e => e.kind === 'message');
    expect(messages.map(m => (m as { operator: string }).operator)).toEqual([...ops, ...bareOps]);
    expect(messages.map(m => (m as { label?: string }).label)).toEqual([
      ...ops.map((_, i) => `msg ${i}`),
      ...bareOps.map((_, i) => `bare ${i}`),
    ]);
    expect(messages.every(m => m.from === 'A' && m.to === 'B')).toBe(true);
  });

  it('parses notes over single actors, spans and left/right of', () => {
    const code = `sequenceDiagram
    participant A
    participant B
    Note over A: single
    Note over A,B: span
    Note left of A: left
    Note right of B: right`;
    const model = parseModel(code);
    const notes = model.elements.filter(e => e.kind === 'note');
    expect(notes).toEqual([
      { key: 'note:0', kind: 'note', over: ['A'], text: 'single', lineStart: 3, lineEnd: 3 },
      { key: 'note:1', kind: 'note', over: ['A', 'B'], text: 'span', lineStart: 4, lineEnd: 4 },
      { key: 'note:2', kind: 'note', over: ['A'], text: 'left', lineStart: 5, lineEnd: 5 },
      { key: 'note:3', kind: 'note', over: ['B'], text: 'right', lineStart: 6, lineEnd: 6 },
    ]);
  });

  it('parses nested blocks with correct spans and skips else', () => {
    const code = `sequenceDiagram
    participant A
    alt Condition
        A->>A: self
        rect rgb(255, 255, 255)
            Note over A: note text
        end
    else Other
        A->>A: other
    end
    A->>A: after`;
    const model = parseModel(code);
    expect(model.elements).toEqual([
      { key: 'p:0', kind: 'participant', id: 'A', lineStart: 1, lineEnd: 1 },
      { key: 'b:0', kind: 'block', blockType: 'alt', title: 'Condition', lineStart: 2, lineEnd: 9 },
      { key: 'm:0', kind: 'message', from: 'A', to: 'A', operator: '->>', label: 'self', lineStart: 3, lineEnd: 3 },
      { key: 'b:1', kind: 'block', blockType: 'rect', title: 'rgb(255, 255, 255)', lineStart: 4, lineEnd: 6 },
      { key: 'note:0', kind: 'note', over: ['A'], text: 'note text', lineStart: 5, lineEnd: 5 },
      { key: 'm:1', kind: 'message', from: 'A', to: 'A', operator: '->>', label: 'other', lineStart: 8, lineEnd: 8 },
      { key: 'm:2', kind: 'message', from: 'A', to: 'A', operator: '->>', label: 'after', lineStart: 10, lineEnd: 10 },
    ]);
  });

  it('parses box blocks emitted by transformActors in processed code', () => {
    const code = `sequenceDiagram
    box red RED Zone
    participant MergedColor_red as Merged red
    end
  MergedColor_red->>MergedColor_red: Message`;
    const model = parseModel(code);
    expect(model.elements).toEqual([
      { key: 'b:0', kind: 'block', blockType: 'box', title: 'red RED Zone', lineStart: 1, lineEnd: 3 },
      { key: 'p:0', kind: 'participant', id: 'MergedColor_red', alias: 'Merged red', lineStart: 2, lineEnd: 2 },
      { key: 'm:0', kind: 'message', from: 'MergedColor_red', to: 'MergedColor_red', operator: '->>', label: 'Message', lineStart: 4, lineEnd: 4 },
    ]);
  });

  it('parses participants with metadata types including database, queue and actor', () => {
    const code = `sequenceDiagram
    participant Standard
    actor User as Human
    participant DB as Main Database @{ type: "database" }
    participant Q @{ type: "queue" }
    participant Cache as Redis @{ "type": "collections" }`;
    const model = parseModel(code);
    expect(model.elements).toEqual([
      { key: 'p:0', kind: 'participant', id: 'Standard', lineStart: 1, lineEnd: 1 },
      { key: 'p:1', kind: 'participant', id: 'User', alias: 'Human', participantType: 'actor', lineStart: 2, lineEnd: 2 },
      { key: 'p:2', kind: 'participant', id: 'DB', alias: 'Main Database', participantType: 'database', lineStart: 3, lineEnd: 3 },
      { key: 'p:3', kind: 'participant', id: 'Q', participantType: 'queue', lineStart: 4, lineEnd: 4 },
      { key: 'p:4', kind: 'participant', id: 'Cache', alias: 'Redis', participantType: 'collections', lineStart: 5, lineEnd: 5 },
    ]);
  });
});

describe('parseModel — flowchart edges and nodes', () => {
  it('parses labeled and unlabeled flowchart edges', () => {
    const code = `flowchart TD
    A --> B
    A ---|lbl1| B
    A -.->|lbl2| B
    A ==>|lbl3| B
    A <--> B
    A <==> B
    A x--x B
    A o--o B
    A -- text -- B
    A --- text2 --- B`;
    const model = parseModel(code);
    const edges = model.elements.filter(e => e.kind === 'edge');
    expect(edges.map(e => ({ from: (e as { from: string }).from, to: (e as { to: string }).to, operator: (e as { operator: string }).operator, label: (e as { label?: string }).label }))).toEqual([
      { from: 'A', to: 'B', operator: '-->', label: undefined },
      { from: 'A', to: 'B', operator: '---', label: 'lbl1' },
      { from: 'A', to: 'B', operator: '-.->', label: 'lbl2' },
      { from: 'A', to: 'B', operator: '==>', label: 'lbl3' },
      { from: 'A', to: 'B', operator: '<-->', label: undefined },
      { from: 'A', to: 'B', operator: '<==>', label: undefined },
      { from: 'A', to: 'B', operator: 'x--x', label: undefined },
      { from: 'A', to: 'B', operator: 'o--o', label: undefined },
      { from: 'A', to: 'B', operator: '--', label: 'text' },
      { from: 'A', to: 'B', operator: '---', label: 'text2' },
    ]);
  });

  it('parses all node shapes', () => {
    const code = `flowchart TD
    A[Rect]
    B(Round)
    C((Circle))
    D[(Cylinder)]
    E{Diamond}
    F>Asym]`;
    const model = parseModel(code);
    const nodes = model.elements.filter(e => e.kind === 'node');
    expect(nodes.map(n => ({ id: (n as { id: string }).id, label: (n as { label?: string }).label, shape: (n as { shape?: string }).shape }))).toEqual([
      { id: 'A', label: 'Rect', shape: 'rect' },
      { id: 'B', label: 'Round', shape: 'round' },
      { id: 'C', label: 'Circle', shape: 'circle' },
      { id: 'D', label: 'Cylinder', shape: 'cylinder' },
      { id: 'E', label: 'Diamond', shape: 'rhombus' },
      { id: 'F', label: 'Asym', shape: 'asymmetric' },
    ]);
  });

  it('uses the first defining line as the node span, bare or shaped', () => {
    const code = `flowchart TD
    A --> B
    B --> C
    A[Alpha]`;
    const model = parseModel(code);
    const nodes = model.elements.filter(e => e.kind === 'node');
    expect(nodes).toEqual([
      { key: 'n:0', kind: 'node', id: 'A', lineStart: 1, lineEnd: 1 },
      { key: 'n:1', kind: 'node', id: 'B', lineStart: 1, lineEnd: 1 },
      { key: 'n:2', kind: 'node', id: 'C', lineStart: 2, lineEnd: 2 },
    ]);
  });

  it('parses nested subgraphs with correct spans', () => {
    const code = `flowchart TD
    subgraph One
        subgraph Two
            A --> B
        end
    end
    B --> C`;
    const model = parseModel(code);
    expect(model.elements).toEqual([
      { key: 'b:0', kind: 'block', blockType: 'subgraph', title: 'One', lineStart: 1, lineEnd: 5 },
      { key: 'b:1', kind: 'block', blockType: 'subgraph', title: 'Two', lineStart: 2, lineEnd: 4 },
      { key: 'n:0', kind: 'node', id: 'A', lineStart: 3, lineEnd: 3 },
      { key: 'n:1', kind: 'node', id: 'B', lineStart: 3, lineEnd: 3 },
      { key: 'e:0', kind: 'edge', from: 'A', to: 'B', operator: '-->', lineStart: 3, lineEnd: 3 },
      { key: 'n:2', kind: 'node', id: 'C', lineStart: 6, lineEnd: 6 },
      { key: 'e:1', kind: 'edge', from: 'B', to: 'C', operator: '-->', lineStart: 6, lineEnd: 6 },
    ]);
  });
});

describe('parseModel — regions, config, skipping', () => {
  it('parses region tags; region-end is not an element', () => {
    const code = `sequenceDiagram
    %% @region-start: flow=login
    participant A
    %% @region-end
    %% @region-start: note
    A->>A: hi
    %% @region-end`;
    const model = parseModel(code);
    expect(model.elements.filter(e => e.kind === 'region')).toEqual([
      { key: 'r:0', kind: 'region', regionType: 'flow', value: 'login', lineStart: 1, lineEnd: 1 },
      { key: 'r:1', kind: 'region', regionType: 'note', lineStart: 4, lineEnd: 4 },
    ]);
  });

  it('parses the CONFIG line (CONFIG and VIEWS prefixes) as a config element', () => {
    const withConfig = parseModel(`%% CONFIG: {"version":1}\nsequenceDiagram\n    participant A`);
    expect(withConfig.elements[0]).toEqual({ key: 'c:0', kind: 'config', lineStart: 0, lineEnd: 0 });
    const withViews = parseModel(`%% VIEWS: {"version":1}\nflowchart TD\n    A --> B`);
    expect(withViews.elements[0]).toEqual({ key: 'c:0', kind: 'config', lineStart: 0, lineEnd: 0 });
    const without = parseModel(`sequenceDiagram\n    participant A`);
    expect(without.elements.some(e => e.kind === 'config')).toBe(false);
  });

  it('skips unrecognized lines without erroring', () => {
    const code = `sequenceDiagram
    autonumber
    activate A
    participant A
    deactivate A
    %% a plain comment
    style A fill:red
    A->>A: hi`;
    const model = parseModel(code);
    expect(model.elements).toEqual([
      { key: 'p:0', kind: 'participant', id: 'A', lineStart: 3, lineEnd: 3 },
      { key: 'm:0', kind: 'message', from: 'A', to: 'A', operator: '->>', label: 'hi', lineStart: 7, lineEnd: 7 },
    ]);
  });

  it('detects the diagram type from the first non-comment line', () => {
    expect(parseModel(`sequenceDiagram\n    participant A`).type).toBe('sequence');
    expect(parseModel(`  sequenceDiagram\n    participant A`).type).toBe('sequence');
    expect(parseModel(`flowchart TD\n    A --> B`).type).toBe('flowchart');
    expect(parseModel(`graph TD\n    A --> B`).type).toBe('flowchart');
    expect(parseModel(`%% CONFIG: {"version":1}\nflowchart TD\n    A --> B`).type).toBe('flowchart');
    expect(parseModel(`classDiagram\n    A --> B`).type).toBe('unknown');
    expect(parseModel(``).type).toBe('unknown');
    expect(parseModel(`\n\n%% just a comment`).type).toBe('unknown');
  });

  it('returns an empty element list for unknown types and empty input', () => {
    expect(parseModel('')).toEqual({ type: 'unknown', elements: [] });
    expect(parseModel('classDiagram\n    A --> B')).toEqual({ type: 'unknown', elements: [] });
  });
});

describe('parseModel — create -> change -> verify (harness)', () => {
  it('parses a newly created sequence diagram into the complete element list', () => {
    const model = parseModel(createSequenceDiagram());
    expect(model).toEqual({
      type: 'sequence',
      elements: [
        { key: 'p:0', kind: 'participant', id: 'A', alias: 'Alice', lineStart: 1, lineEnd: 1 },
        { key: 'p:1', kind: 'participant', id: 'B', alias: 'Bob', lineStart: 2, lineEnd: 2 },
        { key: 'm:0', kind: 'message', from: 'A', to: 'B', operator: '->>', label: 'Hello', lineStart: 3, lineEnd: 3 },
        { key: 'm:1', kind: 'message', from: 'B', to: 'A', operator: '-->>', label: 'Hi there', lineStart: 4, lineEnd: 4 },
      ],
    });
  });

  it('parses a newly created flowchart diagram into the complete element list', () => {
    const model = parseModel(createFlowchartDiagram());
    expect(model).toEqual({
      type: 'flowchart',
      elements: [
        { key: 'n:0', kind: 'node', id: 'A', label: 'Alice', shape: 'rect', lineStart: 1, lineEnd: 1 },
        { key: 'n:1', kind: 'node', id: 'B', label: 'Bob', shape: 'rect', lineStart: 1, lineEnd: 1 },
        { key: 'e:0', kind: 'edge', from: 'A', to: 'B', operator: '-->', lineStart: 1, lineEnd: 1 },
        { key: 'e:1', kind: 'edge', from: 'B', to: 'A', operator: '-->', label: 'Reply', lineStart: 2, lineEnd: 2 },
      ],
    });
  });
});
