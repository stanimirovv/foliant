// Pure editor transforms (EDITING_PLAN.md Section 4.5).
// Every transform is (code, config, ...args) -> { code, config, warning? }.
// Transforms are line-surgical: untouched lines are preserved byte-for-byte
// (NFR-02), and malformed input is a no-op with a warning, never a
// corruption (NFR-01).

import { parseModel, parseShapeToken, SHAPE_DELIMITERS, ModelElement } from './model';
import { ArrowStyle, DiagramConfig, updateViewsData } from './views';

export interface EditResult {
  code: string;
  config: DiagramConfig | null;
  warning?: string;
  cascaded?: string[];   // deleteElement: keys of referencing elements also removed
  newKey?: string;       // addMessage: key of the created element (so the UI can select it)
}

// The complete desired arrow style; empty/undefined fields mean "no style".
export type ArrowStylePatch = Pick<ArrowStyle, 'color' | 'width' | 'dash'>;

const ID = '[A-Za-z0-9_-]+';
const SHAPE = String.raw`(?:\[.*?\]|\(\(.*?\)\)|\(.*?\)|\{.*?\}|>.*?\])`;
const FC_OPS = '<-->|<==>|x--x|o--o|-->|==>|-\\.->|---|--';

const SEQUENCE_OPERATORS = new Set(['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '-', '--']);
const FLOWCHART_OPERATORS = new Set(['---', '-->', '==>', '-.->', '<-->', '<==>', 'x--x', 'o--o']);
const TAG_RE = /^[A-Za-z0-9_-]+$/;

const UNSUPPORTED = 'Unsupported diagram type (editing supports sequence and flowchart diagrams)';

// Verbose line regexes: capture every whitespace segment so rebuilt lines
// preserve the original spacing byte-for-byte outside the edited span.
const SEQ_PARTICIPANT_V = /^(\s*)(participant|actor)\s+([A-Za-z0-9_-]+)(?:\s+as\s+(.*))?$/;
const SEQ_MSG_V = /^(\s*)([A-Za-z0-9_-]+?)(\s*)(-->>|->>|--x|-x|--\)|-\)|-->|->|--|-)(\s*)([A-Za-z0-9_-]+?)(\s*)(?::([ \t]*)(.*))?$/;
const FC_EDGE_PIPE_V = new RegExp(`^(\\s*)(${ID})(\\s*)(${SHAPE})?(\\s*)(${FC_OPS})(\\s*)(\\|([^|]*)\\|)?(\\s*)(${ID})(\\s*)(${SHAPE})?(\\s*)$`);
const FC_EDGE_TEXT_V = new RegExp(`^(\\s*)(${ID})(\\s*)(${SHAPE})?(\\s*)(--|---|-\\.)(\\s+)(.+?)(\\s+)(\\.->|\\.-|${FC_OPS})(\\s*)(${ID})(\\s*)(${SHAPE})?(\\s*)$`);
const FC_NODE_V = new RegExp(`^(\\s*)(${ID})(\\s*)(${SHAPE})?(\\s*)$`);

function fail(code: string, config: DiagramConfig | null, warning: string): EditResult {
  return { code, config, warning };
}

function findElement(model: ReturnType<typeof parseModel>, key: string): ModelElement | undefined {
  return model.elements.find(e => e.key === key);
}

function cloneConfig(config: DiagramConfig | null): DiagramConfig | null {
  if (!config) return null;
  return {
    ...config,
    views: config.views?.map(v => ({ ...v, hiddenPaths: [...v.hiddenPaths] })),
    actors: config.actors
      ? Object.fromEntries(Object.entries(config.actors).map(([k, v]) => [k, { ...v, keys: v.keys ? [...v.keys] : undefined }]))
      : undefined,
    arrows: config.arrows?.map(a => ({ ...a })),
  };
}

// Drop actor entries that carry no state, and empty containers.
function pruneConfig(config: DiagramConfig): void {
  if (config.actors) {
    for (const [id, meta] of Object.entries(config.actors)) {
      if (!meta.color && (!meta.keys || meta.keys.length === 0)) {
        delete config.actors[id];
      }
    }
    if (Object.keys(config.actors).length === 0) delete config.actors;
  }
  if (config.arrows && config.arrows.length === 0) delete config.arrows;
}

function replaceLines(code: string, lineStart: number, lineEnd: number, newLines: string[]): string {
  const lines = code.split('\n');
  lines.splice(lineStart, lineEnd - lineStart + 1, ...newLines);
  return lines.join('\n');
}

// Append a line at the end of the file, keeping a trailing newline in place.
function appendLine(lines: string[], line: string): string {
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.splice(lines.length - 1, 0, line);
  } else {
    lines.push(line);
  }
  return lines.join('\n');
}

// 0-based occurrence of el among same-(kind, from, to, label) elements.
function elementOccurrence(model: ReturnType<typeof parseModel>, el: ModelElement): number {
  if (el.kind !== 'message' && el.kind !== 'edge') return 0;
  let occurrence = 0;
  for (const e of model.elements) {
    if (e === el) break;
    if ((e.kind === 'message' || e.kind === 'edge') &&
        e.from === el.from && e.to === el.to && (e.label ?? undefined) === (el.label ?? undefined)) {
      occurrence++;
    }
  }
  return occurrence;
}

function arrowsMatchEntry(entry: ArrowStyle, from: string, to: string, label: string | undefined, occurrence: number): boolean {
  return entry.from === from && entry.to === to &&
    (entry.label ?? undefined) === (label ?? undefined) &&
    (entry.occurrence ?? 0) === occurrence;
}

function isArrow(el: ModelElement): el is ModelElement & { from: string; to: string; label?: string } {
  return el.kind === 'message' || el.kind === 'edge';
}

function isComponent(el: ModelElement): el is ModelElement & { id: string } {
  return el.kind === 'participant' || el.kind === 'node';
}

// New shape token for a renamed node: inject a rect shape for bare nodes,
// drop the shape when the alias is cleared (the id becomes the label).
// Returns undefined when there is nothing to change.
function shapeTokenForAlias(shapeToken: string | undefined, alias: string): string | undefined {
  if (!shapeToken) {
    if (!alias) return undefined;
    return `[${alias}]`;
  }
  if (!alias) return '';
  const parsed = parseShapeToken(shapeToken);
  if (!parsed) return undefined;
  const [open, close] = SHAPE_DELIMITERS[parsed.shape];
  return `${open}${alias}${close}`;
}

// From-endpoint of an edge line: id, ws before the shape, shape, ws before the
// operator. Returns the replacement text and the whitespace that follows it.
// newShape === undefined keeps the endpoint byte-identical.
function fromEndpoint(id: string, wsBeforeShape: string, shape: string | undefined, newShape: string | undefined, wsBeforeOp: string): { text: string; sep: string } {
  if (newShape === undefined) return { text: `${id}${wsBeforeShape}${shape ?? ''}`, sep: wsBeforeOp };
  if (newShape === '') return { text: id, sep: (wsBeforeShape + wsBeforeOp) === '' ? '' : ' ' };
  if (shape === undefined) return { text: `${id}${newShape}`, sep: wsBeforeShape + wsBeforeOp };
  return { text: `${id}${wsBeforeShape}${newShape}`, sep: wsBeforeOp };
}

// To-endpoint of an edge line: id, ws before the shape, shape, trailing ws.
function toEndpoint(id: string, wsBeforeShape: string, shape: string | undefined, newShape: string | undefined, trailing: string): { text: string; trailing: string } {
  if (newShape === undefined) return { text: `${id}${wsBeforeShape}${shape ?? ''}`, trailing };
  if (newShape === '') return { text: id, trailing: (wsBeforeShape + trailing) === '' ? '' : (wsBeforeShape || trailing) };
  if (shape === undefined) return { text: `${id}${newShape}`, trailing: wsBeforeShape + trailing };
  return { text: `${id}${wsBeforeShape}${newShape}`, trailing };
}

// Rewrite the label of node nodeId on its defining line (standalone node line
// or an edge line). Returns the new line, null for a no-op, or undefined when
// the line does not define nodeId.
function rewriteFlowchartNodeLabel(line: string, nodeId: string, alias: string): string | null | undefined {
  const pipe = line.match(FC_EDGE_PIPE_V);
  if (pipe) {
    if (pipe[2] !== nodeId && pipe[11] !== nodeId) return undefined;
    const from = pipe[2] === nodeId ? fromEndpoint(pipe[2], pipe[3], pipe[4], shapeTokenForAlias(pipe[4], alias), pipe[5]) : undefined;
    const to = pipe[11] === nodeId ? toEndpoint(pipe[11], pipe[12], pipe[13], shapeTokenForAlias(pipe[13], alias), pipe[14]) : undefined;
    if (!from && !to) return null;
    const fromText = from ? from.text : `${pipe[2]}${pipe[3]}${pipe[4] ?? ''}`;
    const fromSep = from ? from.sep : pipe[5];
    const toText = to ? to.text : `${pipe[11]}${pipe[12]}${pipe[13] ?? ''}`;
    const toTrail = to ? to.trailing : pipe[14];
    return `${pipe[1]}${fromText}${fromSep}${pipe[6]}${pipe[7]}${pipe[8] ?? ''}${pipe[10]}${toText}${toTrail}`;
  }
  const text = line.match(FC_EDGE_TEXT_V);
  if (text) {
    if (text[2] !== nodeId && text[12] !== nodeId) return undefined;
    const from = text[2] === nodeId ? fromEndpoint(text[2], text[3], text[4], shapeTokenForAlias(text[4], alias), text[5]) : undefined;
    const to = text[12] === nodeId ? toEndpoint(text[12], text[13], text[14], shapeTokenForAlias(text[14], alias), text[15]) : undefined;
    if (!from && !to) return null;
    const fromText = from ? from.text : `${text[2]}${text[3]}${text[4] ?? ''}`;
    const fromSep = from ? from.sep : text[5];
    const toText = to ? to.text : `${text[12]}${text[13]}${text[14] ?? ''}`;
    const toTrail = to ? to.trailing : text[15];
    return `${text[1]}${fromText}${fromSep}${text[6]}${text[7]}${text[8]}${text[9]}${text[10]}${text[11]}${toText}${toTrail}`;
  }
  const node = line.match(FC_NODE_V);
  if (node) {
    if (node[2] !== nodeId) return undefined;
    const newShape = shapeTokenForAlias(node[4], alias);
    if (newShape === undefined) return null;
    if (newShape === '') return `${node[1]}${node[2]}${node[3] || node[5]}`;
    return `${node[1]}${node[2]}${node[3]}${newShape}${node[5]}`;
  }
  return undefined;
}

// Rewrite the label of a flowchart edge (pipe form, open-text form, or plain).
// Returns the new line, null for a no-op, or undefined for a non-edge line.
function rewriteFlowchartEdgeLabel(line: string, newLabel: string): string | null | undefined {
  const pipe = line.match(FC_EDGE_PIPE_V);
  if (pipe) {
    const fromText = `${pipe[2]}${pipe[3]}${pipe[4] ?? ''}`;
    const toText = `${pipe[11]}${pipe[12]}${pipe[13] ?? ''}`;
    const head = `${pipe[1]}${fromText}${pipe[5]}${pipe[6]}`;
    const tail = `${toText}${pipe[14]}`;
    if (newLabel === '') {
      if (pipe[8] === undefined) return null; // plain edge: nothing to clear
      return `${head}${pipe[7] || pipe[10] || ' '}${tail}`;
    }
    if (pipe[8] !== undefined) {
      return `${head}${pipe[7]}|${newLabel}|${pipe[10]}${tail}`;
    }
    return `${head}|${newLabel}|${pipe[7] || ' '}${tail}`;
  }
  const text = line.match(FC_EDGE_TEXT_V);
  if (text) {
    const fromText = `${text[2]}${text[3]}${text[4] ?? ''}`;
    const toText = `${text[12]}${text[13]}${text[14] ?? ''}`;
    if (newLabel === '') {
      // Normalize the open-text form to a plain edge with the right-hand operator.
      const right = text[10];
      const op = (right === '.->' || right === '.-') ? '-.->' : right;
      return `${text[1]}${fromText}${text[5]}${op} ${toText}${text[15]}`;
    }
    return `${text[1]}${fromText}${text[5]}${text[6]}${text[7]}${newLabel}${text[9]}${text[10]}${text[11]}${toText}${text[15]}`;
  }
  return undefined;
}

// Replace the operator of a flowchart edge in place; the open-text form is
// normalized to the pipe form. Returns the new line or undefined for a
// non-edge line.
function rewriteFlowchartEdgeOperator(line: string, operator: string): string | undefined {
  const pipe = line.match(FC_EDGE_PIPE_V);
  if (pipe) {
    const fromText = `${pipe[2]}${pipe[3]}${pipe[4] ?? ''}`;
    const toText = `${pipe[11]}${pipe[12]}${pipe[13] ?? ''}`;
    return `${pipe[1]}${fromText}${pipe[5]}${operator}${pipe[7]}${pipe[8] ?? ''}${pipe[10]}${toText}${pipe[14]}`;
  }
  const text = line.match(FC_EDGE_TEXT_V);
  if (text) {
    const fromText = `${text[2]}${text[3]}${text[4] ?? ''}`;
    const toText = `${text[12]}${text[13]}${text[14] ?? ''}`;
    return `${text[1]}${fromText}${text[5]}${operator} |${text[8]}|${text[11] || ' '}${toText}${text[15]}`;
  }
  return undefined;
}

// Endpoints of a flowchart edge line (pipe form or open-text form): the
// indent plus each endpoint's id and full declaration (id + shape token).
// Undefined for standalone node lines and other non-edge lines.
function flowchartEdgeEndpoints(line: string): { indent: string; fromId: string; fromDecl: string; toId: string; toDecl: string } | undefined {
  const pipe = line.match(FC_EDGE_PIPE_V);
  if (pipe) {
    return {
      indent: pipe[1],
      fromId: pipe[2],
      fromDecl: `${pipe[2]}${pipe[3]}${pipe[4] ?? ''}`.trimEnd(),
      toId: pipe[11],
      toDecl: `${pipe[11]}${pipe[12]}${pipe[13] ?? ''}`.trimEnd(),
    };
  }
  const text = line.match(FC_EDGE_TEXT_V);
  if (text) {
    return {
      indent: text[1],
      fromId: text[2],
      fromDecl: `${text[2]}${text[3]}${text[4] ?? ''}`.trimEnd(),
      toId: text[12],
      toDecl: `${text[12]}${text[13]}${text[14] ?? ''}`.trimEnd(),
    };
  }
  return undefined;
}

// Rewrite the text after `:` on a sequence message line. An empty label
// drops the `: text` part (bare message).
function rewriteSequenceMessageLabel(line: string, newLabel: string): string | null {
  const m = line.match(SEQ_MSG_V);
  if (!m) return null;
  const head = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
  if (newLabel === '') return head;
  if (m[9] !== undefined) return `${head}${m[7]}:${m[8]}${newLabel}`;
  return `${head}: ${newLabel}`;
}

// Replace the operator token on a sequence message line, preserving the
// label and whitespace.
function rewriteSequenceMessageOperator(line: string, operator: string): string | null {
  const m = line.match(SEQ_MSG_V);
  if (!m) return null;
  const tail = m[9] !== undefined ? `${m[7]}:${m[8]}${m[9]}` : '';
  return `${m[1]}${m[2]}${m[3]}${operator}${m[5]}${m[6]}${tail}`;
}

export function renameParticipant(code: string, config: DiagramConfig | null, key: string, newAlias: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el) return fail(code, config, `Unknown element key: ${key}`);
  const alias = newAlias.trim();
  if (alias.includes('\n')) return fail(code, config, 'Label must be a single line');

  if (model.type === 'sequence') {
    if (el.kind !== 'participant') return fail(code, config, `Element ${key} is not a participant`);
    const line = code.split('\n')[el.lineStart];
    const m = line.match(SEQ_PARTICIPANT_V);
    if (!m) return fail(code, config, `Cannot parse participant line: ${line.trim()}`);
    const newLine = `${m[1]}${m[2]} ${m[3]}${alias ? ` as ${alias}` : ''}`;
    return { code: replaceLines(code, el.lineStart, el.lineEnd, [newLine]), config };
  }

  if (el.kind !== 'node') return fail(code, config, `Element ${key} is not a node`);
  // The label is written inside the node's shape delimiters; characters that
  // would break the shape are rejected (soft-fail).
  const forbiddenChars = el.shape === 'rhombus' ? ['{', '}']
    : el.shape === 'round' || el.shape === 'circle' ? ['(', ')']
    : ['[', ']'];
  if (forbiddenChars.some(c => alias.includes(c))) {
    return fail(code, config, `Label cannot contain '${forbiddenChars.join('')}' for this node shape`);
  }
  const line = code.split('\n')[el.lineStart];
  const newLine = rewriteFlowchartNodeLabel(line, el.id, alias);
  if (newLine === undefined) return fail(code, config, `Cannot parse node line: ${line.trim()}`);
  if (newLine === null) return { code, config }; // bare node with empty alias: already shows the id
  return { code: replaceLines(code, el.lineStart, el.lineEnd, [newLine]), config };
}

export function editMessageLabel(code: string, config: DiagramConfig | null, key: string, newLabel: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isArrow(el)) return fail(code, config, `Element ${key} is not a message or edge`);
  if (newLabel.includes('\n')) return fail(code, config, 'Label must be a single line');

  const line = code.split('\n')[el.lineStart];
  const newLine = model.type === 'sequence'
    ? rewriteSequenceMessageLabel(line, newLabel)
    : rewriteFlowchartEdgeLabel(line, newLabel);
  if (newLine === undefined) return fail(code, config, `Cannot parse message line: ${line.trim()}`);
  if (newLine === null) return { code, config }; // nothing to clear
  return { code: replaceLines(code, el.lineStart, el.lineEnd, [newLine]), config };
}

export function setArrowType(code: string, config: DiagramConfig | null, key: string, operator: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isArrow(el)) return fail(code, config, `Element ${key} is not a message or edge`);
  const valid = model.type === 'sequence' ? SEQUENCE_OPERATORS : FLOWCHART_OPERATORS;
  if (!valid.has(operator)) return fail(code, config, `Unknown arrow operator: ${operator}`);

  const line = code.split('\n')[el.lineStart];
  const newLine = model.type === 'sequence'
    ? rewriteSequenceMessageOperator(line, operator)
    : rewriteFlowchartEdgeOperator(line, operator);
  if (newLine === undefined || newLine === null) return fail(code, config, `Cannot parse message line: ${line.trim()}`);
  return { code: replaceLines(code, el.lineStart, el.lineEnd, [newLine]), config };
}

export function addParticipant(code: string, config: DiagramConfig | null, afterKey?: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);

  // Dedup the generated id against every actor id in the diagram (participants,
  // message/edge endpoints and notes all create actors in Mermaid).
  const taken = new Set<string>();
  for (const e of model.elements) {
    if (isComponent(e)) taken.add(e.id);
    if (isArrow(e)) { taken.add(e.from); taken.add(e.to); }
    if (e.kind === 'note') e.over.forEach(id => taken.add(id));
  }
  let n = 1;
  while (taken.has(`New${n}`)) n++;
  const id = `New${n}`;

  const lines = code.split('\n');

  if (model.type === 'flowchart') {
    return { code: appendLine(lines, `    ${id}[New Participant]`), config };
  }

  let afterLine: number;
  if (afterKey !== undefined) {
    const el = findElement(model, afterKey);
    if (!el) return fail(code, config, `Unknown element key: ${afterKey}`);
    afterLine = el.lineEnd;
  } else {
    const lastParticipant = [...model.elements].reverse().find(e => e.kind === 'participant');
    afterLine = lastParticipant ? lastParticipant.lineEnd : lines.findIndex(l => /^\s*sequenceDiagram\b/.test(l));
  }
  const alias = id === 'New1' ? 'New Participant' : `New Participant ${id.slice(3)}`;
  lines.splice(afterLine + 1, 0, `    participant ${id} as ${alias}`);
  return { code: lines.join('\n'), config };
}

// Where a new message/edge is inserted vertically (sequence diagrams):
//   top    — right after the last participant declaration (before all messages)
//   bottom — appended at the end of the file (default)
//   before — immediately before the given element (message/note/block)
//   after  — immediately after the given element
export type MessageInsertPosition =
  | { type: 'top' }
  | { type: 'bottom' }
  | { type: 'before'; key: string }
  | { type: 'after'; key: string };

export function addMessage(
  code: string,
  config: DiagramConfig | null,
  fromKey: string,
  toKey: string,
  position: MessageInsertPosition = { type: 'bottom' },
): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const componentKind = model.type === 'sequence' ? 'participant' : 'node';
  const fromEl = findElement(model, fromKey);
  const toEl = findElement(model, toKey);
  if (!fromEl || fromEl.kind !== componentKind) return fail(code, config, `Unknown ${componentKind} key: ${fromKey}`);
  if (!toEl || toEl.kind !== componentKind) return fail(code, config, `Unknown ${componentKind} key: ${toKey}`);

  const lines = code.split('\n');
  const line = model.type === 'sequence'
    ? `    ${fromEl.id}->>${toEl.id}: New message`
    : `    ${fromEl.id} --> ${toEl.id}`;

  let insertAt: number;
  switch (position.type) {
    case 'bottom':
      // Keep a trailing newline last: insert before a trailing empty line.
      insertAt = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      break;
    case 'before': {
      const el = findElement(model, position.key);
      if (!el) return fail(code, config, `Unknown element key: ${position.key}`);
      insertAt = el.lineStart;
      break;
    }
    case 'after': {
      const el = findElement(model, position.key);
      if (!el) return fail(code, config, `Unknown element key: ${position.key}`);
      insertAt = el.lineEnd + 1;
      break;
    }
    case 'top': {
      // Insert right after the last participant declaration (sequence) or the
      // type line (flowchart, no participants yet).
      const lastParticipant = [...model.elements].reverse().find(e => e.kind === 'participant');
      insertAt = lastParticipant
        ? lastParticipant.lineEnd + 1
        : lines.findIndex(l => /^\s*(sequenceDiagram|flowchart|graph)\b/.test(l)) + 1;
      break;
    }
  }
  lines.splice(insertAt, 0, line);
  const newCode = lines.join('\n');
  // Report the created element's key so the UI can select it: re-parse and find
  // the message/edge sitting on the inserted line.
  const created = parseModel(newCode).elements.find(
    e => e.lineStart === insertAt && (e.kind === 'message' || e.kind === 'edge')
  );
  return { code: newCode, config, newKey: created?.key };
}

// Move a participant's declaration to a new position among the participants
// (sequence diagrams only). The participant's messages/notes are untouched —
// they reference the participant by id, so only the visual order changes.
// beforeKey === undefined moves the participant to the end (after the last
// participant).
export function moveParticipant(
  code: string,
  config: DiagramConfig | null,
  key: string,
  beforeKey?: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'participant') return fail(code, config, `Element ${key} is not a participant`);

  const participants = model.elements.filter(e => e.kind === 'participant');
  const currentIndex = participants.findIndex(p => p.key === key);
  if (currentIndex < 0) return fail(code, config, `Unknown participant: ${key}`);

  // Determine the target participant (the one the dragged participant should
  // land before). undefined = move to end.
  let targetEl: ModelElement | undefined;
  if (beforeKey !== undefined) {
    targetEl = findElement(model, beforeKey);
    if (!targetEl || targetEl.kind !== 'participant') {
      return fail(code, config, `Unknown participant key: ${beforeKey}`);
    }
    if (targetEl.key === key) return { code, config }; // no-op
  }

  const lines = code.split('\n');
  const participantLine = lines[el.lineStart];

  // Remove the participant's declaration line.
  lines.splice(el.lineStart, 1);

  // Compute the insertion line in the post-removal line array. Line numbers
  // after el.lineStart shift down by 1.
  const adjust = (lineNo: number) => lineNo > el.lineStart ? lineNo - 1 : lineNo;

  let insertAt: number;
  if (targetEl) {
    insertAt = adjust(targetEl.lineStart);
  } else {
    // Move to end: after the last remaining participant.
    const remaining = participants.filter(p => p.key !== key);
    if (remaining.length === 0) {
      // Only one participant: nothing to reorder.
      lines.splice(el.lineStart, 0, participantLine);
      return { code, config };
    }
    const lastRemaining = remaining[remaining.length - 1];
    insertAt = adjust(lastRemaining.lineEnd) + 1;
  }

  lines.splice(insertAt, 0, participantLine);
  const newCode = lines.join('\n');
  // Report the moved participant's key in the new code: keys are positional,
  // so the key changes when the participant changes position. Lets the UI
  // keep the dragged participant selected after the reorder.
  const moved = parseModel(newCode).elements.find(
    e => e.kind === 'participant' && e.id === el.id
  );
  return { code: newCode, config, newKey: moved?.key };
}

export function deleteElement(code: string, config: DiagramConfig | null, key: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el) return fail(code, config, `Unknown element key: ${key}`);
  if (!isComponent(el) && !isArrow(el) && el.kind !== 'note') {
    return fail(code, config, `Cannot delete element of kind '${el.kind}'`);
  }

  // Cascade: deleting a component also deletes every message/edge/note that
  // references it (Mermaid auto-creates actors from messages, so removing the
  // declaration line alone is not enough).
  const cascaded: ModelElement[] = [];
  if (isComponent(el)) {
    for (const e of model.elements) {
      if (e === el) continue;
      if (isArrow(e) && (e.from === el.id || e.to === el.id)) cascaded.push(e);
      if (e.kind === 'note' && e.over.includes(el.id)) cascaded.push(e);
    }
  }

  const lines = code.split('\n');

  // A flowchart edge line can also be the first declaration of its endpoints
  // (`A[Alice] --> B[Bob]`). Dropping such a line outright would silently
  // delete nodes that outlive the removed element, so the line is rewritten
  // to keep the surviving declaration(s) instead of being spliced out.
  const removed = new Set<ModelElement>([el, ...cascaded]);
  const rewriteAt = new Map<number, string[]>();
  if (model.type === 'flowchart') {
    const firstDeclaredHere = (id: string, lineNo: number) =>
      model.elements.some(e => e.kind === 'node' && e.id === id && e.lineStart === lineNo);
    // A deleted node's own declaration must never survive on a rewritten line.
    const deletedNodeId = el.kind === 'node' ? el.id : undefined;
    for (const r of [el, ...cascaded]) {
      if (!removed.has(r)) continue; // already rewritten away by a sibling element
      if (r.lineStart !== r.lineEnd) continue;
      const endpoints = flowchartEdgeEndpoints(lines[r.lineStart]);
      if (!endpoints) continue;
      if (r.kind === 'node') {
        if (endpoints.fromId !== r.id && endpoints.toId !== r.id) continue;
        if (endpoints.fromId === endpoints.toId) continue; // self-loop: nothing survives
        const keptId = endpoints.fromId === r.id ? endpoints.toId : endpoints.fromId;
        const keptDecl = endpoints.fromId === r.id ? endpoints.toDecl : endpoints.fromDecl;
        // Declared on an earlier line: plain removal loses nothing.
        if (!firstDeclaredHere(keptId, r.lineStart)) continue;
        rewriteAt.set(r.lineStart, [`${endpoints.indent}${keptDecl}`]);
        removed.delete(r);
        const shared = cascaded.find(c => isArrow(c) && c.lineStart === r.lineStart &&
          c.lineEnd === r.lineEnd && (c.from === r.id || c.to === r.id));
        if (shared) removed.delete(shared);
      } else if (r.kind === 'edge') {
        const keepFrom = endpoints.fromId !== deletedNodeId && firstDeclaredHere(r.from, r.lineStart);
        const keepTo = endpoints.fromId !== endpoints.toId && endpoints.toId !== deletedNodeId && firstDeclaredHere(r.to, r.lineStart);
        if (!keepFrom && !keepTo) continue;
        const decls: string[] = [];
        if (keepFrom) decls.push(`${endpoints.indent}${endpoints.fromDecl}`);
        if (keepTo) decls.push(`${endpoints.indent}${endpoints.toDecl}`);
        rewriteAt.set(r.lineStart, decls);
        removed.delete(r);
      }
    }
  }

  // One pass: rewrite the shared lines, drop the removed spans. The drop set
  // deduplicates spans that share a line (e.g. a node and its self-loop edge).
  const drop = new Set<number>();
  for (const r of removed) {
    for (let i = r.lineStart; i <= r.lineEnd; i++) drop.add(i);
  }
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rewrite = rewriteAt.get(i);
    if (rewrite) { kept.push(...rewrite); continue; }
    if (drop.has(i)) continue;
    kept.push(lines[i]);
  }
  const newCode = kept.join('\n');

  // Config cleanup: drop the component's actor entry and the arrow styles of
  // every removed element.
  const newConfig = cloneConfig(config);
  if (newConfig) {
    if (isComponent(el) && newConfig.actors) delete newConfig.actors[el.id];
    const arrowTargets: { from: string; to: string; label?: string; occurrence: number }[] = [];
    if (isArrow(el)) arrowTargets.push({ from: el.from, to: el.to, label: el.label, occurrence: elementOccurrence(model, el) });
    for (const c of cascaded) {
      if (isArrow(c)) arrowTargets.push({ from: c.from, to: c.to, label: c.label, occurrence: elementOccurrence(model, c) });
    }
    if (newConfig.arrows) {
      newConfig.arrows = newConfig.arrows.filter(a => {
        if (isComponent(el) && (a.from === el.id || a.to === el.id)) return false;
        return !arrowTargets.some(t => arrowsMatchEntry(a, t.from, t.to, t.label, t.occurrence));
      });
    }
    pruneConfig(newConfig);
  }

  return {
    code: newConfig ? updateViewsData(newCode, newConfig) : newCode,
    config: newConfig,
    cascaded: cascaded.map(c => c.key),
  };
}

export function setActorColor(code: string, config: DiagramConfig | null, key: string, color: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isComponent(el)) return fail(code, config, `Element ${key} is not a component`);
  const trimmed = color.trim();
  if (trimmed.includes('\n')) return fail(code, config, 'Color must be a single line');

  const existing = config?.actors?.[el.id];
  if (!trimmed && (!existing || !existing.color)) return { code, config }; // nothing to clear

  const newConfig = cloneConfig(config) ?? { version: 1 };
  newConfig.actors = newConfig.actors ?? {};
  const meta = newConfig.actors[el.id] ?? {};
  newConfig.actors[el.id] = meta;
  if (trimmed) meta.color = trimmed; else delete meta.color;
  pruneConfig(newConfig);
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

export function addTag(code: string, config: DiagramConfig | null, key: string, tag: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isComponent(el)) return fail(code, config, `Element ${key} is not a component`);
  const t = tag.trim();
  if (!TAG_RE.test(t)) return fail(code, config, `Invalid tag: ${tag}`);

  const newConfig = cloneConfig(config) ?? { version: 1 };
  newConfig.actors = newConfig.actors ?? {};
  const meta = newConfig.actors[el.id] ?? {};
  newConfig.actors[el.id] = meta;
  meta.keys = meta.keys ?? [];
  if (!meta.keys.includes(t)) meta.keys.push(t);
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

export function removeTag(code: string, config: DiagramConfig | null, key: string, tag: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isComponent(el)) return fail(code, config, `Element ${key} is not a component`);
  const existing = config?.actors?.[el.id];
  if (!existing?.keys?.includes(tag)) return { code, config }; // nothing to remove

  const newConfig = cloneConfig(config) ?? { version: 1 };
  const meta = newConfig.actors![el.id];
  meta.keys = meta.keys!.filter(k => k !== tag);
  pruneConfig(newConfig);
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

export function setArrowStyle(code: string, config: DiagramConfig | null, key: string, style: ArrowStylePatch): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isArrow(el)) return fail(code, config, `Element ${key} is not a message or edge`);
  if (style.width !== undefined && (!Number.isInteger(style.width) || style.width < 1 || style.width > 10)) {
    return fail(code, config, 'Arrow width must be an integer between 1 and 10');
  }

  const color = style.color !== undefined && style.color.trim() !== '' ? style.color.trim() : undefined;
  const width = style.width;
  const dash = style.dash !== undefined && style.dash !== 'solid' ? style.dash : undefined;

  const occurrence = elementOccurrence(model, el);
  const newConfig = cloneConfig(config) ?? { version: 1 };
  const arrows = newConfig.arrows ? [...newConfig.arrows] : [];
  const idx = arrows.findIndex(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));

  const hasStyle = color !== undefined || width !== undefined || dash !== undefined;
  let changed = false;
  if (hasStyle) {
    const entry: ArrowStyle = { from: el.from, to: el.to };
    if (el.label !== undefined) entry.label = el.label;
    if (occurrence > 0) entry.occurrence = occurrence;
    if (color !== undefined) entry.color = color;
    if (width !== undefined) entry.width = width;
    if (dash !== undefined) entry.dash = dash;
    if (idx >= 0) {
      if (JSON.stringify(arrows[idx]) !== JSON.stringify(entry)) {
        arrows[idx] = entry;
        changed = true;
      }
    } else {
      arrows.push(entry);
      changed = true;
    }
  } else if (idx >= 0) {
    arrows.splice(idx, 1);
    changed = true;
  }

  if (!changed) return { code, config };
  newConfig.arrows = arrows;
  pruneConfig(newConfig);
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

// The style currently stored for an arrow element, or null when it has none.
// Used to populate the panel fields; dash is normalized (absent means 'solid').
export function getArrowStyle(code: string, config: DiagramConfig | null, key: string): ArrowStylePatch | null {
  const model = parseModel(code);
  const el = findElement(model, key);
  if (!el || !isArrow(el) || !config?.arrows) return null;
  const occurrence = elementOccurrence(model, el);
  const entry = config.arrows.find(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));
  if (!entry) return null;
  return {
    color: entry.color,
    width: entry.width,
    dash: entry.dash ?? 'solid',
  };
}
