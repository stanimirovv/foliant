// Files that ship with the project and must never be modified through the
// viewer. When deployed to a shared server, these files are protected at both
// the API layer (writes are rejected with 403) and the UI layer (all edit
// controls are hidden/disabled).

const READ_ONLY_FILES = new Set([
  'tutorial.md',
]);

export function isReadOnlyFile(filename: string): boolean {
  return READ_ONLY_FILES.has(filename);
}
