import { describe, it, expect } from 'vitest';
import { processMermaid } from './preprocessor';

describe('processMermaid', () => {
  it('keeps all lines if no regions are defined', () => {
    const code = `sequenceDiagram
    A->>B: Hello`;
    const result = processMermaid(code, { isRegionVisible: () => true });
    expect(result.code).toContain('A->>B: Hello');
  });

  it('strips a region if it is hidden', () => {
    const code = `sequenceDiagram
    A->>B: Start
    %% @region-start: flow=login
    A->>B: Login
    %% @region-end
    A->>B: End`;
    
    const result = processMermaid(code, { 
      isRegionVisible: (region) => region.path !== 'flow=login' 
    });
    
    expect(result.code).toContain('Start');
    expect(result.code).not.toContain('Login');
    expect(result.code).toContain('End');
  });

  it('handles nested regions', () => {
    const code = `sequenceDiagram
    %% @region-start: flow=login
    A->>B: Login
    %% @region-start: note
    Note over A,B: User logs in
    %% @region-end
    %% @region-end`;

    // Hide note inside login
    let result = processMermaid(code, { 
      isRegionVisible: (region) => region.path !== 'flow=login/note' 
    });
    
    expect(result.code).toContain('Login');
    expect(result.code).not.toContain('Note over');

    // Hide login entirely
    result = processMermaid(code, { 
      isRegionVisible: (region) => region.path !== 'flow=login' 
    });
    expect(result.code).not.toContain('Login');
    expect(result.code).not.toContain('Note over');
  });

  it('cleans up empty alt blocks', () => {
    const code = `sequenceDiagram
    alt Success
        %% @region-start: flow=hidden
        A->>B: Success
        %% @region-end
    end
    C->>D: Next`;

    const result = processMermaid(code, { 
      isRegionVisible: () => false 
    });
    
    expect(result.code).not.toContain('alt Success');
    expect(result.code).not.toContain('end');
    expect(result.code).toContain('C->>D: Next');
  });

  it('cleans up empty alt/else/end blocks', () => {
    const code = `sequenceDiagram
    alt Success
        %% @region-start: flow=hidden
        A->>B: Success
        %% @region-end
    else Failure
        %% @region-start: flow=hidden
        A->>B: Failure
        %% @region-end
    end`;

    const result = processMermaid(code, { 
      isRegionVisible: () => false 
    });
    
    expect(result.code).not.toContain('alt Success');
    expect(result.code).not.toContain('else Failure');
    expect(result.code).not.toContain('end');
  });

  it('soft fails and returns original code on unclosed tags', () => {
    const code = `sequenceDiagram
    %% @region-start: flow=login
    A->>B: Login`;

    const result = processMermaid(code, { 
      isRegionVisible: () => false 
    });
    
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.code).toContain('%% @region-start: flow=login');
    expect(result.code).toContain('A->>B: Login');
  });
});
