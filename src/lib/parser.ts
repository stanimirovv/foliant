export interface RegionNode {
  type: string;
  value?: string;
  path: string;
  children: RegionNode[];
}

export function extractRegions(code: string): RegionNode[] {
  const lines = code.split('\n');
  const roots: RegionNode[] = [];
  const stack: RegionNode[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('%% @region-start:')) {
      const match = trimmed.match(/%%\s*@region-start:\s*([a-zA-Z0-9_-]+)(?:=([a-zA-Z0-9_-]+))?/);
      if (match) {
        const type = match[1];
        const value = match[2];
        const pathSegment = value ? `${type}=${value}` : type;
        const parentPath = stack.length > 0 ? stack[stack.length - 1].path : '';
        const path = parentPath ? `${parentPath}/${pathSegment}` : pathSegment;
        
        const node: RegionNode = { type, value, path, children: [] };
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(node);
        } else {
          roots.push(node);
        }
        stack.push(node);
      }
    } else if (trimmed === '%% @region-end') {
      stack.pop();
    }
  }

  return roots;
}
