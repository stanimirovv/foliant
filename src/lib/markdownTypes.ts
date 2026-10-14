// Shared, runtime-free types for the markdown-embedded-diagram feature.
// Imported (as types only) by both the API routes and the client so the
// client bundle never pulls in the markdown parser.

export interface MdDiagramMeta {
  index: number;      // 0-based position among the mermaid blocks of the file
  title: string;      // first meaningful line of the diagram (for the menu)
  startLine: number;  // 1-based line of the opening fence
  endLine: number;    // 1-based line of the closing fence
}
