# Mermaid Diagram Authoring Guidelines

You are assisting in generating and editing a massive Mermaid sequence diagram. This diagram is rendered by a custom web application that allows the user to filter specific flows, edge cases, and notes.

To support this filtering, you MUST strictly adhere to the following custom syntax and visual standards.

## 1. Custom Tagging Syntax
The web app uses a custom pre-processor that reads specific Mermaid comments (`%%`) to conditionally render blocks of code. 

**Wrap all flows, edge cases, and notes in the following tags:**

### Starting a Region
Use `%% @region-start: type=value`
- **For a Flow**: `%% @region-start: flow=flow-name`
- **For an Edge Case**: `%% @region-start: edge-case=case-name`
- **For a Note**: `%% @region-start: note`

### Ending a Region
Use `%% @region-end`

**Important Rules:**
1. Regions CAN be nested (e.g., an edge case or a note inside a flow).
2. Everything inside the region will be hidden if the user disables that filter in the UI.
3. Keep core/shared participants OUTSIDE of any region so they are always loaded. However, participants that are *specific* to a certain flow or edge-case MUST be defined INSIDE that region. This ensures the actors disappear cleanly when the flow is toggled off.

## 2. Example Structure

```mermaid
sequenceDiagram
    %% Core Participants (always visible)
    participant C as Client
    participant API as API Gateway
    participant Auth as Auth Service
    participant DB as Database

    %% @region-start: flow=login
    C->>API: POST /login
    API->>Auth: Validate Credentials
    
    %% @region-start: note
    Note over API,Auth: Passwords must be hashed via bcrypt
    %% @region-end
    
    %% @region-start: edge-case=invalid-password
    Auth-->>API: 401 Unauthorized
    API-->>C: Error: Invalid Credentials
    %% @region-end
    
    Auth->>DB: Fetch User Data
    DB-->>Auth: User Record
    Auth-->>API: JWT Token
    API-->>C: 200 OK + Token
    %% @region-end
```

## 3. Visual & Style Standards
When generating the diagrams, maintain these specific visual conventions:
1. **Notes**: Always use standard `Note over X,Y:` syntax. Do not apply inline HTML styling unless explicitly requested, rely on the web app's CSS.
2. **Background Colors (rect)**: Every flow MUST be wrapped in a `rect` block to visualize its background and grouped context. You can use colors (e.g., `rect rgb(255, 255, 255)`) to designate different types of flows or domains. Make sure the `rect` block stays strictly *inside* the `@region-start` boundaries of the flow so it correctly disappears when hidden.
3. **Flow Naming**: Keep flow names in `kebab-case` (e.g., `user-registration`, `checkout-process`). Additionally, you can add a `Note` or comment within the flow to clearly identify it visually if necessary.

## 4. Editing Process
When the user asks you to "add a flow" or "update an edge case":
1. Locate the correct place in the existing sequence diagram.
2. Ensure you add the correct `%% @region-start` and `%% @region-end` boundaries.
3. **Validate Annotations**: Before outputting the final diagram, double-check your tags:
   - Ensure every `%% @region-start` has a matching `%% @region-end` (no unclosed or unmatched tags).
   - Ensure tags use the correct syntax (`%% @region-start: type=value`).
   - Ensure that Mermaid blocks (`rect`, `alt`, `opt`, `loop`, `subgraph`) are properly closed and strictly contained *inside* the region boundaries without overlapping/interleaving with the region tags.
4. Output the fully updated `.mmd` code so it can be saved and live-reloaded by the app.

## 5. Configuration & Views (%% CONFIG)
The first line of the `.mmd` file can contain a `%% CONFIG: { ... }` JSON string to persist app state, including saved views and actor metadata.

**Example:**
`%% CONFIG: {"version":1,"views":[{"name":"Happy Path","hiddenPaths":["flow=login/edge-case"]}],"actors":{"Auth":{"color":"red","keys":["backend"]}}}`

- When defining actors, you can assign them a `color` and an array of `keys`. This allows the viewer to provide dynamic toggles to hide these actors by key/color or merge all actors of the same color into a single block. 

## 6. Subgraph / Box Structural Tags (Levels of Abstraction)
Every grouping block implicitly puts a tag on all the actors and messages inside it, so a whole system can be shown collapsed or expanded. **No `%% CONFIG:` entry is needed** — the tag is derived from the block's title.

- **Sequence diagrams**: use `box <title>` (mermaid's actor grouping there; `subgraph` is not valid in sequence diagrams). The boxed participants belong to the group.
- **Flowcharts**: use `subgraph <title>` or `subgraph <id> [<title>]`.
- The tag key is the **kebab-case slug of the title**: `box Payment Service` → key `payment-service`. A leading CSS color is ignored (`box red Payment Service` → `payment-service`); `#` starts a comment, so `box #ccc Payment Service` yields no tag.
- An actor belongs to the group where it is **first declared/appears** (the same rule mermaid uses to draw the group box around it). Messages/edges/notes inside the group's span carry the tag too (in sequence diagrams, messages sit outside the `box`, which may only contain participant declarations).
- In the viewer's **By Key** filter (sidebar, and the markdown preview's per-block tag toggles), the key behaves like any other tag:
  - **Off** hides the group's actors and messages (an emptied group box is removed).
  - **Merged** collapses the group into a **single actor labeled with the group's title**; messages between internal actors become self-calls on it.
  - **Clean** additionally drops those internal self-calls — the high-level view: only the boundary messages remain.
- Two groups with the same title share one key (two "Payment Service" boxes merge into the same single actor).
- Subgraph tags combine with manual `keys` under the usual multi-tag rule: an element is hidden only when ALL of its tags are disabled.

**Example:**
```mermaid
sequenceDiagram
    participant Client
    box Payment Service
        participant Gateway
        participant Processor
    end
    Client->>Gateway: pay
    Gateway->>Processor: charge
    Processor-->>Client: receipt
```
Setting `payment-service` to **Clean** renders Client talking to a single "Payment Service" actor (`pay`, `receipt`); **On** shows the Gateway/Processor internals again.

## 7. Visual Editing & CONFIG.arrows
The app can edit sequence and flowchart diagrams in place (the **Edit** toggle, `?edit=1`): click a participant/node or message/edge to change its label, type, color, width, dash and tags; add participants/messages; delete elements (deleting a participant/node cascades to everything referencing it); and undo/redo (`Ctrl+Z` / `Ctrl+Y`, history capped at 15 entries). Edits auto-save to the `.mmd` file.

Arrow styles and arrow tags are persisted in the `%% CONFIG:` header under `arrows`:

```ts
interface ArrowStyle {
  from: string;                 // participant/node id in the RAW file
  to: string;                   // participant/node id in the RAW file
  label?: string;               // message/edge label; disambiguates same-endpoint arrows
  occurrence?: number;          // optional: nth arrow with the same (from,to,label), 0-based
  color?: string;               // stroke color, any CSS color
  width?: number;               // stroke width, 1-10
  dash?: 'solid' | 'dashed' | 'dotted';
  keys?: string[];              // the arrow's own tags (merge/hide keys)
  keyMode?: 'merged' | 'clean'; // tag behavior; absent means 'merged' (the default)
}
```

**Rules:**
1. `from`/`to` are the **raw** ids exactly as written in the file (before any merge/hide transform). Styles are resolved against the post-transform actor names, so they follow merges: when actors merge by color/key, their arrow styles are rewritten to the merged actor and keep rendering (e.g. as a styled self-call). Styles whose endpoints are hidden become inert, because the arrows themselves are gone with the hidden actors.
2. `label` disambiguates arrows between the same pair of endpoints; `occurrence` (0-based) disambiguates duplicate arrows that share the same label.
3. Deleting an arrow removes its style entry; deleting a participant/node removes the styles of every arrow that referenced it. The header line is dropped automatically when `views`, `actors` and `arrows` are all empty.
4. **Arrow tags.** A message/edge can carry its own tags (`keys`), editable in the properties panel like component tags. A message's *effective* tags are its own tags plus — when `keyMode` is `'merged'` (the default) — the tags of the service it originates from (its `from` participant/node). When `keyMode` is `'clean'`, only the message's own tags apply (the behavior before arrow tags existed). The effective tags feed the by-key filter: they appear in the sidebar **By Key** list, and setting a key to **Off** hides elements carrying that tag. When an arrow or actor carries multiple tags, it is shown if any of its tags is currently enabled, and hidden only if all of its tags are disabled. Arrows only ever respond to a key as on/off (shown or hidden); the **Merged**/**Clean** merge states remain actor-only. The panel shows inherited tags as read-only chips and offers an **Inherit service tags** On/Off toggle (On = merged, Off = clean).

**Example:**
`%% CONFIG: {"version":1,"actors":{"Auth":{"color":"red","keys":["backend"]}},"arrows":[{"from":"C","to":"API","label":"POST /login","color":"#e11d48","width":3,"dash":"dashed"}]}`
