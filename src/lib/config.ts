import path from 'path';

export function getDiagramsDir(req?: Request) {
  let dirParam = null;
  if (req) {
    const url = new URL(req.url);
    dirParam = url.searchParams.get('dir');
  }
  if (dirParam) {
    return path.resolve(dirParam);
  }
  if (process.env.DIAGRAMS_DIR) {
    return process.env.DIAGRAMS_DIR;
  }
  return path.join(process.cwd(), 'diagrams');
}
