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
  
  const actorsToHide = new Set<string>();
  const colorToActors = new Map<string, string[]>();

  for (const [actor, meta] of Object.entries(config.actors)) {
    let shouldHide = false;
    if (meta.color && options.hideColors?.includes(meta.color)) {
      shouldHide = true;
    }
    if (meta.keys && options.hideKeys?.some(k => meta.keys?.includes(k))) {
      shouldHide = true;
    }
    
    if (shouldHide) {
      actorsToHide.add(actor);
    } else {
      if (meta.color && options.mergeByColor?.includes(meta.color)) {
        if (!colorToActors.has(meta.color)) {
          colorToActors.set(meta.color, []);
        }
        colorToActors.get(meta.color)!.push(actor);
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
    for (const [color, actors] of colorToActors.entries()) {
      if (actors.length > 0) {
        const mergedName = `Merged_${color}`;
        for (const actor of actors) {
          const regex = new RegExp(`\\b${actor}\\b`, 'g');
          line = line.replace(regex, mergedName);
        }
      }
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

    const match = line.match(/^\s*(participant|actor)\s+([A-Za-z0-9_-]+)(?:\s+as\s+(.*))?$/);
    if (match) {
      participants.push({
        type: match[1],
        id: match[2],
        alias: match[3],
        line: line
      });
    } else {
      restOfCode.push(line);
    }
  }

  if (!isSequenceDiagram) {
    return result.join('\n');
  }

  // Now group participants by box/color
  const colorGroups = new Map<string, ParticipantInfo[]>();
  const uncoloredParticipants: ParticipantInfo[] = [];

  const seenIds = new Set<string>();

  for (const p of participants) {
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);

    // Determine the color of this participant
    let color = '';
    
    // Check if it's a merged actor
    if (p.id.startsWith('Merged_')) {
      color = p.id.replace('Merged_', '');
    } else {
      if (config.actors[p.id] && config.actors[p.id].color) {
        color = config.actors[p.id].color as string;
      }
    }

    if (color) {
      if (!colorGroups.has(color)) colorGroups.set(color, []);
      colorGroups.get(color)!.push(p);
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
      
      // Output uncolored
      for (const p of uncoloredParticipants) {
        finalLines.push(p.line);
      }

      // Output colored in boxes
      for (const [color, parts] of colorGroups.entries()) {
        // Lighten the color slightly for the box background or just use the color name
        // Mermaid supports basic css colors or rgba. We'll pass the exact string the user provided.
        // E.g., `box rgb(...) GroupName` or `box rgba(...) GroupName`
        let boxColorStr = color;
        // if user just wrote "red", mermaid parses `box red Title`.
        finalLines.push(`    box ${boxColorStr} ${color.toUpperCase()} Zone`);
        for (const p of parts) {
          finalLines.push(`    ${p.line.trim()}`);
        }
        finalLines.push(`    end`);
      }
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
