# Mermaid Sequence & Flowchart Viewer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![Mermaid.js](https://img.shields.io/badge/Mermaid-v12-ff3670.svg)](https://mermaid.js.org/)
[![Tests](https://img.shields.io/badge/Tests-1100%2B%20Passing-brightgreen.svg)](https://vitest.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

> **A local-first, bidirectional WYSIWYG editor and architectural viewer for massive Mermaid diagrams and Markdown documents with embedded diagrams (2,000+ lines, 50+ flows) with hierarchical layers, dynamic domain merging, zero syntax breakage, and interactive delighters.**

---

## Table of Contents

- [The Gap: Why This Project Exists](#-the-gap-why-this-project-exists)
- [Quick Start & Build](#-quick-start--build)
- [Solving The Diagram Maintainability Gap](#-solving-the-diagram-maintainability-gap)
  - [The Problem: Unmaintainable Monoliths](#the-problem-unmaintainable-monolithic-diagrams)
  - [The Solution: Layers & Dynamic Domain Merging](#the-solution-layered-views--dynamic-domain-merging)
  - [Zero-Config Structural Tags (Box & Subgraph Abstraction)](#zero-config-structural-tags-box--subgraph-abstraction)
- [WYSIWYG Canvas & Document Editing (Valid Mermaid Guarantee)](#-wysiwyg-canvas--document-editing-valid-mermaid-guarantee)
  - [Direct Canvas Manipulations](#1-direct-canvas-manipulation)
  - [Context-Sensitive Properties Panel](#2-context-sensitive-properties-panel)
  - [Safety & Reliability Safeguards](#3-safety--reliability-safeguards)
  - [Interactive Markdown Document Editor & Embedded Previews](#4-interactive-markdown-document-editor--embedded-previews)
- [Supported Diagram Types](#-supported-diagram-types)
  - [Sequence Diagrams](#1-sequence-diagrams-sequencediagram)
  - [Flowcharts](#2-flowcharts-flowchart)
- [Interactive Outliers & Visual Delighters](#-interactive-outliers--visual-delighters)
  - [Draggable & Resizable Markdown Sticky Notes](#1-draggable--resizable-markdown-sticky-notes)
  - [Sequential Animated Arrows & Motion Presets](#2-sequential-animated-arrows--motion-presets)
  - [Global Default Arrow Styling](#3-global-default-arrow-styling)
  - [Monaco Split-View & Live Line Diffing](#4-monaco-split-view--live-line-diffing)
  - [Resizable Workspace Sidebar](#5-resizable-workspace-sidebar)
  - [One-Click Productivity Knobs](#6-one-click-productivity-knobs)
  - [Standalone SVG Export](#7-standalone-svg-export)
- [Authoring Syntax & Configuration Guide](#-authoring-syntax--configuration-guide)
  - [Hierarchical Regions (`%% @region-start`)](#1-hierarchical-regions---region-start)
  - [Zero-Config Structural Subgraphs & Boxes](#2-zero-config-structural-subgraphs--boxes)
  - [Configuration Header (`%% CONFIG:`)](#3-configuration-header---config)
  - [LLM Context Guidelines](#4-llm-context-guidelines-diagram-guidelinesmd)
- [Saved Views & URL State Persistence](#-saved-views--url-state-persistence)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Testing & Quality Assurance](#-testing--quality-assurance)

---

## 🧭 The Gap: Why This Project Exists

Modern distributed systems and microservice architectures are notoriously difficult to document and maintain. Teams are routinely trapped between two flawed extremes:

| Approach | What Works | The Critical Failure Mode |
|---|---|---|
| **Text-as-Code (Mermaid CLI, PlantUML)** | Version-controlled in Git, diffable in PRs, co-located with code, easy for LLMs to generate. | **Unmaintainable at scale.** Monolithic diagrams turn into 2,000-line walls of text. Tweaking arrow endpoints, reordering execution steps, or renaming actors requires tedious manual regex editing. Visualizing edge cases clutters the happy path. |
| **Visual Canvas Tools (Lucidchart, Miro, Draw.io)** | Intuitive drag-and-drop, quick whiteboard iteration, easy stakeholder presentation. | **Broken Git workflows & developer silos.** Proprietary binaries or opaque XML blobs break git diffs, drift instantly from codebase realities, cannot be read or refactored by LLMs, and introduce vendor lock-in. |
| **Online Web Previews (mermaid.live)** | Instant visual preview of raw syntax. | **Pure read-only/scratchpad.** No direct canvas manipulation, no file-system watching, no domain merging, and no way to isolate flows or edge cases on massive architecture diagrams. |

### The Solution: A Bidirectional Bridge
This project fills the gap between **raw text diagrams** and **visual whiteboard canvas tools**:
1. **Single Source of Truth**: The `.mmd` plain-text files and `.md` markdown documents on your local disk remain the single source of truth. Every canvas click, drag, recolor, and retarget directly compiles into **clean, valid, idiomatic Mermaid syntax**.
2. **True WYSIWYG Manipulation**: Click, drag, reorder, connect lifelines, recolor, and retarget arrow endpoints directly on the rendered SVG canvas.
3. **Architectural Maintainability at Enterprise Scale**: Hierarchical layers (`%% @region-start`), zero-config structural subgraphs and boxes, dynamic microservice merging (collapsing 10 microservices into a single domain block on the fly), and non-destructive saved views.
4. **Interactive Delighters**: Draggable and resizable Markdown sticky notes with live task checklists, 9 animated arrow motion styles with chronological sequencing, bi-directional Monaco editor split-view with live line-diff highlighting, WYSIWYG markdown document editing with live diagram previews, and standalone SVG export.

---

## 🚀 Quick Start & Build

The viewer runs locally on your machine, watching your local repository's diagrams directory via `chokidar` and Server-Sent Events (SSE). It seamlessly supports both standalone `.mmd` diagrams and `.md` markdown files containing embedded diagrams.

### Prerequisites
- Node.js 18+ (tested on Node 18, 20, 22)
- npm 9+

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-org/mermaid-sequence-viewer.git
cd mermaid-sequence-viewer
npm install
```

### 2. Development Mode
Run the development server against the bundled demo diagrams or your own local directory:

```bash
# Run using the default ./diagrams folder
npm run dev

# Run and point to a specific directory on your machine
npm run dev -- /absolute/path/to/your/system/diagrams
```
> **Tip:** You can also pass the directory path directly: `node server.js /path/to/diagrams`. Once launched, open [http://localhost:3000](http://localhost:3000) in your browser. You can switch directories dynamically anytime in the UI sidebar!

### 3. Production Build & Run
To compile and run an optimized production build:
```bash
# Build the Next.js application
npm run build

# Start the production server
npm run start
```

### 4. Running Verification & Test Suites
The project enforces high code quality with full automated testing suites:
```bash
# Run unit and integration tests (Vitest) - 1,100+ tests across 36 suites
npx vitest run

# Run linter
npm run lint

# Run type checker
npx tsc --noEmit

# Run headless end-to-end test suite (11 Cypress specs covering canvas interactions, persistence, sticky notes, and WYSIWYG markdown)
npx cypress run
```

---

## 🏗️ Solving The Diagram Maintainability Gap

Large architecture diagrams suffer from **diagram bloat**: when you model real-world production systems, every microservice, edge case, retry policy, and async queue gets crammed into a single unreadable visual tangle.

### The Problem: Unmaintainable Monolithic Diagrams
When an architecture diagram includes every edge case and every microservice participant, stakeholders cannot follow the core business transaction:

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant GW as API Gateway
    participant Auth as Auth Svc
    participant Token as Token Store
    participant Order as Order Svc
    participant Inv as Inventory Svc
    participant DB as Main DB
    participant Pay as Payment Gateway
    participant Audit as Audit Logger

    C->>GW: POST /checkout
    GW->>Auth: Validate Token
    Auth->>Token: Lookup Token
    Token-->>Auth: Expired
    Auth-->>GW: 401 Unauthorized
    GW-->>C: Prompt Re-login
    Note over C,Audit: Edge case clutter disrupts the core transaction flow!
    Auth->>Token: Validate Fresh Token
    Token-->>Auth: OK
    Auth-->>GW: User Verified
    GW->>Order: Create Order
    Order->>Audit: Log Checkout Attempt
    Order->>Inv: Check Stock
    Inv->>DB: Query Stock Count
    DB-->>Inv: Out of Stock
    Inv-->>Order: 422 Stock Unavailable
    Order-->>GW: Error
    GW-->>C: Display "Out of Stock"
    Note over Order,Pay: And so on for 2,000+ lines...
```

### The Solution: Layered Views & Dynamic Domain Merging
With this viewer, diagram authors tag regions and assign domain keys (`backend`, `storage`, `auth`). The UI then allows you to:
1. **Toggle Layers**: Hide edge cases or notes with a single click, viewing only the clean happy path.
2. **Merge by Domain**: Collapse individual services (`Auth Svc` + `Token Store` &rarr; `Merged Auth Zone`) dynamically without mutating the underlying file.
3. **Clean Mode**: Automatically eliminate internal chatter between merged services, retaining only external domain boundaries.

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant GW as API Gateway
    box #e0f2fe Auth Domain
    participant AuthZone as Merged Auth Services
    end
    box #fef3c7 Order Domain
    participant OrderZone as Merged Order & Inventory
    end

    C->>GW: POST /checkout
    GW->>AuthZone: Verify Credentials
    AuthZone-->>GW: 200 Authorized
    GW->>OrderZone: Execute Order (Happy Path)
    OrderZone-->>GW: 201 Order Confirmed
    GW-->>C: Order Summary & Tracking
```

### Zero-Config Structural Tags (Box & Subgraph Abstraction)
Diagram grouping blocks automatically tag all participants, nodes, and messages inside them without requiring any `%% CONFIG:` header entries:
- **Sequence Diagrams**: Group participants using `box <title>` (e.g., `box Payment Service`).
- **Flowcharts**: Group nodes using `subgraph <title>` or `subgraph <id> [<title>]`.
- **Automatic Slugification**: The container's title is automatically slugified into a kebab-case tag key (e.g., `box Payment Service` &rarr; `payment-service`).
- **3-Tier Level of Abstraction**:
  - **On**: Full internal subsystem view showing all participants and internal messages.
  - **Merged**: Collapses all actors/nodes within the container into a **single consolidated actor/node** labeled with the container title. Internal interactions become self-calls.
  - **Clean**: Eliminates internal self-calls completely, displaying only external boundary messages entering or leaving the subsystem (the clean executive view).
  - **Off**: Completely hides the container, its members, and all internal messages (emptied container boxes are cleanly pruned).
- **Shareable Perspectives**: Works seamlessly with Saved Views and URL query parameters (`?merge_key=payment-service`, `?merge_clean_key=payment-service`, `?hide_key=payment-service`).

---

## 🎨 WYSIWYG Canvas & Document Editing (Valid Mermaid Guarantee)

Unlike whiteboard tools that generate arbitrary JSON or proprietary canvas objects, every edit performed on the canvas is processed by an AST/text parser that **rewrites the `.mmd` or `.md` file in place while strictly preserving formatting, comments, and structure**.

### 1. Direct Canvas Manipulation
- **Lifeline Drag-to-Connect**: Hover over any participant's lifeline to reveal an interactive drag handle with an enlarged grab target. Click and drag across to another lifeline to insert a message. A horizontal green slot indicator visualizes the exact insertion point.
- **Self-Pointing Loops**: Drag from an actor's lifeline handle and drop back onto the same actor to immediately create a self-calling message (`Client->>Client: validate`).
- **Endpoint Retargeting**: Click any existing message to expose its origin and recipient handles. Drag the arrowhead (`to`) onto another participant to retarget the recipient, or drag the tail (`from`) to change the sender.
- **Chronological Vertical Reordering**: Drag a message vertically up or down through the diagram to shift its chronological execution order among other steps.
- **Horizontal Participant Reordering**: Drag participant header boxes left or right to reorder service columns on the canvas.
- **Flowchart Node & Edge Dragging**: In flowcharts, drag from node to node to spawn connections, or drag nodes to reorder them along the layout flow axis (`TD` or `LR`).
- **Flowchart Chained Edge Editing**: Multi-hop edge declarations (`A --> B --> C --> D`) are fully parsed into distinct, selectable nodes and links. Editing any node, edge label, arrow style, or endpoint in a chain updates that link without breaking or corrupting the rest of the chain.
- **Precision Hit Paths**: Flowchart edges feature invisible, widened hit paths and hover affordances so even 1px thin or dashed lines can be selected accurately on the first click.
- **Canvas Keyboard Shortcuts**: `Delete` / `Backspace` deletes the selected element (the same action as the panel's Delete button, including the cascade confirmation for notes), `Escape` clears the canvas selection or cancels an in-progress drag, and `Cmd/Ctrl+Shift+Z` redoes an undone edit (next to `Ctrl+Z` / `Ctrl+Y`). The shortcuts stay inert while typing in a text field.
- **Double-Click Inline Label Editing**: Double-click any participant box, flowchart node, or message/edge label directly on the canvas to edit it in place — a small floating input opens over the element (sized to its on-screen text, so it stays aligned at any zoom). `Enter` or clicking away commits; `Escape` cancels. The edit runs through the same pipeline as the properties panel: the `.mmd` file is rewritten, the change joins the undo/redo stack, and it auto-saves.

### 2. Context-Sensitive Properties Panel
Clicking any element on the canvas opens the context-sensitive side panel:
- **Participants / Actors**:
  - Toggle representation between standard box (`participant`), stick-figure (`actor`), database cylinder (`database`), and message queue (`queue`).
  - Edit display labels and aliases.
  - Assign domain tags (`keys`) that feed the sidebar filtering controls.
  - Set custom accent colors and wrap multi-service clusters into `box` blocks.
- **Messages / Edges**:
  - Edit message labels in place with **arrow color and style preservation** (styles, tags, and animations are safely re-keyed in `%% CONFIG:` when labels change).
  - Cycle operator types through the full syntax catalog (`->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--))`).
  - Configure stroke color, stroke width (1–10px), and line pattern (solid, dashed, dotted).
  - Lifeline activation control: *"Activate receiver (+)"* and *"Deactivate sender (-)"*.
  - Message tag inheritance: Toggle **Inherit service tags** (`keyMode: 'merged'` vs `'clean'`).
- **Global Default Arrow Style**:
  - When no element is selected, configure a diagram-wide fallback stroke color and stroke width (1–10px). All arrows and edges without per-arrow overrides automatically inherit this style.
- **Notes**:
  - Assign domain tags (`keys`) that feed the sidebar filtering controls; a note is hidden when all its tags are set to **Off** in *By Key*. Shift+click multi-selects notes to tag them in bulk.

### 3. Safety & Reliability Safeguards
- **Transient Syntax Error Resilience (Last-Good Render)**: Live edits that temporarily break Mermaid syntax keep the last valid diagram rendered on screen with an unobtrusive syntax error alert chip rather than crashing or throwing unhandled Mermaid DOM errors.
- **Two-Phase Cascade Deletion**: Deleting an actor or flowchart node detects all dependent messages or edges. A cascade confirmation modal details exactly what will be removed, ensuring no dangling references or broken syntax strings are left behind.
- **Bounded Undo / Redo**: Full `Ctrl+Z` / `Ctrl+Y` / `Cmd+Shift+Z` history stack capped at 15 edits. Reverting changes updates both the rendered SVG and the on-disk `.mmd` file.
- **Serialized Disk Persistence (`serialQueue`)**: All write-through saves pass through an asynchronous serialization queue to prevent race conditions and disk write interleaving.
- **Debounced Auto-Save & External Live Sync**: Edits auto-save to disk within 1 second. Edits made in external IDEs are detected via `chokidar` and hot-reloaded over SSE without wiping in-flight filter configurations.

### 4. Interactive Markdown Document Editor & Embedded Previews
The viewer provides native support for `.md` markdown files containing embedded ` ```mermaid ` code blocks, serving as a unified documentation and diagram workspace:

- **Dual-Mode Document Editing**:
  - **WYSIWYG Preview Mode (Default)**: Renders markdown prose (headings, paragraphs, blockquotes, lists, tables) as clean, readable typography. Click any prose block to open an inline, auto-sizing textarea scoped to that block's exact source range. Edits are applied using surgical, offset-based text splices and join the document undo/redo stack (`Ctrl+Z` / `Ctrl+Y`).
  - **Edit Mode**: Seamlessly switch to the embedded Monaco editor for raw Markdown editing with full syntax highlighting.
- **Live Embedded Diagram Rendering**:
  - Embedded ` ```mermaid ` fences render as interactive SVGs directly within the document flow.
  - Soft-fail handling: malformed or unclosed code fences display a helpful warning note rather than crashing the page or corrupting document layout.
- **Per-Diagram View & Tag Toggles in Markdown**:
  - Each embedded diagram block features interactive overlay controls: a **View selector dropdown** (cycling saved views) and **By Key tag toggle chips** (On/Off).
  - Preprocesses and filters the diagram in-memory without modifying the document file.
  - URL synchronization: Per-block selections are encoded into query parameters (`?mdview.0=Happy+Path&mdhide.0=cache`), making customized document views directly shareable and reload-persistent.
- **Click-to-Edit Diagram Bridge**:
  - Clicking any embedded diagram in the markdown preview opens it immediately in the visual diagram editor (`?diagram=<i>`), letting you drag lifelines, adjust styles, and configure views.
- **Targeted Block Saving & Post-Write Verification**:
  - Updating a diagram's saved view or layout inside a markdown document updates only that specific target fence on disk, leaving adjacent markdown prose untouched.
  - Post-write verification confirms the markdown file matches and all embedded diagrams remain extractable and syntactically valid.

---

## 📐 Supported Diagram Types

The editor provides full first-class support for the two most critical architectural diagram standards:

### 1. Sequence Diagrams (`sequenceDiagram`)
Designed for chronological communication flows, distributed consensus, protocol handshakes, and microservice transactions:
- **Syntax Features**: `participant`, `actor`, `database`, `queue`, `box [color] ... end`, `rect rgb(...) ... end`, `autonumber`, `Note over ...`, lifeline activation (`+`/`-`).
- **Canvas Interactions**: Lifeline-to-lifeline message dragging with enlarged grab targets, self-pointing loops, arrowhead/tail endpoint retargeting, message vertical slot reordering, participant column shifting, and one-click step numbering toggle.

### 2. Flowcharts (`flowchart`)
Designed for pipeline architectures, decision trees, state machines, and system dependency topologies:
- **Syntax Features**: `flowchart TD`, `flowchart LR`, `flowchart BT`, `flowchart RL`.
- **Node Shapes Supported**:
  - Rectangle: `[Standard Box]`
  - Rounded Rectangle: `(Rounded Box)`
  - Circle: `((Circle / Start-End))`
  - Rhombus / Decision: `{Condition / Decision}`
  - Database Cylinder: `[(Database / Persistent Storage)]`
  - Asymmetric / Flag: `>Asymmetric Banner]`
- **Edge Types Supported**:
  - Normal arrow: `-->`
  - Open link: `---`
  - Thick link: `==>`
  - Dotted link: `-.->`
  - Multi-directional / Bidirectional: `<-->`
- **Canvas Interactions**: Node-to-node edge drawing, node reordering along layout axis, chained edge editing (`A --> B --> C`), precision edge hit paths, and one-click orientation toggle (`TD` &harr; `LR`).

---

## ✨ Interactive Outliers & Visual Delighters

This project includes a collection of unique, high-craft features tailored specifically for architectural review and system design sessions:

### 1. Draggable & Resizable Markdown Sticky Notes
Add sticky notes directly to the diagram canvas to document architectural decisions, highlight open questions, or track review feedback during team syncs:
- **Canvas Anchored**: Sticky notes live on an overlay layer that scales and pans synchronously with the diagram canvas.
- **Smooth Corner Resizing**: Drag the bottom-right corner resize handle (`nwse-resize`) to resize cards to any dimensions. Typography automatically scales proportionally with card size. Dimensions persist under `notes[].width` and `notes[].height` in `%% CONFIG:`.
- **6 Pastel Colors**: Choose between Yellow (`amber`), Green (`emerald`), Blue (`sky`), Pink (`rose`), Orange (`orange`), and Purple (`purple`).
- **Rich Markdown Support**: Double-click to type formatted text supporting `**bold**`, `*italic*`, and inline `` `code` ``.
- **Interactive Task Checklists**: Supports `- [ ]` and `- [x]` syntax with live clickable checkboxes directly on the note!
- **Selectable & Taggable**: Click a card to select it — the properties panel shows its text, color and tags. Shift+click to multi-select: notes appear under **Tags by Element** just like actors and messages, and can be tagged as a group.
- **Filterable by Key**: Notes carry their own tags (persisted under `notes[].keys` in the `%% CONFIG:` header). Set a key to **Off** in the sidebar's By Key filter to hide the note; **On** brings it back (SVG export respects the filter too).
- **Persistent & Non-Destructive**: Notes persist in the `.mmd` file's `%% CONFIG:` JSON header so they survive page reloads and git commits.
- **Toolbar Toggle**: Show or hide all sticky notes with a single click (`Notes (N)` button).

### 2. Sequential Animated Arrows & Motion Presets
Bring static sequence diagrams to life by visualizing message velocity, packet transit, and network failures with animated SVG motion paths:
- **9 Handcrafted Motion Presets**:
  1. **Stream** (`flow`): Continuous fluid glow tracer representing standard async streams or event loops.
  2. **Glowing Orb** (`pulse`): High-energy glowing packet traveling along the message path.
  3. **Cyber Glow** (`cyber`): High-velocity neon particle trail for high-throughput RPCs.
  4. **Broken Sender** (`broken-sender`): HTTP 500 panic glitch with alarm pulsation at the origin lifeline.
  5. **Broken Network** (`broken-network`): Severed gap in transit simulating network drops, timeouts, or partition events.
  6. **Broken Receiver** (`broken-receiver`): Target barrier impact with shockwave burst indicating 4xx/5xx rejection or target crash.
  7. **Stutter** (`stutter`): Hesitant packet progression modeling jittery or congested links.
  8. **Ricochet** (`ricochet`): Bouncing tracer reflecting immediate rejection or boundary redirect.
  9. **Hesitate** (`hesitate`): Long dwell before sudden transit modeling high-latency or slow-responding downstreams.
- **Sequential Execution Timing**: Animated arrows in sequence diagrams trigger sequentially in chronological order down the diagram flow, accurately visualizing message transit order in distributed architectures.
- **10-Color Palette**: 5 positive hues (Emerald, Teal, Ocean, Indigo, Mint) and 5 error hues (Amber, Flame, Rose, Crimson, Ruby).
- **Convert Diagram**: A one-click button in the bottom motion bar that deterministically converts all diagram arrows into animated motion arrows.

### 3. Global Default Arrow Styling
Set a diagram-wide fallback stroke color and width (1–10px) in the Properties panel (`CONFIG.defaultArrowStyle`):
- Accessible when no element is selected under *"All arrows (default style)"*.
- Applies to all sequence arrows and flowchart edges without individual overrides.
- New arrows inherit the global default automatically; per-arrow styles override field-by-field.

### 4. Monaco Split-View & Live Line Diffing
For developers who prefer viewing code alongside the canvas, toggle the **Split View** (`Columns` icon in toolbar):
- **Embedded Monaco Editor**: Full VS Code-grade editor with syntax highlighting, line numbers, and search.
- **Live Line Diff Highlight**: When you perform a visual edit on the canvas (e.g., retargeting a message or changing an arrow style), the affected lines in the Monaco editor immediately light up with green diff gutter decorations (`diff-gutter-changed`) and background tint (`diff-line-changed`) for 5 seconds.
- **Mutual Edit Mode Locking**: Protects state by cleanly separating Visual Mode and Code Mode, with automatic focus switching.
- **Resilient Error Toast**: Hand-editing invalid Mermaid syntax displays an inline error alert while safely keeping the last valid diagram rendered on screen.

### 5. Resizable Workspace Sidebar
Drag the vertical divider on the left edge of the right sidebar to dynamically adjust the ratio between the diagram canvas and properties/source panels:
- Smooth window-level drag tracking that stays responsive even when dragging over the Monaco editor.
- Width is clamped safely (minimum 240px, keeping at least 320px for the diagram canvas).
- Independently persists widths for standard single-tab and split views in `localStorage` (`mermaid_sidebar_width` / `mermaid_sidebar_split_width`).

### 6. One-Click Productivity Knobs
- **Autonumbering Toggle** (`ListOrdered` icon): Instantly toggles `autonumber` on and off in sequence diagrams without manually modifying the header.
- **Orientation Switcher** (`ArrowDownUp` icon): Instantly toggles flowchart layout between vertical (`TD`) and horizontal (`LR`).
- **Copy Mermaid Code** (`Copy` icon): Copies the current, sanitized Mermaid code directly to your clipboard with instant checkmark feedback.
- **Search & Filter**: Search query highlights matching participants, node IDs, and message labels directly on the rendered SVG, auto-pans the canvas to the first match, and offers prev/next match navigation (with wrap-around and a `n/total` counter) in the zoom pill.
- **Zoom Controls & Fit to Screen**: A floating bottom-left canvas pill zooms in/out in absolute 50% steps (clamped to 20%–800%) with a live zoom-level readout, and **Fit to Screen** scales the whole diagram into the viewport (never zooming in past 100%). Mouse-wheel zoom and drag panning keep working as before.
- **Dark / Light Theme**: Seamlessly maps Mermaid rendering between clean high-contrast dark mode and crisp print-ready light mode.

### 7. Standalone SVG Export
Click **Export SVG** in the toolbar to export the current diagram:
- Packaged with full XML namespaces (`xmlns="http://www.w3.org/2000/svg"`, `xmlns:xlink="http://www.w3.org/1999/xlink"`).
- Injects standalone XML declaration (`<?xml version="1.0" standalone="no"?>`).
- Preserves all custom line widths, dash patterns, animations, and element colors.
- Embeds canvas sticky notes with rich markdown formatting and checklists for complete visual parity.
- Ready for zero-distortion inclusion in technical wikis, GitHub READMEs, architecture reviews, and keynote presentations.

---

## 📝 Authoring Syntax & Configuration Guide

### 1. Hierarchical Regions (`%% @region-start`)
Wrap flows, edge cases, and optional subsystems in custom comments. The pre-processor conditionally strips inactive regions and safely cleans up dangling syntax (like orphaned `alt/end` blocks or dangling connectors).

```mermaid
sequenceDiagram
%% @region-start: flow=user-registration
C->>GW: POST /api/register
GW->>Auth: Validate Credentials

%% @region-start: edge-case=duplicate-email
Auth-->>GW: Error 409: Duplicate Email
GW-->>C: Display "Email already in use"
%% @region-end

%% @region-start: note
Note over Auth: bcrypt hashing with cost factor 12
%% @region-end
%% @region-end
```

#### Pre-processor Safety Rules
- **Nesting**: Regions can be arbitrarily nested (e.g., an edge case or note inside a flow).
- **Participant Scope**: Keep shared participants outside regions. Flow-specific participants defined inside a region disappear cleanly when that region is toggled off.
- **Soft-Fail Parsing**: Unmatched or malformed region tags trigger a soft-fail warning toast without crashing the viewer or corrupting the canvas.

### 2. Zero-Config Structural Subgraphs & Boxes
Grouping blocks implicitly tag all participants and messages within them without requiring any `%% CONFIG:` entries:
- **Sequence diagrams**: Use `box <title>` around participants.
- **Flowcharts**: Use `subgraph <title>` or `subgraph <id> [<title>]`.
- **Slugified Keys**: The container title converts to a kebab-case slug (`box Payment Gateway` &rarr; `payment-gateway`).
- **Dynamic Collapse**: Setting the key to **Merged** in the By Key filter collapses the group into a single actor/node; **Clean** removes internal self-calls leaving only boundary flows; **Off** removes the group and its contents.

### 3. Configuration Header (`%% CONFIG:`)
The first line of any `.mmd` file can store non-destructive metadata. This header is managed automatically by the UI:

```json
%% CONFIG: {"version":1,"views":[{"name":"Happy Path","hiddenPaths":["flow=login/edge-case"]}],"actors":{"Auth":{"color":"red","keys":["backend"]}},"arrows":[{"from":"C","to":"GW","color":"#00ff9d","animation":"pulse"}],"defaultArrowStyle":{"color":"#94a3b8","width":2},"notes":[{"id":"note_1","x":100,"y":50,"width":160,"height":120,"text":"Review timeout threshold","color":"yellow"}]}
```

#### JSON Schema Reference
```typescript
interface DiagramConfig {
  version: number;
  views?: SavedView[];
  actors?: Record<string, ActorMetadata>;
  arrows?: ArrowStyle[];
  defaultArrowStyle?: ArrowStyleDefaults;
  noteTags?: NoteTagEntry[];
  notes?: StickyNote[];
}

interface ActorMetadata {
  color?: string;     // Hex or CSS color
  keys?: string[];    // Domain tags feeding "By Key" filter
}

interface ArrowStyleDefaults {
  color?: string;     // Fallback stroke color for all arrows
  width?: number;     // Fallback stroke width (1–10)
}

interface ArrowStyle {
  from: string;
  to: string;
  label?: string;
  occurrence?: number;
  color?: string;
  width?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  animation?: ArrowAnimationType;
  keys?: string[];
  keyMode?: 'merged' | 'clean';
}

type ArrowAnimationType =
  | 'none'
  | 'flow'
  | 'pulse'
  | 'cyber'
  | 'broken-sender'
  | 'broken-network'
  | 'broken-receiver'
  | 'stutter'
  | 'ricochet'
  | 'hesitate';

interface NoteTagEntry {
  over: string[];     // Participant IDs spanned by the note
  text: string;       // Note text identifier
  occurrence?: number;
  keys?: string[];    // Tags for hiding sequence notes
}

interface StickyNote {
  id: string;
  x: number;
  y: number;
  width?: number;     // Custom card width in pixels
  height?: number;    // Custom card height in pixels
  text: string;
  color?: 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple';
  keys?: string[];    // The note's own tags (hide keys)
}
```

### 4. LLM Context Guidelines (`diagram-guidelines.md`)
This repository includes a dedicated instruction manual: [`diagram-guidelines.md`](./diagram-guidelines.md).
- **Purpose**: Feed this file into LLM coding assistants (Claude, Gemini, ChatGPT) as system instructions or skill context.
- **Outcome**: The LLM will automatically generate diagrams formatted with valid `%% @region-start` boundaries, kebab-case flow naming, and valid `rect` groupings that render out of the box with this viewer.

---

## 🔗 Saved Views & URL State Persistence

Collaboration in architectural design requires sharing exact perspectives:
- **Saved Views**: Define named perspectives (e.g., *"Core Happy Path"*, *"Order Processing Focus"*, *"Security Audit"*). Saved views persist to the `.mmd` header and can be switched via the sidebar.
- **URL Synchronization**: Every filter toggle, active flow, search query, theme selection, and per-diagram markdown state is synchronized to the browser URL:
  ```
  http://localhost:3000/?file=complex.mmd&theme=dark&q=Auth&edit=1&merge_clean_key=payment-service
  ```
  For markdown documents with embedded diagrams:
  ```
  http://localhost:3000/?file=architecture.md&mdview.0=Happy+Path&mdhide.1=deprecated-api
  ```
- Send the URL to teammates; when they open it, their viewer loads the exact diagram, search term, and view configuration instantly.

---

## 🏛️ Architecture & Tech Stack

```
mermaid-sequence-viewer/
├── server.js                     # Custom Node.js HTTP server + CLI directory argument resolver
├── src/
│   ├── app/                      # Next.js App Router (pages & SSE event streams)
│   │   ├── api/events/route.ts   # Chokidar file watcher & Server-Sent Events (SSE)
│   │   ├── api/file/[filename]/  # Read & debounced write-through auto-save endpoint
│   │   ├── api/files/route.ts    # Directory indexer & file listing (.mmd and .md)
│   │   └── api/markdown/save/    # Targeted markdown block saving & verification
│   ├── components/               # React client components
│   │   ├── ClientPage.tsx        # Top-level coordinator: state, auto-save, undo/redo
│   │   ├── DiagramViewer.tsx     # Canvas renderer, SVG zoom/pan, lifeline drag handles
│   │   ├── EditorPanel.tsx       # WYSIWYG element properties panel & cascade deletion
│   │   ├── MarkdownEditor.tsx    # Dual-mode Markdown editor (WYSIWYG preview & Monaco edit)
│   │   ├── WYSIWYGEditor.tsx     # Interactive block-based document editing surface
│   │   ├── WYSIWYGBlock.tsx      # Inline auto-sizing block editor for markdown prose
│   │   ├── MermaidBlockPreview   # Live embedded diagram preview with view/tag overlays
│   │   ├── SourceCodePanel.tsx   # Monaco editor split-view & live line-diff highlighter
│   │   ├── StickyNote.tsx        # Draggable & resizable canvas sticky note with markdown
│   │   ├── AnimatedArrowSelector # Motion style selector & live SVG preview generator
│   │   └── BottomAnimatedArrowBar# Slide-up footer toolbar for animations & conversion
│   └── lib/                      # Core AST, preprocessing, and styling engine
│       ├── editor.ts             # Deterministic text transforms & Mermaid code modifier
│       ├── model.ts              # Abstract diagram model & element extractor
│       ├── preprocessor.ts       # Region stripper, syntax cleanup & actor merging
│       ├── styling.ts            # SVG post-processor, arrow colors, dash & motion paths
│       ├── svgmap.ts             # SVG DOM to model element coordinate mapper
│       ├── subgraphTags.ts       # Zero-config box & subgraph title slugification
│       ├── markdownBlocks.ts     # Markdown AST block parser & surgical text splices
│       ├── markdownSave.ts       # Markdown embedded diagram block updater & verifier
│       ├── diagramView.ts        # Diagram view state resolution & URL encoding helpers
│       ├── serialQueue.ts        # Serialized disk write queue preventing write races
│       ├── fileStore.ts          # Atomic file read, write, and directory utilities
│       └── views.ts              # %% CONFIG: parser, serializer & sticky note state
├── diagrams/                     # Bundled example diagrams & fixtures
└── diagram-guidelines.md         # Context file for LLM diagram generation
```

---

## 🧪 Testing & Quality Assurance

The codebase is built with strict Test-Driven Development (TDD) principles to ensure zero diagram corruption:

```bash
# Execute Vitest test suite
npx vitest run
```

### Verified Test Coverage Highlights (1,100+ Tests across 36 Suites)
- **Agnostic Pre-processor**: Validates nested regions, unclosed tags, dangling `alt`/`end` blocks, and multi-tier region paths.
- **Zero-Config Subgraph & Box Tagging**: Tests automatic title slugification, 3-tier merging (On, Merged, Clean, Off), and empty container cleanup across sequence and flowchart diagrams.
- **WYSIWYG Transformations & Chained Edges**: Tests participant renames, lifeline creations, self-pointing loops, endpoint retargeting, arrow style injections, multi-hop flowchart chained edges (`A --> B --> C`), and cascade deletions.
- **Actor & Service Merging**: Tests collapsing participants by tag/color, rewriting external arrows, and stripping internal self-calls in Clean mode.
- **Sticky Notes & Animations**: Tests drag and corner-resize coordinate math, responsive font scaling, markdown parsing, CONFIG serialization, and chronological sequential animation timing.
- **Interactive Markdown WYSIWYG**: Tests block-level AST parsing, scoped inline textarea editing, targeted block replacement, and per-diagram view/tag overlay controls.
- **Persistence & Serialization**: Verifies serialized disk write queue (`serialQueue`), post-write verification, debounced write-throughs, SSE echo cancellation, and external disk change adoption.
- **Undo / Redo History**: Confirms strict 15-entry bounded history and disk state synchronization.
- **11 Cypress End-to-End Suites**: Comprehensive browser-level tests covering canvas interaction, lifeline drag handles, flowchart hit targets, sticky note drag/resize/selection, pan/zoom, and markdown persistence.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
