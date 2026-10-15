# Markdown Demo — Embedded Mermaid Diagrams

This file is a committed sample for testing **mermaid diagrams embedded in
markdown files** on a fresh checkout. Every `mermaid` fenced block below is
listed in the Files menu as a nested child of this file (with an **MD**
badge). Select one, toggle **Edit**, change it on the canvas or in the text
editor, and the save is written back into this file: only that fenced
block's content is replaced, the surrounding prose is untouched.

## Login flow (sequence diagram)

The first block carries a `%% CONFIG:` line, so canvas edits (colors, sticky
notes, saved views) round-trip through the markdown save. Its participants are
tagged (`frontend` / `backend`) and it has a saved view, so the preview's
per-block view dropdown and tag chips can be tried right here.

```mermaid
%% CONFIG: {"version":1,"arrows":[{"from":"C","to":"API","label":"New message","color":"#00ff9d","animation":"flow"}],"actors":{"C":{"keys":["frontend"]},"DB":{"keys":["backend"]},"Auth":{"keys":["backend"]},"API":{"keys":["backend"]}},"views":[{"name":"Backend only","hideKeys":["frontend"]}]}
sequenceDiagram
    participant C as Client
    participant DB as Database
    participant Auth as Auth Service
    participant API as API Gateway

    C->>API: POST /login
    API->>Auth: Validate Credentials
    Auth->>DB: Fetch User Data
    C->>API: New message
    DB-->>Auth: User Record
    Auth-->>API: JWT Token
    API-->>C: 200 OK + Token

    Note over C,API: Demo diagram for visual editing
```

## Order pipeline (flowchart)

```mermaid
flowchart TD
    Client[Web Client] --> Gateway[API Gateway]
    Gateway -->|Validate| Auth{Auth Service}
    Gateway ==> Orders[Order Service]
    Orders --> DB[(Order Database)]
    Auth -.->|Token OK| Gateway
    Client <--> Gateway
    Orders --- Queue[Message Queue]
    Client -->|New message| Orders
```

## Not a diagram

Fenced blocks with a non-mermaid language are ignored by the viewer.

```js
console.log("not a diagram");
```
