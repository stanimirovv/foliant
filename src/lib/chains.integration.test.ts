// Integration tests for editing flowchart lines with chained edges
// (`A --> B --> C` — several links on one statement line). Every actor and
// link on such a line must be editable: the model carries all of them, and
// every transform rewrites only the targeted endpoint/link without corrupting
// the rest of the chain. All actor names are invented (obfuscated data).

import { describe, it, expect } from 'vitest';
import { parseModel } from './model';
import { flowchartNodeIdOf } from './svgmap';
import {
  renameParticipant, setNodeShape, editMessageLabel, setArrowType,
  deleteElement, moveNode,
} from './editor';
import { transformActors } from './preprocessor';
import { parseConfig, renderPipeline } from './editorTestHarness';

// Obfuscated mirror of a real-world chained flowchart: a long link chain with
// multi-line labels, a dotted side branch, and a bare-endpoint dotted chain.
const CHAIN = `flowchart LR
    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"] --> Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]
    N["Long term: Zephyr Kafka outputs"] -.-> Y
    Y -.-> M["Long term: Kafka fanout<br/>Replacement design TBD"] -.-> V`;

const nodeIds = (code: string) =>
  parseModel(code).elements.filter(e => e.kind === 'node').map(e => (e as { id: string }).id);
const edgeIds = (code: string) =>
  parseModel(code).elements.filter(e => e.kind === 'edge').map(e => `${(e as { from: string }).from}->${(e as { to: string }).to}`);

describe('chained edges — every rendered actor is in the model (the reported bug)', () => {
  it('renders with mermaid and the model carries every node and edge', async () => {
    const { svg, model } = await renderPipeline(CHAIN);
    const doc = new DOMParser().parseFromString(svg, 'text/html');
    const svgNodeIds = Array.from(doc.querySelectorAll('g.node[id]'))
      .map(g => flowchartNodeIdOf(g.getAttribute('id') ?? ''))
      .filter((id): id is string => id !== null)
      .sort();
    const modelNodeIds = model.elements
      .filter(e => e.kind === 'node')
      .map(e => (e as { id: string }).id)
      .sort();
    // The rendered diagram and the editable model must agree exactly.
    expect(modelNodeIds).toEqual(svgNodeIds);
    const svgEdgeCount = doc.querySelectorAll('g.edgePaths path[data-et="edge"]').length;
    expect(model.elements.filter(e => e.kind === 'edge').length).toBe(svgEdgeCount);
  });
});

describe('chained edges — rename and shape', () => {
  it('renames a middle node of a chain, touching only its endpoint', () => {
    const res = renameParticipant(CHAIN, null, 'n:2', 'Kestrel Core');
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart LR
    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"] --> Y[Kestrel Core] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]
    N["Long term: Zephyr Kafka outputs"] -.-> Y
    Y -.-> M["Long term: Kafka fanout<br/>Replacement design TBD"] -.-> V`);
    // The model stays complete: no node or link lost.
    expect(nodeIds(res.code)).toEqual(['W', 'X', 'Y', 'Z', 'V', 'U', 'N', 'M']);
    expect(edgeIds(res.code)).toEqual(['W->X', 'X->Y', 'Y->Z', 'Z->V', 'V->U', 'N->Y', 'Y->M', 'M->V']);
    const y = parseModel(res.code).elements.find(e => e.kind === 'node' && (e as { id: string }).id === 'Y');
    expect((y as { label?: string }).label).toBe('Kestrel Core');
  });

  it('renames the first node of a chain', () => {
    const res = renameParticipant(CHAIN, null, 'n:0', 'Router');
    expect(res.code.split('\n')[1]).toBe(
      '    W[Router] --> X["Kestrel SQS"] --> Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]'
    );
  });

  it('injects a shape when renaming a bare endpoint whose first declaration is bare', () => {
    const code = `flowchart TD
    P[Portal] --> Q --> R[Reports]
    Q -.-> S[Status] -.-> P`;
    const res = renameParticipant(code, null, 'n:1', 'Queue');
    expect(res.code).toBe(`flowchart TD
    P[Portal] --> Q[Queue] --> R[Reports]
    Q -.-> S[Status] -.-> P`);
  });

  it('drops only the renamed node\'s shape when its label is cleared', () => {
    const code = `flowchart TD
    P[Portal] --> Q[Queue] --> R[Reports]`;
    const res = renameParticipant(code, null, 'n:1', '');
    expect(res.code).toBe(`flowchart TD
    P[Portal] --> Q --> R[Reports]`);
  });

  it('changes the shape of a chained node, preserving its label and the other links', () => {
    const res = setNodeShape(CHAIN, null, 'n:1', 'cylinder');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[1]).toBe(
      '    W["WidgetStream Router<br/>Kestrel sink"] --> X[("Kestrel SQS")] --> Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]'
    );
    expect(nodeIds(res.code)).toEqual(['W', 'X', 'Y', 'Z', 'V', 'U', 'N', 'M']);
    expect(edgeIds(res.code)).toEqual(['W->X', 'X->Y', 'Y->Z', 'Z->V', 'V->U', 'N->Y', 'Y->M', 'M->V']);
  });
});

describe('chained edges — edge label and operator', () => {
  it('injects a pipe label into the second link of a chain only', () => {
    const res = editMessageLabel(CHAIN, null, 'e:1', 'Handshake');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[1]).toBe(
      '    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"] -->|Handshake| Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]'
    );
    const edges = parseModel(res.code).elements.filter(e => e.kind === 'edge');
    expect(edges.map(e => (e as { label?: string }).label)).toEqual([undefined, 'Handshake', undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('rewrites and clears a pipe label on a chained link only', () => {
    const labeled = `flowchart TD
    A -->|one| B -->|two| C`;
    const renamed = editMessageLabel(labeled, null, 'e:1', 'dos');
    expect(renamed.code).toBe(`flowchart TD
    A -->|one| B -->|dos| C`);
    const cleared = editMessageLabel(labeled, null, 'e:1', '');
    expect(cleared.code).toBe(`flowchart TD
    A -->|one| B --> C`);
  });

  it('rewrites and clears an open-text link label inside a chain', () => {
    const code = `flowchart TD
    A[Alpha] -- note --> B[Beta] --> C[Gamma]`;
    const renamed = editMessageLabel(code, null, 'e:0', 'ping');
    expect(renamed.code).toBe(`flowchart TD
    A[Alpha] -- ping --> B[Beta] --> C[Gamma]`);
    const cleared = editMessageLabel(code, null, 'e:0', '');
    expect(cleared.code).toBe(`flowchart TD
    A[Alpha] --> B[Beta] --> C[Gamma]`);
  });

  it('replaces the operator of one link of a chain only', () => {
    const res = setArrowType(CHAIN, null, 'e:2', '-.->');
    expect(res.warning).toBeUndefined();
    expect(res.code.split('\n')[1]).toBe(
      '    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"] --> Y["Kestrel<br/>PII scrub"] -.-> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]'
    );
    expect(parseModel(res.code).elements.filter(e => e.kind === 'edge').map(e => (e as { operator: string }).operator))
      .toEqual(['-->', '-->', '-.->', '-->', '-->', '-.->', '-.->', '-.->']);
  });

  it('moves the arrow CONFIG entry to the new label of a chained link', () => {
    const code = `%% CONFIG: {"version":1,"arrows":[{"from":"X","to":"Y","color":"red"}]}
${CHAIN}`;
    const res = editMessageLabel(code, parseConfig(code), 'e:1', 'Handshake');
    const config = parseConfig(res.code);
    expect(config?.arrows).toEqual([{ from: 'X', to: 'Y', label: 'Handshake', color: 'red' }]);
  });
});

describe('chained edges — delete', () => {
  it('deleting a middle node splits the chain and keeps surviving declarations', () => {
    const res = deleteElement(CHAIN, null, 'n:2');  // Y
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart LR
    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"]
    Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]
    N["Long term: Zephyr Kafka outputs"]
    M["Long term: Kafka fanout<br/>Replacement design TBD"] -.-> V`);
    expect(nodeIds(res.code)).toEqual(['W', 'X', 'Z', 'V', 'U', 'N', 'M']);
    expect(edgeIds(res.code)).toEqual(['W->X', 'Z->V', 'V->U', 'M->V']);
    // The cascaded links that referenced Y are reported.
    expect(res.cascaded).toEqual(['e:1', 'e:2', 'e:5', 'e:6']);
  });

  it('deleting the first link of a chain keeps the orphaned declaration and the rest of the chain', () => {
    const res = deleteElement(CHAIN, null, 'e:0');  // W -> X
    expect(res.code).toBe(`flowchart LR
    W["WidgetStream Router<br/>Kestrel sink"]
    X["Kestrel SQS"] --> Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]
    N["Long term: Zephyr Kafka outputs"] -.-> Y
    Y -.-> M["Long term: Kafka fanout<br/>Replacement design TBD"] -.-> V`);
    expect(nodeIds(res.code)).toEqual(['W', 'X', 'Y', 'Z', 'V', 'U', 'N', 'M']);
    expect(edgeIds(res.code)).toEqual(['X->Y', 'Y->Z', 'Z->V', 'V->U', 'N->Y', 'Y->M', 'M->V']);
  });

  it('deleting the last link of a chain keeps the chain and the orphaned declaration', () => {
    const res = deleteElement(CHAIN, null, 'e:4');  // V -> U
    expect(res.code).toBe(`flowchart LR
    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"] --> Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"]
    U["Advertising conversion APIs"]
    N["Long term: Zephyr Kafka outputs"] -.-> Y
    Y -.-> M["Long term: Kafka fanout<br/>Replacement design TBD"] -.-> V`);
    expect(nodeIds(res.code)).toEqual(['W', 'X', 'Y', 'Z', 'V', 'U', 'N', 'M']);
    expect(edgeIds(res.code)).toEqual(['W->X', 'X->Y', 'Y->Z', 'Z->V', 'N->Y', 'Y->M', 'M->V']);
  });

  it('deleting a node declared on a single link keeps the surviving declaration', () => {
    const code = `flowchart TD
    A[Alice] --> B[Bob] --> C[Carol]`;
    const res = deleteElement(code, null, 'n:1');  // B
    expect(res.code).toBe(`flowchart TD
    A[Alice]
    C[Carol]`);
    expect(nodeIds(res.code)).toEqual(['A', 'C']);
  });
});

describe('chained edges — move', () => {
  it('moving a chained node earlier inserts a standalone declaration of just that node', () => {
    const res = moveNode(CHAIN, null, 'n:6', 'n:0');  // N before W
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart LR
    N["Long term: Zephyr Kafka outputs"]
    W["WidgetStream Router<br/>Kestrel sink"] --> X["Kestrel SQS"] --> Y["Kestrel<br/>PII scrub"] --> Z["MVP: Kestrel internal SNS"] --> V["Vendor handlers<br/>App/event mapping + consent"] --> U["Advertising conversion APIs"]
    N["Long term: Zephyr Kafka outputs"] -.-> Y
    Y -.-> M["Long term: Kafka fanout<br/>Replacement design TBD"] -.-> V`);
    expect(nodeIds(res.code)).toEqual(['N', 'W', 'X', 'Y', 'Z', 'V', 'U', 'M']);
    expect(edgeIds(res.code)).toEqual(['W->X', 'X->Y', 'Y->Z', 'Z->V', 'V->U', 'N->Y', 'Y->M', 'M->V']);
  });

  it('moving a node later relocates every line that mentions it, as a block', () => {
    const code = `flowchart TD
    P[Portal] --> Q[Queue] --> R[Reports]
    S[Status] --> T[Telemetry]
    Q -.-> S`;
    const res = moveNode(code, null, 'n:1');  // Q to the end
    expect(res.warning).toBeUndefined();
    expect(res.code).toBe(`flowchart TD
    S[Status] --> T[Telemetry]
    P[Portal] --> Q[Queue] --> R[Reports]
    Q -.-> S`);
    // Moving Q carries the whole chain line (P and R ride along — the move is
    // line-granular); the model stays complete afterwards.
    expect(nodeIds(res.code)).toEqual(['S', 'T', 'P', 'Q', 'R']);
    expect(edgeIds(res.code)).toEqual(['S->T', 'P->Q', 'Q->R', 'Q->S']);
  });
});

describe('chained edges — actor merge (preprocessor)', () => {
  it('renames every occurrence of a merged actor on a chained line', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"W":{"keys":["core"]},"X":{"keys":["core"]},"Y":{"keys":["core"]}}}
flowchart LR
    W["WidgetStream"] --> X["Kestrel SQS"] --> Y["Kestrel"] --> Z["SNS"]`;
    const config = parseConfig(code);
    const out = transformActors(code, config, { mergeByKeys: ['core'] });
    expect(out).toBe(`%% CONFIG: {"version":1,"actors":{"W":{"keys":["core"]},"X":{"keys":["core"]},"Y":{"keys":["core"]}}}
flowchart LR
    MergedKey_core[Merged core] --> MergedKey_core[Merged core] --> MergedKey_core[Merged core] --> Z["SNS"]`);
  });

  it('drops a merged self-call line but keeps a merged chain line intact', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"W":{"keys":["core"]},"X":{"keys":["core"]}}}
flowchart LR
    W --> X --> W
    W --> X`;
    const config = parseConfig(code);
    const out = transformActors(code, config, { mergeCleanByKeys: ['core'] });
    // `W --> X --> W` merges to a three-node chain of the same actor: it is
    // NOT a self-call line, so it survives; `W --> X` becomes a self-call and
    // is cleaned away.
    expect(out).toBe(`%% CONFIG: {"version":1,"actors":{"W":{"keys":["core"]},"X":{"keys":["core"]}}}
flowchart LR
    MergedKey_core[Merged core] --> MergedKey_core[Merged core] --> MergedKey_core[Merged core]`);
  });
});
