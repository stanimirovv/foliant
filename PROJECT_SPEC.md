# Mermaid Multi-Flow Diagram Viewer
**Comprehensive Project Specification**

## 1. Project Overview
A full-stack Next.js application designed to manage, visualize, and filter massive Mermaid diagrams (2000+ lines, 50+ flows). The tool acts as a local viewer that allows users to seamlessly switch between `.mmd` files in a directory, selectively hide/show regions (flows, edge cases, notes), and perform custom searches within the rendered diagram.

## 2. Tech Stack
- **Framework**: Next.js (React)
- **Diagramming**: Mermaid.js
- **File Watching**: `chokidar` (Node.js)
- **Live Reload**: Server-Sent Events (SSE) or WebSockets
- **UI & Styling**: Tailwind CSS, generic Pan/Zoom library (e.g., `react-zoom-pan-pinch`)
- **Testing**: Vitest/Jest (Unit Tests), Cypress/Playwright (E2E Tests)

## 3. Functional Requirements

### 3.1 Agnostic Pre-processor
- **Custom Tagging**: Uses `%% @region-start: type=value` and `%% @region-end`.
- **Agnostic Design**: Must be built to support any Mermaid diagram type in the future (Flowcharts, Class diagrams, etc.), not just Sequence Diagrams.
- **Smart Cleanup**: If stripping a region leaves dangling syntax (like an empty `alt/end` block or dangling arrows), the pre-processor MUST safely clean it up to prevent Mermaid from throwing a parse error.
- **Error Handling**: If an invalid or unclosed tag is found, the parser must "soft fail", render the raw un-stripped code, and display a small warning toast to the user.

### 3.2 Dynamic UI & Filtering
- **Sidebar File Explorer**: Watch a directory and provide a sidebar to easily switch between multiple `.mmd` files.
- **URL State Persistence**: Filter states (active flows, toggled notes) must be synced to URL query parameters (e.g., `?file=main.mmd&flows=login,checkout&notes=true`) so views can be easily shared.
- **Hierarchical Toggles**: Provide both Global toggles ("Hide All Notes") and Contextual toggles (expand a specific flow in the sidebar to toggle notes/edge cases *only* within that flow).
- **Custom Search**: A search bar that highlights specific participants or message lines directly on the rendered SVG.
- **Theming**: A basic Light/Dark mode toggle that maps to Mermaid's default and dark themes.

### 3.3 LLM Context File / Skill (Artifact)
The final application must include a bundled `diagram-guidelines.md` context file (or a formal Agent Skill). 
- **Purpose**: This file acts as the instruction manual you feed to LLMs (like Claude, Gemini, or Codex) so they understand how to generate code compatible with this web app.
- **Contents**: It MUST explain the custom `%% @region-start` syntax, demonstrate how to correctly nest flows and edge cases, and establish visual styling rules (like specific background colors for services).

## 4. Non-Functional Requirements
- **Performance**: Implement a 500ms debounce on file save events before parsing and re-rendering to prevent UI freezing during rapid IDE saves.
- **Deployment**: Designed to run strictly locally. Triggered via `npm run dev` or packaged as a global CLI tool (e.g., `npx mermaid-viewer`).

## 5. Acceptance Criteria

1. **Live-Reload**: The diagram MUST update in the browser within 1 second of saving the file, WITHOUT a full page refresh, and it MUST retain the current UI filter state (via URL params).
2. **Pre-processor Reliability**: Stripping a region MUST NOT leave trailing syntax errors that break Mermaid parsing. The pre-processor is entirely responsible for this cleanup.
3. **UI Responsiveness**: The diagram canvas MUST be pan-able and zoomable. The sidebar MUST be collapsible on small screens.
4. **Scale & Capacity**: The application MUST cleanly render and filter a diagram containing at least 50 distinct flows and 2000+ lines of Mermaid code without crashing or severe lag.
5. **Testing**:
   - **Unit Tests**: Thorough coverage of the pre-processor logic ensuring tags are stripped and dangling syntax is cleaned correctly.
   - **E2E Tests**: Cypress or Playwright tests verifying the UI filtering, URL state syncing, and rendering pipeline.

## 6. Implementation Steps for the Agent
1. **Initialize Project**: Setup Next.js, Tailwind, Vitest, and Cypress.
2. **Build the Pre-processor (TDD)**: Write unit tests for various complex stripping scenarios (nested blocks, dangling `alt` blocks), then implement the agnostic parser to pass them.
3. **File System API**: Create the `chokidar` watcher and SSE endpoint. Implement the directory reader API.
4. **Develop UI State & Routing**: Setup Next.js routing to sync sidebar checkboxes with URL query parameters.
5. **Diagram Canvas & Search**: Integrate `mermaid.render()`, apply the Pan/Zoom wrapper, and implement SVG text highlighting for the search feature.
6. **E2E Verification**: Write the final E2E tests to ensure the complete loop (file save -> debounce -> parse -> render -> URL state) works flawlessly.
