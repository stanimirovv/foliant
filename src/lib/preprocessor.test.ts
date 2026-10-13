import { describe, it, expect } from 'vitest';
import { processMermaid, transformActors, isPathHidden } from './preprocessor';

describe('processMermaid', () => {
  it('keeps all lines if no regions are defined', () => {
    const code = `sequenceDiagram\n  A->>B: Hello\n  B->>A: Hi`;
    const result = processMermaid(code, { isRegionVisible: () => true });
    expect(result.code).toBe(code);
    expect(result.warnings).toHaveLength(0);
  });

  it('strips a region if it is hidden', () => {
    const code = `sequenceDiagram\n  A->>B: Hello\n  %% @region-start: flow\n  B->>A: Hi\n  %% @region-end\n  A->>B: Bye`;
    const result = processMermaid(code, { isRegionVisible: () => false });
    expect(result.code).toBe(`sequenceDiagram\n  A->>B: Hello\n  A->>B: Bye`);
  });

  it('handles nested regions', () => {
    const code = `sequenceDiagram\n  %% @region-start: flow\n  A->>B: Hello\n  %% @region-start: note\n  Note over A,B: Test\n  %% @region-end\n  %% @region-end`;
    
    const res1 = processMermaid(code, { isRegionVisible: (r) => r.path === 'flow' });
    expect(res1.code).toBe(`sequenceDiagram\n  A->>B: Hello`);

    const res2 = processMermaid(code, { isRegionVisible: () => true });
    expect(res2.code).toBe(`sequenceDiagram\n  A->>B: Hello\n  Note over A,B: Test`);
  });

  it('cleans up empty alt blocks', () => {
    const code = `sequenceDiagram\n  alt Is True\n    %% @region-start: hidden\n    A->>B: Hello\n    %% @region-end\n  end`;
    const result = processMermaid(code, { isRegionVisible: () => false });
    expect(result.code).toBe('sequenceDiagram');
  });

  it('cleans up empty alt/else/end blocks', () => {
    const code = `sequenceDiagram\n  alt Is True\n    A->>B: Hello\n  else Is False\n    %% @region-start: hidden\n    B->>A: Bye\n    %% @region-end\n  end`;
    const result = processMermaid(code, { isRegionVisible: () => false });
    expect(result.code).toBe(`sequenceDiagram\n  alt Is True\n    A->>B: Hello\nend`);
  });

  it('soft fails and returns original code on unclosed tags', () => {
    const code = `sequenceDiagram\n  %% @region-start: flow\n  A->>B: Hello`;
    const result = processMermaid(code, { isRegionVisible: () => false });
    expect(result.code).toBe(code);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('filters based on custom tag regions', () => {
    const code = `sequenceDiagram
  A->>B: Baseline
  %% @region-start: tag=beta
  A->>B: Beta Feature
  %% @region-end
  %% @region-start: tag=experimental
  A->>B: Experimental Feature
  %% @region-end
  A->>B: End`;
    const result = processMermaid(code, { 
      isRegionVisible: (r) => r.type !== 'tag' || r.value !== 'beta'
    });
    expect(result.code).toBe(`sequenceDiagram
  A->>B: Baseline
  A->>B: Experimental Feature
  A->>B: End`);
  });

  it('soft fails on unmatched end tags', () => {
    const code = `sequenceDiagram\n  A->>B: Hello\n  %% @region-end`;
    const result = processMermaid(code, { isRegionVisible: () => false });
    expect(result.code).toBe(code);
    expect(result.warnings).toContain('Unmatched region end tag at line 3');
  });

  it('soft fails on malformed start tags', () => {
    const code = `sequenceDiagram\n  %% @region-start: \n  A->>B: Hello\n  %% @region-end`;
    const result = processMermaid(code, { isRegionVisible: () => false });
    expect(result.code).toBe(code);
    expect(result.warnings).toContain('Invalid region start tag at line 2');
  });

  it('filters regions in a flowchart', () => {
    const code = `flowchart TD
  A --> B
  %% @region-start: tag=experimental
  subgraph Experimental
    B --> C
  end
  %% @region-end
  B --> D`;
    const result = processMermaid(code, { 
      isRegionVisible: (r) => r.type !== 'tag' || r.value !== 'experimental'
    });
    expect(result.code).toBe(`flowchart TD
  A --> B
  B --> D`);
  });
});

describe('transformActors', () => {
  it('does not wrap colored actors in box zones (colors apply via SVG post-processing)', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: Message
  B->>C: Reply`;
    const config = {
      version: 1,
      actors: {
        A: { color: 'red' },
        B: { color: 'red' }
      }
    };
    const result = transformActors(code, config, {});
    expect(result).toBe(`sequenceDiagram
  participant A
  participant B
  A->>B: Message
  B->>C: Reply`);
  });

  it('hides actors by color', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: Message
  C->>D: Hello`;
    const config = {
      version: 1,
      actors: {
        A: { color: 'red' }
      }
    };
    const result = transformActors(code, config, { hideColors: ['red'] });
    expect(result).toBe(`sequenceDiagram
  participant B
  C->>D: Hello`);
  });

  it('hides actors by key', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: Message
  B->>C: Reply`;
    const config = {
      version: 1,
      actors: {
        B: { keys: ['internal'] }
      }
    };
    const result = transformActors(code, config, { hideKeys: ['internal'] });
    expect(result).toBe(`sequenceDiagram
  participant A`);
  });

  it('merges actors by key', () => {
    const code = `sequenceDiagram
  participant A as API
  participant B as DB
  participant C as Client
  A->>B: Fetch
  B-->>A: Data
  A->>C: Response`;
    const config = {
      version: 1,
      actors: {
        A: { keys: ['backend'] },
        B: { keys: ['backend'] }
      }
    };
    const result = transformActors(code, config, { mergeByKeys: ['backend'] });
    expect(result).toBe(`sequenceDiagram
  participant C as Client
    box #ccc BACKEND Zone
    participant MergedKey_backend as Merged backend
    end
  MergedKey_backend->>MergedKey_backend: Fetch
  MergedKey_backend-->>MergedKey_backend: Data
  MergedKey_backend->>C: Response`);
  });

  it('merges actors by key and hides self calls (Clean)', () => {
    const code = `sequenceDiagram
  participant A as API
  participant B as DB
  participant C as Client
  A->>B: Fetch
  B-->>A: Data
  A->>C: Response`;
    const config = {
      version: 1,
      actors: {
        A: { keys: ['backend'] },
        B: { keys: ['backend'] }
      }
    };
    const result = transformActors(code, config, { mergeCleanByKeys: ['backend'] });
    expect(result).toBe(`sequenceDiagram
  participant C as Client
    box #ccc BACKEND Zone
    participant MergedKey_backend as Merged backend
    end
  MergedKey_backend->>C: Response`);
  });

  it('fixes self-notes when merged and hides self-calls by key (Clean)', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: Do work
  Note over A,B: Internal computation
  B-->>A: Done
  A->>C: Output`;
    const config = {
      version: 1,
      actors: {
        A: { keys: ['backend'] },
        B: { keys: ['backend'] }
      }
    };
    const result = transformActors(code, config, { mergeCleanByKeys: ['backend'] });
    expect(result).toBe(`sequenceDiagram
    box #ccc BACKEND Zone
    participant MergedKey_backend as Merged backend
    end
  Note over MergedKey_backend: Internal computation
  MergedKey_backend->>C: Output`);
  });

  it('prints the entire tag after "Merged " for tags with special characters and spaces', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: Call`;
    const config = {
      version: 1,
      actors: {
        A: { keys: ['backend-service:v2'] },
        B: { keys: ['backend-service:v2'] }
      }
    };
    const result = transformActors(code, config, { mergeByKeys: ['backend-service:v2'] });
    expect(result).toContain('participant MergedKey_backendservicev2 as Merged backend-service:v2');
    expect(result).toContain('box #ccc BACKEND-SERVICE:V2 Zone');
  });

  it('merges actors by key and hides self calls in a flowchart (Clean)', () => {
    const code = `flowchart TD
  A[API] --> B
  B --> C[Client]
  B -->|message| B
  B --> B[Database]`;
    const config = {
      version: 1,
      actors: {
        A: { keys: ['backend'] },
        B: { keys: ['backend'] }
      }
    };
    const result = transformActors(code, config, { mergeCleanByKeys: ['backend'] });
    expect(result).toBe(`flowchart TD
  MergedKey_backend[Merged backend] --> C[Client]`);
  });

  it('when an actor has multiple tags, shows it if any tag is shown and hides it only when all tags are disabled', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: Call`;
    const config = {
      version: 1,
      actors: {
        A: { keys: ['backend', 'core'] },
        B: { keys: ['frontend'] },
      },
    };
    // Only one tag disabled: actor A is shown because 'core' is still enabled
    const oneHidden = transformActors(code, config, { hideKeys: ['backend'] });
    expect(oneHidden).toContain('participant A');
    expect(oneHidden).toContain('A->>B: Call');

    // All tags disabled: actor A is hidden
    const allHidden = transformActors(code, config, { hideKeys: ['backend', 'core'] });
    expect(allHidden).not.toContain('participant A');
    expect(allHidden).not.toContain('A->>B: Call');
    expect(allHidden).toContain('participant B');
  });
});

describe('transformActors message/edge tags', () => {
  // Messages follow the by-key filter, but only as on/off: an own tag (or an
  // inherited one, unless keyMode is 'clean') hides the message line when the
  // key is hidden; merging never applies to messages.
  const code = `sequenceDiagram
  participant A
  participant B
  participant C
  A->>B: Call
  B->>C: Forward
  C->>A: Back`;
  const config = {
    version: 1,
    actors: { A: { keys: ['backend'] } },
    arrows: [
      { from: 'B', to: 'C', label: 'Forward', keys: ['flaky'] },
      { from: 'C', to: 'A', label: 'Back', keys: ['internal'], keyMode: 'clean' as const },
    ],
  };

  it('hides a message carrying a hidden key, keeping the rest', () => {
    const result = transformActors(code, config, { hideKeys: ['flaky'] });
    expect(result).toBe(`sequenceDiagram
  participant A
  participant B
  participant C
  A->>B: Call
  C->>A: Back`);
  });

  it('a hidden actor key still hides the service and its messages', () => {
    const result = transformActors(code, config, { hideKeys: ['backend'] });
    expect(result).toBe(`sequenceDiagram
  participant B
  participant C
  B->>C: Forward`);
  });

  it('hides a message by its own tag even when no actors are in CONFIG', () => {
    const code2 = `sequenceDiagram
  participant A
  participant B
  A->>B: Call
  A->>B: Note`;
    const cfg2 = {
      version: 1,
      arrows: [{ from: 'A', to: 'B', label: 'Note', keys: ['draft'] }],
    };
    const result = transformActors(code2, cfg2, { hideKeys: ['draft'] });
    expect(result).toBe(`sequenceDiagram
  participant A
  participant B
  A->>B: Call`);
  });

  it('hides flowchart edges carrying a hidden key', () => {
    const flow = `flowchart TD
    A[App] --> B[API]
    B --> C[DB]
    A --> D[Cache]`;
    const cfg = {
      version: 1,
      actors: { B: { keys: ['backend'] } },
      arrows: [{ from: 'B', to: 'C', keys: ['flaky'] }],
    };
    const result = transformActors(flow, cfg, { hideKeys: ['flaky'] });
    expect(result).toBe(`flowchart TD
    A[App] --> B[API]
    A --> D[Cache]`);
  });

  it('colors never hide messages by themselves (tags respond to keys only)', () => {
    const cfg = {
      version: 1,
      actors: { A: { color: 'red' } },
      arrows: [{ from: 'B', to: 'C', label: 'Forward', keys: ['flaky'] }],
    };
    const result = transformActors(code, cfg, { hideColors: ['red'] });
    expect(result).toBe(`sequenceDiagram
  participant B
  participant C
  B->>C: Forward`);
  });

  it('does not hide messages for keys that are only merged (on/off only)', () => {
    // 'flaky' exists only on a message: merging cannot apply to it, the line stays
    const result = transformActors(code, config, { mergeByKeys: ['flaky'] });
    expect(result).toBe(code);
  });

  it('is a no-op when no key is hidden, even with arrow tags present', () => {
    expect(transformActors(code, config, {})).toBe(code);
    // merging an actor key renames endpoints but never drops tagged messages
    const merged = transformActors(code, config, { mergeByKeys: ['backend'] });
    expect(merged).toContain('MergedKey_backend->>B: Call');
    expect(merged).toContain('B->>C: Forward');
  });

  it('when an arrow has multiple tags, shows it if any tag is shown and hides it only when all tags are disabled', () => {
    const multiTagCode = `sequenceDiagram
  participant A
  participant B
  A->>B: MultiTag
  A->>B: Other`;
    const multiTagConfig = {
      version: 1,
      arrows: [
        { from: 'A', to: 'B', label: 'MultiTag', keys: ['flaky', 'beta'] },
      ],
    };
    // Only one tag disabled: arrow is shown because 'beta' is still enabled
    const oneHidden = transformActors(multiTagCode, multiTagConfig, { hideKeys: ['flaky'] });
    expect(oneHidden).toContain('A->>B: MultiTag');
    expect(oneHidden).toContain('A->>B: Other');

    // All tags disabled: arrow is hidden
    const allHidden = transformActors(multiTagCode, multiTagConfig, { hideKeys: ['flaky', 'beta'] });
    expect(allHidden).not.toContain('A->>B: MultiTag');
    expect(allHidden).toContain('A->>B: Other');
  });
});

describe('isPathHidden', () => {
  it('matches exact paths', () => {
    const hidden = new Set(['flow=login/edge-case=invalid']);
    expect(isPathHidden('flow=login/edge-case=invalid', hidden)).toBe(true);
    expect(isPathHidden('flow=login', hidden)).toBe(false);
  });

  it('matches leaf segment tag names in nested regions', () => {
    const hidden = new Set(['tag=beta', 'tag=experimental']);
    expect(isPathHidden('flow=login/tag=beta', hidden)).toBe(true);
    expect(isPathHidden('flow=login/tag=experimental', hidden)).toBe(true);
    expect(isPathHidden('flow=login', hidden)).toBe(false);
  });

  it('matches subpath suffixes', () => {
    const hidden = new Set(['nested/tag=beta']);
    expect(isPathHidden('flow=login/nested/tag=beta', hidden)).toBe(true);
    expect(isPathHidden('flow=login/other/tag=beta', hidden)).toBe(false);
  });

  it('hides nested region lines in processMermaid when leaf tag is in hiddenPaths', () => {
    const diagram = `flowchart TD
    %% @region-start: flow=login
    subgraph Login
      A --> B
      %% @region-start: tag=beta
      B --> C
      %% @region-end
    end
    %% @region-end`;

    const hidden = new Set(['tag=beta']);
    const result = processMermaid(diagram, {
      isRegionVisible: (r) => !isPathHidden(r.path, hidden),
    });

    expect(result.code).toContain('A --> B');
    expect(result.code).not.toContain('B --> C');
  });
});
