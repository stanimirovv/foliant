import { DiagramConfig } from './views';

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

export function transformActors(code: string, config: DiagramConfig | null, options: ActorTransformOptions): string {
  if (!config || !config.actors) return code;
  
  const actorsToHide: string[] = [];
  const colorToActors = new Map<string, string[]>();
  const keyToActors = new Map<string, string[]>();
  const cleanMergedNames = new Set<string>();

  for (const [actor, meta] of Object.entries(config.actors)) {
    let shouldHide = false;
    if (meta.color && options.hideColors?.includes(meta.color)) {
      shouldHide = true;
    }
    if (meta.keys && options.hideKeys?.some(k => meta.keys?.includes(k))) {
      shouldHide = true;
    }
    
    if (shouldHide) {
      actorsToHide.push(actor);
    } else {
      let merged = false;
      if (meta.color) {
        if (options.mergeByColor?.includes(meta.color) || options.mergeCleanByColor?.includes(meta.color)) {
          if (!colorToActors.has(meta.color)) {
            colorToActors.set(meta.color, []);
          }
          colorToActors.get(meta.color)!.push(actor);
          merged = true;
          if (options.mergeCleanByColor?.includes(meta.color)) {
            cleanMergedNames.add(`MergedColor_${meta.color.replace(/[^A-Za-z0-9]/g, '')}`);
          }
        }
      }
      
      if (!merged && meta.keys) {
        for (const k of meta.keys) {
          if (options.mergeByKeys?.includes(k) || options.mergeCleanByKeys?.includes(k)) {
            if (!keyToActors.has(k)) keyToActors.set(k, []);
            keyToActors.get(k)!.push(actor);
            merged = true;
            if (options.mergeCleanByKeys?.includes(k)) {
              cleanMergedNames.add(`MergedKey_${k.replace(/[^A-Za-z0-9]/g, '')}`);
            }
            break;
          }
        }
      }
    }
  }

  const lines = code.split('\n');
  const result: string[] = [];

  for (let line of lines) {
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

    // Apply merging
    colorToActors.forEach((actors, color) => {
      if (actors.length > 0) {
        const mergedName = `MergedColor_${color.replace(/[^A-Za-z0-9]/g, '')}`;
        for (const actor of actors) {
          const regex = new RegExp(`\\b${actor}\\b`, 'g');
          line = line.replace(regex, mergedName);
        }
      }
    });
    keyToActors.forEach((actors, key) => {
      if (actors.length > 0) {
        const mergedName = `MergedKey_${key.replace(/[^A-Za-z0-9]/g, '')}`;
        for (const actor of actors) {
          const regex = new RegExp(`\\b${actor}\\b`, 'g');
          line = line.replace(regex, mergedName);
        }
      }
    });

    // Matches A->B:, A-->>B:, etc.
    const arrowMatch = line.match(/^\s*([A-Za-z0-9_-]+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->|--|-)\s*([A-Za-z0-9_-]+)(?:\s*:|\s*$)/);
    if (arrowMatch && arrowMatch[1] === arrowMatch[3]) {
      if (cleanMergedNames.has(arrowMatch[1])) {
        continue;
      }
    }

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
  let isSequenceDiagram = false;
  
  for (const line of result) {
    if (line.trim().startsWith('sequenceDiagram')) {
      isSequenceDiagram = true;
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
    } else if (config.actors[p.id] && config.actors[p.id].color) {
      const c = config.actors[p.id].color as string;
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
