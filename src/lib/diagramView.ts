import { DiagramConfig, SavedView } from './views';
import {
  ActorTransformOptions,
  isPathHidden,
  processMermaid,
  transformActors,
} from './preprocessor';

// View/tag selection for one diagram, as driven by the markdown preview's
// per-block controls. `viewName` selects a saved view from the diagram's
// CONFIG; `hideKeys` are manually toggled-off tags (on/off only — merging is
// a saved-view concern). A selected view overrides the manual tag state,
// mirroring the diagram editor, where loading a view replaces the URL filter
// params and a manual toggle clears the active view.
export interface DiagramViewSelection {
  viewName?: string | null;
  hideKeys?: string[];
}

export const EMPTY_DIAGRAM_VIEW_SELECTION: DiagramViewSelection = { viewName: null, hideKeys: [] };

export function findSavedView(config: DiagramConfig | null, name: string | null | undefined): SavedView | null {
  if (!name || !config?.views) return null;
  return config.views.find(v => v.name === name) || null;
}

// The effective filter state for a selection: a saved view's stored state wins
// over the manual tag toggles; without a view, only the manually hidden tags
// apply (the preview has no manual region hiding — regions are hidden through
// saved views, which bundle hiddenPaths).
export function resolveDiagramViewState(
  config: DiagramConfig | null,
  selection: DiagramViewSelection,
): { hiddenPaths: Set<string>; actorOptions: ActorTransformOptions } {
  const view = findSavedView(config, selection.viewName);
  if (view) {
    return {
      hiddenPaths: new Set(view.hiddenPaths || []),
      actorOptions: {
        mergeByKeys: view.mergeKeys || view.mergeByKeys || [],
        mergeCleanByKeys: view.mergeCleanKeys || view.mergeCleanByKeys || [],
        hideColors: view.hideColors || [],
        hideKeys: view.hideKeys || [],
      },
    };
  }
  return {
    hiddenPaths: new Set<string>(),
    actorOptions: {
      mergeByKeys: [],
      mergeCleanByKeys: [],
      hideColors: [],
      hideKeys: selection.hideKeys ?? [],
    },
  };
}

// The diagram source with the selection applied: the same
// transformActors -> processMermaid pipeline the diagram editor renders. The
// %% CONFIG line survives (mermaid treats it as a comment). With no config and
// no selection the raw content passes through untouched.
export function renderDiagramWithView(
  code: string,
  config: DiagramConfig | null,
  selection: DiagramViewSelection,
): { code: string; warnings: string[] } {
  const hasSelection = Boolean(selection.viewName) || (selection.hideKeys?.length ?? 0) > 0;
  if (!config && !hasSelection) return { code, warnings: [] };
  const { hiddenPaths, actorOptions } = resolveDiagramViewState(config, selection);
  const actorTransformed = transformActors(code, config, actorOptions);
  return processMermaid(actorTransformed, {
    isRegionVisible: (region) => !isPathHidden(region.path, hiddenPaths),
  });
}

// URL state for the markdown preview's per-block view/tag toggles. One param
// per block, so URLSearchParams handles all encoding and free-form view names
// (spaces, commas, anything from the save-view prompt) round-trip safely:
//   mdview.<index>=Happy%20Path   the block's active saved view
//   mdhide.<index>=backend,db     the block's toggled-off tags (tags are
//                                 restricted to [A-Za-z0-9_-], so the comma
//                                 join is unambiguous)
// Like the diagram editor's filter params, this state is shareable and
// survives reloads, and it never writes to the file.
export const MD_VIEW_PARAM_PREFIX = 'mdview.';
export const MD_HIDE_PARAM_PREFIX = 'mdhide.';

const MD_VIEW_KEY_RE = /^mdview\.(\d+)$/;
const MD_HIDE_KEY_RE = /^mdhide\.(\d+)$/;

export function parseMarkdownViewStates(queryString: string): Map<number, DiagramViewSelection> {
  const params = new URLSearchParams(queryString);
  const states = new Map<number, DiagramViewSelection>();
  const ensure = (index: number): DiagramViewSelection => {
    let s = states.get(index);
    if (!s) {
      s = { viewName: null, hideKeys: [] };
      states.set(index, s);
    }
    return s;
  };
  params.forEach((value, key) => {
    const viewMatch = key.match(MD_VIEW_KEY_RE);
    if (viewMatch) {
      if (value) ensure(Number(viewMatch[1])).viewName = value;
      return;
    }
    const hideMatch = key.match(MD_HIDE_KEY_RE);
    if (hideMatch) {
      const s = ensure(Number(hideMatch[1]));
      s.hideKeys = s.hideKeys ?? [];
      for (const key2 of value.split(',').filter(Boolean)) {
        if (!s.hideKeys.includes(key2)) s.hideKeys.push(key2);
      }
    }
  });
  return states;
}

// Applies one block's selection to a URLSearchParams (mutates it): rebuilds
// the mdview.*/mdhide.* params from the other blocks' entries plus this
// block's, and drops a block's params entirely when nothing is selected for
// it.
export function applyMarkdownViewState(
  params: URLSearchParams,
  index: number,
  selection: DiagramViewSelection,
): void {
  const states = parseMarkdownViewStates(params.toString());
  if (selection.viewName || (selection.hideKeys?.length ?? 0) > 0) {
    states.set(index, {
      viewName: selection.viewName ?? null,
      hideKeys: [...(selection.hideKeys ?? [])],
    });
  } else {
    states.delete(index);
  }
  for (const key of Array.from(params.keys())) {
    if (key.startsWith(MD_VIEW_PARAM_PREFIX) || key.startsWith(MD_HIDE_PARAM_PREFIX)) {
      params.delete(key);
    }
  }
  for (const [i, s] of states) {
    if (s.viewName) params.set(`${MD_VIEW_PARAM_PREFIX}${i}`, s.viewName);
    if (s.hideKeys && s.hideKeys.length > 0) {
      params.set(`${MD_HIDE_PARAM_PREFIX}${i}`, s.hideKeys.join(','));
    }
  }
}
