import { describe, it, expect } from 'vitest';
import mermaid from 'mermaid';
import { transformActors, processMermaid, buildActorRewriteMap } from './preprocessor';

describe('Diagram robust parsing and transformations', () => {
  mermaid.initialize({ startOnLoad: false });

  it('does not corrupt message text or aliases when merging', () => {
    const code = `sequenceDiagram
    participant PR as Pull Request Service
    participant Client
    Client->>Client: Review PR now and see Results`;

    const config = {
      version: 1,
      actors: {
        PR: { keys: ['activity'] },
      },
    };

    const transformed = transformActors(code, config, { mergeByKeys: ['activity'] });
    expect(transformed).toContain('Client->>Client: Review PR now and see Results');
    expect(transformed).not.toContain('Review MergedKey_activity now');
  });

  it('does not drop unrelated messages or boxes when an actor name is in text', async () => {
    const code = `sequenceDiagram
    box PR Services
        participant PR
    end
    participant Client
    Client->>Client: Review PR now`;

    const config = {
      version: 1,
      actors: {
        PR: { keys: ['activity'] },
      },
    };

    const transformed = transformActors(code, config, { hideKeys: ['activity'] });
    const processed = processMermaid(transformed, { isRegionVisible: () => true });

    // The unrelated message must survive
    expect(processed.code).toContain('Client->>Client: Review PR now');
    // The diagram must parse in mermaid with no error
    await expect(mermaid.parse(processed.code)).resolves.not.toThrow();
  });

  it('does not corrupt flowchart subgraph headers or edge labels when merging or hiding', async () => {
    const code = `flowchart TD
    subgraph S1 [PR Service]
        direction TB
        PR[PR Node] --> Other[Other Node]
    end
    Client[Client] -->|Check PR status| Server[Server]`;

    const config = {
      version: 1,
      actors: {
        PR: { keys: ['activity'] },
      },
    };

    // Merged
    const merged = transformActors(code, config, { mergeByKeys: ['activity'] });
    expect(merged).toContain('|Check PR status|');
    await expect(mermaid.parse(merged)).resolves.not.toThrow();

    // Hidden
    const hidden = transformActors(code, config, { hideKeys: ['activity'] });
    const processedHidden = processMermaid(hidden, { isRegionVisible: () => true });
    expect(processedHidden.code).toContain('|Check PR status|');
    await expect(mermaid.parse(processedHidden.code)).resolves.not.toThrow();
  });

  it('preserves note text while renaming note participants', async () => {
    const code = `sequenceDiagram
    participant PR
    participant Client
    Note over PR, Client: Discuss PR deployment details`;

    const config = {
      version: 1,
      actors: {
        PR: { keys: ['activity'] },
      },
    };

    const transformed = transformActors(code, config, { mergeByKeys: ['activity'] });
    expect(transformed).toContain('Note over MergedKey_activity, Client: Discuss PR deployment details');
    const processed = processMermaid(transformed, { isRegionVisible: () => true });
    await expect(mermaid.parse(processed.code)).resolves.not.toThrow();
  });

  it('handles activation and deactivation lines cleanly when hiding', async () => {
    const code = `sequenceDiagram
    participant PR
    participant Client
    Client->>PR: Request
    activate PR
    PR-->>Client: Response
    deactivate PR`;

    const config = {
      version: 1,
      actors: {
        PR: { keys: ['activity'] },
      },
    };

    const hidden = transformActors(code, config, { hideKeys: ['activity'] });
    expect(hidden).not.toContain('activate PR');
    expect(hidden).not.toContain('deactivate PR');
    const processed = processMermaid(hidden, { isRegionVisible: () => true });
    await expect(mermaid.parse(processed.code)).resolves.not.toThrow();
  });

  it('drops flowchart self-calls in clean merge mode regardless of edge labels', async () => {
    const code = `flowchart TD
    A[Node A] -->|Internal sync| B[Node B]
    A --> C[Outside Node]`;

    const config = {
      version: 1,
      actors: {
        A: { keys: ['group1'] },
        B: { keys: ['group1'] },
      },
    };

    const mergedClean = transformActors(code, config, { mergeCleanByKeys: ['group1'] });
    expect(mergedClean).not.toContain('Internal sync');
    expect(mergedClean).toContain('Outside Node');
    const processed = processMermaid(mergedClean, { isRegionVisible: () => true });
    await expect(mermaid.parse(processed.code)).resolves.not.toThrow();
  });

  it('cleans up dangling unmatched end lines to avoid fatal syntax errors', async () => {
    const code = `sequenceDiagram
    end
    participant Client
    Client->>Client: Hello`;

    const processed = processMermaid(code, { isRegionVisible: () => true });
    expect(processed.code).not.toContain('    end\n    participant Client');
    await expect(mermaid.parse(processed.code)).resolves.not.toThrow();
  });

  it('reports mergedBy with CONFIG keys taking precedence over structural box keys', () => {
    const code = `sequenceDiagram
    box Enrichment (degrade on failure)
    participant CashOut
    end`;

    const config = {
      version: 1,
      actors: {
        CashOut: { keys: ['enrichment'] },
      },
    };

    // Both merged: CONFIG key wins
    const mapBoth = buildActorRewriteMap(config, {
      mergeByKeys: ['enrichment', 'enrichment-degrade-on-failure'],
    }, code);
    expect(mapBoth.mergedBy.get('CashOut')).toBe('enrichment');

    // Only box key merged: box key wins
    const mapBox = buildActorRewriteMap(config, {
      mergeByKeys: ['enrichment-degrade-on-failure'],
    }, code);
    expect(mapBox.mergedBy.get('CashOut')).toBe('enrichment-degrade-on-failure');

    // Unmerged: not in mergedBy
    const mapNone = buildActorRewriteMap(config, {
      mergeByKeys: [],
    }, code);
    expect(mapNone.mergedBy.has('CashOut')).toBe(false);
  });
});
