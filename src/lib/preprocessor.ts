import { DiagramConfig } from './views';
import { parseModel } from './model';

export interface RegionContext {
  type: string;
  value?: string;
  path: string;
}

export interface PreprocessorOptions {
  isRegionVisible: (region: RegionContext) => boolean;
}

export interface ProcessResult {
  code: string;
  warnings: string[];
}

export interface ActorTransformOptions {
  mergeByColor?: string[];
  mergeCleanByColor?: string[];
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

export interface ActorMergeGroup {
  name: string;    // MergedColor_<c> | MergedKey_<k>
  alias: string;   // Merged <c> | Merged <k> (raw value)
  actors: string[];
}

export interface ActorRewriteMap {
  rename: Map<string, string>;   // actor id -> merged participant name
  hide: Set<string>;             // actor ids whose lines are dropped
  clean: Set<string>;            // merged names whose self-calls are dropped
  groups: ActorMergeGroup[];     // merge groups, colors first then keys
}

// Shared hide/merge computation (EDITING_PLAN.md 4.9). transformActors and
// rewriteArrowStyles both consume it; MergedColor_/MergedKey_ name derivation
// is unchanged.
export function buildActorRewriteMap(config: DiagramConfig | null, options: ActorTransformOptions): ActorRewriteMap {
  const rename = new Map<string, string>();
  const hide = new Set<string>();
  const clean = new Set<string>();
  const groups: ActorMergeGroup[] = [];
  if (!config || !config.actors) return { rename, hide, clean, groups };

  const colorToActors = new Map<string, string[]>();
  const keyToActors = new Map<string, string[]>();

  for (const [actor, meta] of Object.entries(config.actors)) {
    let shouldHide = false;
    if (meta.color && options.hideColors?.includes(meta.color)) {
      shouldHide = true;
    }
    if (meta.keys && options.hideKeys?.some(k => meta.keys?.includes(k))) {
      shouldHide = true;
    }

    if (shouldHide) {
      hide.add(actor);
      continue;
    }

    let merged = false;
    if (meta.color) {
      if (options.mergeByColor?.includes(meta.color) || options.mergeCleanByColor?.includes(meta.color)) {
        if (!colorToActors.has(meta.color)) {
          colorToActors.set(meta.color, []);
        }
        colorToActors.get(meta.color)!.push(actor);
        merged = true;
      }
    }

    if (!merged && meta.keys) {
      for (const k of meta.keys) {
        if (options.mergeByKeys?.includes(k) || options.mergeCleanByKeys?.includes(k)) {
          if (!keyToActors.has(k)) keyToActors.set(k, []);
          keyToActors.get(k)!.push(actor);
          merged = true;
          break;
        }
      }
    }
  }

  colorToActors.forEach((actors, color) => {
    const name = `MergedColor_${color.replace(/[^A-Za-z0-9]/g, '')}`;
    groups.push({ name, alias: `Merged ${color}`, actors });
    for (const actor of actors) rename.set(actor, name);
    if (options.mergeCleanByColor?.includes(color)) clean.add(name);
  });
  keyToActors.forEach((actors, key) => {
    const name = `MergedKey_${key.replace(/[^A-Za-z0-9]/g, '')}`;
    groups.push({ name, alias: `Merged ${key}`, actors });
    for (const actor of actors) rename.set(actor, name);
    if (options.mergeCleanByKeys?.includes(key)) clean.add(name);
  });

  return { rename, hide, clean, groups };
}

export function transformActors(code: string, config: DiagramConfig | null, options: ActorTransformOptions): string {
  const hasArrowTags = !!config?.arrows?.some(a => a.keys && a.keys.length > 0);
  if (!config || (!config.actors && !hasArrowTags)) return code;

  const { hide, clean, groups } = buildActorRewriteMap(config, options);
  const actorsToHide = Array.from(hide);

  // Message/edge lines whose effective tags include a hidden key are dropped
  // too: arrows follow the by-key filter, but only ever as on/off (shown or
  // hidden) — merging stays an actor-only concept. A line's effective tags are
  // its own keys plus, unless the arrow's keyMode is 'clean', the keys of the
  // service it originates from. (Lines whose origin service carries the hidden
  // key are already dropped by the hidden-actor check above, so only the own
  // keys can add drops here; inherited keys are evaluated anyway to keep the
  // semantics exact.)
  const hideKeys = options.hideKeys ?? [];
  const hiddenMessageLines = new Set<number>();
  if (hideKeys.length > 0 && hasArrowTags) {
    const model = parseModel(code);
    const occurrences = new Map<string, number>();
    for (const el of model.elements) {
      if (el.kind !== 'message' && el.kind !== 'edge') continue;
      const occKey = `${el.from}\u0000${el.to}\u0000${el.label ?? ''}`;
      const occurrence = occurrences.get(occKey) ?? 0;
      occurrences.set(occKey, occurrence + 1);
      const entry = config.arrows!.find(a =>
        a.from === el.from && a.to === el.to &&
        (a.label ?? undefined) === (el.label ?? undefined) &&
        (a.occurrence ?? 0) === occurrence);
      const own = entry?.keys ?? [];
      const inherited = entry?.keyMode === 'clean' ? [] : (config.actors?.[el.from]?.keys ?? []);
      const effective = new Set([...own, ...inherited]);
      if (hideKeys.some(k => effective.has(k))) {
        for (let i = el.lineStart; i <= el.lineEnd; i++) hiddenMessageLines.add(i);
      }
    }
  }

  const isSequenceDiagram = /^\s*sequenceDiagram/m.test(code);
  const lines = code.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let skipLine = false;

    // Check if line mentions a hidden actor
    for (const actor of actorsToHide) {
      const regex = new RegExp(`\\b${actor}\\b`);
      if (regex.test(line)) {
        skipLine = true;
        break;
      }
    }

    if (skipLine) continue;
    if (hiddenMessageLines.has(i)) continue;

    if (line.trim().startsWith('%% CONFIG:')) {
      result.push(line);
      continue;
    }

    // Apply merging
    for (const group of groups) {
      for (const actor of group.actors) {
        if (isSequenceDiagram) {
          const regex = new RegExp(`\\b${actor}\\b`, 'g');
          line = line.replace(regex, group.name);
        } else {
          const shapeRegex = new RegExp(`\\b${actor}\\b(?:\\s*(?:\\[.*?\\]|\\(\\(.*?\\)\\)|\\(.*?\\)|\\{.*?\\}|>.*?\\]))?`, 'g');
          line = line.replace(shapeRegex, `${group.name}[${group.alias}]`);
        }
      }
    }

    // Matches A->B:, A-->>B:, etc. (Sequence diagrams)
    const arrowMatch = line.match(/^\s*([A-Za-z0-9_-]+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->|--|-)\s*([A-Za-z0-9_-]+)(?:\s*:|\s*$)/);
    if (arrowMatch && arrowMatch[1] === arrowMatch[3]) {
      if (clean.has(arrowMatch[1])) {
        continue;
      }
    }

    // Matches flowchart self-calls
    let isFlowchartSelfCall = false;
    for (const mergedName of Array.from(clean)) {
      const nodePattern = `${mergedName}(?:\\s*\\[.*?\\]|\\s*\\(.*?\\)|\\s*\\{.*?\\}|\\s*>.*?\\])?`;
      const edgePattern = `(?:---|-->|==>|==|-.->|-.-|<-->|<==>|x--x|o--o)(?:\\s*\\|.*?\\|)?`;
      const selfCallRegex = new RegExp(`^\\s*${nodePattern}\\s*${edgePattern}\\s*${nodePattern}\\s*$`);
      if (selfCallRegex.test(line)) {
        isFlowchartSelfCall = true;
        break;
      }
    }
    if (isFlowchartSelfCall) continue;

    // Fix Notes over the same actor
    const noteMatch = line.match(/^(\s*Note\s+(?:over|left of|right of)\s+)([A-Za-z0-9_-]+),([A-Za-z0-9_-]+)(\s*:.*)$/);
    if (noteMatch && noteMatch[2] === noteMatch[3]) {
      // Rewrite "Note over A,A:" to "Note over A:"
      line = `${noteMatch[1]}${noteMatch[2]}${noteMatch[4]}`;
    }

    result.push(line);
  }

  // Extract participants and group by color
  const participants: ParticipantInfo[] = [];
  const restOfCode: string[] = [];
  
  for (const line of result) {
    if (line.trim().startsWith('sequenceDiagram')) {
      restOfCode.push(line);
      continue;
    }

    const match = line.match(/^(\s*)(participant|actor)\s+([A-Za-z0-9_-]+)(?:\s+as\s+(.*))?$/);
    if (match) {
      const indent = match[1];
      const type = match[2];
      const id = match[3];
      let alias = match[4];

      if (id.startsWith('MergedColor_')) {
        alias = `Merged ${id.replace('MergedColor_', '')}`;
      } else if (id.startsWith('MergedKey_')) {
        alias = `Merged ${id.replace('MergedKey_', '')}`;
      }

      participants.push({
        type,
        id,
        alias,
        line: alias ? `${indent}${type} ${id} as ${alias}` : `${indent}${type} ${id}`
      });
    } else {
      restOfCode.push(line);
    }
  }

  if (!isSequenceDiagram) {
    return result.join('\n');
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

    if (p.id.startsWith('MergedColor_')) {
      const c = p.id.replace('MergedColor_', '');
      boxId = `color_${c}`;
      boxColor = c;
      boxTitle = c.toUpperCase();
    } else if (p.id.startsWith('MergedKey_')) {
      const k = p.id.replace('MergedKey_', '');
      boxId = `key_${k}`;
      boxColor = '#ccc';
      boxTitle = k.toUpperCase();
    } else if (config.actors?.[p.id]?.color) {
      const c = config.actors![p.id].color as string;
      boxId = `color_${c}`;
      boxColor = c;
      boxTitle = c.toUpperCase();
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
    
    const emptyElseEnd = /^[ \t]*(else|and)\b[^\n]*\n(?:[ \t]*(?:%%.*)?\n)*[ \t]*end[ \t]*(?=\n|$)/gm;
    code = code.replace(emptyElseEnd, 'end');

    const emptyBlock = /^[ \t]*(alt|opt|loop|par|rect|subgraph)\b[^\n]*\n(?:[ \t]*(?:%%.*)?\n)*[ \t]*end[ \t]*(?=\n|$)/gm;
    code = code.replace(emptyBlock, '');
  }

  code = code.replace(/\n{3,}/g, '\n\n');
  return code.trim();
}
