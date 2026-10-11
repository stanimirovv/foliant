export interface SavedView {
  name: string;
  hiddenPaths: string[];
}

export interface ActorMetadata {
  color?: string;
  keys?: string[];
}

export interface ArrowStyle {
  from: string;                 // participant/node id in the RAW file
  to: string;                   // participant/node id in the RAW file
  label?: string;               // message/edge label; disambiguates same-endpoint arrows
  occurrence?: number;          // optional: nth arrow with the same (from,to,label), 0-based
  color?: string;               // stroke color, any CSS color
  width?: number;               // stroke width, 1–10
  dash?: 'solid' | 'dashed' | 'dotted';
  keys?: string[];              // the arrow's own tags (merge/hide keys)
  keyMode?: ArrowKeyMode;       // how tags are computed: 'merged' (own + origin's, default) | 'clean' (own only)
}

// Tag behavior of an arrow: 'merged' inherits the tags of the service the arrow
// originates from (the default when keyMode is absent); 'clean' keeps only the
// arrow's own tags.
export type ArrowKeyMode = 'merged' | 'clean';

export type StickyNoteColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple';

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color?: StickyNoteColor;
}

export interface DiagramConfig {
  version: number;
  views?: SavedView[];
  actors?: Record<string, ActorMetadata>;
  arrows?: ArrowStyle[];
  notes?: StickyNote[];
}

export const VIEWS_PREFIX = '%% VIEWS: ';
export const CONFIG_PREFIX = '%% CONFIG: '; // We can allow %% CONFIG: for newer files

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
  const emptyNotes = !config?.notes || config.notes.length === 0;
  if (!config || (emptyViews && emptyActors && emptyArrows && emptyNotes)) {
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
