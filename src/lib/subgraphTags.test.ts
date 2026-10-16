// Subgraph structural tags: every grouping block (`subgraph`, and `box` in
// sequence diagrams — mermaid's actor-grouping construct there) implicitly
// tags the actors and messages inside it with a key derived from the block's
// title, so the whole group can be hidden or merged into a single actor
// through the existing by-key filter (levels of abstraction).

import { describe, it, expect } from 'vitest';
import { buildSubgraphTagIndex, collectSubgraphTags, slugifySubgraphTitle } from './subgraphTags';
import { processMermaid, transformActors, buildActorRewriteMap } from './preprocessor';
import { collectAvailableKeys } from './views';
import { rewriteArrowStyles } from './styling';
import { buildSelectionMap } from './svgmap';
import { getArrowTags } from './editor';
import { renderPipeline, svgText } from './editorTestHarness';

// mermaid renders `box <title>` as the actor group in sequence diagrams. Boxes
// may only contain participant declarations, so the internal messages sit
// outside the box — exactly the "internals of a system" shape: the box holds
// the system's actors, and merging the box collapses them into one actor.
const SEQ = `sequenceDiagram
    participant Client
    box Payment Service
        participant Gateway
        participant Processor
    end
    Client->>Gateway: pay
    Gateway->>Processor: charge
    Processor-->>Client: receipt`;

describe('slugifySubgraphTitle', () => {
  it('slugs titles into kebab-case tag keys', () => {
    expect(slugifySubgraphTitle('Payment Service')).toBe('payment-service');
    expect(slugifySubgraphTitle('Auth')).toBe('auth');
    expect(slugifySubgraphTitle('  Spaced   Out  ')).toBe('spaced-out');
    expect(slugifySubgraphTitle('Billing v2 (EU)')).toBe('billing-v2-eu');
  });

  it('returns null when nothing usable remains', () => {
    expect(slugifySubgraphTitle(undefined)).toBeNull();
    expect(slugifySubgraphTitle('')).toBeNull();
    expect(slugifySubgraphTitle('   ')).toBeNull();
    expect(slugifySubgraphTitle('!!!')).toBeNull();
  });
});

describe('collectSubgraphTags', () => {
  it('derives one tag per box from its title (sequence diagrams)', () => {
    const tags = collectSubgraphTags(SEQ);
    expect(tags).toEqual([{ key: 'payment-service', title: 'Payment Service', lineStart: 2, lineEnd: 5 }]);
  });

  it('tags subgraph blocks too (flowcharts, and sequence diagrams structurally)', () => {
    const flow = `flowchart TD
    A --> B
    subgraph Payment Service
        B --> C
    end`;
    expect(collectSubgraphTags(flow)).toEqual([
      { key: 'payment-service', title: 'Payment Service', lineStart: 2, lineEnd: 4 },
    ]);
    const seq = `sequenceDiagram
    subgraph Payment Service
        participant A
    end`;
    expect(collectSubgraphTags(seq).map(t => t.key)).toEqual(['payment-service']);
  });

  it('reads the bracket title of flowchart subgraphs (subgraph id [Title])', () => {
    const code = `flowchart TD
    subgraph pay [Payment Service]
        A --> B
    end`;
    const tags = collectSubgraphTags(code);
    expect(tags).toEqual([{ key: 'payment-service', title: 'Payment Service', lineStart: 1, lineEnd: 3 }]);
  });

  it('strips a leading CSS color from box titles, like mermaid renders them', () => {
    const strip = (header: string) =>
      collectSubgraphTags(`sequenceDiagram\n    ${header}\n        participant A\n    end`)[0]?.title;
    expect(strip('box Payment Service')).toBe('Payment Service');
    expect(strip('box red Payment Service')).toBe('Payment Service');
    expect(strip('box rgb(200, 200, 255) Payment Service')).toBe('Payment Service');
    expect(strip('box hsl(120, 50%, 50%) Payment Service')).toBe('Payment Service');
    expect(strip('box Payment')).toBe('Payment');
    // `#` starts a comment in mermaid sequence diagrams: no title survives.
    expect(strip('box #ccc Payment Service')).toBeUndefined();
    expect(strip('box Pay#ment Service')).toBe('Pay');
  });

  it('ignores non-grouping blocks (rect, alt, loop, par)', () => {
    const code = `sequenceDiagram
    rect rgb(200,200,255)
        participant A
    end
    alt cond
        participant B
    end
    loop every day
        participant C
    end`;
    expect(collectSubgraphTags(code)).toEqual([]);
  });

  it('skips untitled grouping blocks', () => {
    const code = `sequenceDiagram
    box
        participant A
    end
    subgraph
        participant B
    end`;
    expect(collectSubgraphTags(code)).toEqual([]);
  });

  it('returns nothing for non-diagram content', () => {
    expect(collectSubgraphTags('just some prose')).toEqual([]);
    expect(collectSubgraphTags('')).toEqual([]);
  });
});

describe('buildSubgraphTagIndex (sequence)', () => {
  it('tags actors declared inside the box', () => {
    const index = buildSubgraphTagIndex(SEQ);
    expect(index.actorKeys.get('Gateway')).toEqual(['payment-service']);
    expect(index.actorKeys.get('Processor')).toEqual(['payment-service']);
    expect(index.actorKeys.get('Client')).toBeUndefined();           // declared top-level
  });

  it('tags auto-declared actors first messaged inside the group span', () => {
    // (Not valid mermaid inside a `box`, but the model tolerates it — the rule
    // is "first appearance inside the span", matching how mermaid would place
    // the actor if the group were a renderable subgraph.)
    const code = `sequenceDiagram
    participant Client
    subgraph Payment Service
        participant Gateway
        Gateway->>Processor: charge
    end`;
    const index = buildSubgraphTagIndex(code);
    expect(index.actorKeys.get('Processor')).toEqual(['payment-service']);
  });

  it('does not tag actors whose first appearance is outside the group', () => {
    // Declared (or first messaged) at top level: mermaid renders them outside
    // the group box, so they do not belong to it.
    const code = `sequenceDiagram
    participant Client
    participant Gateway
    box Payment Service
        Gateway->>Processor: charge
    end
    Client->>Gateway: pay`;
    const index = buildSubgraphTagIndex(code);
    expect(index.actorKeys.get('Gateway')).toBeUndefined();
    expect(index.actorKeys.get('Processor')).toEqual(['payment-service']);
  });

  it('tags messages and notes inside the group, not outside', () => {
    const code = `sequenceDiagram
    participant A
    box Internals
        participant B
        A->>B: enter
        Note over B: note inside
    end
    A->>B: leave`;
    const index = buildSubgraphTagIndex(code);
    const messageKeys = [...index.elementKeys.entries()]
      .filter(([k]) => k.startsWith('m:'))
      .map(([k, v]) => [k, v] as const);
    expect(messageKeys).toEqual([['m:0', ['internals']]]);
    const noteKeys = [...index.elementKeys.entries()]
      .filter(([k]) => k.startsWith('note:'))
      .map(([k, v]) => [k, v] as const);
    expect(noteKeys).toEqual([['note:0', ['internals']]]);
  });

  it('tags elements with every enclosing group when nested', () => {
    const code = `sequenceDiagram
    box Outer System
        participant A
        box Inner Detail
            participant B
            A->>B: ping
        end
    end`;
    const index = buildSubgraphTagIndex(code);
    expect(index.actorKeys.get('A')).toEqual(['outer-system']);
    expect(index.actorKeys.get('B')).toEqual(['outer-system', 'inner-detail']);
    expect(index.elementKeys.get('m:0')).toEqual(['outer-system', 'inner-detail']);
  });
});

describe('buildSubgraphTagIndex (flowchart)', () => {
  it('tags nodes declared inside and edges contained in the subgraph', () => {
    const code = `flowchart TD
    Client[Client] --> GW[Gateway]
    subgraph pay [Payment Service]
        GW --> Proc[Processor]
        Proc --> Bank[Bank]
    end
    Proc --> Client`;
    const index = buildSubgraphTagIndex(code);
    expect(index.actorKeys.get('Proc')).toEqual(['payment-service']);
    expect(index.actorKeys.get('Bank')).toEqual(['payment-service']);
    expect(index.actorKeys.get('GW')).toBeUndefined();   // first declared outside
    expect(index.actorKeys.get('Client')).toBeUndefined();
    const edgeKeys = [...index.elementKeys.entries()]
      .filter(([k]) => k.startsWith('e:'))
      .map(([k, v]) => [k, v] as const);
    expect(edgeKeys).toEqual([['e:1', ['payment-service']], ['e:2', ['payment-service']]]);
  });
});

describe('transformActors subgraph tags (sequence)', () => {
  it('is a no-op with no selection, even without any CONFIG', () => {
    expect(transformActors(SEQ, null, {})).toBe(SEQ);
  });

  it('merges the whole group into a single actor labeled with the group title', () => {
    const merged = transformActors(SEQ, null, { mergeByKeys: ['payment-service'] });
    expect(merged).toBe(`sequenceDiagram
    participant Client
    box Payment Service
        participant MergedKey_paymentservice as Payment Service
    end
    Client->>MergedKey_paymentservice: pay
    MergedKey_paymentservice->>MergedKey_paymentservice: charge
    MergedKey_paymentservice-->>Client: receipt`);
  });

  it('clean merge additionally drops the internal self-calls (the high-level view)', () => {
    const merged = transformActors(SEQ, null, { mergeCleanByKeys: ['payment-service'] });
    expect(merged).toBe(`sequenceDiagram
    participant Client
    box Payment Service
        participant MergedKey_paymentservice as Payment Service
    end
    Client->>MergedKey_paymentservice: pay
    MergedKey_paymentservice-->>Client: receipt`);
  });

  it('merging collapses a note over two internal actors into a note over the merged actor', () => {
    const code = `sequenceDiagram
    box Payment Service
        participant Gateway
        participant Processor
        Note over Gateway,Processor: internal note
    end`;
    const merged = transformActors(code, null, { mergeByKeys: ['payment-service'] });
    expect(merged).toContain('Note over MergedKey_paymentservice: internal note');
    expect(merged).not.toContain('Note over MergedKey_paymentservice,MergedKey_paymentservice');
  });

  it('hides the group actors and messages when the group key is off', () => {
    const hidden = transformActors(SEQ, null, { hideKeys: ['payment-service'] });
    expect(hidden).toBe(`sequenceDiagram
    participant Client
    box Payment Service
    end`);
    // The emptied group box is cleaned up by the region pipeline.
    const rendered = processMermaid(hidden, { isRegionVisible: () => true });
    expect(rendered.code).toBe(`sequenceDiagram
    participant Client`);
  });

  it('hides a note inside the group along with the group key', () => {
    const code = `sequenceDiagram
    participant A
    box Internals
        participant B
        Note over B: internal note
    end
    A->>B: call`;
    const hidden = transformActors(code, null, { hideKeys: ['internals'] });
    expect(hidden).not.toContain('internal note');
  });

  it('combines with CONFIG tags as two independent groups (hidden when either group is off)', () => {
    const config = { version: 1, actors: { Gateway: { keys: ['backend'] } } };
    // Group key off: whole box hides, including Gateway
    const groupOff = transformActors(SEQ, config, { hideKeys: ['payment-service'] });
    expect(groupOff).not.toContain('participant Gateway');
    expect(groupOff).not.toContain('participant Processor');
    // Own key off: Gateway hides, but Processor stays
    const ownOff = transformActors(SEQ, config, { hideKeys: ['backend'] });
    expect(ownOff).not.toContain('participant Gateway');
    expect(ownOff).toContain('participant Processor');
  });

  it('hides boxed actors when either their CONFIG key or the box tag is off (Activity reproduction)', () => {
    const code = `sequenceDiagram
    box Activity Sources
        participant BR
        participant PR
    end
    BR->>PR: ping`;
    const config = {
      version: 1,
      actors: {
        BR: { keys: ['Activity'] },
        PR: { keys: ['Activity'] },
      },
    };
    // hideKeys: ['Activity'] -> BR/PR hidden
    const configOff = transformActors(code, config, { hideKeys: ['Activity'] });
    expect(configOff).not.toContain('participant BR');
    expect(configOff).not.toContain('participant PR');
    expect(configOff).not.toContain('ping');

    // hideKeys: ['activity-sources'] -> BR/PR hidden
    const boxOff = transformActors(code, config, { hideKeys: ['activity-sources'] });
    expect(boxOff).not.toContain('participant BR');
    expect(boxOff).not.toContain('participant PR');
    expect(boxOff).not.toContain('ping');
  });

  it('tracks mergedBy with CONFIG keys taking precedence over structural keys', () => {
    const code = `sequenceDiagram
    box Enrichment (degrade on failure)
        participant CashOut
    end`;
    const config = {
      version: 1,
      actors: {
        CashOut: { keys: ['enrichment', 'existingDeps'] },
      },
    };
    const bothMerged = buildActorRewriteMap(config, {
      mergeByKeys: ['enrichment', 'enrichment-degrade-on-failure'],
    }, code);
    expect(bothMerged.mergedBy.get('CashOut')).toBe('enrichment');

    const boxMergedOnly = buildActorRewriteMap(config, {
      mergeByKeys: ['enrichment-degrade-on-failure'],
    }, code);
    expect(boxMergedOnly.mergedBy.get('CashOut')).toBe('enrichment-degrade-on-failure');
  });

  it('merges groups whose titles slug to the same key into one actor', () => {
    const code = `sequenceDiagram
    box Payment Service
        participant Gateway
    end
    box Payment Service
        participant Processor
    end
    Gateway->>Processor: charge`;
    const merged = transformActors(code, null, { mergeCleanByKeys: ['payment-service'] });
    expect(merged.match(/participant MergedKey_paymentservice as Payment Service/g)).toHaveLength(1);
    expect(merged).not.toContain('charge'); // internal self-call cleaned
  });

  it('unmerging restores the original code byte-for-byte', () => {
    const merged = transformActors(SEQ, null, { mergeCleanByKeys: ['payment-service'] });
    expect(merged).not.toBe(SEQ);
    expect(transformActors(SEQ, null, {})).toBe(SEQ);
  });
});

describe('transformActors subgraph tags (flowchart)', () => {
  const FLOW = `flowchart TD
    Client[Client] --> GW[Gateway]
    subgraph pay [Payment Service]
        GW --> Proc[Processor]
        Proc --> Bank[Bank]
    end
    Proc --> Client`;

  it('merges the subgraph nodes into one node labeled with the subgraph title', () => {
    const merged = transformActors(FLOW, null, { mergeByKeys: ['payment-service'] });
    expect(merged).toBe(`flowchart TD
    Client[Client] --> GW[Gateway]
    subgraph pay [Payment Service]
        GW --> MergedKey_paymentservice[Payment Service]
        MergedKey_paymentservice[Payment Service] --> MergedKey_paymentservice[Payment Service]
    end
    MergedKey_paymentservice[Payment Service] --> Client`);
  });

  it('hides the subgraph nodes and their edges when the subgraph key is off', () => {
    const hidden = transformActors(FLOW, null, { hideKeys: ['payment-service'] });
    expect(hidden).toBe(`flowchart TD
    Client[Client] --> GW[Gateway]
    subgraph pay [Payment Service]
    end`);
    const rendered = processMermaid(hidden, { isRegionVisible: () => true });
    expect(rendered.code).toBe(`flowchart TD
    Client[Client] --> GW[Gateway]`);
  });

  it('hides an edge with its own tag inside a flowchart subgraph when only its tag is off', () => {
    const code = `flowchart TD
    subgraph pay [Payment Service]
        A --> B
        B --> C
    end`;
    const config = {
      version: 1,
      arrows: [{ from: 'B', to: 'C', keys: ['flaky'] }],
    };
    // Hiding the edge's own tag 'flaky' drops the edge even though 'payment-service' is not hidden
    const hidden = transformActors(code, config, { hideKeys: ['flaky'] });
    expect(hidden).toContain('A --> B');
    expect(hidden).not.toContain('B --> C');

    // Hiding the subgraph key drops the whole subgraph
    const allHidden = transformActors(code, config, { hideKeys: ['payment-service'] });
    expect(allHidden).not.toContain('A --> B');
    expect(allHidden).not.toContain('B --> C');
  });
});

describe('subgraph tags in the surrounding machinery', () => {
  it('collectAvailableKeys lists subgraph keys even with no CONFIG', () => {
    expect(collectAvailableKeys(null, SEQ)).toEqual(['payment-service']);
    const config = { version: 1, actors: { Client: { keys: ['frontend'] } } };
    expect(collectAvailableKeys(config, SEQ)).toEqual(['frontend', 'payment-service']);
    // Without the code, only CONFIG keys are listed (backward compatible).
    expect(collectAvailableKeys(config)).toEqual(['frontend']);
  });

  it('rewriteArrowStyles follows a subgraph merge', () => {
    const config = {
      version: 1,
      arrows: [{ from: 'Client', to: 'Gateway', label: 'pay', color: 'red' }],
    };
    const resolved = rewriteArrowStyles(config, { mergeByKeys: ['payment-service'] }, SEQ);
    expect(resolved?.arrows?.[0].to).toBe('MergedKey_paymentservice');
    expect(resolved?.arrows?.[0].from).toBe('Client');
  });

  it('buildSelectionMap joins raw and processed elements across a subgraph merge', () => {
    const options = { mergeByKeys: ['payment-service'] };
    const processed = transformActors(SEQ, null, options);
    const map = buildSelectionMap(SEQ, processed, null, options);
    const rawElements = [...map.values()];
    expect(rawElements.some(el => el.kind === 'participant' && el.id === 'Gateway')).toBe(true);
    expect(rawElements.some(el => el.kind === 'participant' && el.id === 'Client')).toBe(true);
    // The boundary message still maps back to its raw counterpart.
    expect(rawElements.some(el => el.kind === 'message' && el.label === 'pay')).toBe(true);
  });

  it('getArrowTags reports the subgraph tag as an inherited (read-only) tag', () => {
    // An edge inside a flowchart subgraph carries the subgraph's tag.
    const flow = `flowchart TD
    A --> B
    subgraph pay [Payment Service]
        B --> C
    end`;
    expect(getArrowTags(flow, null, 'e:1')).toEqual({
      keys: [],
      keyMode: 'clean',
      inherited: ['payment-service'],
    });
    // e:0 is `A --> B`, outside the subgraph
    expect(getArrowTags(flow, null, 'e:0')).toEqual({
      keys: [],
      keyMode: 'clean',
      inherited: [],
    });
    // A message inside a sequence subgraph span does too.
    const seq = `sequenceDiagram
    subgraph Payment Service
        A->>B: ping
    end`;
    expect(getArrowTags(seq, null, 'm:0')?.inherited).toEqual(['payment-service']);
  });
});

describe('subgraph tags (rendered)', () => {
  it('a clean subgraph merge renders as a single actor with only boundary messages', async () => {
    const res = await renderPipeline(SEQ, { mergeCleanByKeys: ['payment-service'] });
    const text = svgText(res.svg);
    expect(text).toContain('Payment Service');
    expect(text).toContain('pay');
    expect(text).toContain('receipt');
    expect(text).not.toContain('charge');
    // The merged actor is declared exactly once.
    const participants = res.model.elements.filter(e => e.kind === 'participant');
    expect(participants.map(p => p.id)).toEqual(['Client', 'MergedKey_paymentservice']);
  });

  it('a subgraph merge keeps internal self-calls in merged (non-clean) mode', async () => {
    const res = await renderPipeline(SEQ, { mergeByKeys: ['payment-service'] });
    const text = svgText(res.svg);
    expect(text).toContain('charge');
    expect(text).toContain('pay');
    expect(text).toContain('receipt');
  });

  it('hiding the subgraph key removes the internals from the rendered diagram', async () => {
    const res = await renderPipeline(SEQ, { hideKeys: ['payment-service'] });
    const text = svgText(res.svg);
    expect(text).toContain('Client');
    expect(text).not.toContain('Gateway');
    expect(text).not.toContain('Processor');
    expect(text).not.toContain('pay');
    expect(text).not.toContain('receipt');
  });

  it('a flowchart subgraph merge renders as a single node', async () => {
    const FLOW = `flowchart TD
    Client[Client] --> GW[Gateway]
    subgraph pay [Payment Service]
        GW --> Proc[Processor]
        Proc --> Bank[Bank]
    end
    Proc --> Client`;
    const res = await renderPipeline(FLOW, { mergeCleanByKeys: ['payment-service'] });
    const doc = new DOMParser().parseFromString(res.svg, 'text/html');
    const labels = Array.from(doc.querySelectorAll('g.node .nodeLabel')).map(el => el.textContent?.trim());
    expect(labels).toEqual(['Client', 'Gateway', 'Payment Service']);
  });
});
