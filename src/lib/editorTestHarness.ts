// Shared create -> change -> verify test harness (EDITING_PLAN.md Section 4.13).
// Every step's integration tests create a brand-new diagram through these
// helpers (never a pre-existing repo fixture) and drive it through the same
// code path the UI uses.

import { parseViewsData, DiagramConfig } from './views';

export function createSequenceDiagram(): string {
  return `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi there`;
}

export function createFlowchartDiagram(): string {
  return `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| A`;
}

export function parseConfig(code: string): DiagramConfig | null {
  return parseViewsData(code);
}
