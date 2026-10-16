import { ActorMetadata, DiagramConfig } from './views';
import {
  BLOCK_END_RE,
  BLOCK_OPEN_RE,
  parseModel,
  parseParticipantLine,
  parseFlowchartLine,
  ParsedParticipantLine,
} from './model';
import { buildSubgraphTagIndex, SubgraphTag } from './subgraphTags';

export interface RegionContext {
  type: string;
  value?: string;
  path: string;
}

export interface PreprocessorOptions {
  isRegionVisible: (region: RegionContext) => boolean;
}

/**
 * Checks whether a hierarchical region path is hidden by the given hiddenPaths set.
 * Supports exact path matches, leaf segment matches (e.g. 'tag=beta' matching 'flow=login/tag=beta'),
 * and suffix subpath matches.
 */
export function isPathHidden(path: string, hiddenPaths: Set<string>): boolean {
  if (hiddenPaths.has(path)) return true;
  const segments = path.split('/');
  if (hiddenPaths.has(segments[segments.length - 1])) return true;
  for (let i = 1; i < segments.length; i++) {
    const subpath = segments.slice(i).join('/');
    if (hiddenPaths.has(subpath)) return true;
  }
  return false;
}

export interface ProcessResult {
  code: string;
  warnings: string[];
}

export interface ActorTransformOptions {
  mergeByKeys?: string[];
  mergeCleanByKeys?: string[];
  hideKeys?: string[];
  hideColors?: string[];
}

interface ParticipantInfo {
  type: string;
  id: string;
  alias?: string;
  line: string;
}

// Rebuilds a participant declaration line, preserving indent, keyword and
// shape metadata while substituting the id and alias.
function formatParticipantLine(p: ParsedParticipantLine, id: string, alias?: string): string {
  const metaPart = (p.participantType !== 'participant' && p.participantType !== 'actor')
    ? ` @{ type: "${p.participantType}" }`
    : '';
  return alias
    ? `${p.indent}${p.keyword} ${id} as ${alias}${metaPart}`
    : `${p.indent}${p.keyword} ${id}${metaPart}`;
}

export interface ActorMergeGroup {
  name: string;    // MergedKey_<k>
  alias: string;   // the subgraph title, or `Merged <k>` (raw value)
  key: string;     // raw tag key
  title?: string;  // subgraph title, when the group's key comes from a subgraph tag
  actors: string[];
}

export interface ActorRewriteMap {
  rename: Map<string, string>;   // actor id -> merged participant name
  hide: Set<string>;             // actor ids whose lines are dropped
  clean: Set<string>;            // merged names whose self-calls are dropped
  groups: ActorMergeGroup[];     // merge groups by key
  mergedBy: Map<string, string>; // actor id -> key that merged it
  keyActors: Map<string, string[]>; // tag key -> actor ids carrying that tag
}

// Shared hide/merge computation (EDITING_PLAN.md 4.9). transformActors and
// rewriteArrowStyles both consume it. Color merging is removed; colors only hide.
//
// When `code` is given, structural subgraph tags join the CONFIG tags: every
// actor inside a `subgraph` carries the subgraph's tag key, so the whole
// subgraph hides or merges as one unit. Subgraph tags apply even with no
// `%% CONFIG:` line at all.
export function buildActorRewriteMap(config: DiagramConfig | null, options: ActorTransformOptions, code?: string): ActorRewriteMap {
  const rename = new Map<string, string>();
  const hide = new Set<string>();
  const clean = new Set<string>();
  const groups: ActorMergeGroup[] = [];
  const mergedBy = new Map<string, string>();
  const keyActors = new Map<string, string[]>();

  const subgraphIndex = code ? buildSubgraphTagIndex(code) : null;
  const subgraphByKey = new Map<string, SubgraphTag>();
  if (subgraphIndex) {
    for (const sg of subgraphIndex.subgraphs) {
      if (!subgraphByKey.has(sg.key)) subgraphByKey.set(sg.key, sg);
    }
  }

  const keyToActors = new Map<string, string[]>();

  // An actor's effective tags are its CONFIG keys plus the subgraph tags of
  // every subgraph it belongs to (CONFIG keys first, so an explicit tag wins
  // the merge-group race when both are merged).
  // CONFIG tags and structural tags act as two independent groups when hiding:
  // an actor is hidden when either group is fully Off.
  const considerActor = (actor: string, meta: ActorMetadata | undefined, subgraphKeys: string[]) => {
    const ownKeys = meta?.keys ?? [];
    const keys = [...ownKeys, ...subgraphKeys];
    for (const k of keys) {
      if (!keyActors.has(k)) keyActors.set(k, []);
      keyActors.get(k)!.push(actor);
    }

    let shouldHide = false;
    if (meta?.color && options.hideColors?.includes(meta.color)) {
      shouldHide = true;
    }
    const allOff = (ks: string[]) => ks.length > 0 && ks.every(k => options.hideKeys?.includes(k));
    if (allOff(ownKeys) || allOff(subgraphKeys)) {
      shouldHide = true;
    }

    if (shouldHide) {
      hide.add(actor);
      return;
    }

    for (const k of keys) {
      if (options.mergeByKeys?.includes(k) || options.mergeCleanByKeys?.includes(k)) {
        if (!keyToActors.has(k)) keyToActors.set(k, []);
        keyToActors.get(k)!.push(actor);
        mergedBy.set(actor, k);
        break;
      }
    }
  };

  if (config?.actors) {
    for (const [actor, meta] of Object.entries(config.actors)) {
      considerActor(actor, meta, subgraphIndex?.actorKeys.get(actor) ?? []);
    }
  }
  if (subgraphIndex) {
    // Actors that appear only inside subgraphs have no CONFIG entry.
    for (const [actor, subgraphKeys] of subgraphIndex.actorKeys) {
      if (config?.actors && Object.prototype.hasOwnProperty.call(config.actors, actor)) continue;
      considerActor(actor, undefined, subgraphKeys);
    }
  }

  keyToActors.forEach((actors, key) => {
    const name = `MergedKey_${key.replace(/[^A-Za-z0-9]/g, '')}`;
    const subgraph = subgraphByKey.get(key);
    groups.push({
      name,
      alias: subgraph ? subgraph.title : `Merged ${key}`,
      key,
      ...(subgraph ? { title: subgraph.title } : {}),
      actors,
    });
    for (const actor of actors) rename.set(actor, name);
    if (options.mergeCleanByKeys?.includes(key)) clean.add(name);
  });

  return { rename, hide, clean, groups, mergedBy, keyActors };
}

export function transformActors(code: string, config: DiagramConfig | null, options: ActorTransformOptions): string {
  const subgraphIndex = buildSubgraphTagIndex(code);
  const hasSubgraphTags = subgraphIndex.subgraphs.length > 0;
  const hasArrowTags = !!config?.arrows?.some(a => (a.keys && a.keys.length > 0) || a.keyMode === 'merged');
  const hasNoteTags = !!config?.noteTags?.some(n => n.keys && n.keys.length > 0);
  // Subgraph tags are structural: they apply even with no %% CONFIG at all.
  if ((!config || (!config.actors && !hasArrowTags && !hasNoteTags)) && !hasSubgraphTags) return code;

  const { rename, hide, clean, groups } = buildActorRewriteMap(config, options, code);
  const groupMap = new Map(groups.map(g => [g.name, g]));
  const actorsToHide = Array.from(hide);

  // Message/edge lines whose effective tags include a hidden key are dropped
  // too: arrows follow the by-key filter, but only ever as on/off (shown or
  // hidden) — merging stays an actor-only concept. A line's own/inherited CONFIG
  // keys and its structural subgraph keys act as two independent groups: the line
  // is dropped when either group is fully Off.
  const hideKeys = options.hideKeys ?? [];
  const hiddenLines = new Set<number>();
  const model = parseModel(code);

  if (hideKeys.length > 0 && (hasArrowTags || hasNoteTags || hasSubgraphTags)) {
    const arrowOccurrences = new Map<string, number>();
    const noteOccurrences = new Map<string, number>();
    const allOff = (ks: string[]) => ks.length > 0 && ks.every(k => hideKeys.includes(k));
    for (const el of model.elements) {
      if (el.kind !== 'message' && el.kind !== 'edge' && el.kind !== 'note') continue;
      const subgraphKeys = subgraphIndex.elementKeys.get(el.key) ?? [];
      let ownKeys: string[];
      if (el.kind === 'note') {
        const occKey = `${el.over.join('\u0000')}\u0000${el.text}`;
        const occurrence = noteOccurrences.get(occKey) ?? 0;
        noteOccurrences.set(occKey, occurrence + 1);
        const entry = config?.noteTags?.find(n =>
          n.over.length === el.over.length && n.over.every((id, i) => id === el.over[i]) &&
          n.text === el.text &&
          (n.occurrence ?? 0) === occurrence);
        ownKeys = entry?.keys ?? [];
      } else {
        const occKey = `${el.from}\u0000${el.to}\u0000${el.label ?? ''}`;
        const occurrence = arrowOccurrences.get(occKey) ?? 0;
        arrowOccurrences.set(occKey, occurrence + 1);
        const entry = config?.arrows?.find(a =>
          a.from === el.from && a.to === el.to &&
          (a.label ?? undefined) === (el.label ?? undefined) &&
          (a.occurrence ?? 0) === occurrence);
        const own = entry?.keys ?? [];
        const inherited = entry?.keyMode === 'merged' ? (config?.actors?.[el.from]?.keys ?? []) : [];
        ownKeys = Array.from(new Set([...own, ...inherited]));
      }
      if (allOff(ownKeys) || allOff(subgraphKeys)) {
        for (let i = el.lineStart; i <= el.lineEnd; i++) hiddenLines.add(i);
      }
    }
  }

  const lines = code.split('\n');

  if (actorsToHide.length > 0) {
    const hiddenActorSet = new Set(actorsToHide);
    for (const el of model.elements) {
      if (el.kind === 'participant' || el.kind === 'node') {
        if (hiddenActorSet.has(el.id)) {
          for (let i = el.lineStart; i <= el.lineEnd; i++) hiddenLines.add(i);
        }
      } else if (el.kind === 'message' || el.kind === 'edge') {
        if (hiddenActorSet.has(el.from) || hiddenActorSet.has(el.to)) {
          for (let i = el.lineStart; i <= el.lineEnd; i++) hiddenLines.add(i);
        }
      } else if (el.kind === 'note') {
        if (el.over.some(a => hiddenActorSet.has(a))) {
          for (let i = el.lineStart; i <= el.lineEnd; i++) hiddenLines.add(i);
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const actMatch = trimmed.match(/^(?:activate|deactivate)\s+([A-Za-z0-9_-]+)$/);
      if (actMatch && hiddenActorSet.has(actMatch[1])) {
        hiddenLines.add(i);
      }
      const styleMatch = trimmed.match(/^(?:style|class|click)\s+([A-Za-z0-9_-]+)\b/);
      if (styleMatch && hiddenActorSet.has(styleMatch[1])) {
        hiddenLines.add(i);
      }
    }
  }

  const isSequenceDiagram = /^\s*sequenceDiagram/m.test(code);
  const result: string[] = [];
  // Participant restructuring (below) runs only for sequence diagrams with an
  // active merge. It needs each output line's block depth and its participant
  // declaration parsed BEFORE merging renames the id, so group membership is
  // looked up by the raw actor id.
  const restructure = isSequenceDiagram && groups.length > 0;
  const resultDepths: number[] = [];
  const resultParticipants: (ParsedParticipantLine | null)[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (hiddenLines.has(i)) continue;

    if (line.trim().startsWith('%% CONFIG:')) {
      result.push(line);
      if (restructure) {
        resultDepths.push(depth);
        resultParticipants.push(null);
      }
      continue;
    }

    const participant = restructure ? parseParticipantLine(line) : null;

    if (groups.length > 0) {
      if (isSequenceDiagram) {
        if (participant && rename.has(participant.id)) {
          const g = groupMap.get(rename.get(participant.id)!)!;
          line = formatParticipantLine(participant, g.name, g.alias);
        }

        const SEQ_MSG_RE = /^(\s*)([A-Za-z0-9_-]+?)\s*(-->>|->>|--x|-x|-->o|->o|-->\*|->\*|--\)|-\)|-->|->|--|-)([+-]?)\s*([A-Za-z0-9_-]+?)(?:\s*(:\s*.*))?$/;
        const msgMatch = line.match(SEQ_MSG_RE);
        if (msgMatch) {
          const [, indent, from, op, act, to, labelPart] = msgMatch;
          const newFrom = rename.get(from) ?? from;
          const newTo = rename.get(to) ?? to;
          if (newFrom === newTo && clean.has(newFrom)) {
            continue;
          }
          if (newFrom !== from || newTo !== to) {
            line = `${indent}${newFrom}${op}${act}${newTo}${labelPart ?? ''}`;
          }
        }

        const SEQ_NOTE_RE = /^(\s*Note\s+(?:over|left of|right of)\s+)([^:]+)(:.*)$/;
        const noteMatch = line.match(SEQ_NOTE_RE);
        if (noteMatch) {
          const [, prefix, rawActors, text] = noteMatch;
          const actors = rawActors.split(',').map(s => s.trim());
          const newActors: string[] = [];
          for (const a of actors) {
            const renamed = rename.get(a) ?? a;
            if (!newActors.includes(renamed)) {
              newActors.push(renamed);
            }
          }
          line = `${prefix}${newActors.join(', ')}${text}`;
        }

        const SEQ_ACT_RE = /^(\s*(?:activate|deactivate)\s+)([A-Za-z0-9_-]+)\s*$/;
        const actMatch = line.match(SEQ_ACT_RE);
        if (actMatch && rename.has(actMatch[2])) {
          line = `${actMatch[1]}${rename.get(actMatch[2])!}`;
        }
      } else {
        const isBlockOrDirective = BLOCK_OPEN_RE.test(line) || BLOCK_END_RE.test(line) || line.trim().startsWith('%%') || /^\s*(direction|click|style|classDef|class|linkStyle|accTitle|accDescr)\b/.test(line);
        if (!isBlockOrDirective) {
          const fcLine = parseFlowchartLine(line);
          if (fcLine) {
            if (fcLine.segments.length === 1 && fcLine.endpoints.length === 2) {
              const firstMerged = rename.get(fcLine.endpoints[0].id) ?? fcLine.endpoints[0].id;
              const secondMerged = rename.get(fcLine.endpoints[1].id) ?? fcLine.endpoints[1].id;
              if (firstMerged === secondMerged && clean.has(firstMerged)) {
                continue;
              }
            }

            const sortedEndpoints = [...fcLine.endpoints].sort((a, b) => b.start - a.start);
            for (const ep of sortedEndpoints) {
              const mergedName = rename.get(ep.id);
              if (mergedName) {
                const g = groupMap.get(mergedName)!;
                const rep = `${g.name}[${g.alias}]`;
                line = line.slice(0, ep.start) + rep + line.slice(ep.end);
              }
            }
          } else {
            const styleMatch = line.match(/^(\s*(?:style|class|click)\s+)([A-Za-z0-9_-]+)(\b.*)$/);
            if (styleMatch && rename.has(styleMatch[2])) {
              line = `${styleMatch[1]}${rename.get(styleMatch[2])!}${styleMatch[3]}`;
            }
          }
        }
      }
    }

    result.push(line);
    if (restructure) {
      resultDepths.push(depth);
      resultParticipants.push(participant);
      if (BLOCK_OPEN_RE.test(line)) depth++;
      else if (BLOCK_END_RE.test(line) && depth > 0) depth--;
    }
  }

  // Without an active merge there is nothing to regroup: return the line-loop
  // result untouched so block structures (box subgraphs, rect areas) survive.
  if (!restructure) {
    return result.join('\n');
  }

  // --- Participant restructuring (sequence diagrams with an active merge) ---
  // Top-level participant declarations are hoisted right after
  // `sequenceDiagram` (unmerged first, then one generated box per merge key).
  // Declarations INSIDE blocks (box/rect/alt/...) stay in place so the
  // enclosing areas/subgraphs survive the merge: the first declaration of an
  // in-block merge group is rewritten to the merged participant and later
  // duplicates are dropped.
  const groupByActor = new Map<string, ActorMergeGroup>();
  for (const g of groups) {
    for (const actor of g.actors) groupByActor.set(actor, g);
  }
  const findGroup = (id: string) => groupByActor.get(id) ?? groupMap.get(id);

  // A merge group with at least one top-level declaration keeps the generated
  // box treatment; its in-block declarations are then dropped, because the
  // merged participant is declared once, in the generated box.
  const groupsWithTopLevel = new Set<string>();
  for (let idx = 0; idx < result.length; idx++) {
    const p = resultParticipants[idx];
    if (p && resultDepths[idx] === 0) {
      const g = findGroup(p.id);
      if (g) groupsWithTopLevel.add(g.name);
    }
  }

  const emittedInPlace = new Set<string>();
  const participants: ParticipantInfo[] = [];
  const restOfCode: string[] = [];

  for (let idx = 0; idx < result.length; idx++) {
    let line = result[idx];
    const p = resultParticipants[idx];

    if (p && resultDepths[idx] > 0) {
      // Participant declared inside a block: keep it inside its area/subgraph.
      const g = findGroup(p.id);
      if (g) {
        if (groupsWithTopLevel.has(g.name) || emittedInPlace.has(g.name)) {
          continue;  // the merged participant is declared elsewhere
        }
        emittedInPlace.add(g.name);
        line = formatParticipantLine(p, g.name, g.alias);
      }
      restOfCode.push(line);
      continue;
    }

    if (line.trim().startsWith('sequenceDiagram')) {
      restOfCode.push(line);
      continue;
    }

    if (p) {
      // Top-level declaration: hoist it; merged members take the group's
      // generated name and alias.
      const g = findGroup(p.id);
      const id = g ? g.name : p.id;
      const alias = g ? g.alias : p.alias;
      participants.push({
        type: p.keyword,
        id,
        alias,
        line: formatParticipantLine(p, id, alias),
      });
      continue;
    }

    restOfCode.push(line);
  }

  // Now group participants by box/color
  const boxGroups = new Map<string, { color: string, title: string, parts: ParticipantInfo[] }>();
  const uncoloredParticipants: ParticipantInfo[] = [];

  const seenIds = new Set<string>();

  for (const p of participants) {
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);

    let boxId = '';
    let boxColor = '';
    let boxTitle = '';

    if (groupMap.has(p.id)) {
      const g = groupMap.get(p.id)!;
      boxId = `key_${g.name}`;
      boxColor = '#ccc';
      // A group keyed by a subgraph tag is labeled with the subgraph's title.
      boxTitle = g.title ?? g.key.toUpperCase();
    }

    if (boxId) {
      if (!boxGroups.has(boxId)) {
        boxGroups.set(boxId, { color: boxColor, title: boxTitle, parts: [] });
      }
      boxGroups.get(boxId)!.parts.push(p);
    } else {
      uncoloredParticipants.push(p);
    }
  }

  // Inject boxed participants right after sequenceDiagram
  const finalLines: string[] = [];
  let injectedParticipants = false;

  for (const line of restOfCode) {
    finalLines.push(line);
    if (line.trim().startsWith('sequenceDiagram') && !injectedParticipants) {
      injectedParticipants = true;
      
      for (const p of uncoloredParticipants) {
        finalLines.push(p.line);
      }

      boxGroups.forEach((group) => {
        finalLines.push(`    box ${group.color} ${group.title} Zone`);
        for (const p of group.parts) {
          finalLines.push(`    ${p.line.trim()}`);
        }
        finalLines.push(`    end`);
      });
    }
  }

  return finalLines.join('\n');
}

export function processMermaid(code: string, options: PreprocessorOptions): ProcessResult {
  const lines = code.split('\n');
  const result: string[] = [];
  const stack: { context: RegionContext; keep: boolean }[] = [];
  const warnings: string[] = [];
  
  let currentKeep = true;
  let hasMalformedTags = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('%% @region-start:')) {
      const match = trimmed.match(/%%\s*@region-start:\s*([a-zA-Z0-9_-]+)(?:=([a-zA-Z0-9_-]+))?/);
      if (match) {
        const type = match[1];
        const value = match[2];
        const pathSegment = value ? `${type}=${value}` : type;
        const parentPath = stack.length > 0 ? stack[stack.length - 1].context.path : '';
        const path = parentPath ? `${parentPath}/${pathSegment}` : pathSegment;
        
        const context: RegionContext = { type, value, path };
        
        const keep: boolean = currentKeep && options.isRegionVisible(context);
        
        stack.push({ context, keep });
        currentKeep = keep;
      } else {
        warnings.push(`Invalid region start tag at line ${i + 1}`);
        hasMalformedTags = true;
      }
      continue;
    } else if (trimmed === '%% @region-end') {
      if (stack.length > 0) {
        stack.pop();
        currentKeep = stack.length > 0 ? stack[stack.length - 1].keep : true;
      } else {
        warnings.push(`Unmatched region end tag at line ${i + 1}`);
        hasMalformedTags = true;
      }
      continue;
    }

    if (currentKeep) {
      result.push(line);
    }
  }

  if (stack.length > 0) {
    warnings.push(`Unclosed region tag: ${stack[stack.length - 1].context.path}`);
    hasMalformedTags = true;
  }

  if (hasMalformedTags) {
    return { code, warnings };
  }

  let processedCode = result.join('\n');
  processedCode = cleanupDanglingSyntax(processedCode);

  return { code: processedCode, warnings };
}

function cleanupDanglingSyntax(code: string): string {
  let previous = '';

  while (code !== previous) {
    previous = code;
    
    const emptyElseEnd = /^[ \t]*(else|and)\b[^\n]*\n(?:[ \t]*(?:%%.*|direction\s+[A-Za-z]+)?\n)*[ \t]*end[ \t]*(?=\n|$)/gm;
    code = code.replace(emptyElseEnd, 'end');

    const emptyBlock = /^[ \t]*(alt|opt|loop|par|rect|box|subgraph)\b[^\n]*\n(?:[ \t]*(?:%%.*|direction\s+[A-Za-z]+)?\n)*[ \t]*end[ \t]*(?=\n|$)/gm;
    code = code.replace(emptyBlock, '');
  }

  // Remove unmatched dangling `end` lines where block depth is 0
  const lines = code.split('\n');
  const cleaned: string[] = [];
  let depth = 0;
  for (const line of lines) {
    if (BLOCK_OPEN_RE.test(line)) {
      depth++;
      cleaned.push(line);
    } else if (BLOCK_END_RE.test(line)) {
      if (depth > 0) {
        depth--;
        cleaned.push(line);
      }
    } else {
      cleaned.push(line);
    }
  }
  code = cleaned.join('\n');

  code = code.replace(/\n{3,}/g, '\n\n');
  return code.trim();
}
