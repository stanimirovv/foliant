// Pure editor transforms (EDITING_PLAN.md Section 4.5).
// Every transform is (code, config, ...args) -> { code, config, warning? }.
// Transforms are line-surgical: untouched lines are preserved byte-for-byte
// (NFR-02), and malformed input is a no-op with a warning, never a
// corruption (NFR-01).

import { parseModel, parseShapeToken, SHAPE_DELIMITERS, ModelElement, MessageElement, EdgeElement, ParticipantElement } from './model';
import { ArrowStyle, ArrowKeyMode, ArrowAnimationType, DiagramConfig, updateViewsData } from './views';
import { ANIMATED_ARROW_COLORS } from './styling';

export interface EditResult {
  code: string;
  config: DiagramConfig | null;
  warning?: string;
  cascaded?: string[];   // deleteElement: keys of referencing elements also removed
  newKey?: string;       // addMessage: key of the created element (so the UI can select it)
}

// The complete desired arrow style; empty/undefined fields mean "no style".
export type ArrowStylePatch = Pick<ArrowStyle, 'color' | 'width' | 'dash' | 'animation'>;

const ID = '[A-Za-z0-9_-]+';
const SHAPE = String.raw`(?:\[.*?\]|\(\(.*?\)\)|\(.*?\)|\{.*?\}|>.*?\])`;
const FC_OPS = '<-->|<==>|x--x|o--o|-->|==>|-\\.->|---|--';

const SEQUENCE_OPERATORS = new Set(['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '->o', '-->o', '->*', '-->*', '-', '--']);
const FLOWCHART_OPERATORS = new Set(['---', '-->', '==>', '-.->', '<-->', '<==>', 'x--x', 'o--o']);
const TAG_RE = /^[A-Za-z0-9_-]+$/;

const UNSUPPORTED = 'Unsupported diagram type (editing supports sequence and flowchart diagrams)';

// Verbose line regexes: capture every whitespace segment so rebuilt lines
// preserve the original spacing byte-for-byte outside the edited span.
const SEQ_PARTICIPANT_V = /^(\s*)(participant|actor)\s+([A-Za-z0-9_-]+)(?:\s+as\s+(.*))?$/;
const SEQ_MSG_V = /^(\s*)([A-Za-z0-9_-]+?)(\s*)(-->>|->>|--x|-x|-->o|->o|-->\*|->\*|--\)|-\)|-->|->|--|-)([+-]?)(\s*)([A-Za-z0-9_-]+?)(\s*)(?::([ \t]*)(.*))?$/;
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
    views: config.views?.map(v => ({
      ...v,
      hiddenPaths: [...v.hiddenPaths],
      mergeColors: v.mergeColors ? [...v.mergeColors] : undefined,
      mergeCleanColors: v.mergeCleanColors ? [...v.mergeCleanColors] : undefined,
      hideColors: v.hideColors ? [...v.hideColors] : undefined,
      mergeKeys: v.mergeKeys ? [...v.mergeKeys] : undefined,
      mergeCleanKeys: v.mergeCleanKeys ? [...v.mergeCleanKeys] : undefined,
      hideKeys: v.hideKeys ? [...v.hideKeys] : undefined,
      mergeByColor: v.mergeByColor ? [...v.mergeByColor] : undefined,
      mergeCleanByColor: v.mergeCleanByColor ? [...v.mergeCleanByColor] : undefined,
      mergeByKeys: v.mergeByKeys ? [...v.mergeByKeys] : undefined,
      mergeCleanByKeys: v.mergeCleanByKeys ? [...v.mergeCleanByKeys] : undefined,
    })),
    actors: config.actors
      ? Object.fromEntries(Object.entries(config.actors).map(([k, v]) => [k, { ...v, keys: v.keys ? [...v.keys] : undefined }]))
      : undefined,
    arrows: config.arrows?.map(a => ({ ...a, keys: a.keys ? [...a.keys] : undefined })),
  };
}

// An arrow entry with no style, no tags and no explicit 'merged' mode carries no
// state ('clean' is the default and is stored as absent).
function arrowEntryIsEmpty(a: ArrowStyle): boolean {
  return !a.color && !a.width && !a.dash && (!a.animation || a.animation === 'none') && (!a.keys || a.keys.length === 0) && a.keyMode !== 'merged';
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
  if (config.arrows) {
    config.arrows = config.arrows.filter(a => !arrowEntryIsEmpty(a));
    if (config.arrows.length === 0) delete config.arrows;
  }
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
  const head = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}${m[7]}`;
  if (newLabel === '') return head;
  if (m[10] !== undefined) return `${head}${m[8]}:${m[9]}${newLabel}`;
  return `${head}: ${newLabel}`;
}

// Replace the operator token on a sequence message line, preserving the
// label, activation, and whitespace.
function rewriteSequenceMessageOperator(line: string, operator: string): string | null {
  const m = line.match(SEQ_MSG_V);
  if (!m) return null;
  const tail = m[10] !== undefined ? `${m[8]}:${m[9]}${m[10]}` : '';
  return `${m[1]}${m[2]}${m[3]}${operator}${m[5]}${m[6]}${m[7]}${tail}`;
}

// Replace one endpoint id on a sequence message line ('from' = origin/tail,
// 'to' = recipient/arrow head), preserving the operator, activation, label and
// whitespace.
function rewriteSequenceMessageEndpoint(line: string, end: 'from' | 'to', newId: string): string | null {
  const m = line.match(SEQ_MSG_V);
  if (!m) return null;
  const tail = m[10] !== undefined ? `${m[8]}:${m[9]}${m[10]}` : '';
  if (end === 'from') return `${m[1]}${newId}${m[3]}${m[4]}${m[5]}${m[6]}${m[7]}${tail}`;
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}${newId}${tail}`;
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

// Retarget one endpoint of a sequence message (sequence diagrams only):
// 'to' changes the recipient (the arrow head), 'from' the origin (the tail).
// The operator and label are untouched. Arrow style/tag entries are keyed by
// (from, to, label, occurrence), so the entries that styled this message
// follow the retargeted endpoint instead of being orphaned. Occurrences are
// not renumbered after the move — the same trade-off deleteElement makes.
export function moveMessageEndpoint(
  code: string,
  config: DiagramConfig | null,
  key: string,
  end: 'from' | 'to',
  newParticipantKey: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'message') return fail(code, config, `Element ${key} is not a message`);
  const target = findElement(model, newParticipantKey);
  if (!target || target.kind !== 'participant') {
    return fail(code, config, `Unknown participant key: ${newParticipantKey}`);
  }
  const newId = target.id;
  if (newId === (end === 'from' ? el.from : el.to)) return { code, config }; // no-op

  const line = code.split('\n')[el.lineStart];
  const newLine = rewriteSequenceMessageEndpoint(line, end, newId);
  if (newLine === null) return fail(code, config, `Cannot parse message line: ${line.trim()}`);
  const newCode = replaceLines(code, el.lineStart, el.lineEnd, [newLine]);

  const occurrence = elementOccurrence(model, el);
  const newConfig = cloneConfig(config);
  let configChanged = false;
  if (newConfig?.arrows) {
    newConfig.arrows = newConfig.arrows.map(a => {
      if (!arrowsMatchEntry(a, el.from, el.to, el.label, occurrence)) return a;
      configChanged = true;
      return end === 'from' ? { ...a, from: newId } : { ...a, to: newId };
    });
  }
  if (!configChanged || !newConfig) return { code: newCode, config, newKey: el.key };
  return { code: updateViewsData(newCode, newConfig), config: newConfig, newKey: el.key };
}

export const PRESET_ACTOR_COLORS: string[] = [
  '#213b5e', '#621d26', '#194821', '#3d1d62', '#584a1f',
  '#1a5557', '#5e214a', '#2b4c17', '#21265e', '#622c1d',
  '#1a4b33', '#541d62', '#4d511d', '#1c465f', '#5e2135',
  '#184b16', '#31215e', '#61421d', '#1c5047', '#621d59',
  '#374c1b', '#1d3162', '#5e2121', '#174c26', '#45215e',
  '#59511b', '#1e4d57', '#621d42', '#254819', '#201d62',
  '#5e3621', '#18503b', '#5a215e', '#465219', '#213f5e',
  '#621d2b', '#19481d', '#371d62', '#5a4720', '#1a5653',
];

export function getNextFreeActorColor(config: DiagramConfig | null): string {
  const actors = config?.actors ?? {};
  const colorUsage = new Map<string, number>();
  for (const c of PRESET_ACTOR_COLORS) {
    colorUsage.set(c.toLowerCase(), 0);
  }

  for (const meta of Object.values(actors)) {
    if (meta.color) {
      const lower = meta.color.trim().toLowerCase();
      if (colorUsage.has(lower)) {
        colorUsage.set(lower, (colorUsage.get(lower) ?? 0) + 1);
      }
    }
  }

  // Find the first preset color that is free
  for (const color of PRESET_ACTOR_COLORS) {
    if (colorUsage.get(color.toLowerCase()) === 0) {
      return color;
    }
  }

  // If all colors are added, start rotating again:
  // Find minimum usage count, and pick the first preset color matching that minimum usage
  let minCount = Infinity;
  for (const count of colorUsage.values()) {
    if (count < minCount) minCount = count;
  }
  for (const color of PRESET_ACTOR_COLORS) {
    if (colorUsage.get(color.toLowerCase()) === minCount) {
      return color;
    }
  }

  return PRESET_ACTOR_COLORS[0];
}

export function addParticipant(
  code: string,
  config: DiagramConfig | null,
  afterKey?: string,
  color?: string,
  kind: 'participant' | 'actor' = 'participant',
): EditResult {
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

  const assignedColor = color ?? getNextFreeActorColor(config);
  const newConfig = cloneConfig(config) ?? { version: 1 };
  newConfig.actors = newConfig.actors ?? {};
  newConfig.actors[id] = {
    ...(newConfig.actors[id] ?? {}),
    color: assignedColor,
  };

  const lines = code.split('\n');

  if (model.type === 'flowchart') {
    const codeWithNode = appendLine(lines, `    ${id}[New Participant]`);
    return {
      code: updateViewsData(codeWithNode, newConfig),
      config: newConfig,
    };
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
  lines.splice(afterLine + 1, 0, `    ${kind} ${id} as ${alias}`);
  return {
    code: updateViewsData(lines.join('\n'), newConfig),
    config: newConfig,
  };
}

export function setParticipantKind(
  code: string,
  config: DiagramConfig | null,
  key: string,
  kind: 'participant' | 'actor',
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'participant') return fail(code, config, `Element ${key} is not a participant`);
  if (kind !== 'participant' && kind !== 'actor') return fail(code, config, `Invalid participant kind: ${kind}`);

  const line = code.split('\n')[el.lineStart];
  const m = line.match(SEQ_PARTICIPANT_V);
  if (!m) return fail(code, config, `Cannot parse participant line: ${line.trim()}`);
  if (m[2] === kind) return { code, config };

  const alias = m[4] !== undefined ? ` as ${m[4]}` : '';
  const newLine = `${m[1]}${kind} ${m[3]}${alias}`;
  return { code: replaceLines(code, el.lineStart, el.lineEnd, [newLine]), config };
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

export function insertMessage(
  code: string,
  config: DiagramConfig | null,
  from: string,
  to: string,
  label: string = 'New message',
  type?: string,
  position: MessageInsertPosition = { type: 'bottom' },
  activation?: { activateTarget?: boolean; deactivateSource?: boolean },
): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const componentKind = model.type === 'sequence' ? 'participant' : 'node';

  let fromEl = findElement(model, from);
  if (!fromEl || fromEl.kind !== componentKind) {
    fromEl = model.elements.find(e => isComponent(e) && e.id === from);
  }
  let toEl = findElement(model, to);
  if (!toEl || toEl.kind !== componentKind) {
    toEl = model.elements.find(e => isComponent(e) && e.id === to);
  }
  if (!fromEl || !isComponent(fromEl)) return fail(code, config, `Unknown ${componentKind} key: ${from}`);
  if (!toEl || !isComponent(toEl)) return fail(code, config, `Unknown ${componentKind} key: ${to}`);

  const fromId = fromEl.id;
  const toId = toEl.id;
  const opType = type ?? (model.type === 'sequence' ? '->>' : '-->');

  let op = opType;
  let extraLine: string | null = null;
  if (model.type === 'sequence') {
    if (activation?.activateTarget && activation?.deactivateSource) {
      op = `${opType}+`;
      extraLine = `    deactivate ${fromId}`;
    } else if (activation?.activateTarget) {
      op = `${opType}+`;
    } else if (activation?.deactivateSource) {
      op = `${opType}-`;
    }
  }

  const lines = code.split('\n');
  const line = model.type === 'sequence'
    ? (label ? `    ${fromId}${op}${toId}: ${label}` : `    ${fromId}${op}${toId}`)
    : (label ? `    ${fromId} ${op}|${label}| ${toId}` : `    ${fromId} ${op} ${toId}`);

  let insertAt: number;
  switch (position.type) {
    case 'bottom':
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
      const lastParticipant = [...model.elements].reverse().find(e => e.kind === 'participant');
      insertAt = lastParticipant
        ? lastParticipant.lineEnd + 1
        : lines.findIndex(l => /^\s*(sequenceDiagram|flowchart|graph)\b/.test(l)) + 1;
      break;
    }
  }

  if (extraLine) {
    lines.splice(insertAt, 0, line, extraLine);
  } else {
    lines.splice(insertAt, 0, line);
  }

  const newCode = lines.join('\n');
  const created = parseModel(newCode).elements.find(
    e => e.lineStart === insertAt && (e.kind === 'message' || e.kind === 'edge')
  );
  return { code: newCode, config, newKey: created?.key };
}

export function addMessage(
  code: string,
  config: DiagramConfig | null,
  fromKey: string,
  toKey: string,
  position: MessageInsertPosition = { type: 'bottom' },
): EditResult {
  const model = parseModel(code);
  const defaultOp = model.type === 'sequence' ? '->>' : '-->';
  const defaultLabel = model.type === 'sequence' ? 'New message' : '';
  return insertMessage(code, config, fromKey, toKey, defaultLabel, defaultOp, position);
}

// Move a message to a new position among the messages (sequence diagrams only).
// The message line is relocated to the specified position (top, bottom,
// before another element, after another element). Any occurrence-keyed style or
// tag entries in CONFIG are updated to follow the message in its new order.
export function moveMessage(
  code: string,
  config: DiagramConfig | null,
  key: string,
  position: MessageInsertPosition,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'message') return fail(code, config, `Element ${key} is not a message`);

  // Target element (for 'before' / 'after')
  let targetEl: ModelElement | undefined;
  if (position.type === 'before' || position.type === 'after') {
    if (position.key === key) return { code, config, newKey: key };
    targetEl = findElement(model, position.key);
    if (!targetEl) return fail(code, config, `Unknown target key: ${position.key}`);
  }

  const lines = code.split('\n');
  const messageLines = lines.slice(el.lineStart, el.lineEnd + 1);
  const spanCount = el.lineEnd - el.lineStart + 1;

  // Remove the message lines
  lines.splice(el.lineStart, spanCount);

  // Line numbers after el.lineStart shift down by spanCount
  const adjust = (lineNo: number) => lineNo > el.lineStart ? lineNo - spanCount : lineNo;

  let insertAt: number;
  switch (position.type) {
    case 'top': {
      const lastParticipant = [...model.elements].filter(e => e.kind === 'participant').reverse()[0];
      insertAt = lastParticipant
        ? adjust(lastParticipant.lineEnd) + 1
        : lines.findIndex(l => /^\s*sequenceDiagram\b/.test(l)) + 1;
      break;
    }
    case 'bottom': {
      insertAt = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      break;
    }
    case 'before': {
      insertAt = adjust(targetEl!.lineStart);
      break;
    }
    case 'after': {
      insertAt = adjust(targetEl!.lineEnd) + 1;
      break;
    }
  }

  // If the target position is the original position, it's a no-op
  if (insertAt === el.lineStart) {
    return { code, config, newKey: key };
  }

  lines.splice(insertAt, 0, ...messageLines);
  const newCode = lines.join('\n');

  const oldOcc = elementOccurrence(model, el);
  const newModel = parseModel(newCode);
  const moved = newModel.elements.find(
    e => e.lineStart === insertAt && e.kind === 'message'
  ) as MessageElement | undefined;
  const newKey = moved?.key ?? key;

  let newConfig = config;
  if (config?.arrows && moved) {
    const newOcc = elementOccurrence(newModel, moved);
    if (oldOcc !== newOcc) {
      newConfig = cloneConfig(config);
      if (newConfig?.arrows) {
        newConfig.arrows = newConfig.arrows.map(a => {
          if (a.from !== el.from || a.to !== el.to || (a.label ?? undefined) !== (el.label ?? undefined)) {
            return a;
          }
          const occ = a.occurrence ?? 0;
          if (occ === oldOcc) return { ...a, occurrence: newOcc === 0 ? undefined : newOcc };
          if (oldOcc < newOcc && occ > oldOcc && occ <= newOcc) {
            const shifted = occ - 1;
            return { ...a, occurrence: shifted === 0 ? undefined : shifted };
          } else if (oldOcc > newOcc && occ >= newOcc && occ < oldOcc) {
            const shifted = occ + 1;
            return { ...a, occurrence: shifted === 0 ? undefined : shifted };
          }
          return a;
        });
      }
    }
  }

  return {
    code: newConfig ? updateViewsData(newCode, newConfig) : newCode,
    config: newConfig,
    newKey,
  };
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

// Move a flowchart node to a new position among the nodes (flowcharts only).
// Mermaid lays same-rank nodes out in first-declaration order, so moving a
// node means moving its FIRST declaration in the source:
//   - target earlier than the current first declaration -> insert a
//     standalone declaration at the target position (the original lines stay;
//     Mermaid keeps the label because re-declarations with identical text are
//     no-ops, and a bare endpoint never resets a label)
//   - target later -> relocate every line that mentions the node before the
//     target, as a block (relative order preserved), landing immediately
//     before the target line. Only moving the first-declaring line would
//     leave the node behind its other declarations; moving all of them keeps
//     edges connecting the same endpoints and keeps the last shaped
//     declaration (what Mermaid shows as the label) last.
// beforeKey === undefined moves the node to the end (after every other node's
// first declaration). Nodes inside a subgraph cannot be moved out of it (or
// vice versa): that would silently change the cluster, so it soft-fails.
export function moveNode(
  code: string,
  config: DiagramConfig | null,
  key: string,
  beforeKey?: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'flowchart') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'node') return fail(code, config, `Element ${key} is not a node`);

  let targetEl: ModelElement | undefined;
  if (beforeKey !== undefined) {
    targetEl = findElement(model, beforeKey);
    if (!targetEl || targetEl.kind !== 'node') {
      return fail(code, config, `Unknown node key: ${beforeKey}`);
    }
    if (targetEl.key === key) return { code, config }; // no-op
  }

  // Nodes in first-declaration order (parseModel emits them in source order).
  const nodes = model.elements.filter(e => e.kind === 'node');
  const idx = nodes.findIndex(n => n.key === key);
  if (beforeKey !== undefined) {
    // Already immediately before the target: nothing to change.
    if (nodes[idx + 1]?.key === beforeKey) return { code, config };
  } else if (nodes[nodes.length - 1].key === key) {
    return { code, config }; // already last
  }

  const lines = code.split('\n');
  // Insert position, in original line indices: the moved line lands
  // immediately before line `insertAt`. Move-to-end appends at the end of the
  // file (keeping a trailing newline last).
  const insertAt = beforeKey !== undefined
    ? targetEl!.lineStart
    : (lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length);

  // A node cannot cross a subgraph boundary: the inserted/relocated line would
  // silently join or leave the cluster.
  const blockAt = (line: number): ModelElement | undefined => {
    let inner: ModelElement | undefined;
    for (const e of model.elements) {
      if (e.kind === 'block' && e.lineStart < line && line <= e.lineEnd) inner = e;
    }
    return inner;
  };
  if (blockAt(el.lineStart)?.key !== blockAt(insertAt)?.key) {
    return fail(code, config, 'Cannot move a node into or out of a subgraph');
  }

  if (insertAt === el.lineStart) return { code, config }; // same position

  // The node's declaration text + indent at its first appearance (used only
  // when moving earlier, where a standalone declaration is inserted).
  const firstLine = lines[el.lineStart];
  let declText: string;
  let indent: string;
  let isStandalone = false;
  const standaloneMatch = firstLine.match(FC_NODE_V);
  if (standaloneMatch && standaloneMatch[2] === el.id) {
    isStandalone = true;
    declText = firstLine.trim();
    indent = standaloneMatch[1];
  } else {
    const endpoints = flowchartEdgeEndpoints(firstLine);
    declText = endpoints
      ? (endpoints.fromId === el.id ? endpoints.fromDecl : endpoints.toDecl)
      : (el.label ? `${el.id}[${el.label}]` : el.id);
    indent = endpoints?.indent ?? '    ';
  }

  let newLines: string[];
  if (insertAt < el.lineStart) {
    // Move earlier: the inserted standalone declaration becomes the node's
    // first appearance. A standalone declaration is relocated (no duplicate);
    // an edge line stays untouched.
    if (isStandalone) {
      lines.splice(el.lineStart, 1);
      lines.splice(insertAt, 0, `${indent}${declText}`);
    } else {
      lines.splice(insertAt, 0, `${indent}${declText}`);
    }
    newLines = lines;
  } else {
    // Move later: every line that mentions the node before the target moves
    // with it, as a block, landing immediately before the target line.
    const mentions: number[] = [];
    for (let i = 0; i < insertAt; i++) {
      const line = lines[i];
      const node = line.match(FC_NODE_V);
      if (node && node[2] === el.id) {
        mentions.push(i);
        continue;
      }
      const endpoints = flowchartEdgeEndpoints(line);
      if (endpoints && (endpoints.fromId === el.id || endpoints.toId === el.id)) {
        mentions.push(i);
      }
    }
    const movedLines = mentions.map(i => lines[i]);
    const drop = new Set(mentions);
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!drop.has(i)) kept.push(lines[i]);
    }
    // All dropped lines were before insertAt, so the target line sits at
    // insertAt - mentions.length in `kept`.
    kept.splice(insertAt - mentions.length, 0, ...movedLines);
    newLines = kept;
  }

  const newCode = newLines.join('\n');
  // Keys are positional, so report the moved node's key in the new code.
  const moved = parseModel(newCode).elements.find(
    e => e.kind === 'node' && e.id === el.id
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
  if (!el || (!isComponent(el) && !isArrow(el))) {
    return fail(code, config, `Element ${key} is not a component or message`);
  }
  const t = tag.trim();
  if (!TAG_RE.test(t)) return fail(code, config, `Invalid tag: ${tag}`);

  if (isComponent(el)) {
    const newConfig = cloneConfig(config) ?? { version: 1 };
    newConfig.actors = newConfig.actors ?? {};
    const meta = newConfig.actors[el.id] ?? {};
    newConfig.actors[el.id] = meta;
    meta.keys = meta.keys ?? [];
    if (!meta.keys.includes(t)) meta.keys.push(t);
    return { code: updateViewsData(code, newConfig), config: newConfig };
  }

  // Arrow: the tag rides on the arrow's CONFIG.arrows entry (same
  // (from, to, label, occurrence) keying as arrow styles).
  const occurrence = elementOccurrence(model, el);
  const newConfig = cloneConfig(config) ?? { version: 1 };
  const arrows = newConfig.arrows ? [...newConfig.arrows] : [];
  const idx = arrows.findIndex(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));
  if (idx >= 0) {
    if (arrows[idx].keys?.includes(t)) return { code, config }; // already there
    arrows[idx] = { ...arrows[idx], keys: [...(arrows[idx].keys ?? []), t] };
  } else {
    const entry: ArrowStyle = { from: el.from, to: el.to };
    if (el.label !== undefined) entry.label = el.label;
    if (occurrence > 0) entry.occurrence = occurrence;
    entry.keys = [t];
    arrows.push(entry);
  }
  newConfig.arrows = arrows;
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

export function removeTag(code: string, config: DiagramConfig | null, key: string, tag: string): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || (!isComponent(el) && !isArrow(el))) {
    return fail(code, config, `Element ${key} is not a component or message`);
  }

  if (isComponent(el)) {
    const existing = config?.actors?.[el.id];
    if (!existing?.keys?.includes(tag)) return { code, config }; // nothing to remove
    const newConfig = cloneConfig(config) ?? { version: 1 };
    const meta = newConfig.actors![el.id];
    meta.keys = meta.keys!.filter(k => k !== tag);
    pruneConfig(newConfig);
    return { code: updateViewsData(code, newConfig), config: newConfig };
  }

  const occurrence = elementOccurrence(model, el);
  const existing = config?.arrows?.find(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));
  if (!existing?.keys?.includes(tag)) return { code, config }; // nothing to remove
  const newConfig = cloneConfig(config) ?? { version: 1 };
  const arrows = newConfig.arrows ? [...newConfig.arrows] : [];
  const idx = arrows.findIndex(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));
  const kept = (arrows[idx].keys ?? []).filter(k => k !== tag);
  const entry = { ...arrows[idx] };
  if (kept.length > 0) entry.keys = kept; else delete entry.keys;
  arrows[idx] = entry;
  newConfig.arrows = arrows;
  pruneConfig(newConfig);
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

// Tag info of an arrow element: its own tags, its tag behavior ('clean' by
// default: only its own tags; 'merged': the arrow also carries the tags of the
// service it originates from), and the inherited tags (own excluded).
export interface ArrowTagInfo {
  keys: string[];
  keyMode: ArrowKeyMode;
  inherited: string[];
}

export function getArrowTags(code: string, config: DiagramConfig | null, key: string): ArrowTagInfo | null {
  const model = parseModel(code);
  const el = findElement(model, key);
  if (!el || !isArrow(el)) return null;
  const occurrence = elementOccurrence(model, el);
  const entry = config?.arrows?.find(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));
  const keys = entry?.keys ?? [];
  const keyMode: ArrowKeyMode = entry?.keyMode === 'merged' ? 'merged' : 'clean';
  const originKeys = keyMode === 'merged' ? (config?.actors?.[el.from]?.keys ?? []) : [];
  return { keys, keyMode, inherited: originKeys.filter(k => !keys.includes(k)) };
}

// Set an arrow's tag behavior. 'clean' is the default and is stored as absent;
// 'merged' is stored explicitly (it is the only non-default state).
export function setArrowKeyMode(code: string, config: DiagramConfig | null, key: string, mode: ArrowKeyMode): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || !isArrow(el)) return fail(code, config, `Element ${key} is not a message or edge`);
  if (mode !== 'merged' && mode !== 'clean') return fail(code, config, `Invalid tag behavior: ${mode}`);

  const occurrence = elementOccurrence(model, el);
  const newConfig = cloneConfig(config) ?? { version: 1 };
  const arrows = newConfig.arrows ? [...newConfig.arrows] : [];
  const idx = arrows.findIndex(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));
  let changed = false;
  if (idx >= 0) {
    const prev = arrows[idx];
    if (mode === 'merged' && prev.keyMode !== 'merged') {
      arrows[idx] = { ...prev, keyMode: 'merged' };
      changed = true;
    } else if (mode === 'clean' && prev.keyMode !== undefined) {
      const entry = { ...prev };
      delete entry.keyMode;
      arrows[idx] = entry;
      changed = true;
    }
  } else if (mode === 'merged') {
    const entry: ArrowStyle = { from: el.from, to: el.to };
    if (el.label !== undefined) entry.label = el.label;
    if (occurrence > 0) entry.occurrence = occurrence;
    entry.keyMode = 'merged';
    arrows.push(entry);
    changed = true;
  }
  if (!changed) return { code, config };
  newConfig.arrows = arrows;
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
  const animation = style.animation !== undefined && style.animation !== 'none' ? style.animation : undefined;

  const occurrence = elementOccurrence(model, el);
  const newConfig = cloneConfig(config) ?? { version: 1 };
  const arrows = newConfig.arrows ? [...newConfig.arrows] : [];
  const idx = arrows.findIndex(a => arrowsMatchEntry(a, el.from, el.to, el.label, occurrence));

  const hasStyle = color !== undefined || width !== undefined || dash !== undefined || animation !== undefined;
  let changed = false;
  if (hasStyle) {
    const entry: ArrowStyle = { from: el.from, to: el.to };
    if (el.label !== undefined) entry.label = el.label;
    if (occurrence > 0) entry.occurrence = occurrence;
    if (color !== undefined) entry.color = color;
    if (width !== undefined) entry.width = width;
    if (dash !== undefined) entry.dash = dash;
    if (animation !== undefined) entry.animation = animation;
    // Tags and tag behavior live on the same entry: carry them over.
    const prev = idx >= 0 ? arrows[idx] : undefined;
    if (prev?.keys) entry.keys = prev.keys;
    if (prev?.keyMode) entry.keyMode = prev.keyMode;
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
    // Clearing the style must not drop the arrow's tags or tag behavior.
    const prev = arrows[idx];
    if ((prev.keys && prev.keys.length > 0) || prev.keyMode === 'merged') {
      const entry: ArrowStyle = { from: prev.from, to: prev.to };
      if (prev.label !== undefined) entry.label = prev.label;
      if (prev.occurrence !== undefined) entry.occurrence = prev.occurrence;
      if (prev.keys) entry.keys = prev.keys;
      if (prev.keyMode) entry.keyMode = prev.keyMode;
      arrows[idx] = entry;
    } else {
      arrows.splice(idx, 1);
    }
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
    ...(entry.animation ? { animation: entry.animation } : {}),
  };
}

export function convertDiagramToAnimatedArrows(
  code: string,
  config: DiagramConfig | null,
): EditResult {
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const arrows = model.elements.filter(e => e.kind === 'message' || e.kind === 'edge') as (MessageElement | EdgeElement)[];
  if (arrows.length === 0) return { code, config };

  const newConfig = cloneConfig(config) ?? { version: 1 };
  newConfig.arrows = newConfig.arrows ? [...newConfig.arrows] : [];

  const posColors = ANIMATED_ARROW_COLORS.positive.map(c => c.hex);
  const errColors = ANIMATED_ARROW_COLORS.error.map(c => c.hex);

  const isErrorOp = (op: string) => op === '-x' || op === '--x';
  const isErrorText = (label?: string) => {
    if (!label) return false;
    return /\b(error|fail|timeout|5\d\d|4\d\d|reject|exception|fatal|denied|broken)\b/i.test(label);
  };
  const isRetryText = (label?: string) => {
    if (!label) return false;
    return /\b(retry|backoff|reattempt)\b/i.test(label);
  };

  let happyPathIndex = 0;
  let errorIndex = 0;

  arrows.forEach((el) => {
    const occurrence = elementOccurrence(model, el);
    const label = el.label ?? undefined;
    const isError = isErrorOp(el.operator) || isErrorText(label);
    const isRetry = isRetryText(label);

    let chosenAnimation: ArrowAnimationType;
    let chosenColor: string;

    if (isError) {
      if (isErrorOp(el.operator) || /reject|crash|fail/i.test(label ?? '')) {
        chosenAnimation = 'broken-receiver';
        chosenColor = errColors[2 % errColors.length]; // Rose (#ff2a85)
      } else if (/timeout|lost|drop|disconnect|net/i.test(label ?? '')) {
        chosenAnimation = 'broken-network';
        chosenColor = errColors[1 % errColors.length]; // Flame (#ff6600)
      } else {
        chosenAnimation = 'broken-sender';
        chosenColor = errColors[errorIndex % errColors.length];
        errorIndex++;
      }
    } else if (isRetry) {
      chosenAnimation = 'broken-network';
      chosenColor = errColors[0]; // Amber (#ffbe0b)
    } else {
      const posAnims: ArrowAnimationType[] = ['flow', 'pulse', 'cyber'];
      chosenAnimation = posAnims[happyPathIndex % posAnims.length];
      chosenColor = posColors[happyPathIndex % posColors.length];
      happyPathIndex++;
    }

    const idx = newConfig.arrows!.findIndex(a => arrowsMatchEntry(a, el.from, el.to, label, occurrence));
    if (idx >= 0) {
      newConfig.arrows![idx] = {
        ...newConfig.arrows![idx],
        animation: chosenAnimation,
        color: chosenColor,
        dash: newConfig.arrows![idx].dash ?? 'solid',
      };
    } else {
      newConfig.arrows!.push({
        from: el.from,
        to: el.to,
        label,
        occurrence: occurrence > 0 ? occurrence : undefined,
        animation: chosenAnimation,
        color: chosenColor,
        dash: 'solid',
      });
    }
  });

  pruneConfig(newConfig);
  return {
    code: updateViewsData(code, newConfig),
    config: newConfig,
  };
}

export function toggleActivation(
  code: string,
  config: DiagramConfig | null,
  messageKey: string,
  endpoint: 'target' | 'source',
  active: boolean,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, messageKey);
  if (!el || el.kind !== 'message') return fail(code, config, `Element ${messageKey} is not a message`);

  const lines = code.split('\n');
  const line = lines[el.lineStart];
  const m = line.match(SEQ_MSG_V);
  if (!m) return fail(code, config, `Cannot parse message line: ${line.trim()}`);

  const indent = m[1];
  const from = m[2];
  const wsBeforeOp = m[3];
  const op = m[4];
  const currAct = m[5]; // '+', '-', or ''
  const wsAfterOp = m[6];
  const to = m[7];
  const tail = m[10] !== undefined ? `${m[8]}:${m[9]}${m[10]}` : '';

  const nextLineIdx = el.lineStart + 1;
  const nextLine = nextLineIdx < lines.length ? lines[nextLineIdx] : null;
  const hasNextActivateTo = nextLine !== null && new RegExp(`^\\s*activate\\s+${to}\\s*$`).test(nextLine);
  const hasNextDeactivateFrom = nextLine !== null && new RegExp(`^\\s*deactivate\\s+${from}\\s*$`).test(nextLine);

  if (endpoint === 'target') {
    if (active) {
      if (currAct === '+' || hasNextActivateTo) return { code, config };
      if (currAct === '') {
        lines[el.lineStart] = `${indent}${from}${wsBeforeOp}${op}+${wsAfterOp}${to}${tail}`;
        return { code: lines.join('\n'), config };
      }
      lines.splice(nextLineIdx, 0, `${indent}activate ${to}`);
      return { code: lines.join('\n'), config };
    } else {
      let changed = false;
      if (currAct === '+') {
        lines[el.lineStart] = `${indent}${from}${wsBeforeOp}${op}${wsAfterOp}${to}${tail}`;
        changed = true;
      }
      if (hasNextActivateTo) {
        lines.splice(nextLineIdx, 1);
        changed = true;
      }
      if (!changed) return { code, config };
      return { code: lines.join('\n'), config };
    }
  } else {
    if (active) {
      if (currAct === '-' || hasNextDeactivateFrom) return { code, config };
      if (currAct === '') {
        lines[el.lineStart] = `${indent}${from}${wsBeforeOp}${op}-${wsAfterOp}${to}${tail}`;
        return { code: lines.join('\n'), config };
      }
      lines.splice(nextLineIdx, 0, `${indent}deactivate ${from}`);
      return { code: lines.join('\n'), config };
    } else {
      let changed = false;
      if (currAct === '-') {
        lines[el.lineStart] = `${indent}${from}${wsBeforeOp}${op}${wsAfterOp}${to}${tail}`;
        changed = true;
      }
      if (hasNextDeactivateFrom) {
        lines.splice(nextLineIdx, 1);
        changed = true;
      }
      if (!changed) return { code, config };
      return { code: lines.join('\n'), config };
    }
  }
}

export function groupParticipants(
  code: string,
  config: DiagramConfig | null,
  participantKeys: string[],
  title: string,
  color?: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  if (participantKeys.length < 2) {
    return fail(code, config, 'At least two participants must be selected to create a box group');
  }

  const elements = participantKeys.map(k => findElement(model, k));
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.kind !== 'participant') {
      return fail(code, config, `Unknown or non-participant key: ${participantKeys[i]}`);
    }
  }

  const validElements = elements as ParticipantElement[];
  validElements.sort((a, b) => a.lineStart - b.lineStart);

  const lines = code.split('\n');
  const targetIndices = new Set(validElements.map(e => e.lineStart));
  const participantLines = validElements.map(e => lines[e.lineStart]);

  const indentMatch = participantLines[0].match(/^(\s*)/);
  const baseIndent = indentMatch ? indentMatch[1] : '    ';
  const innerIndent = `${baseIndent}    `;

  const boxHeader = color && color.trim()
    ? `${baseIndent}box ${color.trim()} ${title.trim()}`
    : `${baseIndent}box ${title.trim()}`;
  const boxEnd = `${baseIndent}end`;

  const boxedLines = [
    boxHeader,
    ...participantLines.map(l => `${innerIndent}${l.trim()}`),
    boxEnd,
  ];

  const firstLineIdx = validElements[0].lineStart;
  const newLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (i === firstLineIdx) {
      newLines.push(...boxedLines);
    } else if (targetIndices.has(i)) {
      continue;
    } else {
      newLines.push(lines[i]);
    }
  }

  return {
    code: newLines.join('\n'),
    config,
  };
}

export function toggleDiagramOrientation(code: string): string {
  const regex = /^(\s*(?:flowchart|graph)\s+)(TD|TB|LR|RL|BT)\b/im;
  const match = code.match(regex);
  if (match) {
    const currentDir = match[2].toUpperCase();
    const newDir = (currentDir === 'TD' || currentDir === 'TB' || currentDir === 'BT') ? 'LR' : 'TD';
    return code.replace(regex, `$1${newDir}`);
  }
  const bareRegex = /^(\s*(?:flowchart|graph))(\s*$)/im;
  if (bareRegex.test(code)) {
    return code.replace(bareRegex, '$1 LR');
  }
  return code;
}

export function hasNumberedSteps(code: string): boolean {
  const model = parseModel(code);
  if (model.type !== 'sequence') return false;
  const lines = code.split('\n');
  return lines.some(l => /^\s*autonumber(?:\s+(?!off\b).*)?$/i.test(l));
}

export function toggleNumberedSteps(code: string): string {
  const model = parseModel(code);
  if (model.type !== 'sequence') return code;

  const lines = code.split('\n');
  const autonumberIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (/^\s*autonumber\b/i.test(line)) {
      autonumberIndices.push(idx);
    }
  });

  const isEnabled = autonumberIndices.some(idx => !/^\s*autonumber\s+off\b/i.test(lines[idx]));

  if (isEnabled) {
    return lines.filter((_, idx) => !autonumberIndices.includes(idx)).join('\n');
  } else {
    const cleaned = lines.filter((_, idx) => !autonumberIndices.includes(idx));
    const seqIdx = cleaned.findIndex(l => /^\s*sequenceDiagram\b/i.test(l));
    if (seqIdx === -1) return code;

    let indent = '    ';
    for (let i = seqIdx + 1; i < cleaned.length; i++) {
      const match = cleaned[i].match(/^(\s+)\S/);
      if (match) {
        indent = match[1];
        break;
      }
    }

    cleaned.splice(seqIdx + 1, 0, `${indent}autonumber`);
    return cleaned.join('\n');
  }
}

