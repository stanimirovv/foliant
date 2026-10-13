// Render-level verification for arrow tags: tagging a message/edge and hiding
// its key must remove it from the rendered diagram (create -> change ->
// verify, EDITING_PLAN.md 4.13). Inheritance semantics (merged default vs
// clean) are covered by the editor unit tests; here the whole pipeline —
// CONFIG -> transformActors -> mermaid — is exercised.

import { describe, it, expect } from 'vitest';
import { renderPipeline, parseConfig } from './editorTestHarness';
import { addTag, setArrowKeyMode, getArrowTags } from './editor';

const SEQ = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant C as Carol
    A->>B: Hello
    B->>C: Forward
    A->>C: Direct`;

describe('arrow tags (rendered)', () => {
  it('hiding a message key removes the message from the rendered diagram', async () => {
    const tagged = addTag(SEQ, null, 'm:1', 'flaky'); // B->>C: Forward
    expect(tagged.warning).toBeUndefined();

    const before = await renderPipeline(tagged.code);
    expect(before.model.elements.filter(e => e.kind === 'message')).toHaveLength(3);
    expect(before.svg).toContain('Forward');

    const after = await renderPipeline(tagged.code, { hideKeys: ['flaky'] });
    const messages = after.model.elements.filter(e => e.kind === 'message');
    expect(messages.map(m => m.label)).toEqual(['Hello', 'Direct']);
    expect(after.svg).not.toContain('Forward');
    expect(after.svg).toContain('Hello');
    expect(after.svg).toContain('Direct');
  });

  it('hiding an edge key removes the edge (and its first-declared node) from a rendered flowchart', async () => {
    const FLOW = `flowchart TD
    A[App] --> B[API]
    B --> C[DB]
    A --> D[Cache]`;
    const tagged = addTag(FLOW, null, 'e:1', 'flaky'); // B --> C[DB]
    expect(tagged.warning).toBeUndefined();

    const after = await renderPipeline(tagged.code, { hideKeys: ['flaky'] });
    expect(after.model.elements.filter(e => e.kind === 'edge')).toHaveLength(2);
    // node C was first declared on the dropped edge line, so it is gone too
    const doc = new DOMParser().parseFromString(after.svg, 'text/html');
    const labels = Array.from(doc.querySelectorAll('g.node .nodeLabel')).map(el => el.textContent?.trim());
    expect(labels).toEqual(['App', 'API', 'Cache']);
  });

  it('messages do not inherit origin service tags by default (clean default); merged opts in', async () => {
    const code = `%% CONFIG: {"version":1,"actors":{"A":{"keys":["backend"]}}}
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B->>A: Hi`;
    const cfg = parseConfig(code);
    // clean (default): the message from A carries only its own tags
    expect(getArrowTags(code, cfg, 'm:0'))
      .toEqual({ keys: [], keyMode: 'clean', inherited: [] });
    // the diagram renders with 2 messages
    const { model } = await renderPipeline(code);
    expect(model.elements.filter(e => e.kind === 'message')).toHaveLength(2);
    // merged: inherits the origin service tags
    const merged = setArrowKeyMode(code, cfg, 'm:0', 'merged');
    expect(getArrowTags(merged.code, merged.config, 'm:0'))
      .toEqual({ keys: [], keyMode: 'merged', inherited: ['backend'] });
  });

  it('an arrow with multiple tags is shown if any tag is shown, and hidden only when all tags are disabled', async () => {
    const t1 = addTag(SEQ, null, 'm:1', 'flaky');
    const t2 = addTag(t1.code, t1.config, 'm:1', 'beta');
    expect(t2.warning).toBeUndefined();

    // Hiding only one tag: arrow remains rendered
    const oneHidden = await renderPipeline(t2.code, { hideKeys: ['flaky'] });
    expect(oneHidden.model.elements.filter(e => e.kind === 'message')).toHaveLength(3);
    expect(oneHidden.svg).toContain('Forward');

    // Hiding all tags: arrow is removed from rendered diagram
    const allHidden = await renderPipeline(t2.code, { hideKeys: ['flaky', 'beta'] });
    expect(allHidden.model.elements.filter(e => e.kind === 'message')).toHaveLength(2);
    expect(allHidden.svg).not.toContain('Forward');
  });
});
