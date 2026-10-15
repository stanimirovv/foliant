import { describe, it, expect } from 'vitest';
import {
  EMPTY_DIAGRAM_VIEW_SELECTION,
  applyMarkdownViewState,
  findSavedView,
  parseMarkdownViewStates,
  renderDiagramWithView,
  resolveDiagramViewState,
} from './diagramView';
import { parseViewsData } from './views';

const CONFIG = '%% CONFIG: {"version":1,"actors":{"Client":{"keys":["frontend"]},"Auth":{"keys":["backend"]},"DB":{"keys":["backend","database"]}},"arrows":[{"from":"Client","to":"Auth","label":"Login","keys":["critical"]}],"views":[{"name":"Backend only","hideKeys":["frontend"]},{"name":"No login flow","hiddenPaths":["flow=login"]},{"name":"Merged backend","mergeKeys":["backend"],"hideColors":["red"]}]}';

const DIAGRAM = [
  CONFIG,
  'sequenceDiagram',
  '    participant Client as Client',
  '    participant Auth as Auth Service',
  '    participant DB as Database',
  '    Client->>Auth: Login',
  '    Auth->>DB: Fetch User',
  '    Client->>DB: Direct',
].join('\n');

const config = parseViewsData(DIAGRAM);

describe('findSavedView', () => {
  it('finds a view by name and returns null for unknown names or missing config', () => {
    expect(findSavedView(config, 'Backend only')?.hideKeys).toEqual(['frontend']);
    expect(findSavedView(config, 'Nope')).toBeNull();
    expect(findSavedView(config, null)).toBeNull();
    expect(findSavedView(config, undefined)).toBeNull();
    expect(findSavedView(null, 'Backend only')).toBeNull();
  });
});

describe('resolveDiagramViewState', () => {
  it('uses the manual tag toggles when no view is selected', () => {
    const { hiddenPaths, actorOptions } = resolveDiagramViewState(config, {
      viewName: null,
      hideKeys: ['backend'],
    });
    expect(hiddenPaths.size).toBe(0);
    expect(actorOptions.hideKeys).toEqual(['backend']);
    expect(actorOptions.mergeByKeys).toEqual([]);
    expect(actorOptions.mergeCleanByKeys).toEqual([]);
    expect(actorOptions.hideColors).toEqual([]);
  });

  it('lets a saved view override the manual tag toggles', () => {
    const { hiddenPaths, actorOptions } = resolveDiagramViewState(config, {
      viewName: 'Backend only',
      hideKeys: ['backend'],
    });
    expect(actorOptions.hideKeys).toEqual(['frontend']);
    expect(hiddenPaths.size).toBe(0);
  });

  it('resolves the view\'s regions, merge keys and hidden colors', () => {
    const { hiddenPaths } = resolveDiagramViewState(config, {
      viewName: 'No login flow',
    });
    expect(Array.from(hiddenPaths)).toEqual(['flow=login']);
    const merged = resolveDiagramViewState(config, { viewName: 'Merged backend' });
    expect(merged.actorOptions.mergeByKeys).toEqual(['backend']);
    expect(merged.actorOptions.hideColors).toEqual(['red']);
  });

  it('falls back to the manual toggles when the named view does not exist', () => {
    const { actorOptions } = resolveDiagramViewState(config, {
      viewName: 'Deleted view',
      hideKeys: ['critical'],
    });
    expect(actorOptions.hideKeys).toEqual(['critical']);
  });

  it('supports the legacy mergeByKeys/mergeCleanByKeys view fields', () => {
    const legacy = parseViewsData(
      '%% VIEWS: {"version":1,"views":[{"name":"Old","hiddenPaths":["a"],"mergeByKeys":["k1"],"mergeCleanByKeys":["k2"]}]}\nsequenceDiagram\n  A->>B: x',
    );
    const { hiddenPaths, actorOptions } = resolveDiagramViewState(legacy, { viewName: 'Old' });
    expect(Array.from(hiddenPaths)).toEqual(['a']);
    expect(actorOptions.mergeByKeys).toEqual(['k1']);
    expect(actorOptions.mergeCleanByKeys).toEqual(['k2']);
  });
});

describe('renderDiagramWithView', () => {
  it('passes the raw code through when there is no config and no selection', () => {
    const code = 'sequenceDiagram\n    A->>B: Hello';
    const result = renderDiagramWithView(code, null, EMPTY_DIAGRAM_VIEW_SELECTION);
    expect(result.code).toBe(code);
    expect(result.warnings).toEqual([]);
  });

  it('hides actors whose tags are all toggled off (and the lines that mention them)', () => {
    const { code } = renderDiagramWithView(DIAGRAM, config, { viewName: null, hideKeys: ['frontend'] });
    expect(code).not.toContain('participant Client');
    expect(code).not.toContain('Client->>Auth: Login');
    expect(code).not.toContain('Client->>DB: Direct');
    expect(code).toContain('participant Auth');
    expect(code).toContain('Auth->>DB: Fetch User');
  });

  it('keeps an actor when only some of its tags are off', () => {
    const { code } = renderDiagramWithView(DIAGRAM, config, { viewName: null, hideKeys: ['database'] });
    expect(code).toContain('participant DB');
    const allOff = renderDiagramWithView(DIAGRAM, config, { viewName: null, hideKeys: ['backend', 'database'] });
    expect(allOff.code).not.toContain('participant DB');
    expect(allOff.code).not.toContain('Auth->>DB: Fetch User');
  });

  it('hides arrows whose own tags are all toggled off, keeping their actors', () => {
    const { code } = renderDiagramWithView(DIAGRAM, config, { viewName: null, hideKeys: ['critical'] });
    expect(code).not.toContain('Client->>Auth: Login');
    expect(code).toContain('participant Client');
    expect(code).toContain('Client->>DB: Direct');
  });

  it('applies a saved view instead of the manual toggles', () => {
    const { code } = renderDiagramWithView(DIAGRAM, config, {
      viewName: 'Backend only',
      hideKeys: ['backend'],
    });
    // the view hides the frontend actor, not the backend actors
    expect(code).not.toContain('participant Client');
    expect(code).toContain('participant Auth');
    expect(code).toContain('participant DB');
  });

  it('hides regions listed in the view\'s hiddenPaths', () => {
    const withRegions = [
      CONFIG,
      'sequenceDiagram',
      '    participant A',
      '    participant B',
      '    %% @region-start: flow=login',
      '    A->>B: Login',
      '    %% @region-end',
      '    A->>B: Always',
    ].join('\n');
    const cfg = parseViewsData(withRegions);
    const { code } = renderDiagramWithView(withRegions, cfg, { viewName: 'No login flow' });
    expect(code).not.toContain('A->>B: Login');
    expect(code).toContain('A->>B: Always');
    expect(code).not.toContain('@region-start');
  });

  it('soft-fails on malformed region tags: raw code plus a warning', () => {
    const malformed = [
      'sequenceDiagram',
      '    participant A',
      '    %% @region-start: flow=login',
      '    A->>B: Login',
    ].join('\n');
    const { code, warnings } = renderDiagramWithView(malformed, null, { viewName: null, hideKeys: ['x'] });
    expect(warnings.length).toBeGreaterThan(0);
    expect(code).toContain('%% @region-start: flow=login');
    expect(code).toContain('A->>B: Login');
  });

  it('keeps the %% CONFIG line when the pipeline does not rewrite anything', () => {
    const viewsOnly = parseViewsData(DIAGRAM);
    const { code } = renderDiagramWithView(DIAGRAM, viewsOnly, EMPTY_DIAGRAM_VIEW_SELECTION);
    expect(code).toContain('%% CONFIG:');
    expect(code).toContain('sequenceDiagram');
  });
});

describe('markdown preview URL state (mdview.<i>/mdhide.<i> params)', () => {
  it('parses an empty query string to an empty map', () => {
    expect(parseMarkdownViewStates('').size).toBe(0);
    expect(parseMarkdownViewStates('file=notes.md&dir=%2Ftmp').size).toBe(0);
  });

  it('parses per-block view selections, decoding free-form view names', () => {
    const states = parseMarkdownViewStates('mdview.0=Happy%20Path&mdview.2=Focus');
    expect(states.get(0)).toEqual({ viewName: 'Happy Path', hideKeys: [] });
    expect(states.get(2)).toEqual({ viewName: 'Focus', hideKeys: [] });
    expect(states.has(1)).toBe(false);
  });

  it('parses view names containing commas, colons or percent signs', () => {
    const states = parseMarkdownViewStates('mdview.0=A%2CB%3AC&mdview.1=100%25');
    expect(states.get(0)?.viewName).toBe('A,B:C');
    expect(states.get(1)?.viewName).toBe('100%');
  });

  it('parses per-block hidden tags (comma-joined per block)', () => {
    const states = parseMarkdownViewStates('mdhide.0=backend,critical&mdhide.2=edge-case');
    expect(states.get(0)?.hideKeys).toEqual(['backend', 'critical']);
    expect(states.get(2)?.hideKeys).toEqual(['edge-case']);
    expect(states.get(0)?.viewName ?? null).toBeNull();
  });

  it('ignores params that do not match the per-block scheme', () => {
    const states = parseMarkdownViewStates('mdview=0:Old&mdhide=0:backend&mdview.x=A&other=1');
    expect(states.size).toBe(0);
  });

  it('applyMarkdownViewState sets the params and round-trips through parse', () => {
    const params = new URLSearchParams('file=notes.md&dir=%2Ftmp');
    applyMarkdownViewState(params, 0, { viewName: 'Happy Path', hideKeys: [] });
    expect(params.get('file')).toBe('notes.md');
    expect(params.get('mdview.0')).toBe('Happy Path');
    expect(params.get('mdhide.0')).toBeNull();
    const parsed = parseMarkdownViewStates(params.toString());
    expect(parsed.get(0)).toEqual({ viewName: 'Happy Path', hideKeys: [] });
  });

  it('applyMarkdownViewState round-trips view names with special characters', () => {
    const params = new URLSearchParams();
    applyMarkdownViewState(params, 3, { viewName: 'A,B: 100%', hideKeys: ['backend'] });
    const parsed = parseMarkdownViewStates(params.toString());
    expect(parsed.get(3)).toEqual({ viewName: 'A,B: 100%', hideKeys: ['backend'] });
  });

  it('applyMarkdownViewState keeps other blocks\' entries and replaces only the given block', () => {
    const params = new URLSearchParams('mdview.0=Old&mdhide.0=backend&mdhide.1=critical');
    applyMarkdownViewState(params, 0, { viewName: null, hideKeys: ['frontend'] });
    expect(params.get('mdview.0')).toBeNull();
    const parsed = parseMarkdownViewStates(params.toString());
    expect(parsed.get(0)).toEqual({ viewName: null, hideKeys: ['frontend'] });
    expect(parsed.get(1)).toEqual({ viewName: null, hideKeys: ['critical'] });
  });

  it('applyMarkdownViewState drops the block\'s params when nothing is selected for it', () => {
    const params = new URLSearchParams('mdview.0=Old&mdhide.0=backend&mdview.1=Keep');
    applyMarkdownViewState(params, 0, { viewName: null, hideKeys: [] });
    expect(params.get('mdview.0')).toBeNull();
    expect(params.get('mdhide.0')).toBeNull();
    expect(params.get('mdview.1')).toBe('Keep');
    expect(params.toString()).toBe('mdview.1=Keep');
  });
});
