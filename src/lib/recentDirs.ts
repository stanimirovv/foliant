// Display formatting for the Recent directories list in the sidebar.
//
// The full absolute path is useless there: it is long, and when several recent
// directories share the same top-level directories the truncated row shows
// the shared prefix and hides the one component that actually differs.
// Instead we show the tail of the path — the last few components — keeping as
// many of the last 3 as fit in the available width (measured with `measure`),
// and falling back to 2, then 1 component when they would not be visible.

export type MeasureText = (text: string) => number;

// Split a path into its meaningful segments (handles both / and \ separators
// and ignores the empty segments produced by leading/trailing slashes).
function splitPathSegments(dir: string): string[] {
  return dir.split(/[\\/]+/).filter(segment => segment.length > 0);
}

// Shorten `dir` for the Recent list: the trailing components joined with '/'
// and prefixed with an ellipsis to mark the cut, using as many of the last 3
// components as fit in `maxWidth` pixels. Paths with 3 or fewer components
// are shown in full.
export function formatRecentDir(dir: string, maxWidth: number, measure: MeasureText): string {
  const segments = splitPathSegments(dir);
  if (segments.length <= 3) return dir;
  for (let keep = 3; keep >= 1; keep--) {
    const candidate = `…/${segments.slice(segments.length - keep).join('/')}`;
    if (measure(candidate) <= maxWidth) return candidate;
  }
  // Even the last component alone does not fit; show it anyway and let the
  // row's CSS truncation cut it.
  return segments[segments.length - 1];
}
