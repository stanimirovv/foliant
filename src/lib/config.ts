import path from 'path';
import { validateDiagramFileName, expandTilde } from './storage/validate';

export { resolveDirPath } from './storage/validate';

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

// Resolve a file name to a path inside the diagrams directory, rejecting
// anything that could escape it (path separators, '..', absolute paths).
// Throws StorageError('invalid-name'); see storage/validate.ts.
export function resolveDiagramFilePath(diagramsDir: string, filename: string): string {
  validateDiagramFileName(filename);
  return path.join(diagramsDir, filename);
}
