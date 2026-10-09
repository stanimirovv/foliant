// Element model for the structured editor (EDITING_PLAN.md Section 4.4).
// parseModel turns raw .mmd text into a typed element list with exact line
// spans, for sequence diagrams and flowchart-style ("component") diagrams.
// Anything unrecognized is skipped, never an error (NFR-01).

export type DiagramType = 'sequence' | 'flowchart' | 'unknown';

export interface BaseElement {
  key: string;        // stable id, e.g. "p:0", "m:3", "n:1", "e:2" (index within kind)
  kind: string;
  lineStart: number;  // 0-based line span in THIS code string
  lineEnd: number;    // inclusive
}

export interface ParticipantElement extends BaseElement {
  kind: 'participant';
  id: string;
  alias?: string;
}

export interface MessageElement extends BaseElement {
  kind: 'message';
  from: string;
  to: string;
  operator: string;
  label?: string;
}

export interface NoteElement extends BaseElement {
  kind: 'note';
  over: string[];
  text: string;
}

export type NodeShape = 'rect' | 'round' | 'circle' | 'cylinder' | 'rhombus' | 'asymmetric';

export interface NodeElement extends BaseElement {
  kind: 'node';
  id: string;
  label?: string;
  shape?: NodeShape;
}

export interface EdgeElement extends BaseElement {
  kind: 'edge';
  from: string;
  to: string;
  operator: string;
  label?: string;
}

export type BlockType = 'alt' | 'opt' | 'loop' | 'par' | 'rect' | 'box' | 'subgraph';

export interface BlockElement extends BaseElement {
  kind: 'block';
  blockType: BlockType;
  title?: string;
}

export interface RegionElement extends BaseElement {
  kind: 'region';
  regionType: string;
  value?: string;
}

export interface ConfigElement extends BaseElement {
  kind: 'config';
}

export type ModelElement = ParticipantElement | MessageElement | NoteElement
  | NodeElement | EdgeElement | BlockElement | RegionElement | ConfigElement;

export interface DiagramModel {
  type: DiagramType;
  elements: ModelElement[];     // in source order
}

const ID = '[A-Za-z0-9_-]+';
// Same shape vocabulary as the preprocessor: [..] ((..)) (..) {..} >..]
// (the [..] alternative also covers the [(..)] cylinder shape).
const SHAPE = String.raw`(?:\[.*?\]|\(\(.*?\)\)|\(.*?\)|\{.*?\}|>.*?\])`;

const CONFIG_LINE_RE = /^%% (?:CONFIG|VIEWS): /;
const REGION_START_RE = /^%%\s*@region-start:\s*([a-zA-Z0-9_-]+)(?:=([a-zA-Z0-9_-]+))?/;

// Sequence diagrams
const PARTICIPANT_RE = new RegExp(`^(\\s*)(?:participant|actor)\\s+(${ID})(?:\\s+as\\s+(.*))?$`);
const NOTE_RE = new RegExp(`^\\s*Note\\s+(over|left of|right of)\\s+(${ID}(?:\\s*,\\s*${ID})*)\\s*:\\s*(.*)$`);
// Full operator set of Section 4.8, including bare `-` / `--` lines.
const MESSAGE_RE = new RegExp(`^\\s*([A-Za-z0-9_-]+?)\\s*(-->>|->>|--x|-x|--\\)|-\\)|-->|->|--|-)\\s*([A-Za-z0-9_-]+?)(?:\\s*:\\s*(.*))?$`);

// Blocks (both diagram types). `box` is emitted by transformActors in
// processed sequence code, so it must be tracked for end-matching.
const BLOCK_OPEN_RE = /^\s*(alt|opt|loop|par|rect|box|subgraph)(?:\s+(.*))?$/;
const BLOCK_END_RE = /^\s*end\s*$/;
const BLOCK_CONT_RE = /^\s*(else|and)\b/;

// Flowcharts
const EDGE_OPS = '<-->|<==>|x--x|o--o|-->|==>|-\\.->|---|--';
const EDGE_PIPE_RE = new RegExp(`^(\\s*)(${ID})\\s*(${SHAPE})?\\s*(${EDGE_OPS})\\s*\\|([^|]*)\\|\\s*(${ID})\\s*(${SHAPE})?\\s*$`);
const EDGE_TEXT_RE = new RegExp(`^(\\s*)(${ID})\\s*(${SHAPE})?\\s*(--|---|-\\.)\\s+(.+?)\\s+(${EDGE_OPS}|\\.->|\\.-)\\s*(${ID})\\s*(${SHAPE})?\\s*$`);
const EDGE_PLAIN_RE = new RegExp(`^(\\s*)(${ID})\\s*(${SHAPE})?\\s*(${EDGE_OPS})\\s*(${ID})\\s*(${SHAPE})?\\s*$`);
const NODE_LINE_RE = new RegExp(`^(\\s*)(${ID})\\s*(${SHAPE})?\\s*$`);
const FC_SKIP_RE = /^\s*(direction|click|style|classDef|class|linkStyle|accTitle|accDescr)\b/;

function detectType(lines: string[]): { type: DiagramType; typeLine: number } {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (/^sequenceDiagram\b/.test(trimmed)) return { type: 'sequence', typeLine: i };
    if (/^(flowchart|graph)\b/.test(trimmed)) return { type: 'flowchart', typeLine: i };
    return { type: 'unknown', typeLine: i };
  }
  return { type: 'unknown', typeLine: -1 };
}

export function parseShapeToken(token: string): { shape: NodeShape; label: string } | null {
  if (token.startsWith('[(') && token.endsWith(')]')) return { shape: 'cylinder', label: token.slice(2, -2) };
  if (token.startsWith('((') && token.endsWith('))')) return { shape: 'circle', label: token.slice(2, -2) };
  if (token.startsWith('[') && token.endsWith(']')) return { shape: 'rect', label: token.slice(1, -1) };
  if (token.startsWith('(') && token.endsWith(')')) return { shape: 'round', label: token.slice(1, -1) };
  if (token.startsWith('{') && token.endsWith('}')) return { shape: 'rhombus', label: token.slice(1, -1) };
  if (token.startsWith('>') && token.endsWith(']')) return { shape: 'asymmetric', label: token.slice(1, -1) };
  return null;
}

export const SHAPE_DELIMITERS: Record<NodeShape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  circle: ['((', '))'],
  cylinder: ['[(', ')]'],
  rhombus: ['{', '}'],
  asymmetric: ['>', ']'],
};

export function parseModel(code: string): DiagramModel {
  const lines = code.split('\n');
  const { type, typeLine } = detectType(lines);
  const elements: ModelElement[] = [];
  if (type === 'unknown') return { type, elements };

  const counters: Record<string, number> = {};
  const nextKey = (prefix: string) => `${prefix}:${counters[prefix] ?? 0}`;
  const bump = (prefix: string) => { counters[prefix] = (counters[prefix] ?? 0) + 1; };

  const blockStack: BlockElement[] = [];
  const seenNodeIds = new Set<string>();

  const registerNode = (id: string, shapeToken: string | undefined, line: number) => {
    if (seenNodeIds.has(id)) return;
    seenNodeIds.add(id);
    let shape: NodeShape | undefined;
    let label: string | undefined;
    if (shapeToken) {
      const parsed = parseShapeToken(shapeToken);
      if (parsed) {
        shape = parsed.shape;
        label = parsed.label;
      }
    }
    const el: NodeElement = { key: nextKey('n'), kind: 'node', id, label, shape, lineStart: line, lineEnd: line };
    bump('n');
    elements.push(el);
  };

  const pushEdge = (from: string, to: string, operator: string, label: string | undefined, line: number, fromShape?: string, toShape?: string) => {
    registerNode(from, fromShape, line);
    registerNode(to, toShape, line);
    const el: EdgeElement = { key: nextKey('e'), kind: 'edge', from, to, operator, label, lineStart: line, lineEnd: line };
    bump('e');
    elements.push(el);
  };

  const pushBlockOpen = (blockType: BlockType, title: string | undefined, line: number) => {
    const el: BlockElement = { key: nextKey('b'), kind: 'block', blockType, title, lineStart: line, lineEnd: line };
    bump('b');
    elements.push(el);
    blockStack.push(el);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (i === 0 && CONFIG_LINE_RE.test(line)) {
      elements.push({ key: nextKey('c'), kind: 'config', lineStart: 0, lineEnd: 0 });
      bump('c');
      continue;
    }
    if (i === typeLine) continue;

    if (trimmed.startsWith('%%')) {
      const regionMatch = trimmed.match(REGION_START_RE);
      if (regionMatch) {
        elements.push({
          key: nextKey('r'),
          kind: 'region',
          regionType: regionMatch[1],
          value: regionMatch[2],
          lineStart: i,
          lineEnd: i,
        });
        bump('r');
      }
      // All other comments (incl. %% @region-end) are not elements.
      continue;
    }

    if (!trimmed) continue;

    const blockOpen = line.match(BLOCK_OPEN_RE);
    if (blockOpen) {
      pushBlockOpen(blockOpen[1] as BlockType, blockOpen[2], i);
      continue;
    }
    if (BLOCK_END_RE.test(line)) {
      const top = blockStack.pop();
      if (top) top.lineEnd = i;
      // A stray `end` is not an element.
      continue;
    }
    if (BLOCK_CONT_RE.test(line)) continue; // else / and belong to the enclosing block

    if (type === 'sequence') {
      const participant = line.match(PARTICIPANT_RE);
      if (participant) {
        const alias = participant[3] ? participant[3].trim() : undefined;
        elements.push({
          key: nextKey('p'),
          kind: 'participant',
          id: participant[2],
          alias,
          lineStart: i,
          lineEnd: i,
        });
        bump('p');
        continue;
      }

      const note = line.match(NOTE_RE);
      if (note) {
        const over = note[2].split(',').map(s => s.trim());
        elements.push({
          key: nextKey('note'),
          kind: 'note',
          over,
          text: note[3],
          lineStart: i,
          lineEnd: i,
        });
        bump('note');
        continue;
      }

      const message = line.match(MESSAGE_RE);
      if (message) {
        const label = message[4] !== undefined && message[4] !== '' ? message[4] : undefined;
        elements.push({
          key: nextKey('m'),
          kind: 'message',
          from: message[1],
          to: message[3],
          operator: message[2],
          label,
          lineStart: i,
          lineEnd: i,
        });
        bump('m');
        continue;
      }
      // Unrecognized sequence line: skipped, never an error.
      continue;
    }

    // Flowchart
    if (FC_SKIP_RE.test(line)) continue;

    const edgePipe = line.match(EDGE_PIPE_RE);
    if (edgePipe) {
      const label = edgePipe[5].trim();
      pushEdge(edgePipe[2], edgePipe[6], edgePipe[4], label === '' ? undefined : label, i, edgePipe[3], edgePipe[7]);
      continue;
    }

    const edgeText = line.match(EDGE_TEXT_RE);
    if (edgeText) {
      const right = edgeText[6];
      const operator = (right === '.->' || right === '.-') ? '-.->' : right;
      const label = edgeText[5].trim();
      pushEdge(edgeText[2], edgeText[7], operator, label === '' ? undefined : label, i, edgeText[3], edgeText[8]);
      continue;
    }

    const edgePlain = line.match(EDGE_PLAIN_RE);
    if (edgePlain) {
      pushEdge(edgePlain[2], edgePlain[5], edgePlain[4], undefined, i, edgePlain[3], edgePlain[6]);
      continue;
    }

    const nodeLine = line.match(NODE_LINE_RE);
    if (nodeLine) {
      registerNode(nodeLine[2], nodeLine[3], i);
      continue;
    }
    // Unrecognized flowchart line: skipped, never an error.
  }

  // Unclosed blocks span to the end of the file.
  for (const block of blockStack) {
    block.lineEnd = lines.length - 1;
  }

  elements.sort((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd);
  return { type, elements };
}
