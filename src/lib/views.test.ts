import { describe, it, expect } from 'vitest';
import { parseViewsData, updateViewsData, DiagramConfig } from './views';

describe('Views parsing and updating', () => {
  it('parses valid views data from the first line with %% VIEWS:', () => {
    const code = `%% VIEWS: {"version":1,"views":[{"name":"Test","hiddenPaths":["a","b"]}]}
sequenceDiagram
  A->>B: Hello`;
    const data = parseViewsData(code);
    expect(data).toEqual({
      version: 1,
      views: [{ name: 'Test', hiddenPaths: ['a', 'b'] }]
    });
  });

  it('parses valid views data from the first line with %% CONFIG:', () => {
    const code = `%% CONFIG: {"version":1,"actors":{"A":{"color":"red"}}}
sequenceDiagram
  A->>B: Hello`;
    const data = parseViewsData(code);
    expect(data).toEqual({
      version: 1,
      actors: { A: { color: 'red' } }
    });
  });

  it('adds config data to code without config using %% CONFIG:', () => {
    const code = `sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = {
      version: 1,
      views: [{ name: 'New View', hiddenPaths: ['path1'] }]
    };
    const newCode = updateViewsData(code, config);
    expect(newCode).toBe(`%% CONFIG: {"version":1,"views":[{"name":"New View","hiddenPaths":["path1"]}]}
sequenceDiagram
  A->>B: Hello`);
  });

  it('removes config line if config is null or empty', () => {
    const code = `%% CONFIG: {"version":1,"views":[{"name":"View to delete","hiddenPaths":["path2"]}]}
sequenceDiagram
  A->>B: Hello`;
    const config: DiagramConfig = {
      version: 1,
      views: [],
      actors: {}
    };
    const newCode = updateViewsData(code, config);
    expect(newCode).toBe(`sequenceDiagram
  A->>B: Hello`);
  });
});
