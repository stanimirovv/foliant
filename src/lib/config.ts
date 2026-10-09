import path from 'path';
import os from 'os';

function expandTilde(filepath: string) {
  if (filepath.charCodeAt(0) === 126 /* ~ */) {
    if (filepath.length === 1 || filepath.charCodeAt(1) === 47 /* / */ || filepath.charCodeAt(1) === 92 /* \ */) {
      return os.homedir() + filepath.slice(1);
    }
  }
  return filepath;
}

export function getDiagramsDir(req?: Request) {
  let dirParam = null;
  if (req) {
    const url = new URL(req.url);
    dirParam = url.searchParams.get('dir');
  }
  if (dirParam) {
    return path.resolve(expandTilde(dirParam));
  }
  if (process.env.DIAGRAMS_DIR) {
    return expandTilde(process.env.DIAGRAMS_DIR);
  }
  return path.join(process.cwd(), 'diagrams');
}
