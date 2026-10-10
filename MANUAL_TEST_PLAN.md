# Manual Test Plan — Visual Editing

This plan verifies the in-app visual editing feature (EDITING_PLAN.md Steps 7–14) by hand,
in the browser. It is split into **independent increments**: run one increment, check off
its bullets, then **stop and confirm the behavior is what you intended** before moving to
the next one. You can re-run the whole plan any number of times; each increment starts from
the committed fixtures.

Run against `npm run dev` (http://localhost:3000) with the committed demo fixtures:

- `diagrams/editing-demo.mmd` (sequence diagram)
- `diagrams/editing-demo-flow.mmd` (flowchart diagram)

**Reset between increments** (the fixtures are committed, so this restores them exactly):

```bash
git checkout -- diagrams/editing-demo.mmd diagrams/editing-demo-flow.mmd
```

Also delete any test diagrams you created via the New Diagram dialog (they are untracked
files in `diagrams/`).

A bullet passes only if the expected result is observed exactly. The automated suites
(`npx vitest run`, `npx cypress run`) already cover the same behaviors headlessly; this plan
exists to check the parts that need human eyes (visuals, timing, feel).

---

## Increment 0 — Setup

> Stop here: both demos render cleanly before any editing is attempted.

- [ ] `npm run dev` starts; the demo directory loads; both demo diagrams appear in the Files list.
- [ ] Open `editing-demo.mmd` — it renders with no warnings (no yellow warning badge in the toolbar).
- [ ] Open `editing-demo-flow.mmd` — it renders with no warnings.

## Increment 1 — Edit mode & selection (sequence)

> Stop here: selection feels right and the panel shows the correct fields per element kind.

- [ ] The toolbar shows an Edit (pencil) toggle; clicking it adds `edit=1` to the URL and canvas elements become clickable (cursor changes to pointer).
- [ ] Clicking a participant selects it: a highlight outline appears; the panel shows Label / Color / Tags / Delete.
- [ ] Clicking a message selects it: the panel shows Label / Type / Color / Width / Dash / Delete.
- [ ] Clicking empty canvas clears the selection and hides the panel.
- [ ] Toggling Edit off removes `edit=1`, the selection, and the panel; the diagram is unchanged.

## Increment 2 — Participant editing (sequence)

> Stop here: renames, colors and tags behave and persist.

- [ ] Rename a participant's label → the actor box label updates within ~1 s.
- [ ] The rename persists after F5.
- [ ] Set a participant color (e.g. red) → a colored box group appears around it; persists after F5.
- [ ] Change the color → the box recolors; clearing the color removes the box grouping.
- [ ] Add a tag (e.g. `backend`) → it appears in the sidebar under Actors → By Key.
- [ ] Add a second tag, then remove one → the By Key list updates immediately.
- [ ] Add Participant (toolbar) → a new actor appears at the right end with a default label; rename it and send it a message.
- [ ] Delete a participant that has messages → a confirm dialog lists the messages/notes that will also be removed; cancelling changes nothing; confirming removes all of them.
- [ ] Delete a participant with no messages → removed immediately, no dialog.

## Increment 3 — Message editing (sequence)

> Stop here: every arrow style knob works and disambiguates correctly.

- [ ] Edit a message label → the label text updates on the canvas within ~1 s.
- [ ] Change Type through every operator (`->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`) → the arrowhead/line style changes each time; persists after F5.
- [ ] Set Color → the line and the arrowhead recolor (arrowhead matches the line).
- [ ] Set a color on a second arrow with the same participants → only that arrow changes (occurrence disambiguation).
- [ ] Set Width from 1 to 10 → stroke thickness visibly changes; persists after F5.
- [ ] Set Dash to dashed / dotted / solid → the line pattern changes; persists after F5.
- [ ] Combine color + width + dash on one arrow → all three apply together.
- [ ] Reset an arrow's style → it returns to default rendering.
- [ ] Add Message (toolbar) → a new message appears; with a message selected it is inserted after it; with a participant selected, that participant is the sender.
- [ ] Delete a message → it disappears; undo brings it back.

## Increment 4 — Flowchart editing

> Stop here: nodes and edges are editable with the same panel, and cascade delete keeps the diagram valid.

- [ ] Open `editing-demo-flow.mmd`; enable Edit; nodes and edges are selectable.
- [ ] Select a node → the panel shows Label / Color / Tags / Delete; rename it → the node label updates.
- [ ] Set a node color → the node fill changes immediately and after F5.
- [ ] Add tags to two nodes → By Key appears; Merged collapses them into one node on the canvas.
- [ ] Select an edge → the panel shows Label / Type / Color / Width / Dash / Delete.
- [ ] Edit an edge label; change Type (`---`, `-->`, `==>`, `-.->`, `<-->`), Color, Width, Dash → all apply to the rendered edge.
- [ ] Add a node and an edge via the toolbar.
- [ ] Delete a node that has edges → the cascade confirm lists the edges → confirming removes them; the surviving nodes keep their labels (check the `.mmd` file: surviving endpoint declarations are kept, not eaten).

## Increment 5 — New Diagram dialog

> Stop here: you can create a new diagram with a chosen file name and diagram type.

- [ ] Click **New** in the Files header → the New Diagram dialog opens.
- [ ] Enter a name (e.g. `my-test-diagram`), choose **Sequence diagram**, click Create → the file is created in the current directory, appears in the Files list, and opens with starter content (two participants and a message).
- [ ] Repeat with **Flowchart** → the new file opens with two nodes and an edge.
- [ ] The created file exists on disk (`cat diagrams/my-test-diagram.mmd`).
- [ ] Invalid names are rejected with an error message and create nothing: empty name, a name with spaces or special characters, a name that already exists in the directory.
- [ ] Cancel closes the dialog without creating anything.
- [ ] Clean up: delete the test files you created (`rm diagrams/my-test-diagram.mmd ...`).

## Increment 6 — Arrows follow the rules of merging

> Stop here: styles survive merges, Clean and hide/un-hide, in both diagram types.

- [ ] Sequence demo, two same-color actors with a styled arrow between them: By Color → Merged → the merged self-call keeps the arrow's color/width/dash.
- [ ] Switch to Clean → the internal self-call (and its style) disappears; external arrows keep their styles, re-keyed to the merged participant.
- [ ] Switch merge Off → the original actors, arrows, and styles return exactly.
- [ ] Repeat for merge By Key with tagged actors.
- [ ] Hide an actor (By Color/Key → Off) → its styled arrows disappear; un-hide → they return with styles.
- [ ] Flowchart demo: merge two tagged nodes → the edge between them becomes a self-loop on the merged node and keeps its style; Clean removes it.

## Increment 7 — Auto-save & external changes

> Stop here: saves are automatic, visible, and recover from failure.

- [ ] Make any edit → the toolbar shows "Saving…" then "Saved" within ~1 s; the `.mmd` file on disk contains the change (check with `cat`).
- [ ] Every kind of edit auto-saves: rename, color, tag, arrow style, add, delete, undo, redo.
- [ ] Edit the file externally (IDE or `echo >>`) → the viewer adopts the change within ~1 s and shows the "Reloaded from disk" notice; nothing is lost.
- [ ] Simulate a save failure (block the network or stop the server) → the indicator shows "Save failed"; the next edit retries and saves.

## Increment 8 — Undo / redo (history capped at 15)

> Stop here: undo/redo steps one edit at a time and the history is bounded.

- [ ] Make three edits → Ctrl+Z twice → the canvas reverts step by step → Ctrl+Y → reapplies.
- [ ] The toolbar Undo/Redo buttons do the same.
- [ ] Undo after auto-save → the file on disk reverts too.
- [ ] Make a new edit after undo → the redo stack is cleared (Ctrl+Y does nothing).
- [ ] Make 20 distinct edits, then press Ctrl+Z exactly 15 times → the 15 most recent edits are reverted; the 16th Ctrl+Z changes nothing (the oldest states have fallen off the 15-entry history).
- [ ] Press Ctrl+Y 15 times → all 15 reverted edits are reapplied; a 16th Ctrl+Y does nothing.
- [ ] Switch to another file and back → history is reset (undo does nothing stale).

## Increment 9 — Filters, views & regions during editing

> Stop here: editing composes with filters/views without corrupting the raw file.

- [ ] Hide a region (e.g. an edge-case flow) → enable Edit → elements inside the hidden region are not selectable; un-hide → they are.
- [ ] Edit something while a region is hidden → `diff` the file: only the edited line and the CONFIG line changed; the hidden region's lines are byte-identical.
- [ ] Save a named view while in edit mode → it works and does not disturb the current edits.
- [ ] Load a saved view → filters apply; edit mode still works.
- [ ] Merge/hide controls still work while editing; edits apply on top of the merged view without corrupting the raw file (original actor names stay in the file).

## Increment 10 — Pan / zoom / search / theme

> Stop here: the canvas context survives edits and theme switches.

- [ ] Pan and zoom in, then make an edit → zoom level and center are preserved.
- [ ] The selection highlight survives re-renders.
- [ ] Search still highlights matches while in edit mode.
- [ ] Switch to dark theme in edit mode → panel, highlight, and styled arrows remain visible and correct.

## Increment 11 — Persistence & reload

> Stop here: everything survives a reload byte-for-byte where it should.

- [ ] Make several edits of every kind → F5 → everything (labels, colors, tags, arrow styles, added/deleted elements) is exactly as left.
- [ ] The `%% CONFIG:` line remains the first line and valid JSON after all edits.
- [ ] Region tags and comments are untouched (`diff` against the pre-edit copy shows only intended changes).

## Increment 12 — Performance & scale

> Stop here: editing stays responsive on a large diagram.

- [ ] Open a ~2000-line diagram → enable Edit → select, rename, and style an arrow → each interaction completes within ~1 s; auto-save fires.
- [ ] Merge + style on the large diagram → still responsive.

## Increment 13 — Error & edge cases

> Stop here: broken input never corrupts anything and the app never crashes.

- [ ] Open a diagram of an unsupported type (e.g. a class diagram) → the Edit toggle is disabled with a tooltip; the diagram still renders.
- [ ] Break the file (unclosed `%% @region-start`, invalid mermaid) → the viewer still renders (soft-fail) with the warning badge; edits to intact elements still work; no crash.
- [ ] Empty file / diagram with a single participant → Edit works; Add Message behaves sanely.
- [ ] File with no CONFIG header → the first style/tag/color edit creates it; nothing else in the file changes.
- [ ] Rapid typing in a panel field → debounced: one save, no flicker, final value correct.
- [ ] Two browser tabs on the same file: edit in tab A → tab B adopts the change via SSE without clobbering.

## Increment 14 — Final automated gates

> Stop here: everything is green before you call it done.

- [ ] `npx vitest run` — all green.
- [ ] `npx tsc --noEmit` — green.
- [ ] `npx next lint` — green.
- [ ] `npx cypress run` — all green (requires `npm run dev` running).
