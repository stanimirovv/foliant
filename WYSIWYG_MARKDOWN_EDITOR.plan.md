# Plan: WYSIWYG Markdown Editor (Typora-style, Approach A)

> Status: **implemented.** Execute steps in order. Each step is
> self-contained: build it, run its tests, do its human verification, then
> move on.

> **Post-implementation change (user request):** Split mode was removed.
> The markdown editor now has two modes — **Edit** (Monaco raw source) and
> **Preview** (the WYSIWYG document); Preview is the default and a stored
> `split` preference migrates to Preview. The undo/redo buttons show in
> Preview mode. Where this plan says "Split", read "removed".

## Overview

**What we're building:** The markdown preview pane becomes an interactive
editing surface. The document renders as a sequence of blocks (headings,
paragraphs, lists, code, tables, blockquotes, mermaid diagrams). Click any
text block → it swaps to an inline source editor scoped to that block. Edit
→ the block re-renders in place. The full document is reassembled from block
edits and flows through the existing `onCodeChange` → auto-save pipeline.
Mermaid blocks keep their existing click → diagram editor flow.

**Core design decisions:**

| Decision | Choice | Rationale |
|---|---|---|
| Block granularity | Top-level mdast nodes (via `mdast-util-from-markdown`, already installed) | Each block maps 1:1 to a source range; no HTML→markdown serialization needed |
| Editing surface | Auto-sized `<textarea>` with the block's markdown source | Robust, lossless, supports all markdown constructs. True contenteditable rich-text is Phase 2 |
| Source reassembly | Offset-based splice at the edited block's range | `lib/markdown.ts` already does this for mermaid blocks; we generalize it |
| Re-parse strategy | Re-parse the full document after every edit | No cross-edit offset tracking needed; always consistent |
| Mode toggle | Existing Edit/Split/Preview — the preview pane becomes the WYSIWYG surface | No new mode; Split = Monaco + WYSIWYG side by side, Preview = WYSIWYG only |
| Undo | WYSIWYG edits route through `commitEdit` (new `onMarkdownEdit` callback) | Monaco edits keep Monaco's built-in undo via `onCodeChange`; WYSIWYG gets app-level undo |

**Architecture:**

```
MarkdownEditor (3 modes: Edit | Split | Preview)
  ├── Edit/Split → Monaco pane (raw source, unchanged)
  └── Split/Preview → WYSIWYGEditor (new)
        ├── parseMarkdownBlocks(code) → Block[]
        ├── WYSIWYGBlock[] (text blocks: rendered ↔ textarea on click)
        ├── MermaidBlockPreview[] (unchanged: SVG, click → diagram editor)
        └── "+" insert buttons between blocks
              │
              ▼  onCodeChange(newFullDocument)  [Monaco edits]
              ▼  onMarkdownEdit(newFullDocument) [WYSIWYG edits → undo stack]
        ClientPage.handleMarkdownChange / commitEdit
              │
              ▼  setRawCode → 800ms debounce → POST /api/file/{name} → auto-save
```

**New files:**

- `src/lib/markdownBlocks.ts` — block parsing + mutation functions
- `src/lib/markdownBlocks.test.ts` — unit tests
- `src/components/WYSIWYGBlock.tsx` — single block (rendered ↔ edit)
- `src/components/WYSIWYGBlock.test.tsx` — component tests
- `src/components/WYSIWYGEditor.tsx` — full document WYSIWYG surface
- `src/components/WYSIWYGEditor.test.tsx` — component tests
- `cypress/e2e/markdown-wysiwyg.cy.ts` — e2e tests

**Modified files:**

- `src/components/MarkdownEditor.tsx` — preview pane → `WYSIWYGEditor`
- `src/components/MarkdownEditor.test.tsx` — update + new tests
- `src/components/ClientPage.tsx` — wire `onMarkdownEdit` → `commitEdit`, pass undo props
- `src/app/globals.css` — WYSIWYG block/toolbar/textarea styles

**Test commands:**

- Unit: `npm test` (vitest) — or `npm test -- <pattern>` for a single file
- E2E: `npm run test:e2e -- --spec cypress/e2e/markdown-wysiwyg.cy.ts`
- Dev: `npm run dev`

---

## Step 1 — Block model: `src/lib/markdownBlocks.ts`

**Goal:** A pure module that parses a markdown document into an ordered list
of blocks and provides pure mutation functions (replace/insert/delete) that
each return a new full document string.

**Depends on:** nothing.

**Agent instructions:**

Create `src/lib/markdownBlocks.ts` with:

### Types

```typescript
type TextBlock = {
  kind: 'text';
  nodeType: string;        // mdast node type: 'heading' | 'paragraph' | 'list' | 'code' | 'blockquote' | 'table' | 'thematicBreak' | 'html' | ...
  headingDepth?: number;   // for heading nodes
  startOffset: number;
  endOffset: number;
  source: string;          // markdown.slice(startOffset, endOffset)
};

type MermaidBlockRef = {
  kind: 'mermaid';
  index: number;           // matches the diagram URL param
  content: string;
  title: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  source: string;          // the full fenced block including fences
};

type MarkdownBlock = TextBlock | MermaidBlockRef;
```

### `parseMarkdownBlocks(markdown: string): MarkdownBlock[]`

1. Call `extractMermaidBlocks(markdown)` (from `./markdown`) to get mermaid
   blocks with offsets.
2. Parse the full document with `fromMarkdown(markdown)` (from
   `mdast-util-from-markdown`, already a dependency).
3. Walk `root.children` in order. For each child:
   - If it's a `code` node with `lang.toLowerCase() === 'mermaid'`, find the
     matching mermaid block by `position.start.offset` and emit a
     `MermaidBlockRef`.
   - Otherwise, emit a `TextBlock` with the node's `position.start.offset`,
     `position.end.offset`, `node.type`, and
     `source = markdown.slice(start, end)`.
4. Return the ordered list. Empty/whitespace-only documents return `[]`.

### `replaceBlockSource(markdown: string, blockIndex: number, newSource: string): string`

- Parse blocks, splice `newSource` at `[block.startOffset, block.endOffset)`,
  return the new full document.
- Throw `RangeError` if `blockIndex` is out of range.

### `insertBlockAfter(markdown: string, blockIndex: number, source: string): string`

- `blockIndex === -1` inserts at the very start.
- Insert `\n\n{source}` at the end offset of the target block (or at offset 0
  for -1).
- If inserting at the end of the document, ensure the document ends with a
  newline.
- Return the new full document.

### `deleteBlock(markdown: string, blockIndex: number): string`

- Remove `markdown.slice(block.startOffset, block.endOffset)`.
- Also consume trailing blank lines (newlines) up to the next block's
  `startOffset` (or end of document) to avoid leaving double blank lines.
- If the deleted block was the last one, also consume preceding blank lines
  back to the previous block's `endOffset`.
- Return the new full document.

### Edge cases to handle and test

- Empty document → `[]`
- Document starting/ending with a mermaid block
- Non-mermaid fenced code blocks → text blocks (nodeType `'code'`)
- Indented code blocks → text blocks
- HTML blocks → text blocks
- Heading depths 1–6
- Nested lists (the whole list is one block)
- Tables, blockquotes, thematic breaks
- CRLF line endings (normalize for offset math, preserve in output where
  possible)
- Block at index 0 and at the last index for insert/delete
- `replaceBlockSource` with empty string (effectively deletes the block
  content)
- Offsets are correct: `markdown.slice(block.startOffset, block.endOffset)
  === block.source` for every block

**Tests (automated):** `src/lib/markdownBlocks.test.ts` — vitest. Cover every
function and edge case above. Round-trip property: `parseMarkdownBlocks` then
reassembling sources with original inter-block text reproduces the original
document.

**Human verification:** Run `npm test -- markdownBlocks`. All tests pass.
Spot-check: write a quick script that parses `diagrams/markdown-demo.md`,
prints each block's type and source, and confirms the sources concatenate
(with inter-block whitespace) back to the original file.

---

## Step 2 — Single block editor: `src/components/WYSIWYGBlock.tsx`

**Goal:** A component that renders one text block in read mode (styled HTML)
or edit mode (textarea with the block's markdown source), with a small
toolbar.

**Depends on:** Step 1.

**Agent instructions:**

Create `src/components/WYSIWYGBlock.tsx`:

### Props

```typescript
interface WYSIWYGBlockProps {
  block: TextBlock;
  blockIndex: number;
  theme: 'default' | 'dark';
  onSave: (blockIndex: number, newSource: string) => void;
  onDelete: (blockIndex: number) => void;
}
```

### Read mode

- Render `block.source` via `renderMarkdownSegment(block.source)` (from
  `@/lib/markdownRender`) into a `dangerouslySetInnerHTML` div.
- Wrap in a container with `data-testid="wysiwyg-block-{blockIndex}"`.
- On click → switch to edit mode.
- Hover shows a subtle border and a small toolbar (top-right): block type
  label (e.g. "H1", "¶", "List", "Code"), a delete button
  (`data-testid="wysiwyg-block-delete-{blockIndex}"`).

### Edit mode

- Replace the rendered HTML with an auto-sized `<textarea>`
  (`data-testid="wysiwyg-block-editor-{blockIndex}"`) containing
  `block.source`.
- The textarea auto-grows with content (adjust `rows` or `scrollHeight` on
  input).
- Toolbar: **Save** button (`data-testid="wysiwyg-block-save-{blockIndex}"`),
  **Cancel** button (`data-testid="wysiwyg-block-cancel-{blockIndex}"`).
- **Save** (click or Cmd/Ctrl+Enter) → `onSave(blockIndex, textarea.value)`.
- **Cancel** (click or Escape) → revert to read mode without saving.
- **Blur** → save (same as clicking Save).
- Active block has a highlighted border (theme-aware).

### Theme

Use the existing `isDark` pattern from `MarkdownEditor`. Reuse
`.markdown-body` CSS class for rendered content so existing styles apply.

### Empty block handling

If `block.source` is empty or whitespace-only, show a placeholder ("Empty
block — click to edit") in read mode.

**Tests (automated):** `src/components/WYSIWYGBlock.test.tsx` — vitest +
Testing Library.

- Renders markdown source as HTML in read mode (heading → `<h1>`,
  paragraph → `<p>`, etc.)
- Click switches to edit mode with textarea containing the source
- Save calls `onSave` with the edited source
- Cancel reverts to read mode without calling `onSave`
- Escape key cancels
- Cmd/Ctrl+Enter saves
- Blur saves
- Delete button calls `onDelete`
- Empty block shows placeholder
- Dark theme applies correct classes

**Human verification:** Run `npm test -- WYSIWYGBlock`. All tests pass.

---

## Step 3 — WYSIWYG document surface: `src/components/WYSIWYGEditor.tsx`

**Goal:** The full WYSIWYG editing surface that renders all blocks, manages
the active (editing) block, and emits full-document updates.

**Depends on:** Steps 1, 2.

**Agent instructions:**

Create `src/components/WYSIWYGEditor.tsx`:

### Props

```typescript
interface WYSIWYGEditorProps {
  code: string;
  theme: 'default' | 'dark';
  onCodeChange: (newCode: string) => void;       // Monaco edits (no undo)
  onMarkdownEdit: (newCode: string) => void;      // WYSIWYG edits (with undo)
  onSelectDiagram: (index: number) => void;
}
```

### State

- `activeBlock: number | null` — which block is in edit mode.
- Blocks are derived via `useMemo(() => parseMarkdownBlocks(code), [code])`.

### Rendering

- Map over blocks. For each:
  - `kind === 'text'` → `<WYSIWYGBlock>` with `onSave`/`onDelete` handlers.
  - `kind === 'mermaid'` → `<MermaidBlockPreview>` (unchanged, existing props).
- Between blocks (and at the end), render a "+" insert button
  (`data-testid="wysiwyg-insert-{position}"`) that appears on hover. Clicking
  inserts a new empty paragraph block at that position.
- Empty document → render a single empty editable block (or an insert button
  at position 0 with a hint).

### Mutation handlers

- `handleSave(blockIndex, newSource)`:
  `const newCode = replaceBlockSource(code, blockIndex, newSource); onMarkdownEdit(newCode); setActiveBlock(null);`
- `handleDelete(blockIndex)`:
  `const newCode = deleteBlock(code, blockIndex); onMarkdownEdit(newCode); setActiveBlock(null);`
- `handleInsert(position, source = '')`:
  `const newCode = insertBlockAfter(code, position - 1, source); onMarkdownEdit(newCode);`
  Then set the newly inserted block as active so the user can immediately type
  into it.
- After insert, scroll the new block into view and focus its textarea.

### Re-parse on external change

When `code` changes (SSE reload, file switch, undo/redo), `useMemo` re-parses
automatically. If the active block no longer exists (e.g., it was deleted
externally), clear `activeBlock`.

### Only one block active at a time

Clicking a different block saves the current one (if dirty) and activates the
new one. Clicking outside all blocks (on the container background) saves and
deactivates.

**Tests (automated):** `src/components/WYSIWYGEditor.test.tsx` — vitest +
Testing Library. Mock `MermaidBlockPreview` and `mermaid`.

- Renders all blocks in document order (text + mermaid)
- Click a text block → textarea appears; edit → save → `onMarkdownEdit`
  called with the correct new full document
- Delete a block → `onMarkdownEdit` called with the block removed
- Insert via "+" → `onMarkdownEdit` called with the new block inserted
- Mermaid blocks render via `MermaidBlockPreview` and call `onSelectDiagram`
  on click
- Empty document shows an insert affordance
- Only one block in edit mode at a time
- External `code` change re-renders blocks

**Human verification:** Run `npm test -- WYSIWYGEditor`. All tests pass.

---

## Step 4 — Integrate into `MarkdownEditor.tsx` (walking skeleton)

**Goal:** The preview pane of `MarkdownEditor` is now the WYSIWYG surface.
End-to-end: open a `.md` file, see rendered blocks, click a paragraph, edit
inline, see it re-render, auto-save to disk.

**Depends on:** Steps 1–3.

**Agent instructions:**

Modify `src/components/MarkdownEditor.tsx`:

- Import `WYSIWYGEditor`.
- Replace the static preview rendering (`renderedSegments.map(...)`) with
  `<WYSIWYGEditor>`.
- The preview pane (`data-testid="markdown-preview-pane"`) now contains:

  ```tsx
  <WYSIWYGEditor
    code={code}
    theme={theme}
    onCodeChange={onCodeChange}
    onMarkdownEdit={onMarkdownEdit}   // new prop, wired in Step 5
    onSelectDiagram={onSelectDiagram}
  />
  ```

- Add `onMarkdownEdit` to `MarkdownEditorProps` (optional for now; will be
  required in Step 5).
- Update the toolbar hint text: "Click any block to edit it inline — mermaid
  diagrams open in the diagram editor."
- Keep the Edit/Split/Preview mode toggle unchanged.
- Keep the Monaco pane unchanged.

Update `src/components/MarkdownEditor.test.tsx`:

- Existing tests that check preview rendering should still pass (rendered
  text appears in WYSIWYG blocks).
- Add: clicking a text block in the preview switches it to edit mode.
- Add: editing a block calls `onMarkdownEdit` with the updated full document.
- Mock `WYSIWYGEditor` in some tests to keep them focused, or test through it.

**Tests (automated):** `npm test -- MarkdownEditor`. All existing + new tests
pass.

**Human verification:**

1. `npm run dev`
2. Open the app, select `diagrams/markdown-demo.md` (or any `.md` file).
3. The document renders as styled blocks in the preview pane.
4. Click a paragraph → textarea appears with the markdown source.
5. Edit the text, click Save (or press Cmd+Enter) → the block re-renders
   with the new content.
6. Wait ~1s → the save indicator shows "Saved".
7. Check the file on disk → the edit is persisted.
8. Switch to Edit mode → Monaco shows the updated source.
9. Switch back to Split → both panes show the updated document.

---

## Step 5 — Undo/redo for WYSIWYG edits

**Goal:** WYSIWYG edits participate in the app's undo/redo stack. Undo/redo
buttons appear in the MarkdownEditor toolbar.

**Depends on:** Step 4.

**Agent instructions:**

Modify `src/components/ClientPage.tsx`:

- Change `handleMarkdownChange` to remain as-is (Monaco edits → `setRawCode`,
  no undo).
- Add `handleMarkdownEdit = useCallback((newCode: string) => { commitEdit(newCode); }, [commitEdit])`.
- Pass to `MarkdownEditor`: `onMarkdownEdit={handleMarkdownEdit}`,
  `onUndo={undo}`, `onRedo={redo}`, `canUndo={historyPast.length > 0}`,
  `canRedo={historyFuture.length > 0}`.

Modify `src/components/MarkdownEditor.tsx`:

- Add optional props: `onMarkdownEdit?`, `onUndo?`, `onRedo?`, `canUndo?`,
  `canRedo?`.
- When `onMarkdownEdit` is provided, pass it to `WYSIWYGEditor` (WYSIWYG
  edits go through the undo stack).
- When `onUndo`/`onRedo` are provided, show undo/redo buttons in the toolbar
  (next to the mode toggle). Use `Undo2`/`Redo2` icons from `lucide-react`.
- The undo/redo buttons are only shown in Split/Preview modes (not Edit mode,
  where Monaco has its own undo).

Update `src/components/MarkdownEditor.test.tsx`:

- Undo/redo buttons appear when props are provided.
- Clicking undo calls `onUndo`.

**Tests (automated):** `npm test -- MarkdownEditor`. Pass.

**Human verification:**

1. Open a `.md` file in Preview mode.
2. Edit a block → save → the block updates.
3. Click Undo → the block reverts to the previous content.
4. Click Redo → the edit is re-applied.
5. Edit another block → the redo stack is cleared (standard undo behavior).
6. Switch to Edit mode → undo/redo buttons disappear (Monaco handles undo
   there).

---

## Step 6 — Styling: `src/app/globals.css`

**Goal:** The WYSIWYG surface looks polished in both themes.

**Depends on:** Step 4.

**Agent instructions:**

Add CSS for:

- **`.wysiwyg-block`** — container for each block. Subtle border on hover,
  highlighted border when active. Rounded corners. Padding.
- **`.wysiwyg-block-toolbar`** — small toolbar (top-right of block on hover).
  Contains block type label and action buttons.
- **`.wysiwyg-block-editor`** — the textarea. Monospace font, transparent
  background (blends with the block), auto-grow, theme-aware text color,
  subtle border.
- **`.wysiwyg-insert-btn`** — the "+" button between blocks. Circular,
  subtle, appears on hover of the gap area.
- **`.wysiwyg-active`** — the active (editing) block. Blue-tinted border
  (matching the existing selection glow aesthetic).
- **Dark mode variants** — under `.theme-dark`, matching the existing dark
  palette (`#0f172a`, `#1e293b`, `#334155`, `#3b82f6`).

Match the existing aesthetic: rounded corners, subtle borders, blue accent
for interactive elements, slate grays for dark mode.

**Tests (automated):** None (CSS). Verified visually.

**Human verification:**

1. Open a `.md` file in both light and dark themes.
2. Hover over blocks → toolbar appears.
3. Click a block → it highlights, textarea appears with matching theme.
4. Insert buttons appear between blocks on hover.
5. No visual glitches (overlapping toolbars, misaligned text, etc.).

---

## Step 7 — Edge cases, block type switching & keyboard shortcuts

**Goal:** Handle edge cases gracefully and add power-user features.

**Depends on:** Steps 4, 6.

**Agent instructions:**

### Block type switching

Add a small dropdown/select in the `WYSIWYGBlock` toolbar (edit mode) to
convert the block: Paragraph ↔ Heading 1–6 ↔ Bullet list ↔ Numbered list ↔
Quote ↔ Code. Implementation: prepend/modify the source (e.g., `# ` for H1,
`- ` for bullet list, `> ` for quote, ` ``` ` for code). This is source
manipulation, not rich-text — simple and lossless.

- `data-testid="wysiwyg-block-type-{blockIndex}"` for the selector.

### Keyboard shortcuts in textarea

- Cmd/Ctrl+B: wrap selection with `**` (or unwrap if already wrapped)
- Cmd/Ctrl+I: wrap selection with `*` (or unwrap)
- Cmd/Ctrl+K: wrap selection with `[text](url)` — insert a link with
  placeholder URL

### Edge cases

- Empty document → render one empty `WYSIWYGBlock` with placeholder, or an
  insert button.
- Document with only mermaid blocks → mermaid blocks + insert button at end.
- Rapid edits → the 800ms auto-save debounce already handles this; ensure
  re-parsing is fast (memoized).
- External change while a block is being edited → if the `code` prop changes
  externally, discard the in-progress edit and show the external version (the
  auto-save will re-save it on the next edit).
- Mermaid block source editing: add a small "edit source" button on the
  `MermaidBlockPreview` in WYSIWYG mode that swaps to a textarea (same as text
  blocks but for the fenced block content). This is optional — the primary
  flow is click → diagram editor.

**Tests (automated):**

- Block type switching: paragraph → H1 adds `# `, H1 → paragraph removes
  `# `, etc.
- Keyboard shortcuts: Cmd+B wraps selection, Cmd+I wraps, Cmd+K inserts link.
- Empty document renders an editable affordance.
- Mermaid-only document renders correctly.

**Human verification:**

1. Open a `.md` file.
2. Click a paragraph, change its type to H2 via the dropdown → it renders as
   a heading.
3. Select text in the textarea, press Cmd+B → text is wrapped with `**`.
4. Open an empty `.md` file → can immediately start typing.
5. Open a `.md` file with only mermaid blocks → diagrams render, can add
   text blocks between them.

---

## Step 8 — E2E tests: `cypress/e2e/markdown-wysiwyg.cy.ts`

**Goal:** End-to-end coverage of the WYSIWYG editing flow in a real browser.

**Depends on:** Steps 1–7.

**Agent instructions:**

Create `cypress/e2e/markdown-wysiwyg.cy.ts` following the patterns in
`cypress/e2e/markdown.cy.ts` (temp dirs via `cy.task('createTempDiagramDir')`,
`cy.request` for file setup, `mdSaved()` helper for auto-save).

Test cases:

1. **Edit a paragraph inline:** Open a `.md` file in Preview mode. Click a
   paragraph → textarea appears. Type new text → save → the block
   re-renders. Verify auto-save ("Saved" indicator). Verify the file on disk
   has the updated content.
2. **Insert a block:** Click the "+" button between two blocks → a new empty
   block appears in edit mode. Type text → save → the new block renders.
   Verify on disk.
3. **Delete a block:** Hover a block → click delete → the block is removed.
   Verify on disk.
4. **Split mode sync:** In Split mode, edit in the WYSIWYG pane → Monaco pane
   updates. Edit in Monaco → WYSIWYG pane updates.
5. **Mermaid blocks unchanged:** Click a mermaid block → navigates to the
   diagram editor (same as before).
6. **Undo/redo:** Edit a block → save → undo → content reverts → redo →
   content restored. Verify on disk after each.
7. **Block type switching:** Change a paragraph to H1 → it renders as a
   heading. Verify on disk the source has `# `.
8. **Empty document:** Create an empty `.md` file → open it → can add content
   immediately.
9. **External change:** While the doc is open, modify the file on disk via
   `cy.request('POST', ...)` → the WYSIWYG surface updates (SSE).

**Tests (automated):** `npm run test:e2e -- --spec cypress/e2e/markdown-wysiwyg.cy.ts`.
All pass.

**Human verification:** Run the full e2e suite: `npm run test:e2e`. All
existing + new tests pass. Then manually walk through the WYSIWYG flow one
more time in `npm run dev`.

---

## Execution order & dependencies

```
Step 1 (lib) ──┬── Step 2 (block component) ──┐
               │                                ├── Step 4 (integration / skeleton) ── Step 5 (undo) ── Step 6 (styling) ── Step 7 (polish)
               └── Step 3 (WYSIWYG surface) ──┘                                                                    │
                                                                                                                      Step 8 (e2e, runs last)
```

Steps 2 and 3 can run in parallel after Step 1. Step 4 requires both.
Steps 5–7 are sequential enhancements. Step 8 runs last (needs everything).

## Quick reference: key existing code

| What | Where |
|---|---|
| Mermaid block extraction (offsets, content, title) | `src/lib/markdown.ts` → `extractMermaidBlocks()` |
| Text segment rendering (marked → HTML) | `src/lib/markdownRender.ts` → `renderMarkdownSegment()` |
| Markdown editor component (3 modes) | `src/components/MarkdownEditor.tsx` |
| Mermaid block preview (SVG render, click → edit) | `src/components/MermaidBlockPreview.tsx` |
| ClientPage: markdown change handler | `src/components/ClientPage.tsx` → `handleMarkdownChange` (line ~948) |
| ClientPage: undo/redo (commitEdit, undo, redo) | `src/components/ClientPage.tsx` → `commitEdit`, `undo`, `redo` |
| ClientPage: MarkdownEditor usage | `src/components/ClientPage.tsx` (line ~2072) |
| Auto-save debounce (800ms) + SSE | `src/components/ClientPage.tsx` (Section 4.10) |
| Markdown preview CSS | `src/app/globals.css` → `.markdown-body` section |
| E2E test patterns | `cypress/e2e/markdown.cy.ts` |
| Unit test patterns | `src/components/MarkdownEditor.test.tsx`, `src/lib/markdownRender.test.ts` |
