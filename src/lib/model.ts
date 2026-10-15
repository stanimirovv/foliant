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

export type ParticipantType =
  | 'participant'
  | 'actor'
  | 'database'
  | 'queue'
  | 'boundary'
  | 'control'
  | 'entity'
  | 'collections';

export interface ParticipantElement extends BaseElement {
  kind: 'participant';
  id: string;
  alias?: string;
  participantType?: ParticipantType;
}

export interface MessageElement extends BaseElement {
  kind: 'message';
  from: string;
  to: string;
  operator: string;
  label?: string;
  activation?: '+' | '-';
  activateTarget?: boolean;
  deactivateSource?: boolean;
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

// Sticky notes are CONFIG annotations (views.ts `StickyNote`), not parsed
// diagram lines, so parseModel never emits them. The editor wraps each note in
// this pseudo-element (key `sticky:<id>`, line span pinned to the CONFIG
// header) so sticky notes join the same selection/tag/hide pipeline as parsed
// elements.
export interface StickyNoteElement extends BaseElement {
  kind: 'sticky';
  id: string;
  text: string;
  color?: string;
}

export type ModelElement = ParticipantElement | MessageElement | NoteElement
  | NodeElement | EdgeElement | BlockElement | RegionElement | ConfigElement
  | StickyNoteElement;

export interface DiagramModel {
  type: DiagramType;
  elements: ModelElement[];     // in source order
}

export const MERMAID_DIAGRAM_KEYWORDS = /^(sequenceDiagram|flowchart|graph|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|sankey|quadrantChart|xyChart|block|packet|architecture|kanban|radar|treemap|info|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|agentflow|swimlane)/i;

export function looksLikeMermaidDiagram(content: string): boolean {
  let inFrontmatter = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    return MERMAID_DIAGRAM_KEYWORDS.test(trimmed);
  }
  return false;
}

const ID = '[A-Za-z0-9_-]+';

const CONFIG_LINE_RE = /^%% (?:CONFIG|VIEWS): /;
const REGION_START_RE = /^%%\s*@region-start:\s*([a-zA-Z0-9_-]+)(?:=([a-zA-Z0-9_-]+))?/;

export interface ParsedParticipantLine {
  indent: string;
  keyword: 'participant' | 'actor';
  id: string;
  alias?: string;
  participantType: ParticipantType;
}

export function parseParticipantLine(line: string): ParsedParticipantLine | null {
  const m = line.match(/^(\s*)(participant|actor)\s+([A-Za-z0-9_-]+)(?:\s+(.*?))?$/);
  if (!m) return null;
  const indent = m[1];
  const keyword = m[2] as 'participant' | 'actor';
  const id = m[3];
  let rest = m[4] ? m[4].trim() : '';

  let typeFromMeta: ParticipantType | null = null;
  const metaMatch = rest.match(/(?:^|\s+)@\{\s*(.*?)\s*\}\s*$/);
  if (metaMatch) {
    const metaStr = metaMatch[0];
    const innerMeta = metaMatch[1];
    const typeMatch = innerMeta.match(/["']?(?:type|shape)["']?\s*:\s*["']?([A-Za-z0-9_-]+)["']?/);
    if (typeMatch) {
      typeFromMeta = typeMatch[1] as ParticipantType;
    }
    rest = rest.slice(0, rest.length - metaStr.length).trim();
  }

  let alias: string | undefined = undefined;
  if (rest.startsWith('as ')) {
    alias = rest.slice(3).trim();
  }

  const participantType: ParticipantType = typeFromMeta || keyword;
  return { indent, keyword, id, alias, participantType };
}

// Sequence diagrams
const NOTE_RE = new RegExp(`^\\s*Note\\s+(over|left of|right of)\\s+(${ID}(?:\\s*,\\s*${ID})*)\\s*:\\s*(.*)$`);
// Full operator set of Section 4.8, including bare `-` / `--` lines and activation +/-.
const MESSAGE_RE = new RegExp(`^\\s*([A-Za-z0-9_-]+?)\\s*(-->>|->>|--x|-x|-->o|->o|-->\\*|->\\*|--\\)|-\\)|-->|->|--|-)([+-]?)\\s*([A-Za-z0-9_-]+?)(?:\\s*:\\s*(.*))?$`);

// Blocks (both diagram types). `box` is emitted by transformActors in
// processed sequence code, so it must be tracked for end-matching.
const BLOCK_OPEN_RE = /^\s*(alt|opt|loop|par|rect|box|subgraph)(?:\s+(.*))?$/;
const BLOCK_END_RE = /^\s*end\s*$/;
const BLOCK_CONT_RE = /^\s*(else|and)\b/;

// Flowcharts
const FC_SKIP_RE = /^\s*(direction|click|style|classDef|class|linkStyle|accTitle|accDescr)\b/;

// Flowchart statement scanner ----------------------------------------------
//
// Mermaid allows several links on one statement line ("chained edges"):
// `A --> B --> C`, `A["x"] -.-> B["y"] -.-> C`, `A -- note --> B --> C`.
// The scanner walks the line left to right and returns its endpoints and
// links with exact spans, so callers can rebuild the line surgically.
// Anything unrecognized makes the whole line null — never a partial parse
// (NFR-01: malformed input is skipped, never an error).
//
// The shape vocabulary matches the preprocessor: [..] ((..)) (..) {..} >..]
// (the [..] alternative also covers the [(..)] cylinder shape). A shape token
// never contains its own closing delimiter, so it cannot swallow a following
// link of a chained line.

const FC_ID_RE = /[A-Za-z0-9_-]+/y;
const FC_SHAPE_RE = /(?:\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{[^}]*\}|>[^\]]*\])/y;
const FC_WS_RE = /[ \t]*/y;
const FC_PIPE_LABEL_RE = /\|([^|]*)\|/y;
// Link operators, more specific (longer) forms first — the historical EDGE_OPS
// alternation order.
const FC_OPS = ['<-->', '<==>', 'x--x', 'o--o', '-->', '==>', '-.->', '---', '--'];
// Open-text links (`A -- text --> B`): a leading operator, free text, then a
// trailing operator. `.->` / `.-` are read as `-.->` (historical behavior).
const FC_TEXT_SEG_RE = /(---|--|-\.)([ \t]+)(.+?)([ \t]+)(<-->|<==>|x--x|o--o|-->|==>|-\.->|---|--|\.->|\.-)[ \t]*/y;

export interface FlowchartEndpoint {
  id: string;
  shapeToken?: string;   // raw shape text including delimiters
  start: number;         // span of the id plus its optional shape token
  end: number;
  idEnd: number;         // end of the id (start of the shape token, if any)
  shapeStart?: number;
}

export interface FlowchartSegment {
  from: number;          // index into ParsedFlowchartLine.endpoints
  to: number;
  operator: string;      // normalized: '.->'/'.->' read as '-.->'
  label?: string;
  form: 'plain' | 'pipe' | 'text';
  opStart: number;       // span of the (trailing) operator
  opEnd: number;
  labelStart?: number;   // span of the label text (inside the pipes / between the operators)
  labelEnd?: number;
  pipeStart?: number;    // span of the whole |label| token (pipe form)
  pipeEnd?: number;
  leadOpStart?: number;  // start of the leading operator (text form)
}

export interface ParsedFlowchartLine {
  indent: string;
  endpoints: FlowchartEndpoint[];
  segments: FlowchartSegment[];
}

// Parse one flowchart statement line (a standalone node declaration or an
// edge line, possibly chained) into its endpoints and links. Returns null for
// anything unrecognized.
export function parseFlowchartLine(line: string): ParsedFlowchartLine | null {
  let pos = 0;
  FC_WS_RE.lastIndex = pos;
  const indent = FC_WS_RE.exec(line)![0];
  pos = FC_WS_RE.lastIndex;

  const endpoints: FlowchartEndpoint[] = [];
  const segments: FlowchartSegment[] = [];

  const skipWs = () => {
    FC_WS_RE.lastIndex = pos;
    FC_WS_RE.exec(line);
    pos = FC_WS_RE.lastIndex;
  };

  const parseEndpoint = (): number | null => {
    skipWs();
    FC_ID_RE.lastIndex = pos;
    const idMatch = FC_ID_RE.exec(line);
    if (!idMatch) return null;
    const id = idMatch[0];
    const start = pos;
    const idEnd = FC_ID_RE.lastIndex;
    pos = idEnd;
    skipWs();
    FC_SHAPE_RE.lastIndex = pos;
    const shapeMatch = FC_SHAPE_RE.exec(line);
    let end = idEnd;
    let shapeToken: string | undefined;
    let shapeStart: number | undefined;
    if (shapeMatch) {
      shapeToken = shapeMatch[0];
      shapeStart = pos;
      end = FC_SHAPE_RE.lastIndex;
      pos = end;
    }
    endpoints.push({ id, shapeToken, start, end, idEnd, shapeStart });
    return endpoints.length - 1;
  };

  const matchOp = (ops: string[]): { op: string; start: number; end: number } | null => {
    for (const op of ops) {
      if (line.startsWith(op, pos)) return { op, start: pos, end: pos + op.length };
    }
    return null;
  };

  if (parseEndpoint() === null) return null;

  while (true) {
    skipWs();
    if (pos >= line.length) break;
    const from = endpoints.length - 1;

    // Open-text link (`A -- text --> B`): tried before the plain/pipe forms,
    // mirroring the historical EDGE_TEXT_RE-before-EDGE_PLAIN_RE order — the
    // text form wins whenever it matches, so `A -- text --> B` is one labeled
    // link, not a link to a node called "text".
    FC_TEXT_SEG_RE.lastIndex = pos;
    const textSeg = FC_TEXT_SEG_RE.exec(line);
    if (textSeg) {
      const leadOpStart = pos;
      const labelStart = leadOpStart + textSeg[1].length + textSeg[2].length;
      const labelEnd = labelStart + textSeg[3].length;
      const trailOpStart = labelEnd + textSeg[4].length;
      const trailOp = textSeg[5];
      pos = FC_TEXT_SEG_RE.lastIndex;
      const to = parseEndpoint();
      if (to === null) return null;
      const label = textSeg[3].trim();
      segments.push({
        from,
        to,
        operator: trailOp === '.->' || trailOp === '.-' ? '-.->' : trailOp,
        label: label === '' ? undefined : label,
        form: 'text',
        opStart: trailOpStart,
        opEnd: trailOpStart + trailOp.length,
        labelStart,
        labelEnd,
        leadOpStart,
      });
      continue;
    }

    const opM = matchOp(FC_OPS);
    if (!opM) return null;  // unrecognized token: the whole line is skipped
    pos = opM.end;
    skipWs();
    FC_PIPE_LABEL_RE.lastIndex = pos;
    const pipeMatch = FC_PIPE_LABEL_RE.exec(line);
    if (pipeMatch) {
      const pipeStart = pos;
      const pipeEnd = FC_PIPE_LABEL_RE.lastIndex;
      pos = pipeEnd;
      const label = pipeMatch[1].trim();
      const to = parseEndpoint();
      if (to === null) return null;
      segments.push({
        from,
        to,
        operator: opM.op,
        label: label === '' ? undefined : label,
        form: 'pipe',
        opStart: opM.start,
        opEnd: opM.end,
        labelStart: pipeStart + 1,
        labelEnd: pipeEnd - 1,
        pipeStart,
        pipeEnd,
      });
      continue;
    }
    const to = parseEndpoint();
    if (to === null) return null;
    segments.push({ from, to, operator: opM.op, form: 'plain', opStart: opM.start, opEnd: opM.end });
  }

  return { indent, endpoints, segments };
}

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
      const participant = parseParticipantLine(line);
      if (participant) {
        elements.push({
          key: nextKey('p'),
          kind: 'participant',
          id: participant.id,
          ...(participant.alias !== undefined ? { alias: participant.alias } : {}),
          ...(participant.participantType !== 'participant' ? { participantType: participant.participantType } : {}),
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
        const label = message[5] !== undefined && message[5] !== '' ? message[5] : undefined;
        const activation = (message[3] === '+' || message[3] === '-') ? (message[3] as '+' | '-') : undefined;
        let activateTarget = activation === '+';
        let deactivateSource = activation === '-';

        // Check if immediately following line is `activate <to>` or `deactivate <from>`
        if (i + 1 < lines.length) {
          const nextTrimmed = lines[i + 1].trim();
          if (nextTrimmed === `activate ${message[4]}`) activateTarget = true;
          if (nextTrimmed === `deactivate ${message[1]}`) deactivateSource = true;
        }

        elements.push({
          key: nextKey('m'),
          kind: 'message',
          from: message[1],
          to: message[4],
          operator: message[2],
          ...(label !== undefined ? { label } : {}),
          ...(activation !== undefined ? { activation } : {}),
          ...(activateTarget ? { activateTarget: true } : {}),
          ...(deactivateSource ? { deactivateSource: true } : {}),
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

    const fcLine = parseFlowchartLine(line);
    if (fcLine) {
      // Register every endpoint first (first declaration wins, as before),
      // then emit one edge element per link of the chain.
      for (const ep of fcLine.endpoints) registerNode(ep.id, ep.shapeToken, i);
      for (const seg of fcLine.segments) {
        const el: EdgeElement = {
          key: nextKey('e'),
          kind: 'edge',
          from: fcLine.endpoints[seg.from].id,
          to: fcLine.endpoints[seg.to].id,
          operator: seg.operator,
          ...(seg.label !== undefined ? { label: seg.label } : {}),
          lineStart: i,
          lineEnd: i,
        };
        bump('e');
        elements.push(el);
      }
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
