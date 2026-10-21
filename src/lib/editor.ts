// Pure editor transforms (EDITING_PLAN.md Section 4.5).
// Every transform is (code, config, ...args) -> { code, config, warning? }.
// Transforms are line-surgical: untouched lines are preserved byte-for-byte
// (NFR-02), and malformed input is a no-op with a warning, never a
// corruption (NFR-01).

import { parseModel, parseShapeToken, parseParticipantLine, parseFlowchartLine, ParsedFlowchartLine, SHAPE_DELIMITERS, ModelElement, MessageElement, EdgeElement, ParticipantElement, NoteElement, NodeElement, NodeShape, ParticipantType, NotePlacement, BlockType, BLOCK_OPEN_RE, BLOCK_END_RE, BLOCK_CONT_RE } from './model';
import { ArrowStyle, ArrowKeyMode, ArrowAnimationType, ArrowStyleDefaults, DiagramConfig, NoteTagEntry, updateViewsData } from './views';
import { ANIMATED_ARROW_COLORS } from './styling';
import { buildSubgraphTagIndex } from './subgraphTags';

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
// A shape token never contains its own closing delimiter, so on a chained
// edge line (`A["x"] --> B["y"] --> C["z"]`) it cannot swallow a following link.
const SHAPE = String.raw`(?:\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{[^}]*\}|>[^\]]*\])`;
const FC_OPS = '<-->|<==>|x--x|o--o|-->|==>|-\\.->|---|--';

const SEQUENCE_OPERATORS = new Set(['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '->o', '-->o', '->*', '-->*', '-', '--']);
const FLOWCHART_OPERATORS = new Set(['---', '-->', '==>', '-.->', '<-->', '<==>', 'x--x', 'o--o']);
const TAG_RE = /^[A-Za-z0-9_-]+$/;

const UNSUPPORTED = 'Unsupported diagram type (editing supports sequence and flowchart diagrams)';

// Verbose line regexes: capture every whitespace segment so rebuilt lines
// preserve the original spacing byte-for-byte outside the edited span.
const SEQ_MSG_V = /^(\s*)([A-Za-z0-9_-]+?)(\s*)(-->>|->>|--x|-x|-->o|->o|-->\*|->\*|--\)|-\)|-->|->|--|-)([+-]?)(\s*)([A-Za-z0-9_-]+?)(\s*)(?::([ \t]*)(.*))?$/;
// Verbose note regex: captures every whitespace segment so rebuilt note
// lines preserve the original spacing byte-for-byte outside the edited span.
const SEQ_NOTE_V = /^(\s*)Note(\s+)(over|left of|right of)(\s+)([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)(\s*)(:)([ \t]*)(.*)$/;
const NOTE_PLACEMENTS = new Set(['over', 'left of', 'right of']);

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
    defaultArrowStyle: config.defaultArrowStyle ? { ...config.defaultArrowStyle } : undefined,
    noteTags: config.noteTags?.map(n => ({ ...n, over: [...n.over], keys: n.keys ? [...n.keys] : undefined })),
    notes: config.notes?.map(n => ({ ...n, keys: n.keys ? [...n.keys] : undefined })),
  };
}

// An arrow entry with no style, no tags and no explicit 'merged' mode carries no
// state ('clean' is the default and is stored as absent).
function arrowEntryIsEmpty(a: ArrowStyle): boolean {
  return !a.color && !a.width && !a.dash && (!a.animation || a.animation === 'none') && (!a.keys || a.keys.length === 0) && a.keyMode !== 'merged';
}

// A note tag entry with no keys carries no state.
function noteEntryIsEmpty(n: NoteTagEntry): boolean {
  return !n.keys || n.keys.length === 0;
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
  if (config.noteTags) {
    config.noteTags = config.noteTags.filter(n => !noteEntryIsEmpty(n));
    if (config.noteTags.length === 0) delete config.noteTags;
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

// Composite lookup key for an arrow CONFIG entry's (from, to, label, occurrence)
// identity. Labels cannot contain NUL, so the encoding is collision-free.
function arrowEntryKey(from: string, to: string, label: string | undefined, occurrence: number): string {
  return `${from}\u0000${to}\u0000${label ?? ''}\u0000${occurrence}`;
}

// 0-based occurrence of el among same-(over, text) notes.
function noteOccurrence(model: ReturnType<typeof parseModel>, el: NoteElement): number {
  let occurrence = 0;
  const overKey = el.over.join('\u0000');
  for (const e of model.elements) {
    if (e === el) break;
    if (e.kind === 'note' && e.over.join('\u0000') === overKey && e.text === el.text) {
      occurrence++;
    }
  }
  return occurrence;
}

function notesMatchEntry(entry: NoteTagEntry, over: string[], text: string, occurrence: number): boolean {
  return entry.over.length === over.length && entry.over.every((id, i) => id === over[i]) &&
    entry.text === text &&
    (entry.occurrence ?? 0) === occurrence;
}

// Composite lookup key for a note CONFIG entry's (over, text, occurrence)
// identity (same encoding idea as arrowEntryKey; ids cannot contain NUL).
function noteEntryKey(over: string[], text: string, occurrence: number): string {
  return `${over.join('\u0000')}\u0000${text}\u0000${occurrence}`;
}

// Retarget CONFIG noteTags entries across a note edit (text/placement/span).
// Entries are keyed by (over, text, occurrence), so the entry that tagged a
// note follows it when its key changes — the editMessageLabel arrow pattern:
// old and new elements are matched by key (index-stable across a single-line
// rewrite) and occurrences are recomputed in the new model, never guessed.
// Returns the rewritten config, or null when nothing changed.
function retargetNoteEntries(
  oldModel: ReturnType<typeof parseModel>,
  newModel: ReturnType<typeof parseModel>,
  config: DiagramConfig | null,
): DiagramConfig | null {
  if (!config?.noteTags || config.noteTags.length === 0) return null;
  const newByKey = new Map<string, ModelElement>();
  for (const e of newModel.elements) newByKey.set(e.key, e);
  const retargeted = new Map<string, { over: string[]; text: string; occurrence?: number }>();
  for (const e of oldModel.elements) {
    if (e.kind !== 'note') continue;
    const n = newByKey.get(e.key);
    if (!n || n.kind !== 'note') continue;
    const newOccurrence = noteOccurrence(newModel, n);
    const before = noteEntryKey(e.over, e.text, noteOccurrence(oldModel, e));
    const after = noteEntryKey(n.over, n.text, newOccurrence);
    if (before === after) continue;
    retargeted.set(before, {
      over: n.over,
      text: n.text,
      occurrence: newOccurrence > 0 ? newOccurrence : undefined,
    });
  }
  if (retargeted.size === 0) return null;
  const newConfig = cloneConfig(config)!;
  newConfig.noteTags = newConfig.noteTags!.map(n => {
    const target = retargeted.get(noteEntryKey(n.over, n.text, n.occurrence ?? 0));
    if (!target) return n;
    const entry: NoteTagEntry = { ...n, over: [...target.over], text: target.text };
    if (target.occurrence !== undefined) entry.occurrence = target.occurrence; else delete entry.occurrence;
    return entry;
  });
  return newConfig;
}

// All actor ids a sequence note may span: declared participants, message
// endpoints (implicit actors) and actors already spanned by other notes.
function sequenceActorIds(model: ReturnType<typeof parseModel>): Set<string> {
  const ids = new Set<string>();
  for (const e of model.elements) {
    if (isComponent(e)) ids.add(e.id);
    if (isArrow(e)) { ids.add(e.from); ids.add(e.to); }
    if (e.kind === 'note') e.over.forEach(id => ids.add(id));
  }
  return ids;
}

function isArrow(el: ModelElement): el is ModelElement & { from: string; to: string; label?: string } {
  return el.kind === 'message' || el.kind === 'edge';
}

// Sticky notes are keyed `sticky:<id>` (the CONFIG note id is stable, so the
// raw key is its own processed key). Unlike parsed elements they are resolved
// from CONFIG.notes, never from the parsed model.
const STICKY_KEY_PREFIX = 'sticky:';

function stickyNoteIdFromKey(key: string): string | null {
  return key.startsWith(STICKY_KEY_PREFIX) ? key.slice(STICKY_KEY_PREFIX.length) : null;
}

// The tag rides on the sticky note's own CONFIG.notes entry `keys` field.
function addStickyNoteTag(code: string, config: DiagramConfig | null, id: string, tag: string): EditResult {
  const note = config?.notes?.find(n => n.id === id);
  if (!note) return fail(code, config, `Sticky note ${id} not found`);
  if (note.keys?.includes(tag)) return { code, config }; // already there
  const newConfig = cloneConfig(config) ?? { version: 1 };
  newConfig.notes = (newConfig.notes ?? []).map(n =>
    n.id === id ? { ...n, keys: [...(n.keys ?? []), tag] } : n);
  return { code: updateViewsData(code, newConfig), config: newConfig };
}

function removeStickyNoteTag(code: string, config: DiagramConfig | null, id: string, tag: string): EditResult {
  const note = config?.notes?.find(n => n.id === id);
  if (!note?.keys?.includes(tag)) return { code, config }; // nothing to remove
  const newConfig = cloneConfig(config) ?? { version: 1 };
  newConfig.notes = (newConfig.notes ?? []).map(n => {
    if (n.id !== id) return n;
    const kept = (n.keys ?? []).filter(k => k !== tag);
    const entry = { ...n };
    if (kept.length > 0) entry.keys = kept; else delete entry.keys;
    return entry;
  });
  return { code: updateViewsData(code, newConfig), config: newConfig };
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

// Apply non-overlapping [start, end) replacements to a line.
function spliceLine(line: string, replacements: { start: number; end: number; text: string }[]): string {
  let out = line;
  for (const r of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

// Rewrite the shape token of every endpoint with id nodeId on a chained edge
// line. makeShape maps the current shape token to its replacement: undefined
// keeps the endpoint byte-identical, '' drops the shape (bare id), anything
// else replaces the token (keeping any whitespace between id and shape).
// Returns the new line, null for a no-op, or undefined when the line does not
// define nodeId.
function rewriteChainedNodeShape(
  line: string,
  parsed: ParsedFlowchartLine,
  nodeId: string,
  makeShape: (shapeToken: string | undefined) => string | undefined,
): string | null | undefined {
  const matching = parsed.endpoints.filter(ep => ep.id === nodeId);
  if (matching.length === 0) return undefined;
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const ep of matching) {
    const newShape = makeShape(ep.shapeToken);
    if (newShape === undefined) continue;
    const text = newShape === ''
      ? ep.id
      : ep.shapeToken === undefined
        ? `${ep.id}${newShape}`
        : `${ep.id}${line.slice(ep.idEnd, ep.shapeStart!)}${newShape}`;
    replacements.push({ start: ep.start, end: ep.end, text });
  }
  if (replacements.length === 0) return null;
  return spliceLine(line, replacements);
}

// Index of an arrow element among the arrows sharing its line, in source
// order — the position of its link on a chained flowchart edge line.
function arrowSegmentIndex(model: ReturnType<typeof parseModel>, el: ModelElement): number {
  const sameLine = model.elements.filter(
    e => (e.kind === 'message' || e.kind === 'edge') && e.lineStart === el.lineStart
  );
  return sameLine.findIndex(e => e.key === el.key);
}

// Rewrite the label of node nodeId on its defining line (standalone node line
// or an edge line). Returns the new line, null for a no-op, or undefined when
// the line does not define nodeId.
function rewriteFlowchartNodeLabel(line: string, nodeId: string, alias: string): string | null | undefined {
  const chained = parseFlowchartLine(line);
  if (chained && chained.segments.length > 1) {
    return rewriteChainedNodeShape(line, chained, nodeId, (shapeToken) => shapeTokenForAlias(shapeToken, alias));
  }
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

function shapeTokenForShape(shapeToken: string | undefined, newShape: NodeShape, defaultLabel: string): string {
  const parsed = shapeToken ? parseShapeToken(shapeToken) : null;
  const label = parsed ? parsed.label : defaultLabel;
  const [open, close] = SHAPE_DELIMITERS[newShape];
  return `${open}${label}${close}`;
}

function rewriteFlowchartNodeShape(line: string, nodeId: string, shape: NodeShape, defaultLabel: string): string | null | undefined {
  const chained = parseFlowchartLine(line);
  if (chained && chained.segments.length > 1) {
    return rewriteChainedNodeShape(line, chained, nodeId, (shapeToken) => shapeTokenForShape(shapeToken, shape, defaultLabel));
  }
  const pipe = line.match(FC_EDGE_PIPE_V);
  if (pipe) {
    if (pipe[2] !== nodeId && pipe[11] !== nodeId) return undefined;
    const from = pipe[2] === nodeId ? fromEndpoint(pipe[2], pipe[3], pipe[4], shapeTokenForShape(pipe[4], shape, defaultLabel), pipe[5]) : undefined;
    const to = pipe[11] === nodeId ? toEndpoint(pipe[11], pipe[12], pipe[13], shapeTokenForShape(pipe[13], shape, defaultLabel), pipe[14]) : undefined;
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
    const from = text[2] === nodeId ? fromEndpoint(text[2], text[3], text[4], shapeTokenForShape(text[4], shape, defaultLabel), text[5]) : undefined;
    const to = text[12] === nodeId ? toEndpoint(text[12], text[13], text[14], shapeTokenForShape(text[14], shape, defaultLabel), text[15]) : undefined;
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
    const newShape = shapeTokenForShape(node[4], shape, defaultLabel);
    return `${node[1]}${node[2]}${node[3]}${newShape}${node[5]}`;
  }
  return undefined;
}

const SHAPE_ALIASES: Record<string, NodeShape> = {
  database: 'cylinder',
  'if-else': 'rhombus',
  decision: 'rhombus',
  diamond: 'rhombus',
  box: 'rect',
  process: 'rect',
};

export function setNodeShape(
  code: string,
  config: DiagramConfig | null,
  key: string,
  shape: NodeShape | string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'flowchart') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'node') return fail(code, config, `Element ${key} is not a node`);

  const targetShape: NodeShape = (SHAPE_ALIASES[shape] ?? shape) as NodeShape;
  if (!SHAPE_DELIMITERS[targetShape]) return fail(code, config, `Invalid node shape: ${shape}`);

  if (el.shape === targetShape || (!el.shape && targetShape === 'rect')) return { code, config };

  const currentLabel = el.label ?? el.id;
  const forbiddenChars = targetShape === 'rhombus' ? ['{', '}']
    : targetShape === 'round' || targetShape === 'circle' || targetShape === 'cylinder' ? ['(', ')']
    : ['[', ']'];
  if (forbiddenChars.some(c => currentLabel.includes(c))) {
    return fail(code, config, `Label cannot contain '${forbiddenChars.join('')}' for this node shape`);
  }

  const line = code.split('\n')[el.lineStart];
  const newLine = rewriteFlowchartNodeShape(line, el.id, targetShape, currentLabel);
  if (newLine === undefined) return fail(code, config, `Cannot parse node line: ${line.trim()}`);
  if (newLine === null) return { code, config };
  return { code: replaceLines(code, el.lineStart, el.lineEnd, [newLine]), config };
}

// Rewrite the label of a flowchart edge (pipe form, open-text form, or plain).
// segmentIndex selects the link on a chained edge line (source order).
// Returns the new line, null for a no-op, or undefined for a non-edge line.
function rewriteFlowchartEdgeLabel(line: string, newLabel: string, segmentIndex: number = 0): string | null | undefined {
  const chained = parseFlowchartLine(line);
  if (chained && chained.segments.length > 1) {
    const seg = chained.segments[segmentIndex];
    if (!seg) return undefined;
    const toEp = chained.endpoints[seg.to];
    if (seg.form === 'pipe') {
      if (newLabel === '') {
        // Drop the |label| token, collapsing the surrounding whitespace.
        const wsBefore = line.slice(seg.opEnd, seg.pipeStart!);
        const wsAfter = line.slice(seg.pipeEnd!, toEp.start);
        return spliceLine(line, [{ start: seg.opEnd, end: toEp.start, text: wsBefore || wsAfter || ' ' }]);
      }
      return spliceLine(line, [{ start: seg.labelStart!, end: seg.labelEnd!, text: newLabel }]);
    }
    if (seg.form === 'text') {
      if (newLabel === '') {
        // Normalize the open-text link to a plain link with the trailing operator.
        return spliceLine(line, [{ start: seg.leadOpStart!, end: toEp.start, text: `${seg.operator} ` }]);
      }
      return spliceLine(line, [{ start: seg.labelStart!, end: seg.labelEnd!, text: newLabel }]);
    }
    if (newLabel === '') return null;  // plain link: nothing to clear
    // Inject a pipe label right after the operator.
    return spliceLine(line, [{ start: seg.opEnd, end: seg.opEnd, text: `|${newLabel}|` }]);
  }
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
// normalized to the pipe form. segmentIndex selects the link on a chained
// edge line (source order). Returns the new line or undefined for a
// non-edge line.
function rewriteFlowchartEdgeOperator(line: string, operator: string, segmentIndex: number = 0): string | undefined {
  const chained = parseFlowchartLine(line);
  if (chained && chained.segments.length > 1) {
    const seg = chained.segments[segmentIndex];
    if (!seg) return undefined;
    if (seg.form === 'text') {
      // Normalize the open-text link to a pipe link.
      const toEp = chained.endpoints[seg.to];
      const ws = line.slice(seg.opEnd, toEp.start);
      return spliceLine(line, [{ start: seg.leadOpStart!, end: toEp.start, text: `${operator} |${seg.label ?? ''}|${ws || ' '}` }]);
    }
    return spliceLine(line, [{ start: seg.opStart, end: seg.opEnd, text: operator }]);
  }
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
    const parsed = parseParticipantLine(line);
    if (!parsed) return fail(code, config, `Cannot parse participant line: ${line.trim()}`);
    const { indent, id, participantType } = parsed;
    let newLine: string;
    if (participantType === 'actor') {
      newLine = `${indent}actor ${id}${alias ? ` as ${alias}` : ''}`;
    } else if (participantType === 'participant') {
      newLine = `${indent}participant ${id}${alias ? ` as ${alias}` : ''}`;
    } else {
      newLine = `${indent}participant ${id}${alias ? ` as ${alias}` : ''} @{ type: "${participantType}" }`;
    }
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
    : rewriteFlowchartEdgeLabel(line, newLabel, arrowSegmentIndex(model, el));
  if (newLine === undefined) return fail(code, config, `Cannot parse message line: ${line.trim()}`);
  if (newLine === null) return { code, config }; // nothing to clear
  const newCode = replaceLines(code, el.lineStart, el.lineEnd, [newLine]);

  // Arrow CONFIG entries are keyed by (from, to, label, occurrence): a label
  // edit re-keys the arrow's own entry — style, tags and tag mode follow the
  // new label — and shifts the occurrence of sibling arrows in the old and
  // new label groups. Element keys are index-based and stable across the edit,
  // so old and new key tuples are matched element by element.
  const newConfig = cloneConfig(config);
  let configChanged = false;
  if (newConfig?.arrows) {
    const newModel = parseModel(newCode);
    const newByKey = new Map<string, ModelElement>();
    for (const e of newModel.elements) newByKey.set(e.key, e);
    const retargeted = new Map<string, { label?: string; occurrence?: number }>();
    for (const e of model.elements) {
      if (!isArrow(e)) continue;
      const n = newByKey.get(e.key);
      if (!n || !isArrow(n)) continue;
      const newOccurrence = elementOccurrence(newModel, n);
      const before = arrowEntryKey(e.from, e.to, e.label, elementOccurrence(model, e));
      const after = arrowEntryKey(n.from, n.to, n.label, newOccurrence);
      if (before === after) continue;
      retargeted.set(before, { label: n.label, occurrence: newOccurrence > 0 ? newOccurrence : undefined });
    }
    newConfig.arrows = newConfig.arrows.map(a => {
      const target = retargeted.get(arrowEntryKey(a.from, a.to, a.label, a.occurrence ?? 0));
      if (!target) return a;
      const entry: ArrowStyle = { ...a };
      if (target.label !== undefined) entry.label = target.label; else delete entry.label;
      if (target.occurrence !== undefined) entry.occurrence = target.occurrence; else delete entry.occurrence;
      configChanged = true;
      return entry;
    });
  }
  if (!configChanged || !newConfig) return { code: newCode, config };
  return { code: updateViewsData(newCode, newConfig), config: newConfig };
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
    : rewriteFlowchartEdgeOperator(line, operator, arrowSegmentIndex(model, el));
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

// Retarget one endpoint of a flowchart edge (flowcharts only): 'to' moves the
// arrow head (target node), 'from' the tail (origin node). The operator and
// label are untouched. Arrow style/tag entries are keyed by
// (from, to, label, occurrence), so the entries that styled this edge follow
// the retargeted endpoint instead of being orphaned (same as
// moveMessageEndpoint).
//
// Chained edge lines (`A --> B --> C` emit one edge element per link) are
// handled through parseFlowchartLine's exact spans. An endpoint shared with
// the adjacent link cannot be renamed in place — that would silently
// retarget the neighbouring edge too — so the line is split in two at the
// endpoint: the retargeted link keeps the new id, the rest of the chain
// keeps the original endpoint text (id + shape) verbatim. An unshared
// endpoint (chain start/end, or a single-link line) is replaced in place.
// When the replaced node's first declaration lived on that endpoint, a
// standalone declaration line preserves it (retargeting an edge never
// deletes a node — same philosophy as deleteElement's rewrite).
export function moveEdgeEndpoint(
  code: string,
  config: DiagramConfig | null,
  key: string,
  end: 'from' | 'to',
  newNodeKey: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'flowchart') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'edge') return fail(code, config, `Element ${key} is not an edge`);
  const target = findElement(model, newNodeKey);
  if (!target || target.kind !== 'node') {
    return fail(code, config, `Unknown node key: ${newNodeKey}`);
  }
  const newId = target.id;
  if (newId === (end === 'from' ? el.from : el.to)) return { code, config }; // no-op

  const line = code.split('\n')[el.lineStart];
  const parsed = parseFlowchartLine(line);
  if (!parsed) return fail(code, config, `Cannot parse edge line: ${line.trim()}`);
  const segIdx = arrowSegmentIndex(model, el);
  const seg = parsed.segments[segIdx];
  const epIdx = end === 'from' ? seg?.from : seg?.to;
  const ep = epIdx !== undefined ? parsed.endpoints[epIdx] : undefined;
  if (!seg || !ep || ep.id !== (end === 'from' ? el.from : el.to)) {
    return fail(code, config, `Cannot locate edge endpoint on line: ${line.trim()}`);
  }

  const isLast = epIdx === parsed.endpoints.length - 1;
  const isFirst = epIdx === 0;
  // The endpoint is shared with the adjacent link when it is an inner chain
  // node: 'to' of segment k is 'from' of segment k+1, 'from' of segment k is
  // 'to' of segment k-1.
  const shared = end === 'to' ? !isLast : !isFirst;

  let newLines: string[];
  if (shared) {
    // Split the chain at the endpoint: the retargeted link carries the new id
    // (bare — the shape token belongs to the old node), the other side keeps
    // the original endpoint text verbatim.
    if (end === 'to') {
      newLines = [line.slice(0, ep.start) + newId, parsed.indent + line.slice(ep.start)];
    } else {
      newLines = [line.slice(0, ep.end), parsed.indent + newId + line.slice(ep.end)];
    }
  } else {
    newLines = [line.slice(0, ep.start) + newId + line.slice(ep.end)];
  }

  // The old node loses its declaration when its id no longer appears on the
  // rewritten line(s) and this line was its first declaration: keep a
  // standalone declaration so it stays visible with its label.
  const firstDeclaredHere = model.elements.some(
    e => e.kind === 'node' && e.id === ep.id && e.lineStart === el.lineStart
  );
  const stillDeclared = newLines.some(nl =>
    parseFlowchartLine(nl)?.endpoints.some(e2 => e2.id === ep.id)
  );
  if (firstDeclaredHere && !stillDeclared) {
    newLines.push(`${parsed.indent}${line.slice(ep.start, ep.end)}`);
  }

  const newCode = replaceLines(code, el.lineStart, el.lineEnd, newLines);

  // Keys are positional: the retargeted edge keeps its rank among the edges
  // of its line, and every segment before it stays before it (the split only
  // reorders lines after the dragged link's line), so its new key is the
  // (edgesBefore + segIdx)-th edge of the new model.
  const edgesBefore = model.elements.filter(e => e.kind === 'edge' && e.lineStart < el.lineStart).length;
  const newEdges = parseModel(newCode).elements.filter(e => e.kind === 'edge');
  const newKey = newEdges[edgesBefore + segIdx]?.key;

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
  if (!configChanged || !newConfig) return { code: newCode, config, newKey };
  return { code: updateViewsData(newCode, newConfig), config: newConfig, newKey };
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

export const PRESET_ACTOR_COLORS_LIGHT: string[] = [
  '#cfe2f3', '#f8d0d6', '#cdeed3', '#e2d0f8', '#f5ebc8',
  '#c9f0f2', '#f5d0e8', '#dcf2ce', '#d2d5f5', '#f8d8cf',
  '#ccf0de', '#efd0f8', '#eff2cc', '#cde6f5', '#f5d0dc',
  '#ccf0ca', '#dbd2f5', '#f7e4cd', '#cdf2eb', '#f8d0f2',
  '#e3f0d0', '#d0dcf8', '#f5d0d0', '#cbf2d6', '#e6d2f5',
  '#f2edc9', '#cfeef5', '#f8d0e5', '#d5edcc', '#d2d0f8',
  '#f5ddd0', '#caf2e3', '#f3d2f5', '#eaf2cb', '#d2e4f5',
  '#f8d0d8', '#ccefd0', '#dfd0f8', '#f3e8d0', '#caf2f0',
];

export function getPresetActorColors(theme: 'default' | 'dark' = 'dark'): string[] {
  return theme === 'default' ? PRESET_ACTOR_COLORS_LIGHT : PRESET_ACTOR_COLORS;
}

export function resolveActorColorForTheme(color: string, theme: 'default' | 'dark' = 'dark'): string {
  const trimmed = color.trim();
  if (!trimmed) return color;
  const hex = /^rgb\(/i.test(trimmed) ? rgbToHexColor(trimmed) : trimmed;
  const normalized = (hex ?? trimmed).toLowerCase();
  const darkIdx = PRESET_ACTOR_COLORS.findIndex(c => c.toLowerCase() === normalized);
  if (darkIdx >= 0) {
    return getPresetActorColors(theme)[darkIdx];
  }
  const lightIdx = PRESET_ACTOR_COLORS_LIGHT.findIndex(c => c.toLowerCase() === normalized);
  if (lightIdx >= 0) {
    return getPresetActorColors(theme)[lightIdx];
  }
  return color;
}

export function getNextFreeActorColor(
  config: DiagramConfig | null,
  theme: 'default' | 'dark' = 'dark',
): string {
  const palette = getPresetActorColors(theme);
  const actors = config?.actors ?? {};
  const indexUsage = new Array<number>(PRESET_ACTOR_COLORS.length).fill(0);

  for (const meta of Object.values(actors)) {
    if (meta.color) {
      const lower = meta.color.trim().toLowerCase();
      const darkIdx = PRESET_ACTOR_COLORS.findIndex(c => c.toLowerCase() === lower);
      if (darkIdx >= 0) {
        indexUsage[darkIdx]++;
        continue;
      }
      const lightIdx = PRESET_ACTOR_COLORS_LIGHT.findIndex(c => c.toLowerCase() === lower);
      if (lightIdx >= 0) {
        indexUsage[lightIdx]++;
      }
    }
  }

  // Find the first preset color index that is free
  for (let i = 0; i < palette.length; i++) {
    if (indexUsage[i] === 0) {
      return palette[i];
    }
  }

  // If all colors are added, start rotating again:
  // Find minimum usage count, and pick the first preset color matching that minimum usage
  let minCount = Infinity;
  for (const count of indexUsage) {
    if (count < minCount) minCount = count;
  }
  for (let i = 0; i < palette.length; i++) {
    if (indexUsage[i] === minCount) {
      return palette[i];
    }
  }

  return palette[0];
}

export function addParticipant(
  code: string,
  config: DiagramConfig | null,
  afterKey?: string,
  color?: string,
  kind: ParticipantType = 'participant',
  theme: 'default' | 'dark' = 'dark',
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

  const assignedColor = color ?? getNextFreeActorColor(config, theme);
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
  const aliasPart = ` as ${alias}`;
  let lineStr: string;
  if (kind === 'actor') {
    lineStr = `    actor ${id}${aliasPart}`;
  } else if (kind === 'participant') {
    lineStr = `    participant ${id}${aliasPart}`;
  } else {
    lineStr = `    participant ${id}${aliasPart} @{ type: "${kind}" }`;
  }
  lines.splice(afterLine + 1, 0, lineStr);
  return {
    code: updateViewsData(lines.join('\n'), newConfig),
    config: newConfig,
  };
}

const VALID_PARTICIPANT_KINDS = new Set<string>([
  'participant', 'actor', 'database', 'queue', 'boundary', 'control', 'entity', 'collections'
]);

export function setParticipantKind(
  code: string,
  config: DiagramConfig | null,
  key: string,
  kind: ParticipantType,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'participant') return fail(code, config, `Element ${key} is not a participant`);
  if (!VALID_PARTICIPANT_KINDS.has(kind)) return fail(code, config, `Invalid participant kind: ${kind}`);

  const line = code.split('\n')[el.lineStart];
  const parsed = parseParticipantLine(line);
  if (!parsed) return fail(code, config, `Cannot parse participant line: ${line.trim()}`);
  if (parsed.participantType === kind) return { code, config };

  const { indent, id, alias } = parsed;
  const aliasPart = alias !== undefined ? ` as ${alias}` : '';
  let newLine: string;
  if (kind === 'actor') {
    newLine = `${indent}actor ${id}${aliasPart}`;
  } else if (kind === 'participant') {
    newLine = `${indent}participant ${id}${aliasPart}`;
  } else {
    newLine = `${indent}participant ${id}${aliasPart} @{ type: "${kind}" }`;
  }
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
  const defaultLabel = 'New message';
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
// first declaration).
//
// Crossing a subgraph boundary is allowed: the node's first declaration moves
// to the target scope (inside the subgraph, or at top level), which changes
// the cluster Mermaid draws. Edge lines stay where they are — moving them
// across a boundary would silently change which cluster they belong to. The
// inserted declaration uses the target scope's indentation.
//
// targetBlockKey (optional) pins the target scope to a specific subgraph block:
// when beforeKey is undefined, the node is inserted at the END of that block
// (just before its `end` line) instead of the end of the file. This is how the
// drag interaction drops a node at the cursor's position inside a subgraph
// when the cursor is past the subgraph's last node.
export function moveNode(
  code: string,
  config: DiagramConfig | null,
  key: string,
  beforeKey?: string,
  targetBlockKey?: string,
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

  // Resolve the target block when targetBlockKey is given.
  let pinnedBlock: ModelElement | undefined;
  if (targetBlockKey !== undefined) {
    pinnedBlock = findElement(model, targetBlockKey);
    if (!pinnedBlock || pinnedBlock.kind !== 'block') {
      return fail(code, config, `Unknown block key: ${targetBlockKey}`);
    }
  }

  // Nodes in first-declaration order (parseModel emits them in source order).
  const nodes = model.elements.filter(e => e.kind === 'node');
  const idx = nodes.findIndex(n => n.key === key);

  const lines = code.split('\n');
  // Insert position, in original line indices: the moved line lands
  // immediately before line `insertAt`. Move-to-end appends at the end of the
  // file (keeping a trailing newline last). When targetBlockKey pins a
  // subgraph and beforeKey is undefined, insert before the block's `end` line
  // (end of that subgraph).
  const insertAt = beforeKey !== undefined
    ? targetEl!.lineStart
    : pinnedBlock
      ? pinnedBlock.lineEnd
      : (lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length);

  // The innermost block (subgraph) containing a line, if any.
  const blockAt = (line: number): ModelElement | undefined => {
    let inner: ModelElement | undefined;
    for (const e of model.elements) {
      if (e.kind === 'block' && e.lineStart < line && line <= e.lineEnd) inner = e;
    }
    return inner;
  };
  const sourceBlock = blockAt(el.lineStart);
  const targetBlock = blockAt(insertAt);
  const crossingSubgraph = sourceBlock?.key !== targetBlock?.key;

  if (beforeKey !== undefined) {
    // Already immediately before the target AND in the same subgraph scope:
    // nothing to change. (Crossing a subgraph boundary is never a no-op,
    // even when the nodes are adjacent in model order.)
    if (nodes[idx + 1]?.key === beforeKey && !crossingSubgraph) return { code, config };
  } else if (pinnedBlock) {
    // Pinned to a subgraph with no beforeKey: no-op when the node's first
    // declaration is already the last line inside that block (just before
    // the block's `end`).
    if (!crossingSubgraph && el.lineStart === pinnedBlock.lineEnd - 1) return { code, config };
  } else if (nodes[nodes.length - 1].key === key && !crossingSubgraph) {
    return { code, config }; // already last, same scope
  }

  if (insertAt === el.lineStart && !crossingSubgraph) return { code, config }; // same position

  // The node's declaration text + indent at its first appearance.
  const firstLine = lines[el.lineStart];
  let declText: string;
  let indent: string;
  let isStandalone = false;
  const parsedFirst = parseFlowchartLine(firstLine);
  const firstEndpoint = parsedFirst?.endpoints.find(e => e.id === el.id);
  if (parsedFirst && firstEndpoint) {
    isStandalone = parsedFirst.segments.length === 0;
    declText = firstLine.slice(firstEndpoint.start, firstEndpoint.end);
    indent = parsedFirst.indent;
  } else {
    declText = el.label ? `${el.id}[${el.label}]` : el.id;
    indent = '    ';
  }

  // When crossing a subgraph boundary, the inserted declaration must use the
  // TARGET scope's indentation (the subgraph's content indent, or the base
  // indent for top level). Detect it from the target line, or from the
  // content lines inside the target block for end-of-subgraph drops.
  // Block delimiters (`end`, `subgraph …`) are skipped: parseFlowchartLine
  // would otherwise parse `end` as a node id with the wrong indent.
  const isBlockDelimiter = (line: string) => BLOCK_END_RE.test(line) || BLOCK_OPEN_RE.test(line);
  let targetIndent = indent;
  if (crossingSubgraph) {
    if (insertAt < lines.length && !isBlockDelimiter(lines[insertAt])) {
      const parsedTarget = parseFlowchartLine(lines[insertAt]);
      if (parsedTarget?.indent) targetIndent = parsedTarget.indent;
    }
    if (targetIndent === indent) {
      if (targetBlock) {
        // insertAt is the block's `end` line (or another non-flowchart line
        // inside the block): detect the content indent from the first
        // flowchart line inside the target block.
        for (let i = targetBlock.lineStart + 1; i < targetBlock.lineEnd; i++) {
          if (isBlockDelimiter(lines[i])) continue;
          const parsed = parseFlowchartLine(lines[i]);
          if (parsed?.indent) { targetIndent = parsed.indent; break; }
        }
      }
      if (targetIndent === indent) {
        // No content lines in the target block (empty subgraph) or target is
        // top level: detect the base indent from the first top-level
        // flowchart line.
        for (let i = 0; i < lines.length; i++) {
          if (isBlockDelimiter(lines[i])) continue;
          if (blockAt(i)) continue; // skip lines inside subgraphs
          const parsed = parseFlowchartLine(lines[i]);
          if (parsed?.indent) { targetIndent = parsed.indent; break; }
        }
      }
    }
  }

  let newLines: string[];
  if (crossingSubgraph) {
    // Cross-subgraph move: insert a standalone declaration at the target scope
    // (with the target's indentation) so the node's first declaration — and
    // thus its cluster membership — changes. Edge lines stay untouched;
    // moving them across a boundary would silently change their cluster.
    // If the source's first declaration is a standalone line, remove it from
    // the old scope (it becomes a no-op re-declaration otherwise).
    if (isStandalone) {
      lines.splice(el.lineStart, 1);
      // Adjust insertAt if the removed line was before it.
      const adjustedInsertAt = insertAt > el.lineStart ? insertAt - 1 : insertAt;
      lines.splice(adjustedInsertAt, 0, `${targetIndent}${declText}`);
    } else {
      lines.splice(insertAt, 0, `${targetIndent}${declText}`);
    }
    newLines = lines;
  } else if (insertAt < el.lineStart) {
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
      const parsed = parseFlowchartLine(lines[i]);
      if (parsed && parsed.endpoints.some(ep => ep.id === el.id)) {
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
    // Group the removed elements by their line: a chained edge line can carry
    // several of them, and it is rebuilt once — keeping the surviving links
    // and re-declaring endpoints whose only declaration was on that line.
    const byLine = new Map<number, ModelElement[]>();
    for (const r of removed) {
      if (r.lineStart !== r.lineEnd) continue;
      const list = byLine.get(r.lineStart) ?? [];
      list.push(r);
      byLine.set(r.lineStart, list);
    }
    for (const [lineNo, rs] of byLine) {
      const parsed = parseFlowchartLine(lines[lineNo]);
      // Standalone node line or unparseable line: plain removal loses nothing.
      if (!parsed || parsed.segments.length === 0) continue;
      const sameLineEdges = model.elements.filter(e => e.kind === 'edge' && e.lineStart === lineNo);
      const removedSegments = new Set<number>();
      // A deleted node's own declaration must never survive on a rewritten line.
      const removedNodeIds = new Set<string>();
      for (const r of rs) {
        if (r.kind === 'node') removedNodeIds.add(r.id);
        else if (r.kind === 'edge') {
          const idx = sameLineEdges.findIndex(e => e.key === r.key);
          if (idx >= 0) removedSegments.add(idx);
        }
      }
      // A link survives unless it is removed directly or touches a deleted node.
      const keptSegment = parsed.segments.map((seg, idx) => {
        if (removedSegments.has(idx)) return false;
        return !removedNodeIds.has(parsed.endpoints[seg.from].id)
          && !removedNodeIds.has(parsed.endpoints[seg.to].id);
      });
      const inKeptSegment = (epIdx: number) =>
        keptSegment.some((kept, segIdx) => kept &&
          (parsed.segments[segIdx].from === epIdx || parsed.segments[segIdx].to === epIdx));
      // Rebuild the line: surviving links stay chained (original text and
      // order); an endpoint left with no surviving link keeps its declaration
      // as a standalone line when this line was its first declaration.
      const newLines: string[] = [];
      let i = 0;
      while (i < parsed.endpoints.length) {
        const ep = parsed.endpoints[i];
        if (!removedNodeIds.has(ep.id) && !inKeptSegment(i) && firstDeclaredHere(ep.id, lineNo)) {
          newLines.push(`${parsed.indent}${lines[lineNo].slice(ep.start, ep.end)}`);
          i++;
          continue;
        }
        if (keptSegment[i]) {
          // A run of consecutive surviving links: endpoints i..j+1.
          let j = i;
          while (j + 1 < keptSegment.length && keptSegment[j + 1]) j++;
          newLines.push(`${parsed.indent}${lines[lineNo].slice(parsed.endpoints[i].start, parsed.endpoints[j + 1].end)}`);
          i = j + 2;
          continue;
        }
        i++;
      }
      if (newLines.length === 0) continue;  // the whole line drops
      rewriteAt.set(lineNo, newLines);
      for (const r of rs) removed.delete(r);
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

  // Config cleanup: drop the component's actor entry and the arrow styles and
  // note tags of every removed element.
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
    const noteTargets: { over: string[]; text: string; occurrence: number }[] = [];
    if (el.kind === 'note') noteTargets.push({ over: el.over, text: el.text, occurrence: noteOccurrence(model, el) });
    for (const c of cascaded) {
      if (c.kind === 'note') noteTargets.push({ over: c.over, text: c.text, occurrence: noteOccurrence(model, c) });
    }
    if (newConfig.noteTags) {
      newConfig.noteTags = newConfig.noteTags.filter(n =>
        !noteTargets.some(t => notesMatchEntry(n, t.over, t.text, t.occurrence)));
    }
    pruneConfig(newConfig);
  }

  return {
    code: newConfig ? updateViewsData(newCode, newConfig) : newCode,
    config: newConfig,
    cascaded: cascaded.map(c => c.key),
  };
}

// Delete multiple elements in one pass (resolving all keys against the initial
// model so positional keys never shift mid-batch). Supports components,
// messages/edges, sequence notes, blocks (with content) and sticky notes.
export function deleteElements(code: string, config: DiagramConfig | null, keys: string[]): EditResult {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return { code, config };

  const stickyIds = new Set<string>();
  const modelKeys: string[] = [];
  for (const k of uniqueKeys) {
    const sid = stickyNoteIdFromKey(k);
    if (sid !== null) stickyIds.add(sid);
    else modelKeys.push(k);
  }

  let newCode = code;
  const cascaded: ModelElement[] = [];

  const model = parseModel(code);
  if (modelKeys.length > 0 && model.type === 'unknown') {
    return fail(code, config, UNSUPPORTED);
  }

  const targets: ModelElement[] = [];
  for (const k of modelKeys) {
    const el = findElement(model, k);
    if (!el) return fail(code, config, `Unknown element key: ${k}`);
    if (!isComponent(el) && !isArrow(el) && el.kind !== 'note' && el.kind !== 'block') {
      return fail(code, config, `Cannot delete element of kind '${el.kind}'`);
    }
    targets.push(el);
  }

  const removed = new Set<ModelElement>(targets);
  if (targets.length > 0) {
    // Cascade referencing messages/edges/notes of deleted components, and
    // contained elements of deleted blocks.
    const removedComponentIds = new Set<string>();
    for (const el of targets) {
      if (isComponent(el)) removedComponentIds.add(el.id);
      if (el.kind === 'block') {
        for (const e of model.elements) {
          if (e.lineStart > el.lineStart && e.lineEnd <= el.lineEnd && isComponent(e)) {
            removedComponentIds.add(e.id);
          }
        }
      }
    }
    for (const e of model.elements) {
      if (removed.has(e)) continue;
      const inRemovedBlock = targets.some(
        b => b.kind === 'block' && e.lineStart > b.lineStart && e.lineEnd <= b.lineEnd &&
          (isComponent(e) || isArrow(e) || e.kind === 'note' || e.kind === 'block')
      );
      const refsRemovedComponent =
        (isArrow(e) && (removedComponentIds.has(e.from) || removedComponentIds.has(e.to))) ||
        (e.kind === 'note' && e.over.some(id => removedComponentIds.has(id)));
      if (inRemovedBlock || refsRemovedComponent) {
        cascaded.push(e);
        removed.add(e);
      }
    }

    const lines = code.split('\n');
    const rewriteAt = new Map<number, string[]>();
    if (model.type === 'flowchart') {
      const firstDeclaredHere = (id: string, lineNo: number) =>
        model.elements.some(e => e.kind === 'node' && e.id === id && e.lineStart === lineNo);
      const byLine = new Map<number, ModelElement[]>();
      for (const r of removed) {
        if (r.lineStart !== r.lineEnd) continue;
        const list = byLine.get(r.lineStart) ?? [];
        list.push(r);
        byLine.set(r.lineStart, list);
      }
      for (const [lineNo, rs] of byLine) {
        const parsed = parseFlowchartLine(lines[lineNo]);
        if (!parsed || parsed.segments.length === 0) continue;
        const sameLineEdges = model.elements.filter(e => e.kind === 'edge' && e.lineStart === lineNo);
        const removedSegments = new Set<number>();
        const removedNodeIds = new Set<string>();
        for (const r of rs) {
          if (r.kind === 'node') removedNodeIds.add(r.id);
          else if (r.kind === 'edge') {
            const idx = sameLineEdges.findIndex(e => e.key === r.key);
            if (idx >= 0) removedSegments.add(idx);
          }
        }
        const keptSegment = parsed.segments.map((seg, idx) => {
          if (removedSegments.has(idx)) return false;
          return !removedNodeIds.has(parsed.endpoints[seg.from].id)
            && !removedNodeIds.has(parsed.endpoints[seg.to].id);
        });
        const inKeptSegment = (epIdx: number) =>
          keptSegment.some((kept, segIdx) => kept &&
            (parsed.segments[segIdx].from === epIdx || parsed.segments[segIdx].to === epIdx));
        const newLines: string[] = [];
        let i = 0;
        while (i < parsed.endpoints.length) {
          const ep = parsed.endpoints[i];
          if (!removedNodeIds.has(ep.id) && !inKeptSegment(i) && firstDeclaredHere(ep.id, lineNo)) {
            newLines.push(`${parsed.indent}${lines[lineNo].slice(ep.start, ep.end)}`);
            i++;
            continue;
          }
          if (keptSegment[i]) {
            let j = i;
            while (j + 1 < keptSegment.length && keptSegment[j + 1]) j++;
            newLines.push(`${parsed.indent}${lines[lineNo].slice(parsed.endpoints[i].start, parsed.endpoints[j + 1].end)}`);
            i = j + 2;
            continue;
          }
          i++;
        }
        if (newLines.length === 0) continue;
        rewriteAt.set(lineNo, newLines);
        for (const r of rs) removed.delete(r);
      }
    }

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
    newCode = kept.join('\n');
  }

  const allRemoved = [...targets, ...cascaded];
  const removedComponentIds = new Set<string>();
  const arrowTargets: { from: string; to: string; label?: string; occurrence: number }[] = [];
  const noteTargets: { over: string[]; text: string; occurrence: number }[] = [];

  for (const r of allRemoved) {
    if (isComponent(r)) removedComponentIds.add(r.id);
    if (isArrow(r)) arrowTargets.push({ from: r.from, to: r.to, label: r.label, occurrence: elementOccurrence(model, r) });
    if (r.kind === 'note') noteTargets.push({ over: r.over, text: r.text, occurrence: noteOccurrence(model, r) });
  }

  const newConfig = cloneConfig(config);
  if (newConfig) {
    if (removedComponentIds.size > 0 && newConfig.actors) {
      for (const id of removedComponentIds) delete newConfig.actors[id];
    }
    if (newConfig.arrows) {
      newConfig.arrows = newConfig.arrows.filter(a => {
        if (removedComponentIds.has(a.from) || removedComponentIds.has(a.to)) return false;
        return !arrowTargets.some(t => arrowsMatchEntry(a, t.from, t.to, t.label, t.occurrence));
      });
    }
    if (newConfig.noteTags) {
      newConfig.noteTags = newConfig.noteTags.filter(n =>
        !noteTargets.some(t => notesMatchEntry(n, t.over, t.text, t.occurrence)));
    }
    if (stickyIds.size > 0 && newConfig.notes) {
      newConfig.notes = newConfig.notes.filter(n => !stickyIds.has(n.id));
      if (newConfig.notes.length === 0) delete newConfig.notes;
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
  // Sticky notes live in CONFIG, not in the parsed model: resolve them first.
  const stickyId = stickyNoteIdFromKey(key);
  if (stickyId !== null) {
    const t = tag.trim();
    if (!TAG_RE.test(t)) return fail(code, config, `Invalid tag: ${tag}`);
    return addStickyNoteTag(code, config, stickyId, t);
  }
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || (!isComponent(el) && !isArrow(el) && el.kind !== 'note')) {
    return fail(code, config, `Element ${key} is not a component, message or note`);
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

  // Note: the tag rides on the note's CONFIG.noteTags entry (same
  // (over, text, occurrence) keying as arrow styles).
  if (el.kind === 'note') {
    const occurrence = noteOccurrence(model, el);
    const newConfig = cloneConfig(config) ?? { version: 1 };
    const noteTags = newConfig.noteTags ? [...newConfig.noteTags] : [];
    const idx = noteTags.findIndex(n => notesMatchEntry(n, el.over, el.text, occurrence));
    if (idx >= 0) {
      if (noteTags[idx].keys?.includes(t)) return { code, config }; // already there
      noteTags[idx] = { ...noteTags[idx], keys: [...(noteTags[idx].keys ?? []), t] };
    } else {
      const entry: NoteTagEntry = { over: [...el.over], text: el.text };
      if (occurrence > 0) entry.occurrence = occurrence;
      entry.keys = [t];
      noteTags.push(entry);
    }
    newConfig.noteTags = noteTags;
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
  // Sticky notes live in CONFIG, not in the parsed model: resolve them first.
  const stickyId = stickyNoteIdFromKey(key);
  if (stickyId !== null) {
    return removeStickyNoteTag(code, config, stickyId, tag);
  }
  const model = parseModel(code);
  if (model.type === 'unknown') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || (!isComponent(el) && !isArrow(el) && el.kind !== 'note')) {
    return fail(code, config, `Element ${key} is not a component, message or note`);
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

  // Note: drop the tag from the note's CONFIG.noteTags entry.
  if (el.kind === 'note') {
    const occurrence = noteOccurrence(model, el);
    const existing = config?.noteTags?.find(n => notesMatchEntry(n, el.over, el.text, occurrence));
    if (!existing?.keys?.includes(tag)) return { code, config }; // nothing to remove
    const newConfig = cloneConfig(config) ?? { version: 1 };
    const noteTags = newConfig.noteTags ? [...newConfig.noteTags] : [];
    const idx = noteTags.findIndex(n => notesMatchEntry(n, el.over, el.text, occurrence));
    const kept = (noteTags[idx].keys ?? []).filter(k => k !== tag);
    const entry = { ...noteTags[idx] };
    if (kept.length > 0) entry.keys = kept; else delete entry.keys;
    noteTags[idx] = entry;
    newConfig.noteTags = noteTags;
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
  // A message/edge sitting inside a subgraph also carries the subgraph's tag
  // (structural, read-only — never stored in CONFIG).
  const subgraphKeys = buildSubgraphTagIndex(code, model).elementKeys.get(el.key) ?? [];
  const inherited = Array.from(new Set([...originKeys, ...subgraphKeys]))
    .filter(k => !keys.includes(k));
  return { keys, keyMode, inherited };
}

// The note's own tags (notes carry no tag behavior: no inheritance, so hiding
// is on/off only, like arrows' own keys).
export function getNoteTags(code: string, config: DiagramConfig | null, key: string): string[] {
  const model = parseModel(code);
  const el = findElement(model, key);
  if (!el || el.kind !== 'note') return [];
  const occurrence = noteOccurrence(model, el);
  const entry = config?.noteTags?.find(n => notesMatchEntry(n, el.over, el.text, occurrence));
  return entry?.keys ?? [];
}

// The sticky note's own tags (sticky notes carry no tag behavior: no
// inheritance, so hiding is on/off only, like notes' own keys).
export function getStickyNoteTags(config: DiagramConfig | null, key: string): string[] {
  const id = stickyNoteIdFromKey(key);
  if (id === null) return [];
  return config?.notes?.find(n => n.id === id)?.keys ?? [];
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

// Global arrow defaults (CONFIG.defaultArrowStyle): the fallback color/width
// for every arrow whose own entry does not set the field. The patch MERGES:
// a field present in the patch is set (empty string / undefined clears it),
// an absent field keeps its current value. When both defaults are cleared the
// key is removed (and the CONFIG header with it, when nothing else carries
// state).
export function setGlobalArrowStyle(code: string, config: DiagramConfig | null, style: ArrowStyleDefaults): EditResult {
  const hasColor = Object.prototype.hasOwnProperty.call(style, 'color');
  const hasWidth = Object.prototype.hasOwnProperty.call(style, 'width');
  if (hasWidth && style.width !== undefined && (!Number.isInteger(style.width) || style.width < 1 || style.width > 10)) {
    return fail(code, config, 'Arrow width must be an integer between 1 and 10');
  }

  const newConfig = cloneConfig(config) ?? { version: 1 };
  const prev = newConfig.defaultArrowStyle ?? {};
  const next: ArrowStyleDefaults = { ...prev };
  if (hasColor) {
    const color = style.color !== undefined && style.color.trim() !== '' ? style.color.trim() : undefined;
    if (color !== undefined) next.color = color; else delete next.color;
  }
  if (hasWidth) {
    if (style.width !== undefined) next.width = style.width; else delete next.width;
  }

  const prevHasDefault = prev.color !== undefined || prev.width !== undefined;
  const nextHasDefault = next.color !== undefined || next.width !== undefined;
  if (prevHasDefault === nextHasDefault && JSON.stringify(prev) === JSON.stringify(next)) {
    return { code, config };  // no-op: no history entry
  }
  if (nextHasDefault) {
    newConfig.defaultArrowStyle = next;
  } else {
    delete newConfig.defaultArrowStyle;
  }
  return { code: updateViewsData(code, newConfig), config: newConfig };
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

// --- Sequence notes ---------------------------------------------------------

// Create a native `Note over <actor>: New note` line (sequence diagrams only).
// The actor is the requested participant, else the first declared participant,
// else the first implicit actor (a message endpoint). The line lands after the
// requested element — hopping over its trailing activate/deactivate companion
// lines, which parseModel attributes to the message via the immediately
// following line — else after the last message/note, else after the last
// participant. Placement and span are edited afterwards; the created line must
// be valid on its own, so it is always created with `over`.
export function addSequenceNote(
  code: string,
  config: DiagramConfig | null,
  opts?: { overKey?: string; afterKey?: string },
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);

  let actorId: string | undefined;
  if (opts?.overKey !== undefined) {
    const over = findElement(model, opts.overKey);
    if (!over || over.kind !== 'participant') {
      return fail(code, config, `Unknown participant key: ${opts.overKey}`);
    }
    actorId = over.id;
  } else {
    const firstParticipant = model.elements.find(e => e.kind === 'participant');
    if (firstParticipant && firstParticipant.kind === 'participant') actorId = firstParticipant.id;
    if (!actorId) {
      const firstMessage = model.elements.find(e => e.kind === 'message');
      if (firstMessage && firstMessage.kind === 'message') actorId = firstMessage.from;
    }
  }
  if (!actorId) return fail(code, config, 'Add a participant first');

  const lines = code.split('\n');
  const isCompanion = (line: string) => /^\s*(?:activate|deactivate)\s+[A-Za-z0-9_-]+\s*$/.test(line);

  let insertAt: number;
  const anchor = opts?.afterKey !== undefined ? findElement(model, opts.afterKey) : undefined;
  if (opts?.afterKey !== undefined && !anchor) {
    return fail(code, config, `Unknown element key: ${opts.afterKey}`);
  }
  if (anchor) {
    insertAt = anchor.lineEnd + 1;
    while (insertAt < lines.length && isCompanion(lines[insertAt])) insertAt++;
  } else {
    const lastMsgOrNote = [...model.elements].reverse().find(e => e.kind === 'message' || e.kind === 'note');
    if (lastMsgOrNote) {
      insertAt = lastMsgOrNote.lineEnd + 1;
      while (insertAt < lines.length && isCompanion(lines[insertAt])) insertAt++;
    } else {
      const lastParticipant = [...model.elements].reverse().find(e => e.kind === 'participant');
      insertAt = lastParticipant
        ? lastParticipant.lineEnd + 1
        : lines.findIndex(l => /^\s*sequenceDiagram\b/.test(l)) + 1;
    }
  }

  lines.splice(insertAt, 0, `    Note over ${actorId}: New note`);
  const newCode = lines.join('\n');
  const created = parseModel(newCode).elements.find(e => e.kind === 'note' && e.lineStart === insertAt);
  return { code: newCode, config, newKey: created?.key };
}

// Edit a sequence note's text. Only the text span of the line changes; the
// CONFIG noteTags entry that tagged the note follows the new (over, text,
// occurrence) key.
export function editNoteText(code: string, config: DiagramConfig | null, key: string, text: string): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'note') return fail(code, config, `Element ${key} is not a note`);
  if (text.includes('\n')) return fail(code, config, 'Note text must be a single line');

  const line = code.split('\n')[el.lineStart];
  const m = line.match(SEQ_NOTE_V);
  if (!m) return fail(code, config, `Cannot parse note line: ${line.trim()}`);
  const newLine = `${m[1]}Note${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}:${text === '' ? '' : `${m[8]}${text}`}`;
  if (newLine === line) return { code, config };
  const newCode = replaceLines(code, el.lineStart, el.lineEnd, [newLine]);

  const newConfig = retargetNoteEntries(model, parseModel(newCode), config);
  if (!newConfig) return { code: newCode, config };
  return { code: updateViewsData(newCode, newConfig), config: newConfig };
}

// Edit a sequence note's placement keyword (over / left of / right of).
// `left of` / `right of` span exactly one actor in Mermaid, so switching away
// from `over` on a multi-actor note is refused.
export function setNotePlacement(code: string, config: DiagramConfig | null, key: string, placement: NotePlacement): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'note') return fail(code, config, `Element ${key} is not a note`);
  if (!NOTE_PLACEMENTS.has(placement)) return fail(code, config, `Invalid note placement: ${placement}`);
  if (placement !== 'over' && el.over.length > 1) {
    return fail(code, config, 'A left of / right of note can span only one participant');
  }
  if (el.placement === placement) return { code, config };

  const line = code.split('\n')[el.lineStart];
  const m = line.match(SEQ_NOTE_V);
  if (!m) return fail(code, config, `Cannot parse note line: ${line.trim()}`);
  const newLine = `${m[1]}Note${m[2]}${placement}${m[4]}${m[5]}${m[6]}:${m[8]}${m[9]}`;
  const newCode = replaceLines(code, el.lineStart, el.lineEnd, [newLine]);

  // Placement is not part of the CONFIG tag key, so this retarget is a no-op
  // in practice — run uniformly so the invariant does not depend on the caller.
  const newConfig = retargetNoteEntries(model, parseModel(newCode), config);
  if (!newConfig) return { code: newCode, config };
  return { code: updateViewsData(newCode, newConfig), config: newConfig };
}

// Edit the participant span of a sequence note. Ids are deduped (a literal
// `Note over A,A` must not survive a rewrite), must be actors of this diagram
// (declared participants, message endpoints, or actors of other notes) and
// keep the caller's order. A left of / right of note stays single-actor.
export function setNoteSpan(code: string, config: DiagramConfig | null, key: string, overIds: string[]): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'note') return fail(code, config, `Element ${key} is not a note`);

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of overIds) {
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  if (ids.length === 0) return fail(code, config, 'A note must span at least one participant');
  if (el.placement !== 'over' && ids.length > 1) {
    return fail(code, config, 'A left of / right of note can span only one participant');
  }
  const actors = sequenceActorIds(model);
  for (const id of ids) {
    if (!actors.has(id)) return fail(code, config, `Unknown participant: ${id}`);
  }
  if (ids.length === el.over.length && ids.every((id, i) => id === el.over[i])) return { code, config };

  const line = code.split('\n')[el.lineStart];
  const m = line.match(SEQ_NOTE_V);
  if (!m) return fail(code, config, `Cannot parse note line: ${line.trim()}`);
  const newLine = `${m[1]}Note${m[2]}${m[3]}${m[4]}${ids.join(',')}${m[6]}:${m[8]}${m[9]}`;
  const newCode = replaceLines(code, el.lineStart, el.lineEnd, [newLine]);

  const newConfig = retargetNoteEntries(model, parseModel(newCode), config);
  if (!newConfig) return { code: newCode, config };
  return { code: updateViewsData(newCode, newConfig), config: newConfig };
}

// --- Sequence blocks (alt/opt/loop/par/rect/box) -----------------------------

// Verbose block-header regex: captures every whitespace segment so rebuilt
// lines preserve the original spacing byte-for-byte outside the edited span.
const SEQ_BLOCK_V = /^(\s*)(alt|opt|loop|par|rect|box|subgraph)(\s+)?(.*?)(\s*)$/;

// Block types the panel can edit (title + type). box blocks encode color and
// name in their title and are managed by Group into Box; subgraphs are not a
// sequence construct.
const EDITABLE_BLOCK_TYPES: ReadonlySet<BlockType> = new Set(['alt', 'opt', 'loop', 'par', 'rect']);

// Default color when converting a block to rect without an rgb(...) title
// (edge W11; the rect color row in the panel starts from it).
export const DEFAULT_RECT_COLOR = 'rgb(200,150,255)';

const RGB_COLOR_RE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;

function isRgbColor(title: string): boolean {
  const m = title.trim().match(RGB_COLOR_RE);
  return !!m && Number(m[1]) <= 255 && Number(m[2]) <= 255 && Number(m[3]) <= 255;
}

// hex (#rrggbb) -> rgb(r,g,b) for rect block titles (edge B10); null when the
// input is not a 6-digit hex color.
export function hexToRgbColor(hex: string): string | null {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

// rgb(r,g,b) -> hex (#rrggbb) for the rect color picker; null when the input
// is not a valid rgb() color.
export function rgbToHexColor(rgb: string): string | null {
  const m = rgb.trim().match(RGB_COLOR_RE);
  if (!m) return null;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (r > 255 || g > 255 || b > 255) return null;
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// The line of the `end` that closes the block opened at headerLine, or null
// when the block is unclosed. Recomputed from the lines (not the model) so a
// nested unclosed block is not mistaken for closed by a later sibling's `end`.
function matchingEndLine(lines: string[], headerLine: number): number | null {
  let depth = 0;
  for (let i = headerLine; i < lines.length; i++) {
    if (BLOCK_OPEN_RE.test(lines[i])) depth++;
    else if (BLOCK_END_RE.test(lines[i])) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

// Rebuild a block header line, replacing only the keyword and/or title span.
function rebuildBlockHeader(line: string, keyword: BlockType, title: string | undefined): string | null {
  const m = line.match(SEQ_BLOCK_V);
  if (!m) return null;
  const titleText = title ?? '';
  return `${m[1]}${keyword}${titleText !== '' ? (m[3] ?? ' ') + titleText : ''}${m[5]}`;
}

// Edit a block's title. Only the header line's title span changes (NFR-02).
// rect titles are colors: a non-empty rect title must be a validated rgb(...)
// string (the panel converts hex <-> rgb, edge B10). Empty title -> bare
// keyword line. box titles encode color and name and are not editable.
export function setBlockTitle(code: string, config: DiagramConfig | null, key: string, title: string): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'block') return fail(code, config, `Element ${key} is not a block`);
  if (el.blockType === 'box') {
    return fail(code, config, 'A box block title encodes its color and name; unwrap the box or regroup its participants instead');
  }
  if (el.blockType === 'subgraph') return fail(code, config, 'Subgraph titles are not editable');
  if (title.includes('\n')) return fail(code, config, 'Block title must be a single line');
  if (el.blockType === 'rect' && title !== '' && !isRgbColor(title)) {
    return fail(code, config, `A rect block title must be an rgb(...) color, e.g. ${DEFAULT_RECT_COLOR}`);
  }
  if ((el.title ?? '') === title) return { code, config };

  const line = code.split('\n')[el.lineStart];
  const newLine = rebuildBlockHeader(line, el.blockType, title);
  if (newLine === null) return fail(code, config, `Cannot parse block line: ${line.trim()}`);
  return { code: replaceLines(code, el.lineStart, el.lineStart, [newLine]), config };
}

// Change a block's type among alt|opt|loop|par|rect (box/subgraph refused both
// as source and target). Only the keyword span changes; converting to rect
// requires an rgb(...) title, so a non-color title becomes the default color
// (edge W11). A block whose span contains else/and separator lines cannot be
// converted (edge B5: else is only legal in alt, and only in par).
export function setBlockType(code: string, config: DiagramConfig | null, key: string, blockType: BlockType): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'block') return fail(code, config, `Element ${key} is not a block`);
  if (!EDITABLE_BLOCK_TYPES.has(el.blockType)) {
    return fail(code, config, `Cannot change the type of a ${el.blockType} block`);
  }
  if (!EDITABLE_BLOCK_TYPES.has(blockType)) {
    return fail(code, config, `Cannot convert a block to '${blockType}'`);
  }
  if (el.blockType === blockType) return { code, config };

  const lines = code.split('\n');
  const endLine = matchingEndLine(lines, el.lineStart) ?? lines.length;
  let separators = 0;
  for (let i = el.lineStart + 1; i < endLine; i++) {
    if (BLOCK_CONT_RE.test(lines[i])) separators++;
  }
  if (separators > 0) {
    return fail(code, config,
      `Cannot convert a block with ${separators === 1 ? 'an else/and separator' : `${separators} else/and separators`} to '${blockType}'`);
  }

  let title = el.title;
  if (blockType === 'rect' && (!title || !isRgbColor(title))) title = DEFAULT_RECT_COLOR;

  const newLine = rebuildBlockHeader(lines[el.lineStart], blockType, title);
  if (newLine === null) return fail(code, config, `Cannot parse block line: ${lines[el.lineStart].trim()}`);
  return { code: replaceLines(code, el.lineStart, el.lineStart, [newLine]), config };
}

// Unwrap a block: drop the header line and the matching `end` line, drop
// else/and separator lines inside the span (edge B6 — leaving them would be a
// Mermaid syntax error), and de-indent only content lines that start with
// headerIndent + 4 spaces (edge B7). An unclosed block (edge B8) loses only
// its header. Blank lines are preserved byte-for-byte.
export function unwrapBlock(code: string, config: DiagramConfig | null, key: string): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'block') return fail(code, config, `Element ${key} is not a block`);

  const lines = code.split('\n');
  const headerIndent = lines[el.lineStart].match(/^\s*/)?.[0] ?? '';
  const endLine = matchingEndLine(lines, el.lineStart);

  if (endLine === null) {
    // Unclosed block: drop the header only; the content stays as written.
    return { code: replaceLines(code, el.lineStart, el.lineStart, []), config };
  }

  let separators = 0;
  const kept: string[] = [];
  const deindent = headerIndent + '    ';
  for (let i = el.lineStart + 1; i < endLine; i++) {
    const line = lines[i];
    if (BLOCK_CONT_RE.test(line)) { separators++; continue; }
    if (line.trim() === '') { kept.push(line); continue; }
    // De-indent one level (edge B7): only lines that actually start with
    // headerIndent + 4 spaces move up to the header's own indent.
    kept.push(line.startsWith(deindent) ? headerIndent + line.slice(deindent.length) : line);
  }
  const newCode = replaceLines(code, el.lineStart, endLine, kept);
  return {
    code: newCode,
    config,
    ...(separators > 0
      ? { warning: `${separators} separator ${separators === 1 ? 'line' : 'lines'} removed` }
      : {}),
  };
}

// Delete a block with its content: drop the whole span (header through the
// matching `end`, or to EOF for an unclosed block). CONFIG cleanup mirrors
// deleteElement: the arrows entries and noteTags entries of every contained
// message/note are filtered out, actor entries of participants declared
// inside the span are dropped, and occurrences of surviving entries are NOT
// renumbered (edge B9, same trade-off as deleteElement). `cascaded` lists the
// contained messages/notes for the confirmation dialog. withContent: false
// unwraps instead (same as unwrapBlock).
export function deleteBlock(
  code: string,
  config: DiagramConfig | null,
  key: string,
  opts?: { withContent?: boolean },
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const el = findElement(model, key);
  if (!el || el.kind !== 'block') return fail(code, config, `Element ${key} is not a block`);
  if (opts?.withContent === false) return unwrapBlock(code, config, key);

  // Everything whose lines live inside the span goes away with the block.
  const contained: ModelElement[] = [];
  const containedParticipants: ParticipantElement[] = [];
  for (const e of model.elements) {
    if (e === el) continue;
    if (e.lineStart <= el.lineStart || e.lineEnd > el.lineEnd) continue;
    if (e.kind === 'message' || e.kind === 'note') contained.push(e);
    else if (e.kind === 'participant') containedParticipants.push(e);
  }

  const newCode = replaceLines(code, el.lineStart, el.lineEnd, []);

  const newConfig = cloneConfig(config);
  if (newConfig) {
    if (containedParticipants.length > 0 && newConfig.actors) {
      for (const p of containedParticipants) delete newConfig.actors[p.id];
    }
    const arrowTargets = contained
      .filter(isArrow)
      .map(m => ({ from: m.from, to: m.to, label: m.label, occurrence: elementOccurrence(model, m) }));
    if (newConfig.arrows && arrowTargets.length > 0) {
      newConfig.arrows = newConfig.arrows.filter(a =>
        !arrowTargets.some(t => arrowsMatchEntry(a, t.from, t.to, t.label, t.occurrence)));
    }
    const noteTargets = contained
      .filter((e): e is NoteElement => e.kind === 'note')
      .map(n => ({ over: n.over, text: n.text, occurrence: noteOccurrence(model, n) }));
    if (newConfig.noteTags && noteTargets.length > 0) {
      newConfig.noteTags = newConfig.noteTags.filter(n =>
        !noteTargets.some(t => notesMatchEntry(n, t.over, t.text, t.occurrence)));
    }
    pruneConfig(newConfig);
  }

  return {
    code: newConfig ? updateViewsData(newCode, newConfig) : newCode,
    config: newConfig,
    cascaded: contained.map(c => c.key),
  };
}

// ---------------------------------------------------------------------------
// Wrapping a selection (messages/notes) in a block or a %% @region (W1–W16).
// ---------------------------------------------------------------------------

// Block types a selection can be wrapped in. box encodes color+name in its
// title and subgraphs are not a sequence construct (same set as the panel).
const WRAP_BLOCK_TYPES: ReadonlySet<BlockType> = new Set(['alt', 'opt', 'loop', 'par', 'rect']);

const REGION_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const REGION_START_LINE_RE = /^%%\s*@region-start:/;
const REGION_END_LINE_RE = /^%%\s*@region-end\b/;
// `activate X` / `deactivate X` companion lines follow the message they modify
// (parseModel reads them from the next line only); they are not elements.
const COMPANION_LINE_RE = /^\s*(?:activate|deactivate)\s+[A-Za-z0-9_-]+\s*$/;

interface WrapSpan {
  spanStart: number;
  spanEnd: number;
  lines: string[];
}

// Running count of BLOCK_OPEN_RE minus BLOCK_END_RE over lines[0..upto).
// else/and separators and region comments do not change the depth.
function blockDepthAt(lines: string[], upto: number): number {
  let depth = 0;
  for (let i = 0; i < upto && i < lines.length; i++) {
    if (BLOCK_OPEN_RE.test(lines[i])) depth++;
    else if (BLOCK_END_RE.test(lines[i])) depth = Math.max(0, depth - 1);
  }
  return depth;
}

// Resolve the selected keys to a wrappable span: all keys must be messages or
// notes (W4), sorted by lineStart (W5), at least two distinct ones, spanning
// first lineStart .. last lineEnd and extended over trailing activate /
// deactivate companion lines of the last message (W3). The span must not
// touch line 0 (W16, defensive — CONFIG / diagram-type line).
function resolveWrapSpan(
  code: string,
  model: ReturnType<typeof parseModel>,
  keys: string[],
): { ok: true; span: WrapSpan } | { ok: false; reason: string } {
  if (model.type !== 'sequence') return { ok: false, reason: UNSUPPORTED };
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length < 2) {
    return { ok: false, reason: 'Select at least two messages or notes to wrap' };
  }
  const elements = uniqueKeys.map(k => findElement(model, k));
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) return { ok: false, reason: `Unknown element key: ${uniqueKeys[i]}` };
    if (el.kind !== 'message' && el.kind !== 'note') {
      return { ok: false, reason: `Only messages and notes can be wrapped (${uniqueKeys[i]} is a ${el.kind})` };
    }
  }
  const selected = (elements as (MessageElement | NoteElement)[]).slice().sort((a, b) => a.lineStart - b.lineStart);
  const lines = code.split('\n');
  const spanStart = selected[0].lineStart;
  let spanEnd = selected[selected.length - 1].lineEnd;
  // W3: absorb trailing companion lines so the wrap never separates a message
  // from its activation.
  while (spanEnd + 1 < lines.length && COMPANION_LINE_RE.test(lines[spanEnd + 1])) spanEnd++;
  if (spanStart === 0) {
    return { ok: false, reason: 'The selection must not include the diagram header line' };
  }
  return { ok: true, span: { spanStart, spanEnd, lines } };
}

// Shared gate for canWrapSelection and both wrap transforms. W1 (both modes,
// checked first): every model element fully contained in the span must be
// selected (blank lines and %% comments inside are fine). Mode 'block' (W2):
// no block open/end/else/and line inside the span and equal block depth
// before and after it — a wrap fully inside a single block arm is allowed.
// Mode 'region' (W9/W10): block structure lines are fine (region tags are
// stripped comments), but an existing %% @region-start/@region-end line inside
// the span is refused.
function checkWrap(
  code: string,
  model: ReturnType<typeof parseModel>,
  keys: string[],
  mode: 'block' | 'region',
): { ok: true; span: WrapSpan } | { ok: false; reason: string } {
  const resolved = resolveWrapSpan(code, model, keys);
  if (!resolved.ok) return resolved;
  const { spanStart, spanEnd, lines } = resolved.span;

  // W1 first: every model element fully contained in the span must be
  // selected (blank lines and %% comments inside are fine).
  const selectedKeys = new Set(keys);
  for (const e of model.elements) {
    if (e.kind === 'config') continue;
    if (e.lineStart >= spanStart && e.lineEnd <= spanEnd && !selectedKeys.has(e.key)) {
      return { ok: false, reason: `The selection is not contiguous (${e.key} sits inside the span but is not selected)` };
    }
  }

  if (mode === 'block') {
    for (let i = spanStart; i <= spanEnd; i++) {
      if (BLOCK_CONT_RE.test(lines[i])) {
        return { ok: false, reason: 'The selection crosses an else/and arm of a block' };
      }
      if (BLOCK_OPEN_RE.test(lines[i])) {
        return { ok: false, reason: 'The selection contains a block header (alt/opt/loop/par/rect/box)' };
      }
      if (BLOCK_END_RE.test(lines[i])) {
        return { ok: false, reason: 'The selection contains a block end line' };
      }
    }
    if (blockDepthAt(lines, spanStart) !== blockDepthAt(lines, spanEnd + 1)) {
      return { ok: false, reason: 'The selection starts and ends at different block depths' };
    }
  } else {
    for (let i = spanStart; i <= spanEnd; i++) {
      const trimmed = lines[i].trim();
      if (REGION_START_LINE_RE.test(trimmed)) {
        return { ok: false, reason: 'The selection contains a %% @region-start tag' };
      }
      if (REGION_END_LINE_RE.test(trimmed)) {
        return { ok: false, reason: 'The selection contains a %% @region-end tag' };
      }
    }
  }
  return { ok: true, span: resolved.span };
}

// The single source of truth for wrap gating, used by the panel (to enable /
// disable the wrap controls and show the reason verbatim) and by the transforms.
export function canWrapSelection(
  code: string,
  model: ReturnType<typeof parseModel>,
  keys: string[],
  mode: 'block' | 'region',
): { ok: true } | { ok: false; reason: string } {
  const r = checkWrap(code, model, keys, mode);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

// Wrap the selected messages/notes in an alt/opt/loop/par/rect block. The
// header takes the first span line's indent, content lines get +4 spaces (blank
// lines untouched), `end` sits at the header indent. No CONFIG changes: arrow /
// note entry keys are order-based and the wrap preserves element order.
export function wrapInBlock(
  code: string,
  config: DiagramConfig | null,
  keys: string[],
  blockType: BlockType,
  title?: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  if (!WRAP_BLOCK_TYPES.has(blockType)) {
    return fail(code, config, `A ${blockType} block cannot wrap a selection`);
  }
  const trimmedTitle = (title ?? '').trim();
  if (trimmedTitle.includes('\n')) return fail(code, config, 'Block title must be a single line');
  let headerTitle = trimmedTitle;
  if (blockType === 'rect') {
    // W11: a rect title is a color; empty falls back to the default (B10).
    if (headerTitle === '') headerTitle = DEFAULT_RECT_COLOR;
    else if (!isRgbColor(headerTitle)) {
      return fail(code, config, `A rect block title must be an rgb(...) color, e.g. ${DEFAULT_RECT_COLOR}`);
    }
  }

  const check = checkWrap(code, model, keys, 'block');
  if (!check.ok) return fail(code, config, check.reason);
  const { spanStart, spanEnd, lines } = check.span;

  const indentMatch = lines[spanStart].match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '    ';
  const header = headerTitle === '' ? `${indent}${blockType}` : `${indent}${blockType} ${headerTitle}`;
  const wrapped = lines
    .slice(spanStart, spanEnd + 1)
    .map(l => (l.trim() === '' ? l : `    ${l}`));
  const newCode = replaceLines(code, spanStart, spanEnd, [header, ...wrapped, `${indent}end`]);

  const created = parseModel(newCode).elements.find(e => e.kind === 'block' && e.lineStart === spanStart);
  return { code: newCode, config, newKey: created?.key };
}

// Wrap the selected messages/notes in a %% @region-start/@region-end pair
// (W8–W10). The two comment lines are inserted at the span's indent; content
// lines are byte-untouched (NFR-02). No CONFIG changes (order preserved).
export function wrapInRegion(
  code: string,
  config: DiagramConfig | null,
  keys: string[],
  type: string,
  value?: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'sequence') return fail(code, config, UNSUPPORTED);
  const regionType = type.trim();
  if (!REGION_NAME_RE.test(regionType)) {
    return fail(code, config, 'Region type must be non-empty and use only letters, digits, _ and -');
  }
  const regionValue = (value ?? '').trim();
  if (regionValue !== '' && !REGION_NAME_RE.test(regionValue)) {
    return fail(code, config, 'Region value must use only letters, digits, _ and -');
  }

  const check = checkWrap(code, model, keys, 'region');
  if (!check.ok) return fail(code, config, check.reason);
  const { spanStart, spanEnd, lines } = check.span;

  const indentMatch = lines[spanStart].match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '    ';
  const startLine = regionValue === ''
    ? `${indent}%% @region-start: ${regionType}`
    : `${indent}%% @region-start: ${regionType}=${regionValue}`;
  const endLine = `${indent}%% @region-end`;
  const content = lines.slice(spanStart, spanEnd + 1);
  const newCode = replaceLines(code, spanStart, spanEnd, [startLine, ...content, endLine]);

  const created = parseModel(newCode).elements.find(e => e.kind === 'region' && e.lineStart === spanStart);
  return { code: newCode, config, newKey: created?.key };
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

// Wrap flowchart nodes into a `subgraph <title> ... end` block (the flowchart
// counterpart of groupParticipants' `box`). A node joins the cluster through
// its FIRST declaration line (mermaid's placement rule — the same one
// buildSubgraphTagIndex applies), so the block carries one declaration per
// selected node: a standalone declaration line moves into the subgraph
// verbatim, while a node first declared on an edge line gets a standalone
// declaration inserted (copying its endpoint text, shape included). Edge
// lines themselves are never wrapped or rewritten — wrapping an edge line
// would pull its non-selected endpoints into the cluster with it.
//
// The block is inserted immediately before the first selected node's
// declaration line; selected nodes keep their relative order (sorted by
// line), and every other line is preserved byte-for-byte. No CONFIG is
// written: the subgraph tag pipeline (subgraphTags.ts) derives the group tag
// from the block's title structurally.
export function groupNodes(
  code: string,
  config: DiagramConfig | null,
  nodeKeys: string[],
  title: string,
): EditResult {
  const model = parseModel(code);
  if (model.type !== 'flowchart') return fail(code, config, UNSUPPORTED);
  if (nodeKeys.length < 2) {
    return fail(code, config, 'At least two nodes must be selected to create a subgraph');
  }
  if (title.includes('\n')) return fail(code, config, 'Title must be a single line');

  const elements = nodeKeys.map(k => findElement(model, k));
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || el.kind !== 'node') {
      return fail(code, config, `Unknown or non-node key: ${nodeKeys[i]}`);
    }
  }

  const nodes = (elements as NodeElement[]).slice().sort((a, b) => a.lineStart - b.lineStart);
  const lines = code.split('\n');

  const movedLines = new Set<number>();
  const decls: string[] = [];
  for (const n of nodes) {
    const line = lines[n.lineStart];
    const parsed = parseFlowchartLine(line);
    if (parsed && parsed.segments.length === 0) {
      // Standalone node line: it declares only this node, so it moves in.
      movedLines.add(n.lineStart);
      decls.push(line.trim());
    } else if (parsed) {
      // Edge line: insert a standalone declaration, leave the line untouched.
      const ep = parsed.endpoints.find(e => e.id === n.id);
      decls.push(ep ? line.slice(ep.start, ep.end) : n.id);
    } else {
      decls.push(n.label ? `${n.id}[${n.label}]` : n.id);
    }
  }

  const indentMatch = lines[nodes[0].lineStart].match(/^(\s*)/);
  const baseIndent = indentMatch ? indentMatch[1] : '    ';
  const innerIndent = `${baseIndent}    `;

  const trimmedTitle = title.trim();
  const block = [
    trimmedTitle ? `${baseIndent}subgraph ${trimmedTitle}` : `${baseIndent}subgraph`,
    ...decls.map(d => `${innerIndent}${d}`),
    `${baseIndent}end`,
  ];

  const insertAt = nodes[0].lineStart;
  const newLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === insertAt) newLines.push(...block);
    if (movedLines.has(i)) continue;
    newLines.push(lines[i]);
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

