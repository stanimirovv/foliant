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

// Resolve a user-supplied directory path (tilde-expanded, made absolute)
// without any fallback or side effects.
export function resolveDirPath(dirParam: string): string {
  return path.resolve(expandTilde(dirParam));
}

export function getDiagramsDir(req?: Request) {
  let dirParam = null;
  if (req) {
    const url = new URL(req.url);
    dirParam = url.searchParams.get('dir');
  }
  if (dirParam) {
    return resolveDirPath(dirParam);
  }
  if (process.env.DIAGRAMS_DIR) {
    return expandTilde(process.env.DIAGRAMS_DIR);
  }
  return path.join(process.cwd(), 'diagrams');
}

// Resolve a file name to a path inside the diagrams directory, rejecting
// anything that could escape it (path separators, '..', absolute paths).
export function resolveDiagramFilePath(diagramsDir: string, filename: string): string {
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..' ||
    path.isAbsolute(filename)
  ) {
    throw new Error('Invalid file name');
  }
  return path.join(diagramsDir, filename);
}
