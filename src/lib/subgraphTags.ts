// Structural tags derived from grouping blocks (levels of abstraction).
//
// Every grouping block implicitly puts a tag on all the actors and messages
// inside it: the tag key is the kebab-case slug of the block's title. The
// existing by-key filter machinery then treats the whole group as one unit —
// set the key to Off to hide its internals, or to Merged/Clean to collapse it
// into a single actor (labeled with the group's title), so a diagram can show
// both the high-level systems and their details.
//
// Which blocks group actors depends on the diagram type, mirroring what
// mermaid actually renders:
//   - sequence diagrams: `box <title>` (mermaid has no `subgraph` there) and,
//     for forward compatibility, `subgraph <title>`;
//   - flowcharts: `subgraph <title>` / `subgraph <id> [<title>]`.
//
// Subgraph tags are structural: they need no `%% CONFIG:` line and never write
// to the file. They combine with CONFIG tags under the usual multi-tag rule
// (an element is hidden only when ALL of its tags are disabled).

import { BlockType, DiagramModel, DiagramType, parseModel } from './model';

export interface SubgraphTag {
  key: string;        // derived tag key, [A-Za-z0-9_-] (kebab-case slug of the title)
  title: string;      // display title, as mermaid renders it
  lineStart: number;  // inclusive span of the grouping block in the code
  lineEnd: number;
}

// Slugifies a title into a tag key: lowercase kebab-case, restricted to the
// tag alphabet ([A-Za-z0-9_-]). Returns null when nothing usable remains.
export function slugifySubgraphTitle(title: string | undefined): string | null {
  if (!title) return null;
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : null;
}

// --- Title extraction (mirrors mermaid's own parsing) -----------------------

// Flowchart subgraphs use `subgraph id [Title]`; the display title is the
// bracket label. Without brackets the whole text is the title.
const FC_SUBGRAPH_TITLE_RE = /^([A-Za-z0-9_-]+)\s*\[([^\]]*)\]\s*$/;

// Mermaid's parseBoxData: the first token of a `box` header is a color when it
// is an rgb/hsl function or a valid CSS color name; anything else is the title.
const BOX_COLOR_CANDIDATE_RE = /^((?:rgba?|hsla?)\s*\([^)]*\)|[A-Za-z][A-Za-z0-9-]*)([\s\S]*)$/;

function isCssColor(token: string): boolean {
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  if (css?.supports) return css.supports('color', token);
  // Without a DOM, only the functional forms are unambiguous color tokens.
  return /^(?:rgba?|hsla?)\s*\(/.test(token);
}

function sequenceBoxTitle(rawTitle: string | undefined): string | undefined {
  if (!rawTitle) return undefined;
  // `#` starts a comment in mermaid sequence diagrams — the header ends there.
  const text = rawTitle.split('#')[0].trim();
  if (!text) return undefined;
  const m = BOX_COLOR_CANDIDATE_RE.exec(text);
  const colorCandidate = (m?.[1] ?? '').trim();
  if (colorCandidate && isCssColor(colorCandidate)) {
    return m![2].trim() || undefined;
  }
  return text;
}

function groupingTitle(diagramType: DiagramType, blockType: BlockType, rawTitle: string | undefined): string | undefined {
  if (blockType === 'box') return sequenceBoxTitle(rawTitle);
  if (diagramType === 'flowchart' && rawTitle) {
    const m = rawTitle.match(FC_SUBGRAPH_TITLE_RE);
    if (m) return m[2].trim() || undefined;
  }
  return rawTitle?.trim() || undefined;
}

function isGroupingBlock(diagramType: DiagramType, blockType: BlockType): boolean {
  if (blockType === 'subgraph') return true;
  // `box` groups actors in sequence diagrams only.
  return blockType === 'box' && diagramType === 'sequence';
}

// --- Collection -------------------------------------------------------------

// One tag per grouping block, in source order. Blocks whose titles slugify to
// the same key share the tag (two "Payment Service" groups are the same system
// at the high level). Untitled blocks produce no tag.
export function collectSubgraphTags(code: string, model?: DiagramModel): SubgraphTag[] {
  const m = model ?? parseModel(code);
  const tags: SubgraphTag[] = [];
  for (const el of m.elements) {
    if (el.kind !== 'block' || !isGroupingBlock(m.type, el.blockType)) continue;
    const title = groupingTitle(m.type, el.blockType, el.title);
    const key = slugifySubgraphTitle(title);
    if (!key) continue;
    tags.push({ key, title: title!, lineStart: el.lineStart, lineEnd: el.lineEnd });
  }
  return tags;
}

export interface SubgraphTagIndex {
  subgraphs: SubgraphTag[];
  actorKeys: Map<string, string[]>;    // actor/node id -> containing group tag keys
  elementKeys: Map<string, string[]>;  // message/edge/note element key -> containing group tag keys
}

// Maps every actor and message/edge/note to the grouping tags it carries.
// An actor belongs to a group when its FIRST appearance (declaration or
// message endpoint) lies inside the group's span — the same placement rule
// mermaid uses to draw the group box around it. A message/edge/note is inside
// when its line span is contained in the group. Nested groups tag the same
// element with every enclosing group's key.
export function buildSubgraphTagIndex(code: string, model?: DiagramModel): SubgraphTagIndex {
  const m = model ?? parseModel(code);
  const subgraphs = collectSubgraphTags(code, m);
  const actorKeys = new Map<string, string[]>();
  const elementKeys = new Map<string, string[]>();
  if (subgraphs.length === 0) return { subgraphs, actorKeys, elementKeys };

  const within = (lineStart: number, lineEnd: number, sg: SubgraphTag) =>
    lineStart >= sg.lineStart && lineEnd <= sg.lineEnd;
  const addActor = (id: string, key: string) => {
    const list = actorKeys.get(id);
    if (list) { if (!list.includes(key)) list.push(key); return; }
    actorKeys.set(id, [key]);
  };
  const addElement = (elementKey: string, key: string) => {
    const list = elementKeys.get(elementKey);
    if (list) { if (!list.includes(key)) list.push(key); return; }
    elementKeys.set(elementKey, [key]);
  };

  if (m.type === 'sequence') {
    const firstAppearance = new Map<string, number>();
    const touch = (id: string, line: number) => {
      const prev = firstAppearance.get(id);
      if (prev === undefined || line < prev) firstAppearance.set(id, line);
    };
    for (const el of m.elements) {
      if (el.kind === 'participant') touch(el.id, el.lineStart);
      else if (el.kind === 'message') {
        touch(el.from, el.lineStart);
        touch(el.to, el.lineStart);
      }
    }
    for (const [id, line] of firstAppearance) {
      for (const sg of subgraphs) {
        if (within(line, line, sg)) addActor(id, sg.key);
      }
    }
    for (const el of m.elements) {
      if (el.kind !== 'message' && el.kind !== 'note') continue;
      for (const sg of subgraphs) {
        if (within(el.lineStart, el.lineEnd, sg)) addElement(el.key, sg.key);
      }
    }
  } else if (m.type === 'flowchart') {
    // A node is tagged by the group of its declaration line (its first
    // endpoint mention); an edge by the group containing its line.
    for (const el of m.elements) {
      if (el.kind !== 'node' && el.kind !== 'edge') continue;
      for (const sg of subgraphs) {
        if (within(el.lineStart, el.lineEnd, sg)) {
          if (el.kind === 'node') addActor(el.id, sg.key);
          else addElement(el.key, sg.key);
        }
      }
    }
  }

  return { subgraphs, actorKeys, elementKeys };
}
