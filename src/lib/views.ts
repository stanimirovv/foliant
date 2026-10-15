export interface SavedView {
  name: string;
  hiddenPaths: string[];
  mergeColors?: string[];
  mergeCleanColors?: string[];
  hideColors?: string[];
  mergeKeys?: string[];
  mergeCleanKeys?: string[];
  hideKeys?: string[];
  mergeByColor?: string[];
  mergeCleanByColor?: string[];
  mergeByKeys?: string[];
  mergeCleanByKeys?: string[];
}

export interface ActorMetadata {
  color?: string;
  keys?: string[];
}

export type ArrowAnimationType =
  | 'none'
  | 'flow'
  | 'pulse'
  | 'cyber'
  | 'broken-sender'
  | 'broken-network'
  | 'broken-receiver'
  | 'stutter'
  | 'ricochet'
  | 'hesitate';

export interface ArrowStyle {
  from: string;                 // participant/node id in the RAW file
  to: string;                   // participant/node id in the RAW file
  label?: string;               // message/edge label; disambiguates same-endpoint arrows
  occurrence?: number;          // optional: nth arrow with the same (from,to,label), 0-based
  color?: string;               // stroke color, any CSS color
  width?: number;               // stroke width, 1–10
  dash?: 'solid' | 'dashed' | 'dotted';
  animation?: ArrowAnimationType;
  keys?: string[];              // the arrow's own tags (merge/hide keys)
  keyMode?: ArrowKeyMode;       // how tags are computed: 'clean' (own only, default) | 'merged' (own + origin's)
}

// Tag behavior of an arrow: 'clean' keeps only the arrow's own tags (the default
// when keyMode is absent); 'merged' inherits the tags of the service the arrow
// originates from.
export type ArrowKeyMode = 'merged' | 'clean';

// Tag entry of a sequence-diagram note (Note over / left of / right of),
// keyed by (over, text, occurrence) like arrow entries are keyed by
// (from, to, label, occurrence). Distinct from `notes` (sticky notes), which
// are free-floating canvas annotations.
export interface NoteTagEntry {
  over: string[];               // participant ids the note spans, in the RAW file
  text: string;                 // note text; disambiguates notes over the same actors
  occurrence?: number;          // optional: nth note with the same (over, text), 0-based
  keys?: string[];              // the note's own tags (hide keys)
}

export type StickyNoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple';

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color?: StickyNoteColor;
  width?: number;
  height?: number;
  keys?: string[];              // the note's own tags (hide keys)
}

// Global default style for ALL arrows: the fallback for every arrow whose own
// entry does not set the field (styling.ts resolves entry fields over these).
export interface ArrowStyleDefaults {
  color?: string;               // stroke color, any CSS color
  width?: number;               // stroke width, 1–10
}

export interface DiagramConfig {
  version: number;
  views?: SavedView[];
  actors?: Record<string, ActorMetadata>;
  arrows?: ArrowStyle[];
  defaultArrowStyle?: ArrowStyleDefaults;
  noteTags?: NoteTagEntry[];
  notes?: StickyNote[];
}

export const VIEWS_PREFIX = '%% VIEWS: ';
export const CONFIG_PREFIX = '%% CONFIG: '; // We can allow %% CONFIG: for newer files

// All tags (keys) used anywhere in the config: actors, arrows, note tags and
// sticky notes. Drives the "By Key" filter lists — the diagram editor sidebar
// and the markdown preview's per-block tag toggles.
export function collectAvailableKeys(config: DiagramConfig | null): string[] {
  const keys = new Set<string>();
  if (config?.actors) {
    Object.values(config.actors).forEach(a => { if (a.keys) a.keys.forEach(k => keys.add(k)); });
  }
  // Messages/edges carry their own tags too (their inherited tags are the
  // origin service's, already listed via the actors).
  if (config?.arrows) {
    for (const a of config.arrows) {
      if (a.keys) a.keys.forEach(k => keys.add(k));
    }
  }
  // Notes carry their own tags as well.
  if (config?.noteTags) {
    for (const n of config.noteTags) {
      if (n.keys) n.keys.forEach(k => keys.add(k));
    }
  }
  // Sticky notes carry their own tags as well.
  if (config?.notes) {
    for (const n of config.notes) {
      if (n.keys) n.keys.forEach(k => keys.add(k));
    }
  }
  return Array.from(keys);
}

export function parseViewsData(code: string): DiagramConfig | null {
  if (!code) return null;
  const firstLine = code.split('\n')[0];
  if (firstLine) {
    if (firstLine.startsWith(VIEWS_PREFIX)) {
      try {
        return JSON.parse(firstLine.slice(VIEWS_PREFIX.length)) as DiagramConfig;
      } catch {
        // ignore
      }
    } else if (firstLine.startsWith(CONFIG_PREFIX)) {
      try {
        return JSON.parse(firstLine.slice(CONFIG_PREFIX.length)) as DiagramConfig;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export function updateViewsData(code: string, config: DiagramConfig | null): string {
  const lines = code.split('\n');
  const hasConfig = lines[0] && (lines[0].startsWith(VIEWS_PREFIX) || lines[0].startsWith(CONFIG_PREFIX));
  
  const emptyViews = !config?.views || config.views.length === 0;
  const emptyActors = !config?.actors || Object.keys(config.actors).length === 0;
  const emptyArrows = !config?.arrows || config.arrows.length === 0;
  const emptyDefault = !config?.defaultArrowStyle ||
    (config.defaultArrowStyle.color === undefined && config.defaultArrowStyle.width === undefined);
  const emptyNoteTags = !config?.noteTags || config.noteTags.length === 0;
  const emptyNotes = !config?.notes || config.notes.length === 0;
  if (!config || (emptyViews && emptyActors && emptyArrows && emptyDefault && emptyNoteTags && emptyNotes)) {
    if (hasConfig) {
      lines.shift();
    }
    return lines.join('\n');
  }

  // Use %% CONFIG: by default now since it's more general
  const configLine = `${CONFIG_PREFIX}${JSON.stringify(config)}`;
  if (hasConfig) {
    lines[0] = configLine;
  } else {
    lines.unshift(configLine);
  }
  
  return lines.join('\n');
}

export function addStickyNote(code: string, note: StickyNote): string {
  const config = parseViewsData(code) || { version: 1 };
  const notes = [...(config.notes || []), note];
  return updateViewsData(code, { ...config, notes });
}

export function updateStickyNote(code: string, id: string, patch: Partial<Omit<StickyNote, 'id'>>): string {
  const config = parseViewsData(code);
  if (!config || !config.notes) return code;
  const notes = config.notes.map(n => n.id === id ? { ...n, ...patch } : n);
  return updateViewsData(code, { ...config, notes });
}

export function deleteStickyNote(code: string, id: string): string {
  const config = parseViewsData(code);
  if (!config || !config.notes) return code;
  const notes = config.notes.filter(n => n.id !== id);
  return updateViewsData(code, { ...config, notes });
}
