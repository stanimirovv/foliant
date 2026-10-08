import { describe, it, expect } from 'vitest';
import { processMermaid, transformActors } from './preprocessor';

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
});

describe('transformActors', () => {
  it('merges actors by color', () => {
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
    const result = transformActors(code, config, { mergeByColor: ['red'] });
    expect(result).toBe(`sequenceDiagram
    box red RED Zone
    participant MergedColor_red as Merged red
    end
  MergedColor_red->>MergedColor_red: Message
  MergedColor_red->>C: Reply`);
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

  it('fixes self-notes when merged and hides self-calls by color (Clean)', () => {
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
        A: { color: 'red' },
        B: { color: 'red' }
      }
    };
    const result = transformActors(code, config, { mergeCleanByColor: ['red'] });
    expect(result).toBe(`sequenceDiagram
    box red RED Zone
    participant MergedColor_red as Merged red
    end
  Note over MergedColor_red: Internal computation
  MergedColor_red->>C: Output`);
  });
});
