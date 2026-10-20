# Implementation Plan — Sequence Notes & Visual Blocks (`alt` / `opt` / `loop` / `par` / `rect`)

Plan for **Feature 1 of `FEATURES_AND_QOL.md`** ("Visual Creation & Editing Blocks").
Date: 2026-10-19. Do **not** treat this file as a spec change: `FEATURES_AND_QOL.md`
stays untouched.

## 0. Overview

**Source requirement** (verbatim from `FEATURES_AND_QOL.md` §1, mirrored in the task):

- Make `NoteFields` editable (note text, placement `over` / `left of` / `right of`,
  participant span, and deletion) + add an **"Add Sequence Note"** action in the toolbar.
- Allow Shift-selecting contiguous messages on the canvas to wrap them in an `alt`,
  `opt`, `loop`, `par`, or `rect` block — or wrap them in a `%% @region-start: flow=…`
  region directly from `MultiElementFields` (similar to how `Group into Box` works for
  participants).

**Strategy — foundation first, then vertical slices:**

1. **Model foundation** (Step 1): notes learn their placement keyword; blocks stay as-is.
2. **Vertical slice A — notes** (Steps 2–3): pure transforms in `editor.ts`, then the
   UI (editable `NoteFields`, toolbar button, delete confirmation). Human-visible after
   Step 3.
3. **Vertical slice B — block selection & editing** (Steps 4–5): blocks become clickable
   canvas elements, then get a `BlockFields` panel with title/type editing, unwrap and
   delete-with-content.
4. **Vertical slice C — wrapping** (Steps 6–7): `wrapInBlock` / `wrapInRegion` transforms
   plus the `MultiElementFields` UI, modeled on `Group into Box`.
5. **Hardening** (Step 8): dedicated Cypress e2e suites + `MANUAL_TEST_PLAN.md` update.

Each step leaves the app runnable; every step adds unit tests, and the slices end in
e2e coverage. A human works through the plan by executing one step with the agent,
running its verification, and moving on.

**Design principle (task constraint): keep controls and mechanics similar to the
existing ones.** Every new control mirrors an existing pattern:

| New thing | Existing pattern it mirrors |
| --- | --- |
| "Add Sequence Note" toolbar button | "Add Sticky Note" button (`ClientPage.tsx` ~2509) and "Participant"/"Message" buttons (gating via `isVisualLocked`, `data-testid`, lucide icon + label) |
| `NoteFields` text/placement/span editing | `ParticipantFields` label input, `ArrowFields` selects; commit style of `StickyNoteFields` (textarea, blur-commit) |
| Note delete button + confirmation | `DeleteButton` + `pendingDelete` dialog (`EditorPanel.tsx` `describeElement` already describes notes) |
| `wrapInBlock` transform | `groupParticipants` (`editor.ts:1903`): sort by line, splice header/end, indent content +4 |
| Wrap UI in `MultiElementFields` | "Group into Box" emerald-bordered section (`EditorPanel.tsx` 374–430) |
| Block canvas selection | Notes: zip in `svgmap.ts`, point/label resolution in `elementKeyAtTarget`, signature in `buildSelectionMap` |
| CONFIG retargeting after note edits | `editMessageLabel`'s arrow-entry retargeting (`editor.ts:583`) |

**Repo NFRs honored throughout** (from `model.ts` / `editor.ts` header comments):

- **NFR-01** — malformed input is skipped / a no-op with a warning, never an error or corruption.
- **NFR-02** — transforms are line-surgical; untouched lines preserved byte-for-byte.
- **NFR-03** — these features are sequence-diagram-only; flowchart behavior must not regress.

## 1. Requirements (derived from the task + current-state gaps)

- **R-01** — The properties panel for a native sequence note (`NoteFields`) exposes editable
  note text, placement (`over` / `left of` / `right of`) and spanned participant list, and
  a Delete control; edits rewrite the `.mmd` source through the same commit/undo/auto-save
  pipeline as every other edit.
- **R-02** — A toolbar "Add Sequence Note" action creates a native `Note over …` line,
  selects it, and is gated the same way as "Add Message" (sequence diagram required,
  actors required, disabled while visual edits are locked).
- **R-03** — Deleting a sequence note from the panel or the `Delete` key uses the existing
  cascade-confirmation dialog and cleans up CONFIG `noteTags`.
- **R-04** — CONFIG `noteTags` entries (keyed by `over` + `text` + `occurrence`) follow the
  note through text/placement/span edits and survive deletion, exactly like arrow entries
  follow label edits.
- **R-05** — Shift-selecting ≥2 contiguous messages (and/or notes) on the canvas shows a
  "Wrap Selection" control in `MultiElementFields` that wraps them in an `alt`, `opt`,
  `loop`, `par`, or `rect` block; the created block is selected afterwards.
- **R-06** — The same multi-selection can be wrapped in a `%% @region-start: <type>=<value>`
  / `%% @region-end` region from `MultiElementFields`, so view filters (hidden paths) can
  hide the span.
- **R-07** — `BlockElement`s (`alt`/`opt`/`loop`/`par`/`rect`) become selectable on the
  canvas (via their label area) and editable in the panel: title edit, type conversion,
  unwrap, and delete-with-content (with cascade confirmation). `BlockElement` no longer
  falls through to "This element is not editable."

**Out of scope** (do not build; note in the PRs): flowchart subgraph grouping (feature 4
of `FEATURES_AND_QOL.md`), `critical`/`option` blocks, adding `else`/`and` arms via the
UI, multi-line note text, note drag on canvas, editing `box` titles (box unwrap only).

## 2. Key mechanics this plan builds on (read before starting)

- `parseModel` (`src/lib/model.ts`) — typed elements with exact 0-based line spans.
  `NoteElement` has `over: string[]` + `text` but **no placement field** — `NOTE_RE`
  already captures `over|left of|right of` and throws the keyword away. `BlockElement`
  has `blockType` + `title`; `BLOCK_OPEN_RE` covers `alt|opt|loop|par|rect|box|subgraph`,
  `BLOCK_CONT_RE` covers `else|and`, `BLOCK_END_RE` covers `end`. Unclosed blocks span to
  EOF. `%% @region-start` lines become `RegionElement`s; other comments are not elements.
- `editor.ts` transforms — pure `(code, config, …) → { code, config, warning?, newKey? }`;
  `applyEditResult` (`ClientPage.tsx` ~1395) commits, selects `newKey`, shows `warning`.
  `deleteElement` (line 1250) already supports notes and prunes CONFIG; participants/arrows
  delete immediately, everything else confirms.
- `buildSelectionMap` (`src/lib/svgmap.ts:782`) — matches processed ↔ raw elements by
  grouped signature (`notesMatchEntry`-style order matching within identical signatures);
  blocks/regions/config explicitly return `null` ("not selectable") today.
- `zipModelToSvg` / `elementKeyAtTarget` — zips participants/messages/notes/nodes/edges to
  SVG groups; notes are resolved by point containment because lifelines paint above them.
  Per `svgmap.ts`'s own selector table, sequence blocks render as `g[data-et="control-structure"]`
  (label box + frame lines, painted *below* messages), currently treated as decoration
  (`styling.ts:903`).
- `transformActors` / `processMermaid` (`src/lib/preprocessor.ts`) — region tags are
  **stripped** from processed code (regions never reach Mermaid); `cleanupDanglingSyntax`
  (line 581) removes *empty* blocks (`alt…end` with no statements) and dangling `end`s
  from processed code, and `transformActors` rewrites `Note over A,A` → `Note over A`
  after actor merges/renames. Both matter for edge cases below.
- `groupParticipants` (`editor.ts:1903`) — the template for wrapping: validate keys,
  sort by line, build header/end with 4-space extra indent on content, splice lines.
- CONFIG tag entries: `NoteTagEntry { over, text, occurrence?, keys? }` (`views.ts:57`);
  `noteOccurrence` / `notesMatchEntry` (`editor.ts:152/164`) are the existing matching
  helpers — reuse, don't reinvent.
- E2E harness: `cypress/e2e/*.cy.ts` + `cy.task('createTempDiagramDir')`, seeded via
  `POST /api/file/<name>?dir=…`, asserting through the real UI *and* the file API;
  `[data-testid="save-indicator"]` with text `Saved` marks the debounced auto-save.

## 3. Edge-case catalog (each is covered by a step and a test)

### Notes (Steps 1–3)

| # | Edge case | Handling |
| --- | --- | --- |
| N1 | Note text contains `:` or `#` | `NOTE_RE` takes everything after the first `: `; rebuild only the text span (NFR-02) |
| N2 | Note text with newline | Refuse with warning (same rule as `editMessageLabel`) |
| N3 | Empty note text | Allowed; line kept (`Note over A:`) |
| N4 | `left of` / `right of` with multi-actor span | Mermaid allows only one actor: the placement select is disabled while >1 actor is spanned; the transform double-checks and refuses |
| N5 | Span list with duplicates / empty / unknown ids | Transform dedupes, requires ≥1, and refuses ids that are not actors anywhere in the diagram |
| N6 | Spanning implicit actors (only appear as message endpoints, no `participant` line) | Allowed; the actor picker lists participants **plus** message/edge endpoints plus existing note overs |
| N7 | CONFIG `noteTags` re-keying after text/span edit | Retarget entries old↔new by element key (keys are index-stable), recomputing occurrences — the `editMessageLabel` pattern (R-04) |
| N8 | Two identical notes (`over`+`text`); edit the second's text | Old key (occurrence 1) must land on the new group's occurrence 1, not steal occurrence 0 from the untouched note — computed from the new model, never by guesswork |
| N9 | Insert a note right after `A->>B: x` whose next line is `activate B` | `parseModel` detects activation via the *next* line; inserting between them silently breaks activation state. The insert index must hop over trailing `activate`/`deactivate` companion lines |
| N10 | No participants but implicit actors exist | Note is created over the first implicit actor |
| N11 | No actors at all | Button disabled with title "Add a participant first" (mirror "Add Message") |
| N12 | Note hidden by region/hide-keys | Not rendered → not selectable → not editable; document, don't code around |
| N13 | `Note over A,A` literal duplicate in raw | Dedupe on write so processed rewrite can't produce a phantom |
| N14 | Delete key vs. panel button | Both go through `handleRequestDelete` (`ClientPage.tsx:1759`); notes already take the confirm path |
| N15 | Actors are merged/renamed by views | Raw-file edits use raw ids; `transformActors` handles the processed rewrite — never write processed ids into raw code |

### Blocks — selection & editing (Steps 4–5)

| # | Edge case | Handling |
| --- | --- | --- |
| B1 | Frame paints below messages; clicking the frame interior must not select the block | Resolve block clicks **only** from the block's label box / label text (document-order zip); everything else falls through to existing resolution |
| B2 | Nested blocks (loop inside alt) | Document order = source order for both; 1:1 zip when counts match, otherwise skip with a warning (never mis-select) |
| B3 | Empty block removed by `cleanupDanglingSyntax` in processed code | Grouped signature matching tolerates missing processed counterparts — no crash, block just unselectable while its content is hidden |
| B4 | Duplicate block headers (`alt x` twice) | Signature groups + order matching handle duplicates, like messages |
| B5 | Converting `alt` (has `else`) → `loop` | Refuse with warning — `else` is only legal in `alt` (and `and` in `par`); scan span with `BLOCK_CONT_RE` |
| B6 | Unwrapping an `alt` with `else` arms | Unwrap removes header, `end`, **and** `else`/`and` separator lines (leaving them would be a Mermaid syntax error); arms merge. The panel states this |
| B7 | Unwrapping hand-written blocks with arbitrary indentation | De-indent only lines that actually start with `headerIndent + 4 spaces` |
| B8 | Unclosed block (no `end`) | `parseModel` spans it to EOF; unwrap/delete operate on the span; unwrap of an unclosed block just removes the header |
| B9 | Delete block with content | Confirm dialog lists contained messages/notes (`cascaded`); CONFIG `arrows`/`noteTags` pruned like `deleteElement`; occurrences of *remaining* entries are not renumbered (same trade-off `deleteElement` makes) |
| B10 | `rect` title is a color (`rgb(200,150,255)`), not text | `BlockFields` shows a color input for `rect`; hex ↔ `rgb()` conversion in the transform layer; free-text title for the other types |
| B11 | `box` blocks (created by "Group into Box", also emitted by `transformActors` in processed code) | Selectable + unwrappable; title edit skipped (its title encodes color+name); processed-only boxes simply have no raw counterpart |
| B12 | Block selected + `Delete` key | Same path as panel delete (with-content confirmation) |

### Wrapping (Steps 6–7)

| # | Edge case | Handling |
| --- | --- | --- |
| W1 | Selection not contiguous (unselected element between selected ones) | `canWrapSelection` refuses: every element inside the span must be selected; blank lines / `%%` comments inside are allowed |
| W2 | Span crosses block structure (messages in two `alt` arms, or inside vs. outside a block) | Refuse: no `alt/opt/…` open, `end`, `else`, `and` line inside the span, and depth before span == depth after |
| W3 | Last selected message has `activate`/`deactivate` companion lines | Companions are absorbed into the span (else wrapping would separate a message from its activation) |
| W4 | Mixed selection (participants + messages) | Wrap panel counts only `message`/`note` kinds; participants keep the Box group control; wrapping requires ≥2 wrappable elements |
| W5 | Shift-click order ≠ source order | Sort keys by `lineStart` inside the transform; UI order is irrelevant |
| W6 | Selected messages inside a hidden region | They aren't rendered → can't be selected; no special handling |
| W7 | Wrapping makes the block the only content of an outer hidden region | `cleanupDanglingSyntax` may drop the empty block from processed code — render stays valid |
| W8 | Region name/value invalid (`[a-zA-Z0-9_-]+` violation, empty type) | Refuse with warning; UI input has a datalist of existing region types + values |
| W9 | Region wrap spanning an existing `%% @region-end` | Refuse — the new region's `@region-end` would pop the wrong stack entry and `processMermaid` would flag malformed tags |
| W10 | Region wrap around lines containing block headers/`end`s | Allowed (region tags are stripped comments); unlike block wrap, no structure rules apply |
| W11 | `rect` wrap | Title is a color: color input in the wrap UI, `rect rgb(...)` in source; default `rgb(200,150,255)` |
| W12 | Empty/long block titles | Empty title → bare `loop`/`alt` line; titles with newline refused |
| W13 | Wrap while visual edits locked | Buttons disabled with the same "Locked while editing source code" title as Participant/Message |
| W14 | Undo after wrap | `commitEdit` history handles it for free; e2e asserts the file returns to the pre-wrap bytes |
| W15 | Duplicate region names | Allowed (paths nest by value); no uniqueness check |
| W16 | `%% CONFIG:` header / `sequenceDiagram` line inside span | Impossible (not wrappable kinds) but the transform asserts the span doesn't touch line 0/CONFIG anyway |

## 4. Steps

---

## Step 1 — Model: give `NoteElement` its placement

**Goal:** `parseModel` emits `placement: 'over' | 'left of' | 'right of'` on every
`NoteElement`; nothing else changes.
**Covers:** R-01 (foundation), NFR-01, NFR-02
**Depends on:** —

**Agent instructions:**

1. In `src/lib/model.ts`, extend `NoteElement` with
   `placement: 'over' | 'left of' | 'right of'`. `NOTE_RE` already captures the keyword
   in group 1 — store it on the element in `parseModel`. Do not change `over` semantics.
2. In `src/lib/svgmap.ts` `buildSelectionMap`, add `placement` to the note signature
   (`note|<placement>|<deduped over>|<text>`) so an `over` note and a `left of` note over
   the same actor never cross-match. Keep the existing `rewriteId` dedup logic.
3. Grep for every construction/consumption of `NoteElement` (`editor.ts`, `svgmap.ts`,
   `subgraphTags.ts`, tests) and update. Default `placement` only where a test constructs
   a note literal by hand.
4. Do **not** touch `NoteTagEntry` — CONFIG keys stay `(over, text, occurrence)`; placement
   is not part of the tag key.

**Tests (automated):** `src/lib/model.test.ts` — `over` / `left of` / `right of` notes all
report the right `placement`, span, and text; note line spans unchanged; block/region
parsing untouched. `src/lib/svgmap.test.ts` — `left of` raw note maps to `left of`
processed note even when an `over` note with the same actor+text exists.

**Human verification:** `npx vitest run src/lib/model.test.ts src/lib/svgmap.test.ts` —
all green. `npx tsc --noEmit` clean (it covers `cypress/**` too). Open the dev app on any
diagram with notes and confirm nothing about note selection/tagging changed.

---

## Step 2 — Pure transforms: note create/edit/delete plumbing

**Goal:** `editor.ts` can create, edit (text/placement/span) sequence notes and retarget
CONFIG `noteTags` entries across edits.
**Covers:** R-01, R-02, R-04 (logic), NFR-01, NFR-02
**Depends on:** Step 1

**Agent instructions:**

1. **`addSequenceNote(code, config, opts?: { overKey?: string; afterKey?: string }): EditResult`**
   (mirror `insertMessage`):
   - Determine the note's actor: `overKey` (a participant key) if given, else first
     participant, else first implicit actor (message endpoint), else fail with
     `"Add a participant first"` (edge N10/N11).
   - Insert `    Note over <id>: New note` — placement + span are edited afterwards, the
     created line must be valid on its own (edge N4: always create with `over`).
   - Position: `afterKey` resolved to an element → insert after its `lineEnd`, **then hop
     over any immediately-following `activate <to>` / `deactivate <from>` companion lines
     of that message** (edge N9); no `afterKey` → after the last message/note; else after
     the last participant (`insertMessage`'s `'top'` logic).
   - Return `newKey` of the created note (find by `lineStart` like `insertMessage` does).
2. **`editNoteText(code, config, key, text)`**: refuse `'\n'` (N2). Rebuild the line with a
   verbose regex (capture indent, `Note`, placement keyword, id list, spacing, `:`, text)
   so only the text span changes (N1, N3, NFR-02).
3. **`setNotePlacement(code, config, key, placement)`**: refuse `left of`/`right of` when
   `over.length > 1` (N4). Rebuild only the keyword span.
4. **`setNoteSpan(code, config, key, overIds[])`**: validate every id is an actor
   (participant, or message/edge endpoint, or appears in another note's `over` — N6),
   dedupe (N13), require ≥1 (N5), keep given order. Rebuild the id-list span.
5. **Shared CONFIG retargeting** (edges N7/N8, R-04): a private helper
   `retargetNoteEntries(oldModel, newModel, config)` following `editMessageLabel`'s arrow
   retargeting exactly: match old↔new elements by `key` (index-stable), compute
   `noteOccurrence` in both models, and rewrite `noteTags` entries whose
   `(over, text, occurrence)` key changed. All three edit transforms run it.
6. Deletion needs no new transform — `deleteElement` already handles notes and prunes
   `noteTags` (R-03). Add a test only.

**Tests (automated):** extend `src/lib/editor.test.ts`:
- create: default actor, `afterKey` (incl. the `activate` companion hop), `newKey` correct;
  no actors → warning; implicit-actor diagram works.
- text edit: preserves indent/spacing/other lines byte-for-byte (assert the untouched
  prefix), refuses newlines, allows empty text, text containing `:` and `#`.
- placement edit: `over`→`left of` single-actor works; multi-actor refused.
- span edit: dedupe, unknown id refused, empty refused, implicit actor allowed, N8's
  duplicate-note occurrence case (tag follows the *edited* note, occurrence 1).
- tag retarget: a tagged note keeps its `keys` after each of the three edits; a deleted
  note drops its entry (existing `deleteElement` path).

**Human verification:** `npx vitest run src/lib/editor.test.ts` — green. Then
`node -e` snippet (or a scratch vitest "tmp" test) running `addSequenceNote` +
`editNoteText` on the repo's demo `.mmd` and printing the code — verify by eye that
untouched lines are byte-identical and the note landed after the expected message.

---

## Step 3 — UI: editable `NoteFields`, "Add Sequence Note", note deletion

**Goal:** A user can create a note from the toolbar, click it, edit text/placement/span,
and delete it — with the same look, commit flow, and gating as existing controls.
**Covers:** R-01, R-02, R-03, R-04 (end-to-end), NFR-03
**Depends on:** Steps 1–2

**Agent instructions:**

1. **`EditorPanel.tsx` `NoteFields`** — extend props with `actorIds: string[]`,
   `onEditNoteText(text: string)`, `onSetNotePlacement(placement)`,
   `onSetNoteSpan(overIds: string[])`, plus the existing `onRequestDelete`:
   - Text: `<textarea data-testid="note-text">` mirroring `StickyNoteFields` (blur-commit,
     syncs on element change). Single-line enforcement is the transform's warning — show
     `warning` as today.
   - Placement: `<select data-testid="note-placement">` with the three options; disabled
     with a tooltip when `over.length > 1` and value ≠ `over` (edge N4).
   - Span: checkbox chips (`data-testid="note-span-<id>"`) over `actorIds`, checked for
     current `over`; toggling rebuilds the ordered list (current order first, additions
     appended) and calls `onSetNoteSpan`.
   - Tags section and `DeleteButton` below (DeleteButton already exists for participants).
2. **Toolbar** (`ClientPage.tsx`, next to the "Message" button):
   `handleAddSequenceNote` — `overKey` = selected participant (if any), `afterKey` =
   selected message/note (if any); `applyEditResult(addSequenceNote(...))` selects the new
   note via `newKey`. Button: `data-testid="add-sequence-note"`, lucide
   `MessageSquareWarning` (or `StickyNote`-style equivalent) + label `Note`, title
   `Add Sequence Note`, disabled when `isVisualLocked` or no actors, hidden when
   `diagramType !== 'sequence'` (mirror the sticky-note button's gating).
3. **Delete**: `handleRequestDelete` already routes notes through `deleteElement` +
   `pendingDelete` confirmation (notes are neither component nor arrow). Only wire
   `onRequestDelete` into `NoteFields`. `describeElement` already names notes.
4. **`actorIds`**: compute in `ClientPage` from `rawModel` (participants, message/edge
   endpoints, note overs — deduped, source order) and pass down.
5. Copy check: the panel header should read distinctly from sticky notes ("Sequence
   note" vs "Sticky note").

**Tests (automated):**
- `src/components/EditorPanel.test.tsx`: rendering `NoteFields` shows the current
  text/placement/span; editing each calls the right handler; placement select disabled
  for multi-actor span; Delete button calls `onRequestDelete`.
- `src/components/ClientPage.test.tsx` (harness `editorTestHarness.ts`): clicking
  "Add Sequence Note" inserts a note line, selects it (panel shows `NoteFields`), the
  warning path fires when no actors; editing text updates `rawCode`.

**Human verification:** `npm run dev`, open a sequence diagram:
1. Toolbar → Note → a note appears and is selected; type text, blur → note label updates.
2. Switch placement to `left of`, re-span to two actors → note moves/resizes.
3. Add a tag to the note, then edit its text → tag chip survives (R-04 visible).
4. Delete → confirmation dialog → note gone; `Cmd+Z` restores it.
5. `npx vitest run` — everything green.

---

## Step 4 — Canvas: make blocks selectable

**Goal:** Clicking a block's label (the colored chip in the frame, e.g. "alt
[title]") selects the `BlockElement`; selection highlight and multi-select work.
**Covers:** R-07 (selection half), NFR-03
**Depends on:** Step 1 (parseModel context; independent of Steps 2–3 in code, ordered after
to keep slices reviewable)

**Agent instructions:**

1. **`svgmap.ts`**:
   - `zipBlocks(svg, model)`: `querySelectorAll('g[data-et="control-structure"]')` in
     document order; zip 1:1 with `model.elements.filter(kind === 'block')` in source
     order (edges B1/B2). If counts mismatch, return nulls and push a warning — never
     guess. Add `blocks` to `SvgZip` and `zipModelToSvg` (sequence branch only).
   - `elementKeyAtTarget`: after the existing participant/message/note resolution fails,
     if `target.closest('g[data-et="control-structure"]')` and the click point lies in
     the zipped block's **label box rect** (`.labelBox`, or whatever Mermaid 12.1 actually
     emits — verify against a rendered `loop` fixture first and record it in the
     selector-table comment at the top of `svgmap.ts`), return that block's key
     (edge B1). Frame-interior clicks fall through to the existing logic.
   - `buildSelectionMap`: add `case 'block'` returning `block|<blockType>|<title ?? ''>`
     (edges B3/B4/B11: grouped order matching already tolerates processed-only or
     missing blocks). Remove the "blocks … not selectable" comment lines.
   - `svgElementForKey` + the selection-highlight path in `DiagramViewer`/`styling.ts`:
     outline the block frame (reuse the existing selected-element highlight mechanism —
     find how participants/messages get their highlight and extend, don't invent).
2. **`ClientPage.tsx`**: nothing new — `handleSelect`/`handleSelectNote` already map
   processed keys to raw elements generically; verify block keys flow through
   `selectionMap` and the panel receives the raw `BlockElement`.

**Tests (automated):**
- `src/lib/svgmap.test.ts`: block signature matching raw↔processed; nested blocks zip
  outer-before-inner; duplicate titles keep order; a block removed from processed code
  doesn't break the map.
- Use the existing rendered-SVG fixture approach (`svgTestFixtures.ts`) to assert
  `elementKeyAtTarget` resolves label-box clicks to the block and frame-interior clicks to
  null (or the message underneath).

**Human verification:** `npm run dev`, open a diagram containing
`alt`/`loop` (e.g. hand-edit the source once): click the loop label → panel shows the
block (still "not editable" until Step 5); Shift-click a message + the block → both
selected. `npx vitest run` green.

---

## Step 5 — Pure transforms + UI: `BlockFields` (title, type, unwrap, delete)

**Goal:** Blocks are fully editable from the panel; delete-with-content confirms with a
cascade list.
**Covers:** R-07 (editing half), R-03 (confirmation reuse), NFR-01, NFR-02
**Depends on:** Step 4

**Agent instructions:**

1. **Transforms in `editor.ts`** (all sequence- or type-gated, `fail()` on anything else):
   - `setBlockTitle(code, config, key, title)`: refuse `'\n'`; for `rect` blocks the title
     is `rgb(r,g,b)` — accept a validated `rgb(...)` string (the UI converts hex ↔ rgb,
     edge B10). Rebuild the header line's title span only (NFR-02). Empty title → bare
     keyword line.
   - `setBlockType(code, config, key, blockType)`: allowed among
     `alt|opt|loop|par|rect` (and to/from them only; `box`/`subgraph` refused). Refuse
     with a warning if the block's span contains `else`/`and` lines (edge B5). Rebuild
     the keyword span. When converting *to* `rect`, require a `rgb(...)` title (default
     `rgb(200,150,255)` supplied by the UI, edge W11).
   - `unwrapBlock(code, config, key)`: drop the header line and the matching `end` line
     (`block.lineEnd`), drop `else`/`and` lines inside the span (edge B6), de-indent only
     lines starting with `headerIndent + 4 spaces` (edge B7). Unclosed block → drop header
     only (edge B8). Set `warning` when separator lines were removed so the UI can surface
     "N separator lines removed".
   - `deleteBlock(code, config, key, { withContent: true })`: drop the whole span;
     CONFIG cleanup mirrors `deleteElement` — collect `arrows` entries and `noteTags`
     entries for every message/note inside the span and filter them out; do **not**
     renumber occurrences of surviving entries (edge B9, same trade-off as
     `deleteElement`). Return `cascaded` = keys of contained messages/notes.
2. **`EditorPanel.tsx` `BlockFields`** (new component, props analogous to `NoteFields`):
   - Header: `${blockType} block` + title input (`data-testid="block-title"`) for
     `alt|opt|loop|par`; color picker + hex display for `rect` (mirror
     `ParticipantFields` color row).
   - Type select (`data-testid="block-type"`) among the four text types + `rect`.
   - `box` blocks: read-only description ("Box group — edit via Group into Box"),
     no title/type controls, unwrap allowed.
   - Buttons: `Unwrap` (`data-testid="block-unwrap"`, immediate, like arrow edits) and
     `Delete` (`DeleteButton` → confirmation dialog listing cascaded content, edge B12).
3. **`ClientPage.tsx`**: `handleRequestDelete` branches on `kind === 'block'` →
   `deleteBlock(..., { withContent: true })` and stages the dialog with the cascaded
   elements; new handlers `handleEditBlockTitle`, `handleSetBlockType`, `handleUnwrapBlock`
   all go through `applyEditResult`. Remove `BlockElement` from the "This element is not
   editable" fallthrough (region/config/sticky-pseudo remain).
4. Update `describeElement`'s block line if needed (it already covers blocks).

**Tests (automated):**
- `src/lib/editor.test.ts`: title edit (incl. `rect` rgb validation + round-trip), type
  conversion (allowed, `else` refused, to-`rect`), unwrap (plain, with `else`, nested
  content untouched, indentation preserved for hand-written code), delete-with-content
  (span dropped, CONFIG entries pruned, cascaded keys), unclosed block, non-sequence /
  unknown key → warnings.
- `src/components/EditorPanel.test.tsx`: `BlockFields` renders per type, calls handlers;
  `box` shows read-only controls; unwrap button fires `onUnwrapBlock`.
- `src/components/ClientPage.test.tsx`: selecting a block (harness-level) and deleting
  opens the confirm dialog with the contained messages listed.

**Human verification:** `npm run dev` on a diagram with `alt … else … end`:
rename the title (label updates on canvas), convert `alt`→`opt` (works) and convert the
`else`-bearing one (refused with warning), unwrap the `else` block (separators gone,
messages intact), delete a block with content (dialog lists messages; confirm removes
them; `Cmd+Z` restores everything). `npx vitest run` green.

---

## Step 6 — Pure transforms: `canWrapSelection`, `wrapInBlock`, `wrapInRegion`

**Goal:** The wrapping logic exists, fully validated, with the exact edge-case rules of
§3/W.
**Covers:** R-05, R-06 (logic), NFR-01, NFR-02
**Depends on:** Step 1 (model); no UI dependency

**Agent instructions:**

1. **`canWrapSelection(model, keys, mode: 'block' | 'region'): { ok: true } | { ok: false, reason: string }`**
   — the single source of truth used by both UI gating and transforms:
   - Resolve keys; all must be `message` or `note` (W4); sort by `lineStart` (W5);
     require ≥2 (parity with `groupParticipants`).
   - Span = first `lineStart` … last `lineEnd`, extended over trailing
     `activate`/`deactivate` companion lines of the last message (W3).
   - Contiguity (W1): every model element whose lines intersect the span must be selected.
     Blank lines and `%%` comments inside are fine.
   - Block mode (W2): scan the span's non-element lines with `BLOCK_OPEN_RE`,
     `BLOCK_END_RE`, `BLOCK_CONT_RE` — any hit → refuse; also require block depth at the
     line before the span equals depth at the line after (covers "inside vs. outside a
     block"). Region mode (W9/W10): refuse only on `%% @region-start`/`%% @region-end`
     lines inside the span; block lines are allowed.
   - Reasons are human-readable strings (the UI shows them verbatim).
2. **`wrapInBlock(code, config, keys, blockType, title?): EditResult`** — mirror
   `groupParticipants`'s shape:
   - Run `canWrapSelection(…, 'block')` and its region-mode guards; `fail()` on refusal.
   - Header indent = the first span line's indent; content lines get +4 spaces (blank
     lines untouched, edge W14-adjacent NFR-02 note: only span lines are touched);
     `end` at header indent. `rect` takes a `rgb(...)` title, others take free text
     (empty allowed, W12/W11).
   - Splice header + re-indented span + `end`. Return `newKey` of the created block
     (parse the new code, find the block at the header line).
3. **`wrapInRegion(code, config, keys, type, value?): EditResult`**:
   - Validate `[a-zA-Z0-9_-]+` for type and (when present) value (W8); `canWrapSelection`
     in `'region'` mode (W9/W10).
   - Insert `%% @region-start: <type>[=<value>]` before the span and `%% @region-end`
     after it, at the span's indent; **content lines are not re-indented and not
     otherwise touched** (NFR-02: a region wrap is byte-identical apart from the two new
     comment lines). `newKey` = the created `RegionElement`'s key.
4. No CONFIG changes for either transform: arrow/note entry keys are order-based and
   order is preserved (state this in a comment).

**Tests (automated):** `src/lib/editor.test.ts` new `describe('wrapInBlock')` /
`('wrapInRegion')` covering every W-row: contiguous happy path for each block type,
non-contiguous refusal (unselected message in between), blank-line-in-span allowed,
comment-in-span allowed, `else`-crossing refusal, cross-block-boundary refusal, companion
absorption, mixed-kind selection, out-of-order keys, <2 keys, region tag inside span,
region happy path (verify exact inserted lines + byte-identity of the rest), invalid
region names, `rect` color round-trip, `newKey` correctness, `undo` byte-identity (apply
then reverse-check by comparing pre-wrap code against a manual splice-out — or simply
assert the transform output minus the inserted lines equals the input).

**Human verification:** `npx vitest run src/lib/editor.test.ts` — green. Scratch-print
`wrapInBlock` output on the demo diagram and eyeball indentation and header placement.

---

## Step 7 — UI: "Wrap Selection" in `MultiElementFields`

**Goal:** With ≥2 messages/notes shift-selected, the panel offers block wrap and region
wrap, styled and behaving like "Group into Box".
**Covers:** R-05, R-06 (UI), NFR-03
**Depends on:** Steps 6 (and 3 for panel-prop plumbing conventions)

**Agent instructions:**

1. **`MultiElementFields`** (keep the existing component; add two sections):
   - New props: `diagramType: DiagramType`, `wrapCheck: { ok: boolean; reason?: string }`
     (computed in `ClientPage` from `canWrapSelection`), `onWrapInBlock(blockType, title)`,
     `onWrapInRegion(type, value)`, `regionTypes: string[]` (existing region types for the
     datalist).
   - **Wrap in Block** section (emerald-bordered, mirroring Group into Box): type select
     (`data-testid="wrap-block-type"`: alt/opt/loop/par/rect), title input
     (`data-testid="wrap-block-title"`, placeholder "Title (optional)") that becomes a
     color input (`data-testid="wrap-block-color"`, default `rgb(200,150,255)`) when
     `rect` is selected, button `data-testid="wrap-block-button"` labeled
     `Wrap in Block (N elements)`. Disabled when `!wrapCheck.ok`, with the reason shown
     in a small gray line (`data-testid="wrap-reason"`) — never hidden, so the user
     learns the contiguity rule (W1/W2).
   - **Wrap in Region** section: type input with datalist (`data-testid="wrap-region-type"`,
     default `flow`), value input (`data-testid="wrap-region-value"`), button
     `data-testid="wrap-region-button"` `Wrap in Region`. Same disabled/reason mechanics.
   - Both sections render only when `diagramType === 'sequence'` and the selection
     contains ≥2 `message`/`note` elements (NFR-03, W4). Gating on `isVisualLocked`:
     mirror the Group into Box button (it delegates safety to `applyEditResult`'s lock
     handling; do not add a divergent guard).
2. **`ClientPage.tsx`**: `handleWrapInBlock` / `handleWrapInRegion` call the transforms
   with the sorted selected keys and `applyEditResult` (which selects the new block via
   `newKey`); the `wrapCheck` is a `useMemo` over `selectedRawElements` +
   `canWrapSelection(rawModel, keys, mode)` computed for both modes.
3. After wrap, the new block is selected → `BlockFields` (Step 5) opens immediately, so
   titling the block is a one-flow action.

**Tests (automated):**
- `src/components/EditorPanel.test.tsx`: sections appear/hide by kind count and diagram
  type; disabled state + reason text for a non-contiguous `wrapCheck`; rect swaps title →
  color input; buttons call handlers with the right args.
- `src/components/ClientPage.test.tsx`: two selected messages (harness) → wrap → `rawCode`
  contains `loop`/`end` and the selection is the block; non-contiguous selection leaves
  the code unchanged.

**Human verification:** `npm run dev`: Shift-click two messages → Wrap in Loop → the frame
renders, block selected, source shows the wrapped lines indented. Then: select
non-adjacent messages → reason text shown, button disabled. Wrap a region, open the
views/filters UI and hide that flow → the messages disappear; unhide → they return.
`npx vitest run` green.

---

## Step 8 — E2E suites, docs, full audit

**Goal:** Browser-level proof of every scenario in §5, plus docs.
**Covers:** R-01 … R-07 verification, NFR-01 … NFR-03
**Depends on:** Steps 1–7

**Agent instructions:**

1. **`cypress/e2e/sequence-notes.cy.ts`** — scenarios E2E-N1…N10 (§5). Follow the
   house rules from `note-shift-select.cy.ts` / `editor.cy.ts`: fresh temp dir via
   `cy.task('createTempDiagramDir')`, seed via the file API, never committed fixtures,
   assert UI *and* file content after `[data-testid="save-indicator"]` says `Saved`.
2. **`cypress/e2e/sequence-blocks.cy.ts`** — scenarios E2E-B1…B10 (§5: block selection,
   editing, wrap-in-block, wrap-in-region and the refusal cases).
   Shift-clicks target `text.messageText` with `{ shiftKey: true }`; block label clicks
   target the label box rect (resolve coordinates via `getBoundingClientRect` like
   `note-shift-select.cy.ts` does for notes).
3. **`MANUAL_TEST_PLAN.md`**: add a "Sequence notes & blocks" section restating the human
   verifications of Steps 3/5/7 as checkboxes.
4. **`FEATURES_AND_QOL.md`**: move feature 1 from "Suggested Features" to the
   "Implemented QoL" section — one short entry, matching the existing entries' style.
   (The plan file itself stays as-is.)
5. Full audit: `npx vitest run`, `npx tsc --noEmit`, `npx cypress run` (dev server on
   `localhost:3000`). Fix fallout in *existing* specs if any behavior they asserted
   changed (expected: none — `note-shift-select.cy.ts` and `editor.cy.ts` must stay green
   unmodified).

**Tests (automated):** the two new Cypress specs; the full existing suite must stay green.

**Human verification:** `npx cypress run` — all 13 specs green. Then one manual pass of the
`MANUAL_TEST_PLAN.md` checklist section in the browser, ending with an undo/redo and a
reload on each feature to confirm persistence.

---

## 5. E2E scenario catalog (Cypress)

All scenarios start from a fresh temp diagram seeded through the API. `saved()` waits for
the auto-save indicator; `content()` re-reads the file through the API to assert source
truth. Baseline seeds:

```text
SEQ_BASE:
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    activate B
    B-->>A: Hi
    Note over A,B: greeting

SEQ_ALT:
sequenceDiagram
    participant A
    participant B
    A->>B: ping
    alt success
        B-->>A: ok
    else failure
        B-->>A: error
    end
    A->>B: done
```

### Notes (`sequence-notes.cy.ts`)

| ID | Scenario | Steps & assertions |
| --- | --- | --- |
| E2E-N1 | Create note from toolbar | Click `add-sequence-note` → note group appears, `NoteFields` visible, text `New note`; `saved()`; file contains `Note over A: New note` (default actor = first participant) |
| E2E-N2 | Create with selection context | Click `Hi` message, then toolbar Note → file has the note line directly after `Hi` (`afterKey` honored) |
| E2E-N3 | Companion hop (N9) | In `SEQ_BASE`, select `Hello`, add note → the note lands **after** `activate B`, not between; file order asserted |
| E2E-N4 | Edit text | Select note, clear `note-text`, type `Contains: colon #hash`, blur → canvas label updates; file text matches |
| E2E-N5 | Placement over → left of | Single-actor note; select `left of` → note moves left of the lifeline; file reads `Note left of A:` |
| E2E-N6 | Placement disabled for spans | Note over `A,B`: the placement select is disabled (assert `disabled` attr); code unchanged |
| E2E-N7 | Span edit | Uncheck `B`, check `A` only → file `Note over A:`; re-add `B` → `Note over A,B:` |
| E2E-N8 | Implicit actor span (N6) | Diagram with no `participant` lines, only messages: toolbar note works, span chips list the implicit ids |
| E2E-N9 | Tags follow edits (R-04) | Tag the note `k1`, edit text, reload → tag chip still shown (CONFIG entry re-keyed); also cover the duplicate-note occurrence case N8 by editing the second of two identical notes |
| E2E-N10 | Delete + undo | Select note → panel Delete → dialog names the note → confirm → gone from canvas + file; `Cmd+Z` → back. Also: select note, press `Delete` key → same dialog |

### Blocks (`sequence-blocks.cy.ts`)

| ID | Scenario | Steps & assertions |
| --- | --- | --- |
| E2E-B1 | Wrap in loop (happy path) | Shift-click `Hello` and `Hi` labels → panel shows `Wrap in Block (2 elements)`; select `loop`, type `retry`, wrap → frame renders with label `retry`; block selected (`BlockFields`); file: `loop retry` … `end` with content indented +4 |
| E2E-B2 | Wrap in rect | Same selection, type `rect` + color → file contains `rect rgb(200,150,255)`; frame tinted on canvas |
| E2E-B3 | Non-contiguous refusal (W1) | Shift-click `Hello` and `done` in `SEQ_ALT` → button disabled, `wrap-reason` mentions non-contiguous; code unchanged after attempting |
| E2E-B4 | Cross-arm refusal (W2) | Shift-click `ok` and `error` (two `alt` arms) → refused (reason shown); file unchanged |
| E2E-B5 | Wrap in region | Shift-click two messages → wrap in region `flow=auth` → file has `%% @region-start: flow=auth` before and `%% @region-end` after, content byte-identical; canvas unchanged; hide `flow=auth` via the views UI → messages hidden, empty block cleanup doesn't break the render (W7 if combined with a block) |
| E2E-B6 | Region validation (W8/W9) | Empty value with a type is allowed (bare region) but `bad value!` is refused with a warning line; wrapping across an existing `@region-end` is refused |
| E2E-B7 | Select block via label (B1) | In `SEQ_ALT`, click the `alt` label box → `BlockFields` opens; clicking inside the frame (on a message) still selects the message |
| E2E-B8 | Edit/convert/unwrap/delete block | Rename `alt`→`opt` type (has `else` → refused with warning, B5); on a plain `loop`: rename title (label updates), convert `loop`→`opt` (works), unwrap (frame gone, messages intact, indentation restored), delete-with-content on another block (dialog lists contained messages; confirm removes them; CONFIG arrows/noteTags for removed elements pruned — assert file's CONFIG) |
| E2E-B9 | Undo round trip (W14) | After wrap: `Cmd+Z` → file returns byte-identical to the seed; `Cmd+Shift+Z` → block returns |
| E2E-B10 | Persistence | Wrap a block, reload the page → frame, selection mapping, and editing all still work on the persisted file |

### Regression guards (same spec files, cheap asserts)

- Flowchart diagram: no Note button, no wrap sections (NFR-03).
- `editor.cy.ts`, `note-shift-select.cy.ts`, `canvas-shortcuts.cy.ts` run unmodified and
  green.

## 6. Traceability matrix

| Req / NFR | Implemented by | Verified by (automated) | Verified by (human) |
| --- | --- | --- | --- |
| R-01 note fields editable | Steps 1, 2, 3 | `model.test.ts`, `editor.test.ts`, `EditorPanel.test.tsx`, `ClientPage.test.tsx`, E2E-N4…N7 | Step 3 manual 1–2 |
| R-02 Add Sequence Note | Steps 2, 3 | `editor.test.ts` (create), `ClientPage.test.tsx`, E2E-N1…N3, N8 | Step 3 manual 1 |
| R-03 note deletion + confirmation | Step 3 (+ existing `deleteElement`) | `editor.test.ts` (delete path), `ClientPage.test.tsx`, E2E-N10 | Step 3 manual 4 |
| R-04 CONFIG tags follow edits | Step 2 (retarget helper) | `editor.test.ts` N7/N8 cases, E2E-N9 | Step 3 manual 3 |
| R-05 wrap in block | Steps 6, 7 | `editor.test.ts` wrap suite, `EditorPanel.test.tsx`, `ClientPage.test.tsx`, E2E-B1…B4, B9, B10 | Step 7 manual |
| R-06 wrap in region | Steps 6, 7 | same as R-05, E2E-B5, B6 | Step 7 manual (hide/unhide flow) |
| R-07 block selection & editing | Steps 4, 5 | `svgmap.test.ts`, `editor.test.ts` block suite, `EditorPanel.test.tsx`, E2E-B7, B8 | Step 5 manual |
| NFR-01 skip, never error | All transforms (`fail()` pattern) | refusal cases in every new `editor.test.ts` suite | — |
| NFR-02 byte-preserving | Steps 2, 5, 6 (verbose regexes / minimal spans) | byte-identity asserts in `editor.test.ts` | eyeball in Steps 2/6 |
| NFR-03 sequence-only / no flowchart regression | Steps 3, 7 gating | gating tests + full existing suite | Step 8 audit |

Edge-case coverage: every N1–N15, B1–B12, W1–W16 row maps to at least one automated test
listed above (rows N12, N13, B3, B11, W6, W15, W16 are covered by unit tests or documented
behavior rather than e2e).

## 7. Risks & open decisions

- **Mermaid 12.1 block DOM selectors** (`.labelBox` etc.) must be confirmed against a real
  render before coding Step 4 — `svgmap.ts`'s selector table is the precedent; record the
  confirmed selectors there. If blocks are *not* tagged `data-et="control-structure"` in
  this version, add the tag in `styling.ts` post-processing instead of loosening the zip.
- **Unwrap semantics for `else` arms** (B6) is a product call: this plan merges arms and
  removes separator lines, stated in the UI. The alternative (refuse unwrap of
  `else`-bearing blocks) is a one-line change if preferred.
- **`newKey` stability**: transforms locate created elements by line index (the
  `insertMessage` pattern); all new transforms must do the same, never by counting.
- **Occurrence renumbering** is deliberately *not* done after block delete-with-content,
  matching `deleteElement`'s existing trade-off — noted so a reviewer doesn't "fix" it.
