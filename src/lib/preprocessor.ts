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

  // Soft fail
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
    
    // Clean up empty else blocks at the end of alt
    const emptyElseEnd = /^[ \t]*(else|and)\b[^\n]*\n(?:[ \t]*(?:%%.*)?\n)*[ \t]*end[ \t]*(?=\n|$)/gm;
    code = code.replace(emptyElseEnd, 'end');

    // Clean up completely empty alt/opt/loop/par/rect/subgraph blocks
    const emptyBlock = /^[ \t]*(alt|opt|loop|par|rect|subgraph)\b[^\n]*\n(?:[ \t]*(?:%%.*)?\n)*[ \t]*end[ \t]*(?=\n|$)/gm;
    code = code.replace(emptyBlock, '');
  }

  // Remove multiple consecutive blank lines
  code = code.replace(/\n{3,}/g, '\n\n');
  return code.trim();
}
