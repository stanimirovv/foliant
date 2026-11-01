'use client';

import { useEffect, useState, useMemo, useCallback, useRef, MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import DiagramViewer from './DiagramViewer';
import EditorPanel from './EditorPanel';
import MarkdownEditor from './MarkdownEditor';
import SourceCodePanel from './SourceCodePanel';
import CanvasContextToolbar from './CanvasContextToolbar';
import CommandPalette from './CommandPalette';
import { processMermaid, transformActors, buildActorRewriteMap, ActorTransformOptions, isPathHidden } from '@/lib/preprocessor';
import { extractRegions, RegionNode } from '@/lib/parser';
import { Search, Moon, Sun, Folder, Save, Trash2, Play, Pencil, UserPlus, MessageSquarePlus, MessageSquareWarning, Undo2, Redo2, Plus, Copy, Check, StickyNote as StickyNoteIcon, Columns, Sliders, Code, Download, ArrowDownUp, ArrowLeft, ListOrdered, FileText, RotateCcw, PanelRightClose, PanelRightOpen, AlertTriangle, Globe, Command, Image as ImageIcon } from 'lucide-react';
import { parseViewsData, updateViewsData, collectAvailableKeys, DiagramConfig, SavedView, ArrowKeyMode, ArrowAnimationType, addStickyNote, updateStickyNote, deleteStickyNote, StickyNote } from '@/lib/views';
import { applyMarkdownViewState, DiagramViewSelection, parseMarkdownViewStates } from '@/lib/diagramView';
import { parseModel, ModelElement, ParticipantElement, NodeElement, MessageElement, EdgeElement, NodeShape, ParticipantType, StickyNoteElement, NotePlacement, BlockType } from '@/lib/model';
import { computeLineDiff } from '@/lib/sourceDiff';
import mermaid from 'mermaid';
import {
  editMessageLabel, renameParticipant, addParticipant, addMessage, deleteElement, deleteElements,
  setArrowType, setActorColor, addTag, removeTag, setArrowStyle, setGlobalArrowStyle, getArrowStyle,
  getArrowTags, getNoteTags, getStickyNoteTags, setArrowKeyMode,
  moveNode, moveMessage, moveMessageEndpoint, moveEdgeEndpoint, EditResult, ArrowStylePatch, MessageInsertPosition,
  setParticipantKind, setNodeShape, toggleActivation, groupParticipants, groupNodes, toggleDiagramOrientation,
  toggleNumberedSteps, hasNumberedSteps, addSequenceNote, editNoteText, setNotePlacement, setNoteSpan,
  setBlockTitle, setBlockType, unwrapBlock, deleteBlock,
  canWrapSelection, wrapInBlock, wrapInRegion,
} from '@/lib/editor';
import { resolveParticipantReorder } from '@/lib/reorder';
import { formatRecentDir } from '@/lib/recentDirs';
import { buildSelectionMap } from '@/lib/svgmap';
import { buildSubgraphTagIndex } from '@/lib/subgraphTags';
import { rewriteArrowStyles, ANIMATED_ARROW_PRESETS, ANIMATED_ARROW_COLORS } from '@/lib/styling';
import { exportSvgToFile, exportPngToFile, copyPngToClipboard } from '@/lib/svgExport';
import { PendingDelete } from './EditorPanel';
import type { MdDiagramMeta } from '@/lib/markdownTypes';
import { createSerialQueue } from '@/lib/serialQueue';
import { extractMermaidBlocks } from '@/lib/markdown';
import { MERMAID_DIAGRAM_TEMPLATES, scaffoldMermaidBlock } from '@/lib/markdownBlocks';
import { isReadOnlyFile } from '@/lib/readOnlyFiles';
import { STATIC_DEMO, getStaticFiles, getStaticMarkdownFiles, getStaticFileContent, getStaticMarkdownDiagrams } from '@/lib/staticDemo';

// Undo/redo history depth: capped so both stacks stay small (10-15 steps).
const HISTORY_LIMIT = 15;

// Starter content for the New file dialog (the user picks the file name and
// the kind: a standalone .mmd diagram or a .md architecture document).
const NEW_DIAGRAM_TEMPLATES: Record<'sequence' | 'flowchart', string> = MERMAID_DIAGRAM_TEMPLATES;

// A new .md architecture document: a heading, a prose placeholder, and a
// scaffolded sequence diagram the user can open and edit right away.
const NEW_MARKDOWN_DOC_TEMPLATE = [
  '# Architecture',
  '',
  'Describe the system here.',
  '',
  scaffoldMermaidBlock('sequence'),
  '',
].join('\n');

// The kinds the New file dialog can create.
type NewFileKind = 'sequence' | 'flowchart' | 'markdown';

const RICH_ARROW_LAST_POSITIVE_COLOR_KEY = 'mermaid_rich_arrow_last_positive_color';
const RICH_ARROW_LAST_ERROR_COLOR_KEY = 'mermaid_rich_arrow_last_error_color';
const DEFAULT_RICH_ARROW_POSITIVE_COLOR = '#00ff9d';
const DEFAULT_RICH_ARROW_ERROR_COLOR = '#ff2a85';

// The right sidebar (Properties / Mermaid Source) is resizable by dragging
// the handle on its left edge — the vertical divider between the diagram
// editor and the plain-text source. Single-tab and split view keep
// independent persisted widths.
const SIDEBAR_WIDTH_KEY = 'mermaid_sidebar_width';
const SPLIT_SIDEBAR_WIDTH_KEY = 'mermaid_sidebar_split_width';
const DEFAULT_SIDEBAR_WIDTH = 320; // w-80
const DEFAULT_SPLIT_SIDEBAR_WIDTH = 640; // w-[640px]
const MIN_SIDEBAR_WIDTH = 240;
const MIN_MAIN_WIDTH = 320; // keep at least this much room for the diagram

function loadSidebarWidth(key: string, fallback: number): number {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = Number(window.localStorage.getItem(key));
      if (Number.isFinite(stored) && stored >= MIN_SIDEBAR_WIDTH) return stored;
    } catch {}
  }
  return fallback;
}

// The right sidebar (Properties / Mermaid Source) can be hidden to give the
// diagram area more room. The toolbar button and the Tab key toggle it; the
// choice is persisted so it survives reloads.
const SIDEBAR_VISIBLE_KEY = 'mermaid_sidebar_visible';

function loadSidebarVisible(): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_VISIBLE_KEY);
      if (stored === '0') return false;
      if (stored === '1') return true;
    } catch {}
  }
  return true;
}

export default function ClientPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [files, setFiles] = useState<string[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  // Active storage backend ('fs' | 'memory' | 's3'), reported by /api/files.
  // The memory backend is volatile: surface a banner so it is never mistaken
  // for durable storage.
  const [storageBackend, setStorageBackend] = useState<string | null>(null);
  // Markdown files in the directory and the mermaid diagrams embedded in them.
  // The Files menu lists each .md file as a parent row with its detected
  // diagrams as nested children; selecting a child opens that diagram in the
  // editor, and saving writes it back into the markdown file (through a
  // background job — see saveEmbeddedDiagram).
  const [markdownFiles, setMarkdownFiles] = useState<string[]>([]);
  const [mdDiagrams, setMdDiagrams] = useState<Record<string, MdDiagramMeta[]>>({});
  const [saveConflict, setSaveConflict] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  // Editing state (EDITING_PLAN.md Steps 7+): `selectedKeys` holds RAW element
  // keys. DiagramViewer reports the PROCESSED key on click; it is resolved to
  // the raw element through the selection map and the RAW key is stored, so
  // the selection survives transforms that reorder the processed diagram
  // (e.g. colored participants regrouped into box blocks).
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const setSelection = (key: string | null) => {
    setSelectedKeys(key ? [key] : []);
  };
  const [editWarning, setEditWarning] = useState<string | null>(null);
  // Two-phase delete (EDITING_PLAN.md Step 8): the transform runs on request
  // so the confirm dialog can list the cascaded elements; the new code is
  // applied only on confirm.
  const [pendingDelete, setPendingDelete] = useState<(PendingDelete & { code: string }) | null>(null);
  // New file dialog: create a brand-new .mmd diagram or .md architecture
  // document in the current directory (the user picks the file name and the
  // kind) and open it.
  const [pendingNew, setPendingNew] = useState<NewFileKind | null>(null);

  // Auto-save state (EDITING_PLAN.md Section 4.10): lastWrittenRef holds the
  // exact content string of the last successful POST. The auto-save effect
  // debounces every edit into a write-through POST; the SSE handler routes
  // refetches through the same comparison, so echoes of our own writes are
  // ignored and anything else is adopted as an external change.
  const lastWrittenRef = useRef<string | null>(null);
  const rawCodeFileRef = useRef<string | null>(null); // which file rawCode belongs to
  const rawCodeDiagramRef = useRef<number | null>(null); // which embedded diagram (index) rawCode belongs to
  // Always-current rawCode for effects that must not re-run on every keystroke
  // (e.g. the load effect, which flushes a pending document edit before
  // opening an embedded diagram).
  const rawCodeRef = useRef(rawCode);
  rawCodeRef.current = rawCode;
  const saveSeqRef = useRef(0);                       // only the latest save applies its result
  const loadSeqRef = useRef(0);                       // only the latest load applies its result
  const saveQueueRef = useRef(createSerialQueue());   // client-side FIFO queue for persistence calls
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [reloadNotice, setReloadNotice] = useState(false);

  // Undo/redo (EDITING_PLAN.md Section 4.11): the state is a single string
  // (the raw code, CONFIG included), so history is string[] past + future
  // stacks around the current rawCode, capped at 100. Pushing happens in the
  // edit dispatch (commitEdit), never in a render effect; undo/redo results
  // flow through the same rawCode state, so auto-save applies to them too.
  const [historyPast, setHistoryPast] = useState<string[]>([]);
  const [historyFuture, setHistoryFuture] = useState<string[]>([]);

  const [lastPositiveColor, setLastPositiveColor] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(RICH_ARROW_LAST_POSITIVE_COLOR_KEY) || DEFAULT_RICH_ARROW_POSITIVE_COLOR;
      } catch {
        return DEFAULT_RICH_ARROW_POSITIVE_COLOR;
      }
    }
    return DEFAULT_RICH_ARROW_POSITIVE_COLOR;
  });

  const [lastErrorColor, setLastErrorColor] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(RICH_ARROW_LAST_ERROR_COLOR_KEY) || DEFAULT_RICH_ARROW_ERROR_COLOR;
      } catch {
        return DEFAULT_RICH_ARROW_ERROR_COLOR;
      }
    }
    return DEFAULT_RICH_ARROW_ERROR_COLOR;
  });

  const updateLastPositiveColor = (color: string) => {
    setLastPositiveColor(color);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(RICH_ARROW_LAST_POSITIVE_COLOR_KEY, color);
      } catch {}
    }
  };

  const updateLastErrorColor = (color: string) => {
    setLastErrorColor(color);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(RICH_ARROW_LAST_ERROR_COLOR_KEY, color);
      } catch {}
    }
  };
  const [sidebarTab, setSidebarTab] = useState<'properties' | 'source'>('properties');
  const [isSplitView, setIsSplitView] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => loadSidebarVisible());
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH));
  const [splitSidebarWidth, setSplitSidebarWidth] = useState(() => loadSidebarWidth(SPLIT_SIDEBAR_WIDTH_KEY, DEFAULT_SPLIT_SIDEBAR_WIDTH));
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number; split: boolean; latestWidth: number } | null>(null);
  const [editModeKind, setEditModeKind] = useState<'visual' | 'code'>('visual');
  const [changedLines, setChangedLines] = useState<number[]>([]);
  const [sourceValidationError, setSourceValidationError] = useState<string | null>(null);
  const changedLinesTimerRef = useRef<NodeJS.Timeout | null>(null);

  const updateChangedLines = useCallback((lines: number[]) => {
    if (changedLinesTimerRef.current) {
      clearTimeout(changedLinesTimerRef.current);
      changedLinesTimerRef.current = null;
    }
    setChangedLines(lines);
    if (lines.length > 0) {
      const timer = setTimeout(() => {
        setChangedLines([]);
        changedLinesTimerRef.current = null;
      }, 5000);
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        timer.unref();
      }
      changedLinesTimerRef.current = timer;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (changedLinesTimerRef.current) {
        clearTimeout(changedLinesTimerRef.current);
      }
    };
  }, []);

  // Hide/show the whole right sidebar (Properties / Mermaid Source); the
  // toolbar button and the Tab key both go through this.
  const toggleSidebarVisibility = useCallback(() => {
    const next = !isSidebarVisible;
    setIsSidebarVisible(next);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(SIDEBAR_VISIBLE_KEY, next ? '1' : '0');
      } catch {}
    }
  }, [isSidebarVisible]);

  // --- Sidebar resize (drag the handle on the sidebar's left edge) ---
  const activeSidebarWidth = isSplitView ? splitSidebarWidth : sidebarWidth;

  const handleSidebarResizeStart = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const split = isSplitView;
    const startWidth = split ? splitSidebarWidth : sidebarWidth;
    sidebarResizeRef.current = { startX: e.clientX, startWidth, split, latestWidth: startWidth };
    setIsResizingSidebar(true);
  };

  // Window-level move/up listeners while dragging, so the drag keeps working
  // even when the cursor leaves the handle (e.g. over the Monaco editor).
  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMouseMove = (e: MouseEvent) => {
      const start = sidebarResizeRef.current;
      if (!start) return;
      const maxWidth = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_MAIN_WIDTH);
      const next = Math.min(Math.max(MIN_SIDEBAR_WIDTH, start.startWidth + (start.startX - e.clientX)), maxWidth);
      start.latestWidth = next;
      if (start.split) setSplitSidebarWidth(next);
      else setSidebarWidth(next);
    };
    const onMouseUp = () => {
      const start = sidebarResizeRef.current;
      sidebarResizeRef.current = null;
      setIsResizingSidebar(false);
      if (start && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(start.split ? SPLIT_SIDEBAR_WIDTH_KEY : SIDEBAR_WIDTH_KEY, String(start.latestWidth));
        } catch {}
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizingSidebar]);

  // While resizing, keep the column cursor and disable text selection page-wide.
  useEffect(() => {
    if (!isResizingSidebar) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isResizingSidebar]);

  const switchToCodeMode = () => {
    if (selectedViewName) return;
    setEditModeKind('code');
    setSidebarTab('source');
    setSelection(null);
  };

  const switchToVisualMode = () => {
    setEditModeKind('visual');
    setSourceValidationError(null);
  };
  
  const currentFile = searchParams.get('file');
  const searchQuery = searchParams.get('q') || '';
  const presentation = searchParams.get('present') === '1';
  const themeParam = searchParams.get('theme');
  const theme: 'default' | 'dark' = themeParam === 'default' ? 'default' : 'dark';
  const isDark = theme === 'dark';
  const dirParam = searchParams.get('dir') || '';

  // Synchronize the root <html> class with the active theme so Tailwind's
  // `dark:` variant and CSS theme variables respond dynamically to theme switches.
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // A markdown file selected with a `diagram` index opens that embedded
  // diagram (0-based among the ```mermaid blocks of the file) in the diagram
  // editor; a markdown file without the index opens the whole document in the
  // rich markdown editor (MarkdownEditor).
  const diagramParam = searchParams.get('diagram');
  const diagramIndex = diagramParam !== null && /^\d+$/.test(diagramParam) ? parseInt(diagramParam, 10) : null;
  const isMarkdownFile = Boolean(currentFile && /\.(md|markdown)$/i.test(currentFile));
  const isEmbeddedDiagram = Boolean(isMarkdownFile && diagramIndex !== null);
  const isMarkdownDoc = Boolean(isMarkdownFile && diagramIndex === null);

  // Read-only files (e.g. the shipped tutorial): the UI stays fully explorable
  // — users can edit on the canvas, in Monaco, or in the WYSIWYG preview — but
  // changes are never written to disk. The server also rejects writes (403).
  const isReadOnly = Boolean(currentFile && isReadOnlyFile(currentFile));
  
  const [customDirInput, setCustomDirInput] = useState(dirParam);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('recentDirs');
    if (stored) {
      try {
        setRecentDirs(JSON.parse(stored));
      } catch {}
    }
  }, []);

  // The Recent list shows only the tail of each path (see formatRecentDir), so
  // it needs to know how wide a row is to decide how many of the last
  // components would actually be visible. The hidden span measures candidate
  // labels with the same font the rows use.
  const recentListRef = useRef<HTMLUListElement | null>(null);
  const recentMeasureSpanRef = useRef<HTMLSpanElement | null>(null);
  const [recentListWidth, setRecentListWidth] = useState(0);

  useEffect(() => {
    const list = recentListRef.current;
    if (!list) return;
    const update = () => setRecentListWidth(list.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [recentDirs.length]);

  const measureRecentLabel = (text: string): number => {
    const span = recentMeasureSpanRef.current;
    if (!span) return 0;
    span.textContent = text;
    return span.getBoundingClientRect().width;
  };

  // Keep the directory input in sync with the active directory: the URL can
  // change without the form (browser back/forward, a pasted link, a recent
  // directory click), and the input must show the directory actually loaded.
  useEffect(() => {
    setCustomDirInput(dirParam);
  }, [dirParam]);

  const handleDirSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newDir = customDirInput.trim();
    const params = new URLSearchParams(searchParams.toString());
    if (newDir) {
      params.set('dir', newDir);
      const newRecents = [newDir, ...recentDirs.filter(d => d !== newDir)].slice(0, 5);
      setRecentDirs(newRecents);
      localStorage.setItem('recentDirs', JSON.stringify(newRecents));
    } else {
      params.delete('dir');
    }
    params.delete('file');
    params.delete('diagram');

    const newQueryString = params.toString();
    if (newQueryString === searchParams.toString()) {
      setRefreshKey(k => k + 1);
    } else {
      router.replace(`${pathname}?${newQueryString}`, { scroll: false });
    }
  };

  // Select a markdown file (no diagram -> the rich markdown editor) or one of
  // its embedded diagrams (?file=notes.md&diagram=N).
  const selectMarkdownFile = (filename: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('file', filename);
    params.delete('diagram');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const selectMarkdownDiagram = (filename: string, index: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('file', filename);
    params.set('diagram', String(index));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // One-shot request to scroll the markdown document to a diagram after
  // returning from the diagram editor (the top bar's "Back to markdown"
  // button). MarkdownEditor reports back through handleDiagramScrolled.
  const [scrollToDiagram, setScrollToDiagram] = useState<number | null>(null);
  const handleDiagramScrolled = useCallback(() => setScrollToDiagram(null), []);
  // Which selection the currently loaded rawCode belongs to. The scroll
  // request is delivered to the markdown editor only once the document for
  // the current selection has loaded — otherwise the editor would briefly
  // see the previous selection's content (a single diagram block, without
  // fences) and mistake the requested diagram for missing.
  const [loadedSelection, setLoadedSelection] = useState<{ file: string | null; diagram: number | null }>({ file: null, diagram: null });
  const scrollTarget = loadedSelection.file === currentFile && loadedSelection.diagram === diagramIndex
    ? scrollToDiagram
    : null;

  // Return from an embedded diagram to the markdown document, scrolled to
  // that diagram, so editing can continue in context.
  const backToMarkdownDoc = () => {
    if (!currentFile || diagramIndex === null) return;
    setScrollToDiagram(diagramIndex);
    selectMarkdownFile(currentFile);
  };

  // Hidden paths
  const hiddenPathsParam = searchParams.get('hidden') || '';
  const hiddenPaths = useMemo(() => new Set(hiddenPathsParam.split(',').filter(Boolean)), [hiddenPathsParam]);

  const hideColorParam = searchParams.get('hide_color') || '';
  const hideColors = useMemo(() => new Set(hideColorParam.split(',').filter(Boolean)), [hideColorParam]);

  const mergeKeyParam = searchParams.get('merge_key') || '';
  const mergeKeys = useMemo(() => new Set(mergeKeyParam.split(',').filter(Boolean)), [mergeKeyParam]);

  const hideKeyParam = searchParams.get('hide_key') || '';
  const hideKeys = useMemo(() => new Set(hideKeyParam.split(',').filter(Boolean)), [hideKeyParam]);

  const mergeCleanKeyParam = searchParams.get('merge_clean_key') || '';
  const mergeCleanKeys = useMemo(() => new Set(mergeCleanKeyParam.split(',').filter(Boolean)), [mergeCleanKeyParam]);

  const viewParam = searchParams.get('view') || '';
  const [selectedViewName, setSelectedViewName] = useState<string | null>(viewParam || null);

  useEffect(() => {
    setSelectedViewName(viewParam || null);
    if (viewParam) {
      setEditModeKind('visual');
    }
  }, [viewParam]);

  const toggleHiddenPath = (path: string) => {
    setSelectedViewName(null);
    const newSet = new Set(hiddenPaths);
    if (isPathHidden(path, newSet)) {
      newSet.delete(path);
      const segments = path.split('/');
      newSet.delete(segments[segments.length - 1]);
      for (let i = 1; i < segments.length; i++) {
        newSet.delete(segments.slice(i).join('/'));
      }
    } else {
      newSet.add(path);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    if (newSet.size > 0) {
      params.set('hidden', Array.from(newSet).join(','));
    } else {
      params.delete('hidden');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const [refreshKey, setRefreshKey] = useState(0);

  // Opening the app with no directory selected: load the most recent
  // directory, but only if it still exists. The check goes through
  // /api/dir-check because /api/files would create a missing directory, so
  // it cannot tell "gone" apart from "empty". The flag is set only once the
  // check has an answer (and synchronously when a dir/file is already chosen),
  // so the auto-load runs once per mount — also under StrictMode, where the
  // effect body runs twice but the ref survives between the two runs.
  const recentDirLoadAttemptedRef = useRef(false);

  useEffect(() => {
    let ignore = false;
    const run = async () => {
      if (STATIC_DEMO) {
        // Static mode: no recent dirs, no dir-check — go straight to the file list.
        recentDirLoadAttemptedRef.current = true;
      } else if (!dirParam && !currentFile) {
        if (!recentDirLoadAttemptedRef.current) {
          let lastRecent: string | null = null;
          try {
            const stored = localStorage.getItem('recentDirs');
            if (stored) {
              const parsed: unknown = JSON.parse(stored);
              if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0]) {
                lastRecent = parsed[0];
              }
            }
          } catch {}
          if (lastRecent) {
            try {
              const r = await fetch(`/api/dir-check?dir=${encodeURIComponent(lastRecent)}`);
              const data = await r.json();
              if (ignore) return;
              recentDirLoadAttemptedRef.current = true;
              if (data.exists) {
                const params = new URLSearchParams(searchParams.toString());
                params.set('dir', lastRecent);
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                return; // the effect re-runs with the new dir param and loads it
              }
            } catch {
              if (ignore) return;
              recentDirLoadAttemptedRef.current = true;
            }
          } else {
            recentDirLoadAttemptedRef.current = true;
          }
        }
      } else {
        // A directory or file is already chosen; never auto-load this mount.
        recentDirLoadAttemptedRef.current = true;
      }
      try {
        if (STATIC_DEMO) {
          // Static mode: serve the file list from the bundled data — no API.
          const staticMmd = getStaticFiles();
          const staticMd = getStaticMarkdownFiles();
          if (ignore) return;
          setFilesError(null);
          setStorageBackend('static');
          setFiles(staticMmd);
          setMarkdownFiles(staticMd);
          if (!currentFile) {
            const defaultFile =
              staticMd.find(f => f === 'tutorial.md') ??
              staticMd[0] ??
              staticMmd[0];
            if (defaultFile) {
              const params = new URLSearchParams(searchParams.toString());
              params.set('file', defaultFile);
              params.delete('diagram');
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }
          }
          return;
        }
        const r = await fetch(`/api/files${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`);
        const data = await r.json();
        if (ignore) return;
        if (data.error) {
          // Unreadable directory: say why instead of silently emptying the list.
          setFiles([]);
          setFilesError(data.error);
          return;
        }
        setFilesError(null);
        setStorageBackend(typeof data.backend === 'string' ? data.backend : null);
        setFiles(data.files || []);
        setMarkdownFiles(data.markdownFiles || []);
        if (!currentFile) {
          // Prefer markdown documents (especially tutorial.md) over standalone
          // .mmd files, so a fresh checkout lands on the interactive tutorial.
          const mdFiles: string[] = data.markdownFiles || [];
          const mmdFiles: string[] = data.files || [];
          const defaultFile =
            mdFiles.find((f: string) => f === 'tutorial.md') ??
            mdFiles[0] ??
            mmdFiles[0];
          if (defaultFile) {
            const params = new URLSearchParams(searchParams.toString());
            params.set('file', defaultFile);
            params.delete('diagram');
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }
        }
      } catch {
        if (ignore) return;
        setFiles([]);
        setMarkdownFiles([]);
        setFilesError('Failed to read directory');
      }
    };
    run();
    return () => { ignore = true; };
  }, [currentFile, pathname, router, searchParams, dirParam, refreshKey]);

  // Fetch the embedded mermaid diagrams of every markdown file, for the Files
  // menu (nested under each .md file).
  useEffect(() => {
    let ignore = false;
    if (markdownFiles.length === 0) {
      setMdDiagrams({});
      return;
    }
    const dirQs = dirParam ? `&dir=${encodeURIComponent(dirParam)}` : '';
    if (STATIC_DEMO) {
      // Static mode: extract diagram metadata from the bundled content.
      const entries = markdownFiles.map(f => [f, getStaticMarkdownDiagrams(f)] as const);
      setMdDiagrams(Object.fromEntries(entries));
      return;
    }
    Promise.all(markdownFiles.map(async f => {
      try {
        const r = await fetch(`/api/markdown/diagrams?file=${encodeURIComponent(f)}${dirQs}`);
        const data = await r.json();
        return [f, Array.isArray(data.diagrams) ? data.diagrams as MdDiagramMeta[] : []] as const;
      } catch {
        return [f, [] as MdDiagramMeta[]] as const;
      }
    })).then(entries => {
      if (!ignore) setMdDiagrams(Object.fromEntries(entries));
    });
    return () => { ignore = true; };
  }, [markdownFiles, dirParam, refreshKey]);

  const fetchFileContent = useCallback(async (filename: string): Promise<string | null> => {
    if (STATIC_DEMO) {
      return getStaticFileContent(filename);
    }
    try {
      const r = await fetch(`/api/file/${filename}${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`);
      const data = await r.json();
      return data.content || '';
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [dirParam]);

  // The full source of one embedded diagram (the fenced block's content,
  // including the %% CONFIG comment as its first line).
  const fetchEmbeddedDiagram = useCallback(async (filename: string, index: number): Promise<string | null> => {
    if (STATIC_DEMO) {
      const content = getStaticFileContent(filename);
      if (content === null) return null;
      const block = extractMermaidBlocks(content)[index];
      return block ? block.content : null;
    }
    try {
      const qs = dirParam ? `&dir=${encodeURIComponent(dirParam)}` : '';
      const r = await fetch(`/api/markdown/diagram?file=${encodeURIComponent(filename)}&index=${index}${qs}`);
      const data = await r.json();
      return typeof data.content === 'string' ? data.content : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [dirParam]);

  // The "editable content" of a selection: the whole file for .mmd files, the
  // embedded block's source for a diagram inside a markdown file.
  const fetchCurrentContent = useCallback(async (filename: string, index: number | null): Promise<string | null> => {
    if (index !== null && /\.(md|markdown)$/i.test(filename)) {
      return fetchEmbeddedDiagram(filename, index);
    }
    return fetchFileContent(filename);
  }, [fetchEmbeddedDiagram, fetchFileContent]);

  const postFile = useCallback(async (filename: string, content: string): Promise<{ ok: boolean; code?: string; message?: string }> => {
    // Defense-in-depth: never POST a write for a read-only file. The server
    // also rejects it (403), but short-circuiting here avoids a wasted round-trip.
    if (isReadOnlyFile(filename)) {
      return { ok: false, code: 'forbidden', message: 'This file is read-only and cannot be modified.' };
    }
    try {
      const r = await fetch(`/api/file/${filename}${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) {
        let message = "Contents aren't saved";
        let code: string | undefined;
        try {
          const data = await r.json();
          if (typeof data?.error === 'string') message = data.error;
          if (typeof data?.code === 'string') code = data.code;
        } catch {}
        // Surface storage error codes distinctly (STORAGE_BACKENDS plan §5.2):
        // verify-failed/unknown keep today's "Contents aren't saved" message,
        // unavailable says so, conflict asks for a reload.
        if (code === 'unavailable') {
          message = `Storage unavailable${message ? `: ${message}` : ''}`;
        } else if (code === 'conflict') {
          message = 'The file changed on disk; reload it before saving';
        }
        return { ok: false, code, message };
      }
      return { ok: true };
    } catch (e) {
      console.error(e);
      return { ok: false, message: "Contents aren't saved" };
    }
  }, [dirParam]);

  // Save an embedded diagram through the background job queue: the POST only
  // enqueues the job (the read -> AST splice -> atomic write happens
  // server-side, off the request path, so editing never freezes), then the
  // job status is polled until it reaches a terminal state.
  const saveEmbeddedDiagram = useCallback(async (
    filename: string,
    index: number,
    content: string,
    expectedContent: string,
  ): Promise<{ ok: boolean; code?: string; message?: string }> => {
    // Defense-in-depth: never enqueue a save job for a read-only file.
    if (isReadOnlyFile(filename)) {
      return { ok: false, code: 'forbidden', message: 'This file is read-only and cannot be modified.' };
    }
    try {
      const qs = dirParam ? `?dir=${encodeURIComponent(dirParam)}` : '';
      const r = await fetch(`/api/markdown/save${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: filename, index, content, expectedContent }),
      });
      if (!r.ok) return { ok: false, message: "Contents aren't saved: save request rejected" };
      const data = await r.json();
      if (typeof data.jobId !== 'string') return { ok: false, message: "Contents aren't saved: save request rejected" };
      const deadline = Date.now() + 30000;
      for (;;) {
        const jr = await fetch(`/api/jobs/${encodeURIComponent(data.jobId)}`);
        if (!jr.ok) return { ok: false, message: "Contents aren't saved: could not check save status" };
        const job = await jr.json();
        if (job.status === 'done') return { ok: true };
        if (job.status === 'failed') {
          const jobCode = typeof job.code === 'string' ? job.code : undefined;
          let message = typeof job.error === 'string' ? job.error : "Contents aren't saved";
          // Surface a dead backend distinctly (STORAGE_BACKENDS plan §5.2);
          // verify-failed/unknown keep the "Contents aren't saved" message.
          if (jobCode === 'unavailable') {
            message = `Storage unavailable${message ? `: ${message}` : ''}`;
          }
          return { ok: false, code: jobCode, message };
        }
        if (Date.now() > deadline) return { ok: false, message: "Contents aren't saved: save timed out" };
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } catch (e) {
      console.error(e);
      return { ok: false, message: "Contents aren't saved" };
    }
  }, [dirParam]);

  // Persists the active diagram (either embedded diagram via background job
  // or standalone .mmd file via atomic POST). All persist operations are
  // serialized through saveQueueRef to ensure writes never run in parallel.
  const persistActiveDiagram = useCallback(async (contentToPersist: string): Promise<{ ok: boolean; message?: string }> => {
    if (!currentFile) return { ok: false, message: 'No file selected' };
    // Read-only files: apply the change in-memory so the user can explore,
    // but never write to disk.
    if (isReadOnly) {
      lastWrittenRef.current = contentToPersist;
      setRawCode(contentToPersist);
      return { ok: true };
    }
    return saveQueueRef.current.run(async () => {
      setSaveStatus('saving');
      setSaveConflict(null);
      setSaveErrorMessage(null);
      if (isEmbeddedDiagram && diagramIndex !== null) {
        const expectedContent = lastWrittenRef.current ?? '';
        lastWrittenRef.current = contentToPersist;
        const result = await saveEmbeddedDiagram(currentFile, diagramIndex, contentToPersist, expectedContent);
        if (result.ok) {
          lastWrittenRef.current = contentToPersist;
          setRawCode(contentToPersist);
          setSaveStatus('saved');
          setSaveErrorMessage(null);
          return { ok: true };
        } else {
          setSaveStatus('error');
          setSaveErrorMessage(result.message || "Contents aren't saved");
          if (result.code === 'conflict') {
            setSaveConflict(result.message || 'The diagram changed on disk; it was reloaded.');
          }
          const disk = await fetchCurrentContent(currentFile, diagramIndex);
          if (disk !== null && rawCodeFileRef.current === currentFile && rawCodeDiagramRef.current === diagramIndex) {
            lastWrittenRef.current = disk;
          }
          return { ok: false, message: result.message || "Contents aren't saved" };
        }
      } else {
        const res = await postFile(currentFile, contentToPersist);
        if (res.ok) {
          lastWrittenRef.current = contentToPersist;
          setRawCode(contentToPersist);
          setSaveStatus('saved');
          setSaveErrorMessage(null);
          return { ok: true };
        } else {
          setSaveStatus('error');
          setSaveErrorMessage(res.message || "Contents aren't saved");
          if (res.code === 'conflict') {
            setSaveConflict(res.message || 'The file changed on disk; it was reloaded.');
          }
          return { ok: false, message: res.message || "Contents aren't saved" };
        }
      }
    });
  }, [currentFile, isEmbeddedDiagram, diagramIndex, saveEmbeddedDiagram, postFile, fetchCurrentContent, isReadOnly]);

  const loadFile = useCallback(async (filename: string, index: number | null): Promise<boolean> => {
    const seq = ++loadSeqRef.current;
    const content = await fetchCurrentContent(filename, index);
    if (seq !== loadSeqRef.current) return false;
    if (content === null) {
      if (index !== null) {
        // Stale diagram index (e.g. a hand-edited URL): show an empty editor
        // rather than the previously loaded file's content under the new URL.
        lastWrittenRef.current = '';
        rawCodeFileRef.current = filename;
        rawCodeDiagramRef.current = index;
        setLoadedSelection({ file: filename, diagram: index });
        setRawCode('');
        setDebouncedCode('');
      }
      return false;
    }
    lastWrittenRef.current = content;
    rawCodeFileRef.current = filename;
    rawCodeDiagramRef.current = index;
    setLoadedSelection({ file: filename, diagram: index });
    setRawCode(content);
    setDebouncedCode(content);
    return true;
  }, [fetchCurrentContent]);

  useEffect(() => {
    if (currentFile) {
      // Switching to a different file or embedded diagram clears the in-memory
      // content immediately so stale text (e.g. whole-document markdown prose)
      // is never passed to DiagramViewer or the editor while the fetch runs.
      if (rawCodeFileRef.current !== currentFile || rawCodeDiagramRef.current !== diagramIndex) {
        setRawCode('');
        setDebouncedCode('');
      }
      // A markdown file without a diagram selection loads the whole document
      // into the rich markdown editor; a diagram selection loads just that
      // embedded block.
      //
      // Opening an embedded diagram from the document view first persists a
      // pending whole-document edit: the diagram editor loads the block's
      // source from disk, and the content clear above cancels the debounced
      // auto-save — without the flush a just-inserted diagram block would
      // never reach disk and the insert would be lost. The write is serialized
      // through the save queue so it cannot interleave with an in-flight save.
      const pendingDocEdit = diagramIndex !== null
        && rawCodeFileRef.current === currentFile
        && rawCodeDiagramRef.current === null
        && rawCodeRef.current !== lastWrittenRef.current
        && !isReadOnly;
      // Capture the pending document eagerly: the content clear above
      // re-renders (and with it rawCodeRef) before the queued save task runs.
      const docEditToFlush = pendingDocEdit ? { content: rawCodeRef.current, diagramIndex } : null;
      const flush = docEditToFlush !== null
        ? saveQueueRef.current.run(async () => {
            const res = await postFile(currentFile, docEditToFlush.content);
            if (res.ok) {
              // Pre-seed the marker with the target block's source — exactly
              // what the diagram API returns for it — so the SSE echo of this
              // write is recognized as our own once the block loads.
              const block = extractMermaidBlocks(docEditToFlush.content)[docEditToFlush.diagramIndex];
              lastWrittenRef.current = block ? block.content : docEditToFlush.content;
            } else {
              setSaveStatus('error');
              setSaveErrorMessage(res.message || "Contents aren't saved");
            }
          })
        : Promise.resolve();
      flush.then(() => {
        loadFile(currentFile, diagramIndex);
      });
      setSelection(null);
      setPendingDelete(null);
    } else {
      rawCodeFileRef.current = null;
      rawCodeDiagramRef.current = null;
      setRawCode('');
      setDebouncedCode('');
      setSelection(null);
      setPendingDelete(null);
    }
    setSelectedViewName(null);
    setSaveConflict(null);
    // Switching files or directories resets the undo history (Section 4.11).
    setHistoryPast([]);
    setHistoryFuture([]);
    setEditModeKind('visual');
    if (changedLinesTimerRef.current) {
      clearTimeout(changedLinesTimerRef.current);
      changedLinesTimerRef.current = null;
    }
    setChangedLines([]);
    setSourceValidationError(null);
  }, [currentFile, diagramIndex, loadFile, postFile, isReadOnly]);

  useEffect(() => {
    if (STATIC_DEMO) return; // no server → no SSE live reload
    const evtSource = new EventSource(`/api/events${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`);
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!currentFile || data.file !== currentFile) return;
      // Refetch and route through the last-written comparison (Section 4.10):
      // identical content is our own write echoed back — ignore it; anything
      // else is an external change — adopt it, do not clobber it.
      fetchCurrentContent(currentFile, diagramIndex).then(content => {
        if (content === null) return;
        if (content === lastWrittenRef.current) return;
        lastWrittenRef.current = content;
        setRawCode(content);
        setDebouncedCode(content);
        setHistoryPast([]);   // external change: the in-memory history no longer applies
        setHistoryFuture([]);
        setReloadNotice(true);
      });
    };
    return () => evtSource.close();
  }, [currentFile, fetchCurrentContent, dirParam, diagramIndex]);

  // The "Reloaded from disk" notice auto-dismisses.
  useEffect(() => {
    if (!reloadNotice) return;
    const timer = setTimeout(() => setReloadNotice(false), 5000);
    return () => clearTimeout(timer);
  }, [reloadNotice]);

  // The save-conflict notice auto-dismisses.
  useEffect(() => {
    if (!saveConflict) return;
    const timer = setTimeout(() => setSaveConflict(null), 8000);
    return () => clearTimeout(timer);
  }, [saveConflict]);

  // The save-error notice auto-dismisses.
  useEffect(() => {
    if (!saveErrorMessage) return;
    const timer = setTimeout(() => setSaveErrorMessage(null), 8000);
    return () => clearTimeout(timer);
  }, [saveErrorMessage]);

  const [debouncedCode, setDebouncedCode] = useState(rawCode);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedCode(rawCode);
    }, 500);
    return () => clearTimeout(handler);
  }, [rawCode]);

  // Auto-save (Section 4.10): every committed edit becomes a debounced
  // write-through POST. Skipped when there is no file, when the content
  // belongs to another file (a switch discarded it), or when it is already
  // the last successfully written content (initial load, own SSE echo, or an
  // undo back to the saved state). Diagrams embedded in a markdown file save
  // through the background job queue instead of a direct POST; a markdown
  // document selected without a diagram saves the whole file with a direct
  // POST.
  useEffect(() => {
    if (!currentFile) return;
    if (rawCodeFileRef.current !== currentFile || rawCodeDiagramRef.current !== diagramIndex) return;
    if (rawCode === lastWrittenRef.current) {
      // An edit superseded by a newer one that equals the last written content
      // (e.g. undo then redo inside the debounce window) clears the previous
      // run's timer before it fires, but that run already flagged 'saving' —
      // nothing would ever complete it. Settle the indicator back to 'saved'
      // (the in-memory content matches the disk); other states are untouched.
      setSaveStatus(prev => (prev === 'saving' ? 'saved' : prev));
      return;
    }
    // Read-only files: edits are reflected in-memory so the UI stays fully
    // explorable, but nothing is ever written to disk.
    if (isReadOnly) {
      lastWrittenRef.current = rawCode;
      setSaveStatus('idle');
      return;
    }
    setSaveStatus('saving');
    setSaveConflict(null);
    setSaveErrorMessage(null);
    const seq = ++saveSeqRef.current;
    const contentToSave = rawCode;
    const timer = setTimeout(() => {
      saveQueueRef.current.run(async () => {
        if (seq !== saveSeqRef.current) return; // a newer edit superseded this save
        if (isEmbeddedDiagram && diagramIndex !== null) {
          // Compare-and-swap: the job re-reads the markdown file and refuses to
          // write when the target block changed on disk since it was loaded.
          const expectedContent = lastWrittenRef.current ?? '';
          // Optimistically mark the content as written so the SSE echo of our
          // own save is ignored (same pattern as the direct POST below).
          lastWrittenRef.current = contentToSave;
          const result = await saveEmbeddedDiagram(currentFile, diagramIndex, contentToSave, expectedContent);
          if (seq !== saveSeqRef.current) return; // a newer edit superseded this save
          if (result.ok) {
            setSaveStatus('saved');
            setSaveErrorMessage(null);
          } else {
            setSaveStatus('error');
            setSaveErrorMessage(result.message || "Contents aren't saved");
            if (result.code === 'conflict') {
              setSaveConflict(result.message || 'The diagram changed on disk; it was reloaded.');
            }
            // Roll back the optimistic marker to the real disk content, so the
            // next edit saves again with a fresh compare-and-swap base. Only
            // when the selection is still the one this save was for — after a
            // file/diagram switch the load already set the correct marker.
            fetchCurrentContent(currentFile, diagramIndex).then(disk => {
              if (disk !== null && rawCodeFileRef.current === currentFile && rawCodeDiagramRef.current === diagramIndex) {
                lastWrittenRef.current = disk;
              }
            });
          }
        } else {
          const res = await postFile(currentFile, contentToSave);
          if (seq !== saveSeqRef.current) return; // a newer edit superseded this save
          if (res.ok) {
            lastWrittenRef.current = contentToSave;
            setSaveStatus('saved');
            setSaveErrorMessage(null);
          } else {
            setSaveStatus('error'); // retried on the next edit
            setSaveErrorMessage(res.message || "Contents aren't saved");
          }
        }
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [rawCode, currentFile, postFile, isEmbeddedDiagram, diagramIndex, saveEmbeddedDiagram, fetchCurrentContent, isReadOnly]);

  const regionRoots = useMemo(() => extractRegions(debouncedCode), [debouncedCode]);

  const viewsData = useMemo<DiagramConfig | null>(() => {
    return parseViewsData(rawCode);
  }, [rawCode]);

  const [showNotes, setShowNotes] = useState(true);
  const stickyNotes = useMemo(() => viewsData?.notes || [], [viewsData]);

  // Sticky notes live in CONFIG, not in the parsed model; wrap them as
  // pseudo-elements (key `sticky:<id>`) so they join the same
  // selection/tag/hide pipeline as parsed elements. Their line span is pinned
  // to the CONFIG header (line 0); no line-surgical transform targets them.
  const stickyElements = useMemo<StickyNoteElement[]>(() => {
    return stickyNotes.map(n => ({
      key: `sticky:${n.id}`,
      kind: 'sticky',
      id: n.id,
      text: n.text,
      color: n.color,
      lineStart: 0,
      lineEnd: 0,
    }));
  }, [stickyNotes]);

  // Hiding is on/off only for sticky notes: the card is hidden when ALL of
  // its tags are Off in the By Key filter (same rule as notes' own keys).
  const visibleStickyNotes = useMemo(() => {
    if (hideKeys.size === 0) return stickyNotes;
    return stickyNotes.filter(n => {
      const keys = n.keys ?? [];
      return keys.length === 0 || !keys.every(k => hideKeys.has(k));
    });
  }, [stickyNotes, hideKeys]);

  // Subgraph tags are structural (derived from the code, not the CONFIG), so
  // the By Key list reflects the raw file even before any tag is saved.
  const availableKeys = useMemo(() => collectAvailableKeys(viewsData, rawCode), [viewsData, rawCode]);

  // Per-block view/tag selections for the markdown preview's diagram controls,
  // keyed by diagram index. The state lives in the URL (mdview/mdhide params),
  // so it survives reloads and is shareable — like the diagram editor's
  // filter params — and toggling never writes to the file.
  const mdViewStates = useMemo(
    () => parseMarkdownViewStates(searchParams.toString()),
    [searchParams],
  );

  const handleMarkdownViewStateChange = (index: number, selection: DiagramViewSelection) => {
    const params = new URLSearchParams(searchParams.toString());
    applyMarkdownViewState(params, index, selection);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const actorOptions = useMemo<ActorTransformOptions>(() => ({
    mergeByKeys: Array.from(mergeKeys),
    mergeCleanByKeys: Array.from(mergeCleanKeys),
    hideColors: Array.from(hideColors),
    hideKeys: Array.from(hideKeys)
  }), [mergeKeys, mergeCleanKeys, hideColors, hideKeys]);

  const activeView = useMemo(() => {
    if (!selectedViewName || !viewsData?.views) return null;
    return viewsData.views.find(v => v.name === selectedViewName) || null;
  }, [viewsData, selectedViewName]);
  const isViewActive = Boolean(activeView);
  // The built-in "Default" entry in the Saved Views list stands for the full,
  // unfiltered diagram: it is the active choice when no saved view is applied
  // and no manual filters are in effect. Selecting it resets everything.
  const isDefaultViewActive = !activeView && hiddenPaths.size === 0 && hideColors.size === 0
    && mergeKeys.size === 0 && mergeCleanKeys.size === 0 && hideKeys.size === 0;

  const effectiveHiddenPaths = useMemo(() => {
    if (activeView) {
      return new Set(activeView.hiddenPaths || []);
    }
    return hiddenPaths;
  }, [activeView, hiddenPaths]);

  const effectiveActorOptions = useMemo<ActorTransformOptions>(() => {
    if (activeView) {
      return {
        mergeByKeys: activeView.mergeKeys || activeView.mergeByKeys || [],
        mergeCleanByKeys: activeView.mergeCleanKeys || activeView.mergeCleanByKeys || [],
        hideColors: activeView.hideColors || [],
        hideKeys: activeView.hideKeys || [],
      };
    }
    return actorOptions;
  }, [activeView, actorOptions]);

  const { code: processedCode, warnings: procWarnings } = useMemo(() => {
    const actorTransformed = transformActors(debouncedCode, viewsData, effectiveActorOptions);

    return processMermaid(actorTransformed, {
      isRegionVisible: (region) => !isPathHidden(region.path, effectiveHiddenPaths)
    });
  }, [debouncedCode, viewsData, effectiveActorOptions, effectiveHiddenPaths]);

  const viewCode = useMemo(() => {
    const actorTransformed = transformActors(rawCode, viewsData, effectiveActorOptions);

    return processMermaid(actorTransformed, {
      isRegionVisible: (region) => !isPathHidden(region.path, effectiveHiddenPaths)
    }).code;
  }, [rawCode, viewsData, effectiveActorOptions, effectiveHiddenPaths]);

  const actorRewriteMap = useMemo(
    () => buildActorRewriteMap(viewsData, effectiveActorOptions, rawCode),
    [viewsData, effectiveActorOptions, rawCode]
  );

  const setActorState = (id: string, state: 'on' | 'off' | 'merged' | 'merged_clean') => {
    setSelectedViewName(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    params.delete('merge_color');
    params.delete('merge_clean_color');

    const mergeParamName = 'merge_key';
    const mergeCleanParamName = 'merge_clean_key';
    const hideParamName = 'hide_key';
    
    const currentMerge = new Set(mergeKeys);
    const currentMergeClean = new Set(mergeCleanKeys);
    const currentHide = new Set(hideKeys);

    if (state === 'on') {
      currentMerge.delete(id);
      currentMergeClean.delete(id);
      currentHide.delete(id);
    } else if (state === 'off') {
      currentMerge.delete(id);
      currentMergeClean.delete(id);
      currentHide.add(id);
    } else if (state === 'merged') {
      currentHide.delete(id);
      currentMergeClean.delete(id);
      currentMerge.add(id);
    } else if (state === 'merged_clean') {
      currentHide.delete(id);
      currentMerge.delete(id);
      currentMergeClean.add(id);
    }

    if (currentMerge.size > 0) params.set(mergeParamName, Array.from(currentMerge).join(','));
    else params.delete(mergeParamName);

    if (currentMergeClean.size > 0) params.set(mergeCleanParamName, Array.from(currentMergeClean).join(','));
    else params.delete(mergeCleanParamName);

    if (currentHide.size > 0) params.set(hideParamName, Array.from(currentHide).join(','));
    else params.delete(hideParamName);

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    setWarnings(procWarnings);
  }, [procWarnings]);

  // --- Edit mode (EDITING_PLAN.md Step 7 walking skeleton) ---
  const rawModel = useMemo(() => parseModel(rawCode), [rawCode]);
  const editSupported = rawModel.type !== 'unknown';  // R-01: sequence + flowchart only
  // Edit mode is ON by default when a diagram is opened; `edit=0` opts out
  // (the toolbar toggle flips between the two). `edit=1` still works.
  // A markdown document is never in diagram edit mode — its mermaid blocks are
  // edited by selecting them (which opens the diagram editor).
  const editMode = !isMarkdownDoc && editSupported && searchParams.get('edit') !== '0';
  const isVisualLocked = editMode && editModeKind === 'code';

  const selectionMap = useMemo(
    () => buildSelectionMap(rawCode, processedCode, viewsData, effectiveActorOptions),
    [rawCode, processedCode, viewsData, effectiveActorOptions]
  );
  // Inverse of the selection map (raw key -> processed key) for the highlight.
  const rawToProcessed = useMemo(() => {
    const map = new Map<string, string>();
    selectionMap.forEach((rawEl, processedKey) => { map.set(rawEl.key, processedKey); });
    return map;
  }, [selectionMap]);
  const processedSelections = useMemo(() => {
    return selectedKeys
      .map(k => rawToProcessed.get(k))
      .filter((k): k is string => Boolean(k));
  }, [selectedKeys, rawToProcessed]);
  const processedSelection = processedSelections.length <= 1 ? (processedSelections[0] ?? null) : processedSelections;

  const selectedRawElements = useMemo(() => {
    const rawMap = new Map(rawModel.elements.map(e => [e.key, e]));
    const stickyMap = new Map(stickyElements.map(e => [e.key, e]));
    return selectedKeys
      .map(k => rawMap.get(k) ?? stickyMap.get(k))
      .filter((e): e is ModelElement => Boolean(e));
  }, [selectedKeys, rawModel, stickyElements]);

  const selectedRawElement = selectedRawElements.length === 1 ? selectedRawElements[0] : null;

  const selectedElementsTagInfo = useMemo(() => {
    // Structural subgraph tags show up as read-only inherited chips: an actor
    // carries the tags of the subgraphs it belongs to, a message/edge/note the
    // tags of the subgraphs containing its line.
    const subgraphIndex = buildSubgraphTagIndex(rawCode);
    return selectedRawElements.map(el => {
      let ownTags: string[] = [];
      let inheritedTags: string[] = [];
      if (el.kind === 'participant' || el.kind === 'node') {
        ownTags = viewsData?.actors?.[el.id]?.keys ?? [];
        inheritedTags = subgraphIndex.actorKeys.get(el.id) ?? [];
      } else if (el.kind === 'message' || el.kind === 'edge') {
        const info = getArrowTags(rawCode, viewsData, el.key);
        ownTags = info?.keys ?? [];
        inheritedTags = info?.inherited ?? [];
      } else if (el.kind === 'note') {
        ownTags = getNoteTags(rawCode, viewsData, el.key);
        inheritedTags = subgraphIndex.elementKeys.get(el.key) ?? [];
      } else if (el.kind === 'sticky') {
        ownTags = getStickyNoteTags(viewsData, el.key);
      }
      return {
        element: el,
        ownTags,
        inheritedTags,
      };
    });
  }, [selectedRawElements, rawCode, viewsData]);

  // DiagramViewer click: processed key -> raw key.
  const handleSelect = (processedKey: string | string[] | null, options?: { shiftKey?: boolean }) => {
    if (Array.isArray(processedKey)) {
      const rawKeys: string[] = [];
      for (const pk of processedKey) {
        if (pk.startsWith('sticky:')) {
          rawKeys.push(pk);
        } else {
          const raw = selectionMap.get(pk);
          if (raw) rawKeys.push(raw.key);
        }
      }
      if (options?.shiftKey) {
        setSelectedKeys(prev => {
          const set = new Set(prev);
          for (const k of rawKeys) set.add(k);
          return Array.from(set);
        });
      } else {
        setSelectedKeys(rawKeys);
      }
      return;
    }

    if (options?.shiftKey) {
      if (!processedKey) return;
      if (processedKey.startsWith('sticky:')) {
        setSelectedKeys(prev =>
          prev.includes(processedKey) ? prev.filter(k => k !== processedKey) : [...prev, processedKey]
        );
        return;
      }
      const raw = selectionMap.get(processedKey);
      if (!raw) return;
      setSelectedKeys(prev => {
        if (prev.includes(raw.key)) {
          return prev.filter(k => k !== raw.key);
        } else {
          return [...prev, raw.key];
        }
      });
      return;
    }

    if (!processedKey) {
      setSelectedKeys([]);
      return;
    }
    if (processedKey.startsWith('sticky:')) {
      setSelectedKeys([processedKey]);
      return;
    }
    const raw = selectionMap.get(processedKey);
    setSelectedKeys(raw ? [raw.key] : []);
  };

  // Sticky-note card click: the card reports its CONFIG id; the sticky key
  // (`sticky:<id>`) is its own raw key, so no selection-map hop is needed.
  const handleSelectNote = (id: string, options?: { shiftKey?: boolean }) => {
    const key = `sticky:${id}`;
    if (options?.shiftKey) {
      setSelectedKeys(prev => {
        if (prev.includes(key)) {
          return prev.filter(k => k !== key);
        } else {
          return [...prev, key];
        }
      });
      return;
    }
    setSelectedKeys([key]);
  };

  // CONFIG ids of the selected sticky notes, for the card highlight ring.
  const selectedNoteIds = useMemo(
    () => selectedKeys
      .filter(k => k.startsWith('sticky:'))
      .map(k => k.slice('sticky:'.length)),
    [selectedKeys]
  );
  const resolvedArrowStyles = useMemo(
    () => rewriteArrowStyles(viewsData, effectiveActorOptions, rawCode),
    [viewsData, effectiveActorOptions, rawCode]
  );

  const toggleEditMode = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (editMode) {
      params.set('edit', '0');
    } else {
      params.delete('edit');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // --- Drag callbacks (processed keys -> raw keys via the selection map) ---

  // DiagramViewer drag: reorder a participant (sequence) or a node (flowchart).
  // beforeKey is the processed key of the element to insert before, or null
  // to move to the end. targetBlockKey (flowchart only) pins the drop to a
  // subgraph block when the cursor lifts off past the last node inside it.
  const handleMoveParticipant = (processedKey: string, beforeProcessedKey: string | null, targetBlockKey?: string | null) => {
    if (rawModel.type === 'flowchart') {
      // Flowchart nodes: map the processed keys to raw node keys and move the
      // node's declaration. transformActors only hides/renames flowchart
      // actors (it never reorders them), so the rendered order is the raw
      // declaration order and a direct raw move is exact.
      const fromRaw = selectionMap.get(processedKey);
      if (!fromRaw || fromRaw.kind !== 'node') return;
      let beforeRaw: ModelElement | undefined;
      if (beforeProcessedKey !== null) {
        const b = selectionMap.get(beforeProcessedKey);
        if (!b || b.kind !== 'node') return;
        beforeRaw = b;
      }
      // Map the target block key (processed → raw) for end-of-subgraph drops.
      let targetBlockRawKey: string | undefined;
      if (targetBlockKey) {
        const blockRaw = selectionMap.get(targetBlockKey);
        if (blockRaw && blockRaw.kind === 'block') targetBlockRawKey = blockRaw.key;
      }
      applyEditResult(moveNode(rawCode, viewsData, fromRaw.key, beforeRaw?.key, targetBlockRawKey));
      return;
    }
    // Sequence participants: the drop is computed in rendered order, so
    // resolve it against the raw code through the processing pipeline:
    // transformActors regroups participants into color boxes, so rendered
    // order is not the raw declaration order.
    applyEditResult(resolveParticipantReorder(
      rawCode,
      processedCode,
      processedKey,
      beforeProcessedKey,
      {
        config: viewsData,
        actorOptions,
        isRegionVisible: (region) => !isPathHidden(region.path, hiddenPaths),
      },
    ));
  };

  // DiagramViewer drag: create a message by dragging from one participant to
  // another. The position's key (before/after) is also a processed key.
  const handleCreateMessageDrag = (
    fromProcessedKey: string,
    toProcessedKey: string,
    position: MessageInsertPosition,
  ) => {
    const fromRaw = selectionMap.get(fromProcessedKey);
    const toRaw = selectionMap.get(toProcessedKey);
    if (!fromRaw || !toRaw) return;
    let rawPosition: MessageInsertPosition;
    if (position.type === 'before' || position.type === 'after') {
      const rawTarget = selectionMap.get(position.key);
      if (!rawTarget) return;
      rawPosition = { type: position.type, key: rawTarget.key };
    } else {
      rawPosition = position;
    }
    applyEditResult(addMessage(rawCode, viewsData, fromRaw.key, toRaw.key, rawPosition));
  };

  // DiagramViewer drag: retarget a sequence message's endpoint — drag the
  // arrow head to change the recipient ('to'), the tail to change the origin
  // ('from'). All keys are processed; resolved to raw keys here.
  const handleMoveMessageEndpoint = (
    messageProcessedKey: string,
    end: 'from' | 'to',
    targetProcessedKey: string,
  ) => {
    const rawMessage = selectionMap.get(messageProcessedKey);
    const rawTarget = selectionMap.get(targetProcessedKey);
    if (!rawMessage || !rawTarget) return;
    applyEditResult(moveMessageEndpoint(rawCode, viewsData, rawMessage.key, end, rawTarget.key));
  };

  // DiagramViewer drag: retarget a flowchart edge's endpoint — drag the arrow
  // head to change the target node ('to'), the tail to change the origin
  // ('from'). All keys are processed; resolved to raw keys here.
  const handleMoveEdgeEndpoint = (
    edgeProcessedKey: string,
    end: 'from' | 'to',
    targetProcessedKey: string,
  ) => {
    const rawEdge = selectionMap.get(edgeProcessedKey);
    const rawTarget = selectionMap.get(targetProcessedKey);
    if (!rawEdge || !rawTarget) return;
    applyEditResult(moveEdgeEndpoint(rawCode, viewsData, rawEdge.key, end, rawTarget.key));
  };

  // DiagramViewer drag: reorder a sequence message vertically up or down.
  const handleMoveMessage = (
    messageProcessedKey: string,
    position: MessageInsertPosition,
  ) => {
    const rawMessage = selectionMap.get(messageProcessedKey);
    if (!rawMessage || rawMessage.kind !== 'message') return;
    const rawPosition: MessageInsertPosition =
      position.type === 'before' || position.type === 'after'
        ? (() => {
            const el = selectionMap.get(position.key);
            return el ? { type: position.type, key: el.key } : { type: 'bottom' };
          })()
        : position;
    applyEditResult(moveMessage(rawCode, viewsData, rawMessage.key, rawPosition));
  };

  // --- Edit dispatch (EDITING_PLAN.md Steps 7-8): every panel action runs a
  // pure transform over (rawCode, viewsData) and applies the result. ---

  // Commit a new raw text state: push the current state onto the undo stack
  // (before the auto-save debounce fires) and clear the redo stack.
  const commitEdit = useCallback((newCode: string) => {
    const diff = computeLineDiff(rawCode, newCode);
    updateChangedLines(diff.changedLines);
    setHistoryPast(past => [...past, rawCode].slice(-HISTORY_LIMIT));
    setHistoryFuture([]);
    setRawCode(newCode);
  }, [rawCode, updateChangedLines]);

  const handleHandEditCode = useCallback(async (newCode: string) => {
    if (isViewActive || editModeKind !== 'code') return;
    if (newCode === rawCode) return;
    const diff = computeLineDiff(rawCode, newCode);
    updateChangedLines(diff.changedLines);
    try {
      const model = parseModel(newCode);
      if (model.type === 'unknown' && newCode.trim().length > 0) {
        throw new Error('Unknown diagram type. Expected sequenceDiagram or flowchart/graph');
      }
      const config = parseViewsData(newCode);
      const transformed = transformActors(newCode, config, actorOptions);
      const processed = processMermaid(transformed, {
        isRegionVisible: (region) => !isPathHidden(region.path, hiddenPaths),
      });
      if (typeof mermaid !== 'undefined' && mermaid.parse) {
        await mermaid.parse(processed.code);
      }
      setSourceValidationError(null);
      commitEdit(newCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSourceValidationError(msg);
    }
  }, [isViewActive, editModeKind, rawCode, actorOptions, hiddenPaths, commitEdit, updateChangedLines]);

  // Markdown source edits (MarkdownEditor): no diagram validation — the text
  // is saved as-is through the regular auto-save path.
  const handleMarkdownChange = useCallback((newCode: string) => {
    setRawCode(newCode);
  }, []);

  // WYSIWYG block edits (MarkdownEditor): routed through commitEdit so they
  // participate in the undo/redo stack (Monaco edits keep Monaco's own undo).
  const handleMarkdownEdit = useCallback((newCode: string) => {
    commitEdit(newCode);
  }, [commitEdit]);

  const applyEditResult = (result: EditResult) => {
    if (result.warning) {
      setEditWarning(result.warning);
      return;
    }
    setEditWarning(null);
    if (result.code === rawCode) return; // no-op transform: no history entry
    commitEdit(result.code);
    // Select a newly created element (e.g. a message created by drag), so the
    // right panel shows it immediately.
    if (result.newKey) setSelection(result.newKey);
  };

  const handleAddNote = () => {
    if (!showNotes) setShowNotes(true);
    let x = 120;
    let y = 80;
    const container = document.getElementById('diagram-container');
    if (container) {
      const svg = container.querySelector('svg');
      if (svg) {
        const svgRect = svg.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const transformEl = container.querySelector('.react-transform-component') as HTMLElement | null;
        const scaleMatch = transformEl?.style.transform.match(/scale\(([\d.]+)\)/);
        const parsedScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
        const scale = Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1;
        const offset = (stickyNotes.length % 6) * 20;

        if (containerRect.width > 0 && containerRect.height > 0 && svgRect.width > 0 && svgRect.height > 0) {
          const viewLeft = typeof window !== 'undefined' && window.innerWidth > 0
            ? Math.max(containerRect.left, 0)
            : containerRect.left;
          const viewTop = typeof window !== 'undefined' && window.innerHeight > 0
            ? Math.max(containerRect.top, 0)
            : containerRect.top;
          const viewRight = typeof window !== 'undefined' && window.innerWidth > 0
            ? Math.min(containerRect.right, window.innerWidth)
            : containerRect.right;
          const viewBottom = typeof window !== 'undefined' && window.innerHeight > 0
            ? Math.min(containerRect.bottom, window.innerHeight)
            : containerRect.bottom;

          const vLeft = viewRight > viewLeft ? viewLeft : containerRect.left;
          const vTop = viewBottom > viewTop ? viewTop : containerRect.top;
          const vRight = viewRight > viewLeft ? viewRight : containerRect.right;
          const vBottom = viewBottom > viewTop ? viewBottom : containerRect.bottom;

          const interLeft = Math.max(vLeft, svgRect.left);
          const interTop = Math.max(vTop, svgRect.top);
          const interRight = Math.min(vRight, svgRect.right);
          const interBottom = Math.min(vBottom, svgRect.bottom);

          const boxLeft = interRight > interLeft ? interLeft : vLeft;
          const boxRight = interRight > interLeft ? interRight : vRight;
          const boxTop = interBottom > interTop ? interTop : vTop;
          const boxBottom = interBottom > interTop ? interBottom : vBottom;

          const centerScreenX = (boxLeft + boxRight) / 2;
          const centerScreenY = (boxTop + boxBottom) / 2;

          let noteX = (centerScreenX - svgRect.left) / scale - 32 + offset;
          let noteY = (centerScreenY - svgRect.top) / scale - 27 + offset;

          const minVisX = (vLeft - svgRect.left) / scale + 8;
          const maxVisX = (vRight - svgRect.left) / scale - 65 - 8;
          if (maxVisX >= minVisX) {
            noteX = Math.min(Math.max(noteX, minVisX), maxVisX);
          }
          const minVisY = (vTop - svgRect.top) / scale + 8;
          const maxVisY = (vBottom - svgRect.top) / scale - 55 - 8;
          if (maxVisY >= minVisY) {
            noteY = Math.min(Math.max(noteY, minVisY), maxVisY);
          }

          x = Math.round(noteX);
          y = Math.round(noteY);
        } else if (svgRect.width > 0 && svgRect.height > 0) {
          x = Math.max(20, Math.round((svgRect.width / scale) / 2 - 32 + offset));
          y = Math.max(20, Math.round((svgRect.height / scale) / 2 - 27 + offset));
        }
      }
    }
    const newNote: StickyNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      x,
      y,
      text: '',
      color: 'yellow',
    };
    commitEdit(addStickyNote(rawCode, newNote));
  };

  const handleUpdateNote = (id: string, patch: Partial<Omit<StickyNote, 'id'>>) => {
    const updated = updateStickyNote(rawCode, id, patch);
    if (updated !== rawCode) {
      commitEdit(updated);
    }
  };

  const handleDeleteNote = (id: string) => {
    commitEdit(deleteStickyNote(rawCode, id));
  };

  const undo = useCallback(() => {
    if (historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast(historyPast.slice(0, -1));
    setHistoryFuture([...historyFuture, rawCode].slice(-HISTORY_LIMIT));
    const diff = computeLineDiff(rawCode, previous);
    updateChangedLines(diff.changedLines);
    setRawCode(previous);
  }, [historyPast, historyFuture, rawCode, updateChangedLines]);

  const redo = useCallback(() => {
    if (historyFuture.length === 0) return;
    const next = historyFuture[historyFuture.length - 1];
    setHistoryFuture(historyFuture.slice(0, -1));
    setHistoryPast([...historyPast, rawCode].slice(-HISTORY_LIMIT));
    const diff = computeLineDiff(rawCode, next);
    updateChangedLines(diff.changedLines);
    setRawCode(next);
  }, [historyPast, historyFuture, rawCode, updateChangedLines]);

  const [copied, setCopied] = useState(false);
  const [pngCopied, setPngCopied] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ key: string; seq: number } | null>(null);

  const handleCopyMermaid = async () => {
    const codeToCopy = isViewActive ? viewCode : rawCode;
    if (!codeToCopy) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(codeToCopy);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = codeToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy Mermaid code:', err);
    }
  };

  const handleExportSvg = useCallback(() => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    exportSvgToFile(svg, {
      notes: visibleStickyNotes,
      showNotes,
      isDark,
      fileName: currentFile,
    });
  }, [currentFile, visibleStickyNotes, showNotes, isDark]);

  const handleExportPng = useCallback(async () => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    await exportPngToFile(svg, {
      notes: visibleStickyNotes,
      showNotes,
      isDark,
      fileName: currentFile,
    });
  }, [currentFile, visibleStickyNotes, showNotes, isDark]);

  const handleCopyPng = useCallback(async () => {
    const container = document.getElementById('diagram-container');
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const ok = await copyPngToClipboard(svg, {
      notes: visibleStickyNotes,
      showNotes,
      isDark,
      fileName: currentFile,
    });
    if (ok) {
      setPngCopied(true);
      setTimeout(() => setPngCopied(false), 2000);
    }
  }, [currentFile, visibleStickyNotes, showNotes, isDark]);

  const handleJumpToElement = useCallback((rawKey: string) => {
    setSelectedKeys([rawKey]);
    const processedKey = rawToProcessed.get(rawKey) ?? rawKey;
    setFocusRequest(prev => ({ key: processedKey, seq: (prev?.seq ?? 0) + 1 }));
  }, [rawToProcessed]);

  // Cmd+K / Ctrl+K opens or closes the Command Palette from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Ctrl+Z / Ctrl+Y, plus the macOS-standard redo Cmd/Ctrl+Shift+Z
  // (Section 4.11). Inside text fields the native input undo wins; the
  // diagram-level shortcut applies everywhere else.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' || target.isContentEditable)) return;
      e.preventDefault();
      // Shift+Z is redo (Cmd+Shift+Z); plain Z is undo; Y is always redo.
      if (key === 'y' || e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // Tab toggles the right sidebar (Properties / Mermaid Source) on and off,
  // but only in diagram edit mode. Inside text fields (search box, Monaco)
  // and while a dialog is open, Tab keeps its native focus behavior.
  useEffect(() => {
    if (!editMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (pendingNew || pendingDelete) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' || target.isContentEditable)) return;
      e.preventDefault();
      toggleSidebarVisibility();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode, pendingNew, pendingDelete, toggleSidebarVisibility]);

  const selectedComponent = selectedRawElement && (selectedRawElement.kind === 'participant' || selectedRawElement.kind === 'node')
    ? selectedRawElement
    : null;
  const selectedComponents = useMemo(
    () => selectedRawElements.filter((e): e is ParticipantElement | NodeElement => e.kind === 'participant' || e.kind === 'node'),
    [selectedRawElements]
  );
  const selectedArrow = selectedRawElement && (selectedRawElement.kind === 'message' || selectedRawElement.kind === 'edge')
    ? selectedRawElement
    : null;
  const selectedArrows = useMemo(
    () => selectedRawElements.filter((e): e is MessageElement | EdgeElement => e.kind === 'message' || e.kind === 'edge'),
    [selectedRawElements]
  );

  const selectedArrowStyle = useMemo<ArrowStylePatch | null>(() => {
    if (selectedArrows.length === 0) return null;
    if (selectedArrows.length === 1) {
      return getArrowStyle(rawCode, viewsData, selectedArrows[0].key);
    }
    const styles = selectedArrows.map(a => getArrowStyle(rawCode, viewsData, a.key));
    const first = styles[0] ?? { dash: 'solid' as const };
    const sameColor = styles.every(s => (s?.color ?? undefined) === (first.color ?? undefined));
    const sameWidth = styles.every(s => (s?.width ?? undefined) === (first.width ?? undefined));
    const sameDash = styles.every(s => (s?.dash ?? 'solid') === (first.dash ?? 'solid'));
    const sameAnim = styles.every(s => (s?.animation ?? 'none') === (first.animation ?? 'none'));
    return {
      color: sameColor ? first.color : undefined,
      width: sameWidth ? first.width : undefined,
      dash: sameDash ? (first.dash ?? 'solid') : 'solid',
      ...(sameAnim && first.animation ? { animation: first.animation } : {}),
    };
  }, [selectedArrows, rawCode, viewsData]);

  const selectedArrowTags = useMemo(
    () => (selectedArrow ? getArrowTags(rawCode, viewsData, selectedArrow.key) : null),
    [selectedArrow, rawCode, viewsData]
  );

  const selectedNote = selectedRawElement && selectedRawElement.kind === 'note'
    ? selectedRawElement
    : null;

  const selectedBlock = selectedRawElement && selectedRawElement.kind === 'block'
    ? selectedRawElement
    : null;

  const selectedNoteTags = useMemo(
    () => (selectedNote ? getNoteTags(rawCode, viewsData, selectedNote.key) : null),
    [selectedNote, rawCode, viewsData]
  );

  const selectedStickyNote = selectedRawElement && selectedRawElement.kind === 'sticky'
    ? selectedRawElement
    : null;

  const selectedStickyNoteTags = useMemo(
    () => (selectedStickyNote ? getStickyNoteTags(viewsData, selectedStickyNote.key) : null),
    [selectedStickyNote, viewsData]
  );

  // Current arrow style as a complete patch for a given arrow key (setArrowStyle
  // replaces the whole entry, so single-field edits carry the other fields along).
  const arrowPatchForKey = (code: string, config: DiagramConfig | null, key: string): ArrowStylePatch => {
    const cur = getArrowStyle(code, config, key) ?? {};
    return {
      color: cur.color,
      width: cur.width,
      dash: cur.dash && cur.dash !== 'solid' ? cur.dash : undefined,
      animation: cur.animation,
    };
  };

  const handleEditLabel = (newLabel: string) => {
    if (!selectedRawElement) return;
    const fn = selectedComponent ? renameParticipant : editMessageLabel;
    applyEditResult(fn(rawCode, viewsData, selectedRawElement.key, newLabel));
  };

  // Double-click inline label edit on the canvas: the viewer reports the
  // processed key of the double-clicked element; map it to the raw element
  // and run the same label-edit pipeline as the properties panel.
  const handleInlineLabelEdit = (processedKey: string, newLabel: string) => {
    const rawEl = selectionMap.get(processedKey);
    if (!rawEl) return;
    if (rawEl.kind !== 'participant' && rawEl.kind !== 'node' && rawEl.kind !== 'message' && rawEl.kind !== 'edge') return;
    const fn = (rawEl.kind === 'participant' || rawEl.kind === 'node') ? renameParticipant : editMessageLabel;
    applyEditResult(fn(rawCode, viewsData, rawEl.key, newLabel));
  };

  const handleSetColor = (color: string) => {
    const trimmed = color.trim().toLowerCase();
    if (trimmed) {
      const currentAnim = selectedArrowStyle?.animation;
      const isErrorAnim = currentAnim && ANIMATED_ARROW_PRESETS.some(p => p.id === currentAnim && p.isError);
      const isPosAnim = currentAnim && ANIMATED_ARROW_PRESETS.some(p => p.id === currentAnim && !p.isError);

      if (isErrorAnim) {
        updateLastErrorColor(trimmed);
      } else if (isPosAnim) {
        updateLastPositiveColor(trimmed);
      } else {
        const isErrorPalette = ANIMATED_ARROW_COLORS.error.some(c => c.hex.toLowerCase() === trimmed);
        const isPosPalette = ANIMATED_ARROW_COLORS.positive.some(c => c.hex.toLowerCase() === trimmed);
        if (isErrorPalette) {
          updateLastErrorColor(trimmed);
        } else if (isPosPalette) {
          updateLastPositiveColor(trimmed);
        }
      }
    }

    if (selectedComponent) {
      applyEditResult(setActorColor(rawCode, viewsData, selectedComponent.key, color));
    } else if (selectedComponents.length > 0 && selectedArrows.length === 0) {
      let currentCode = rawCode;
      let currentConfig = viewsData;
      for (const comp of selectedComponents) {
        const res = setActorColor(currentCode, currentConfig, comp.key, color);
        if (res.warning) {
          setEditWarning(res.warning);
          return;
        }
        currentCode = res.code;
        currentConfig = res.config;
      }
      applyEditResult({ code: currentCode, config: currentConfig });
    } else if (selectedArrows.length > 0) {
      let currentCode = rawCode;
      let currentConfig = viewsData;
      for (const arrow of selectedArrows) {
        const patch = arrowPatchForKey(currentCode, currentConfig, arrow.key);
        patch.color = color.trim() || undefined;
        const res = setArrowStyle(currentCode, currentConfig, arrow.key, patch);
        if (res.warning) {
          setEditWarning(res.warning);
          return;
        }
        currentCode = res.code;
        currentConfig = res.config;
      }
      applyEditResult({ code: currentCode, config: currentConfig });
    }
  };

  const handleSetType = (operator: string) => {
    if (selectedArrows.length === 0) return;
    let currentCode = rawCode;
    let currentConfig = viewsData;
    for (const arrow of selectedArrows) {
      if (arrow.operator === operator) continue;
      const res = setArrowType(currentCode, currentConfig, arrow.key, operator);
      if (res.warning) {
        setEditWarning(res.warning);
        return;
      }
      currentCode = res.code;
      currentConfig = res.config;
    }
    applyEditResult({ code: currentCode, config: currentConfig });
  };

  const handleSetWidth = (width: number | '') => {
    if (selectedArrows.length === 0) return;
    let currentCode = rawCode;
    let currentConfig = viewsData;
    for (const arrow of selectedArrows) {
      const patch = arrowPatchForKey(currentCode, currentConfig, arrow.key);
      patch.width = width === '' ? undefined : width;
      const res = setArrowStyle(currentCode, currentConfig, arrow.key, patch);
      if (res.warning) {
        setEditWarning(res.warning);
        return;
      }
      currentCode = res.code;
      currentConfig = res.config;
    }
    applyEditResult({ code: currentCode, config: currentConfig });
  };

  // All-arrows default style (CONFIG.defaultArrowStyle): the fallback for
  // arrows without their own entry field. '' / '' clears the field.
  const handleSetGlobalColor = (color: string) => {
    applyEditResult(setGlobalArrowStyle(rawCode, viewsData, { color }));
  };

  const handleSetGlobalWidth = (width: number | '') => {
    applyEditResult(setGlobalArrowStyle(rawCode, viewsData, { width: width === '' ? undefined : width }));
  };

  const handleSetDash = (dash: 'solid' | 'dashed' | 'dotted') => {
    if (selectedArrows.length === 0) return;
    let currentCode = rawCode;
    let currentConfig = viewsData;
    for (const arrow of selectedArrows) {
      const patch = arrowPatchForKey(currentCode, currentConfig, arrow.key);
      patch.dash = dash === 'solid' ? undefined : dash;
      const res = setArrowStyle(currentCode, currentConfig, arrow.key, patch);
      if (res.warning) {
        setEditWarning(res.warning);
        return;
      }
      currentCode = res.code;
      currentConfig = res.config;
    }
    applyEditResult({ code: currentCode, config: currentConfig });
  };

  const handleSetAnimation = (animation: ArrowAnimationType) => {
    if (selectedArrows.length === 0) return;
    let currentCode = rawCode;
    let currentConfig = viewsData;
    for (const arrow of selectedArrows) {
      const curStyle = getArrowStyle(currentCode, currentConfig, arrow.key);
      const patch = arrowPatchForKey(currentCode, currentConfig, arrow.key);
      const isCurrentlyAnimated = Boolean(curStyle?.animation && curStyle.animation !== 'none');
      patch.animation = animation === 'none' ? undefined : animation;

      if (animation !== 'none' && !isCurrentlyAnimated) {
        const isError = ANIMATED_ARROW_PRESETS.some(p => p.id === animation && p.isError);
        const inheritedColor = isError ? lastErrorColor : lastPositiveColor;
        patch.color = inheritedColor;
      }
      const res = setArrowStyle(currentCode, currentConfig, arrow.key, patch);
      if (res.warning) {
        setEditWarning(res.warning);
        return;
      }
      currentCode = res.code;
      currentConfig = res.config;
    }
    applyEditResult({ code: currentCode, config: currentConfig });
  };

  const handleAddTag = (tag: string, targetKey?: string) => {
    const keysToAdd = targetKey
      ? [targetKey]
      : (selectedRawElements.length > 0
          ? selectedRawElements.map(e => e.key)
          : (selectedRawElement ? [selectedRawElement.key] : []));
    if (keysToAdd.length === 0) return;

    let currentCode = rawCode;
    let currentConfig = viewsData;
    let anyWarning: string | undefined;

    for (const key of keysToAdd) {
      const result = addTag(currentCode, currentConfig, key, tag);
      if (result.warning) {
        anyWarning = result.warning;
        break;
      }
      currentCode = result.code;
      currentConfig = result.config;
    }

    if (anyWarning) {
      setEditWarning(anyWarning);
      return;
    }
    applyEditResult({ code: currentCode, config: currentConfig });
  };

  const handleRemoveTag = (tag: string, targetKey?: string) => {
    const keyToRemove = targetKey ?? selectedRawElement?.key;
    if (!keyToRemove) return;
    applyEditResult(removeTag(rawCode, viewsData, keyToRemove, tag));
  };

  const handleSetArrowKeyMode = (mode: ArrowKeyMode) => {
    if (!selectedArrow) return;
    applyEditResult(setArrowKeyMode(rawCode, viewsData, selectedArrow.key, mode));
  };

  const handleSetParticipantKind = (kind: ParticipantType) => {
    if (!selectedRawElement || selectedRawElement.kind !== 'participant') return;
    applyEditResult(setParticipantKind(rawCode, viewsData, selectedRawElement.key, kind));
  };

  const handleSetNodeShape = (shape: NodeShape) => {
    if (!selectedRawElement || selectedRawElement.kind !== 'node') return;
    applyEditResult(setNodeShape(rawCode, viewsData, selectedRawElement.key, shape));
  };

  const handleToggleActivation = (endpoint: 'target' | 'source', active: boolean) => {
    if (!selectedRawElement || selectedRawElement.kind !== 'message') return;
    applyEditResult(toggleActivation(rawCode, viewsData, selectedRawElement.key, endpoint, active));
  };

  const handleGroupParticipants = (participantKeys: string[], title: string, color?: string) => {
    applyEditResult(groupParticipants(rawCode, viewsData, participantKeys, title, color));
  };

  // Editor panel: wrap flowchart nodes into a `subgraph <title> ... end`
  // block. The subgraph tag pipeline derives the group tag from the title —
  // no CONFIG entry is written.
  const handleGroupNodes = (nodeKeys: string[], title: string) => {
    applyEditResult(groupNodes(rawCode, viewsData, nodeKeys, title));
  };

  const handleToggleOrientation = () => {
    const newCode = toggleDiagramOrientation(rawCode);
    if (newCode !== rawCode) {
      commitEdit(newCode);
    }
  };

  const isNumbered = useMemo(() => hasNumberedSteps(rawCode), [rawCode]);

  const handleToggleNumberedSteps = () => {
    const newCode = toggleNumberedSteps(rawCode);
    if (newCode !== rawCode) {
      commitEdit(newCode);
    }
  };

  const handleRequestDelete = () => {
    if (selectedRawElements.length > 1) {
      const result = deleteElements(
        rawCode,
        viewsData,
        selectedRawElements.map(e => e.key),
      );
      if (result.warning) {
        setEditWarning(result.warning);
        return;
      }
      applyEditResult(result);
      setSelection(null);
      return;
    }
    if (!selectedRawElement) return;
    // Sticky notes are CONFIG annotations: delete the note entry directly
    // (no line-surgical transform, no cascaded elements).
    if (selectedRawElement.kind === 'sticky') {
      handleDeleteNote(selectedRawElement.id);
      setSelection(null);
      return;
    }
    // Blocks delete with their content (edge B12): confirm with the contained
    // messages/notes listed, like the note cascade dialog.
    if (selectedRawElement.kind === 'block') {
      const result = deleteBlock(rawCode, viewsData, selectedRawElement.key, { withContent: true });
      if (result.warning) {
        setEditWarning(result.warning);
        return;
      }
      const cascaded = (result.cascaded ?? [])
        .map(k => rawModel.elements.find(e => e.key === k))
        .filter((e): e is ModelElement => e !== undefined);
      setPendingDelete({ code: result.code, element: selectedRawElement, cascaded });
      return;
    }
    const result = deleteElement(rawCode, viewsData, selectedRawElement.key);
    if (result.warning) {
      setEditWarning(result.warning);
      return;
    }
    // Actors and arrows are deleted immediately without asking for confirmation
    if (selectedComponent || selectedArrow) {
      applyEditResult(result);
      setSelection(null);
      return;
    }
    const cascaded = (result.cascaded ?? [])
      .map(k => rawModel.elements.find(e => e.key === k))
      .filter((e): e is ModelElement => e !== undefined);
    setPendingDelete({ code: result.code, element: selectedRawElement, cascaded });
  };

  // Canvas keyboard shortcuts: Delete/Backspace runs the same delete as the
  // panel's Delete button (handleRequestDelete), Escape clears the canvas
  // selection. '1' adds a participant (or flowchart node), '2' adds a sticky note.
  // Both are skipped inside text fields (native behavior wins
  // there) and while visual edits are locked (editing source code). Escape
  // during an active canvas drag is handled by DiagramViewer, which cancels
  // the drag and marks the event as handled so the selection survives.
  const handleRequestDeleteRef = useRef(handleRequestDelete);
  handleRequestDeleteRef.current = handleRequestDelete;
  const handleAddParticipantRef = useRef<() => void>(() => {});
  const handleAddNoteRef = useRef(handleAddNote);
  handleAddNoteRef.current = handleAddNote;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const inField = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable));
      if (inField) return;
      if (e.key === 'Escape') {
        if (selectedKeys.length === 0) return;
        e.preventDefault();
        setSelection(null);
        return;
      }
      if (e.key === '1' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!editMode || isVisualLocked) return;
        e.preventDefault();
        handleAddParticipantRef.current();
        return;
      }
      if (e.key === '2' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!editMode || isVisualLocked || !rawCode) return;
        e.preventDefault();
        handleAddNoteRef.current();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!editMode || isVisualLocked || selectedKeys.length === 0) return;
      e.preventDefault();
      handleRequestDeleteRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode, isVisualLocked, selectedKeys, rawCode]);

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    commitEdit(pendingDelete.code);
    setPendingDelete(null);
    setSelection(null);
    setEditWarning(null);
  };

  const handleCancelDelete = () => setPendingDelete(null);

  // Creates a new file through the API and navigates to it: a standalone .mmd
  // diagram (sequence/flowchart template) or a .md architecture document (with
  // an embedded diagram scaffold). Returns a validation/API error message, or
  // null on success.
  const createNewFile = async (rawName: string, kind: NewFileKind): Promise<string | null> => {
    const isMarkdown = kind === 'markdown';
    const base = rawName.trim().replace(isMarkdown ? /\.(md|markdown)$/i : /\.mmd$/i, '');
    if (!base) return 'Enter a file name';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(base)) {
      return 'Use letters, numbers, dashes and underscores only';
    }
    const name = isMarkdown ? `${base}.md` : `${base}.mmd`;
    if (files.includes(name) || markdownFiles.includes(name)) return `${name} already exists`;
    const content = isMarkdown ? NEW_MARKDOWN_DOC_TEMPLATE : NEW_DIAGRAM_TEMPLATES[kind];
    const createRes = await postFile(name, content);
    if (!createRes.ok) {
      return 'Could not create the file';
    }
    if (isMarkdown) {
      setMarkdownFiles(prev => [...prev, name].sort());
    } else {
      setFiles(prev => [...prev, name].sort());
    }
    setPendingNew(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set('file', name);
    params.delete('diagram');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    return null;
  };

  // --- Add Participant / Add Message (EDITING_PLAN.md 4.12) ---
  const componentElements = useMemo(
    () => rawModel.elements.filter(e => e.kind === 'participant' || e.kind === 'node'),
    [rawModel]
  );

  const handleAddParticipant = () => {
    const afterKey = selectedComponent ? selectedComponent.key : undefined;
    applyEditResult(addParticipant(rawCode, viewsData, afterKey, undefined, 'participant', theme));
  };
  handleAddParticipantRef.current = handleAddParticipant;

  const handleAddMessage = () => {
    if (componentElements.length === 0) {
      setEditWarning('Add a participant first');
      return;
    }
    const fromEl = selectedComponent ?? componentElements[0];
    const idx = componentElements.findIndex(e => e.key === fromEl.key);
    // Selected participant becomes `from`; `to` is the next participant
    // (a lone participant gets a self-message, which Mermaid supports).
    const toEl = componentElements.length > 1
      ? componentElements[(idx + 1) % componentElements.length]
      : fromEl;
    // A selected message/edge sets the insertion point.
    const position: MessageInsertPosition | undefined = selectedArrow
      ? { type: 'after', key: selectedArrow.key }
      : undefined;
    applyEditResult(addMessage(rawCode, viewsData, fromEl.key, toEl.key, position));
  };

  // All actor ids a sequence note may span: declared participants, message
  // endpoints (implicit actors) and actors of existing notes — deduped, source
  // order. Also drives the Add Sequence Note button's disabled state.
  const noteActorIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const e of rawModel.elements) {
      const add = (id: string) => {
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
      };
      if (e.kind === 'participant') add(e.id);
      if (e.kind === 'message') { add(e.from); add(e.to); }
      if (e.kind === 'note') e.over.forEach(add);
    }
    return ids;
  }, [rawModel]);

  // Keys of the selected messages/notes — the wrappable kinds (W4). The
  // transforms re-sort by lineStart, so click order never matters (W5).
  const wrapKeys = useMemo(
    () => selectedRawElements
      .filter(e => e.kind === 'message' || e.kind === 'note')
      .map(e => e.key),
    [selectedRawElements]
  );

  // Wrap gating for the multi-selection panel (W1–W10): both modes checked up
  // front; the panel shows the refusal reason verbatim and disables the buttons.
  const wrapChecks = useMemo(() => {
    if (rawModel.type !== 'sequence' || wrapKeys.length < 2) return null;
    const toCheck = (r: { ok: true } | { ok: false; reason: string }) =>
      r.ok ? { ok: true } : { ok: false, reason: r.reason };
    return {
      block: toCheck(canWrapSelection(rawCode, rawModel, wrapKeys, 'block')),
      region: toCheck(canWrapSelection(rawCode, rawModel, wrapKeys, 'region')),
    };
  }, [rawCode, rawModel, wrapKeys]);

  // Existing region types, for the wrap-in-region datalist (W8/W15: duplicate
  // names are allowed, so the list is deduped but never restricted).
  const regionTypes = useMemo(() => {
    const types: string[] = [];
    for (const e of rawModel.elements) {
      if (e.kind === 'region' && !types.includes(e.regionType)) types.push(e.regionType);
    }
    return types;
  }, [rawModel]);

  // Add Sequence Note (sequence diagrams only): the note spans the selected
  // participant (else the first one) and lands after the selected message/note
  // (else after the last one). applyEditResult selects the new note via newKey.
  const handleAddSequenceNote = () => {
    const overKey = selectedComponent && selectedComponent.kind === 'participant'
      ? selectedComponent.key
      : undefined;
    const afterKey = selectedRawElement && (selectedRawElement.kind === 'message' || selectedRawElement.kind === 'note')
      ? selectedRawElement.key
      : undefined;
    applyEditResult(addSequenceNote(rawCode, viewsData, { overKey, afterKey }));
  };

  const handleEditNoteText = (text: string) => {
    if (!selectedNote) return;
    applyEditResult(editNoteText(rawCode, viewsData, selectedNote.key, text));
  };

  const handleSetNotePlacement = (placement: NotePlacement) => {
    if (!selectedNote) return;
    applyEditResult(setNotePlacement(rawCode, viewsData, selectedNote.key, placement));
  };

  const handleSetNoteSpan = (overIds: string[]) => {
    if (!selectedNote) return;
    applyEditResult(setNoteSpan(rawCode, viewsData, selectedNote.key, overIds));
  };

  const handleEditBlockTitle = (title: string) => {
    if (!selectedBlock) return;
    applyEditResult(setBlockTitle(rawCode, viewsData, selectedBlock.key, title));
  };

  const handleSetBlockType = (blockType: BlockType) => {
    if (!selectedBlock) return;
    applyEditResult(setBlockType(rawCode, viewsData, selectedBlock.key, blockType));
  };

  const handleUnwrapBlock = () => {
    if (!selectedBlock) return;
    applyEditResult(unwrapBlock(rawCode, viewsData, selectedBlock.key));
  };

  // Wrap the selected messages/notes in a block (W1–W12). applyEditResult
  // selects the created block via newKey, so BlockFields opens immediately.
  const handleWrapInBlock = (blockType: BlockType, title?: string) => {
    applyEditResult(wrapInBlock(rawCode, viewsData, wrapKeys, blockType, title));
  };

  // Wrap the selected messages/notes in a %% @region (W8–W10). Regions are not
  // selectable on the canvas, so the selection is cleared after the wrap.
  const handleWrapInRegion = (type: string, value?: string) => {
    const result = wrapInRegion(rawCode, viewsData, wrapKeys, type, value);
    if (result.warning) {
      setEditWarning(result.warning);
      return;
    }
    applyEditResult({ code: result.code, config: result.config });
    setSelectedKeys([]);
  };

  const saveCurrentView = async () => {
    if (!currentFile) return;
    const name = window.prompt('Enter view name:');
    if (!name) return;

    const currentViews = viewsData?.views ? [...viewsData.views] : [];
    const existingIndex = currentViews.findIndex(v => v.name === name);

    const newView: SavedView = {
      name,
      hiddenPaths: Array.from(hiddenPaths),
      ...(hideColors.size > 0 && { hideColors: Array.from(hideColors) }),
      ...(mergeKeys.size > 0 && { mergeKeys: Array.from(mergeKeys) }),
      ...(mergeCleanKeys.size > 0 && { mergeCleanKeys: Array.from(mergeCleanKeys) }),
      ...(hideKeys.size > 0 && { hideKeys: Array.from(hideKeys) }),
    };

    if (existingIndex >= 0) {
      currentViews[existingIndex] = newView;
    } else {
      currentViews.push(newView);
    }

    const newData: DiagramConfig = {
      ...(viewsData || {}),
      version: 1,
      views: currentViews
    };

    const newCode = updateViewsData(rawCode, newData);

    const res = await persistActiveDiagram(newCode);
    if (!res.ok) {
      console.error('Failed to save view:', res.message);
    }
  };

  const deleteView = async (name: string) => {
    if (!currentFile || !viewsData?.views) return;
    if (!window.confirm(`Delete view "${name}"?`)) return;

    if (selectedViewName === name) {
      deselectView();
    }

    const currentViews = viewsData.views.filter(v => v.name !== name);
    const newData: DiagramConfig | null = (currentViews.length > 0 || (viewsData && viewsData.actors && Object.keys(viewsData.actors).length > 0)) ? {
      ...(viewsData || {}),
      version: 1,
      views: currentViews
    } : null;

    const newCode = updateViewsData(rawCode, newData);

    const res = await persistActiveDiagram(newCode);
    if (!res.ok) {
      console.error('Failed to delete view:', res.message);
    }
  };

  const loadView = (view: SavedView) => {
    setSelectedViewName(view.name);
    if (editModeKind === 'code') {
      setEditModeKind('visual');
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view.name);
    if (view.hiddenPaths && view.hiddenPaths.length > 0) {
      params.set('hidden', view.hiddenPaths.join(','));
    } else {
      params.delete('hidden');
    }

    params.delete('merge_color');
    params.delete('merge_clean_color');

    const hideColors = view.hideColors || [];
    if (hideColors.length > 0) params.set('hide_color', hideColors.join(','));
    else params.delete('hide_color');

    const mergeKeys = view.mergeKeys || view.mergeByKeys || [];
    if (mergeKeys.length > 0) params.set('merge_key', mergeKeys.join(','));
    else params.delete('merge_key');

    const mergeCleanKeys = view.mergeCleanKeys || view.mergeCleanByKeys || [];
    if (mergeCleanKeys.length > 0) params.set('merge_clean_key', mergeCleanKeys.join(','));
    else params.delete('merge_clean_key');

    const hideKeys = view.hideKeys || [];
    if (hideKeys.length > 0) params.set('hide_key', hideKeys.join(','));
    else params.delete('hide_key');

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const deselectView = () => {
    setSelectedViewName(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    params.delete('hidden');
    params.delete('merge_key');
    params.delete('merge_clean_key');
    params.delete('hide_key');
    params.delete('hide_color');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const renderRegionTree = (nodes: RegionNode[]) => {
    return (
      <ul className="pl-4 space-y-1">
        {nodes.map(node => {
          const isHidden = isPathHidden(node.path, hiddenPaths);
          return (
            <li key={node.path} className="text-sm">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={!isHidden}
                  onChange={() => toggleHiddenPath(node.path)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="truncate" title={node.path}>
                  <span className="font-semibold">{node.type}</span>
                  {node.value && <span className="text-gray-600 ">={node.value}</span>}
                </span>
              </label>
              {node.children.length > 0 && renderRegionTree(node.children)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className={`flex h-screen ${isDark ? 'dark bg-slate-950 text-slate-100' : 'bg-gray-50 text-gray-900'}`}>
      <div className={`w-64 border-r flex flex-col ${isDark ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-gray-200 bg-white text-gray-900'}`}>
        <div className={`p-4 border-b flex justify-between items-center ${isDark ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="flex items-center space-x-2">
            <img src="/logo.png" alt="Logo" className="w-6 h-6 rounded-md object-cover" />
            <h1 className="font-bold">Foliant</h1>
          </div>
          <button 
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('theme', theme === 'dark' ? 'default' : 'dark');
              router.replace(`${pathname}?${params.toString()}`);
            }}
            className={`p-1 rounded transition-colors ${isDark ? 'text-amber-300 hover:bg-slate-800' : 'text-gray-700 hover:bg-gray-100'}`}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {!STATIC_DEMO && (
          <div className="mb-6">
            <h2 className={`text-xs font-bold uppercase ${isDark ? 'text-slate-400' : 'text-gray-500'} mb-2 flex items-center`}>
              <Folder size={14} className="mr-1" /> Directory
            </h2>
            <form onSubmit={handleDirSubmit} className="mb-2">
              <input
                type="text"
                placeholder="Paste absolute path..."
                value={customDirInput}
                onChange={e => setCustomDirInput(e.target.value)}
                className={`w-full px-2 py-1 text-sm border rounded mb-1 ${isDark ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus:ring-blue-500' : 'bg-white border-gray-200 text-gray-900'}`}
              />
              <button type="submit" className="w-full bg-blue-600 text-white rounded py-1 text-sm hover:bg-blue-700 font-medium">
                Load Directory
              </button>
            </form>
            {recentDirs.length > 0 && (
              <div className="mb-2">
                <span className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Recent:</span>
                <ul className="space-y-1 mt-1" ref={recentListRef}>
                  {recentDirs.map(d => (
                    <li key={d}>
                      <button
                        className={`w-full text-left text-xs truncate ${isDark ? 'text-blue-400' : 'text-blue-600'} hover:underline`}
                        onClick={() => {
                          setCustomDirInput(d);
                          const params = new URLSearchParams(searchParams.toString());
                          params.set('dir', d);
                          params.delete('file');
                          const newQueryString = params.toString();
                          if (newQueryString === searchParams.toString()) {
                            setRefreshKey(k => k + 1);
                          } else {
                            router.replace(`${pathname}?${newQueryString}`, { scroll: false });
                          }
                        }}
                        title={d}
                      >
                        {formatRecentDir(d, recentListWidth, measureRecentLabel)}
                      </button>
                    </li>
                  ))}
                </ul>
                <span
                  ref={recentMeasureSpanRef}
                  aria-hidden="true"
                  className="absolute invisible whitespace-nowrap text-xs"
                />
              </div>
            )}
          </div>
          )}

          <div className="mb-6">
            <h2 className={`text-xs font-bold uppercase ${isDark ? 'text-slate-400' : 'text-gray-500'} mb-2 flex items-center`}>
              <Folder size={14} className="mr-1" /> Files
              {!STATIC_DEMO && (
              <div className="ml-auto flex items-center space-x-2">
                <button
                  data-testid="new-diagram"
                  title="New diagram file"
                  onClick={() => setPendingNew('sequence')}
                  className={`normal-case font-normal ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-500 hover:text-blue-600'} flex items-center space-x-0.5`}
                >
                  <Plus size={12} /> New
                </button>
                <button
                  data-testid="new-markdown"
                  title="New markdown file"
                  onClick={() => setPendingNew('markdown')}
                  className={`normal-case font-normal ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-500 hover:text-blue-600'} flex items-center space-x-0.5`}
                >
                  <Plus size={12} /> New MD
                </button>
              </div>
              )}
            </h2>
            {filesError && (
              <p className="text-xs text-red-500 mb-1" data-testid="files-error">
                {filesError}{dirParam ? `: ${dirParam}` : ''}
              </p>
            )}
            {!filesError && files.length === 0 && markdownFiles.length === 0 && (
              <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'} italic mb-1`}>No .mmd or .md files in this directory</p>
            )}
            <ul className="space-y-1">
              {files.map(f => (
                <li key={f}>
                  <button
                    className={`w-full text-left px-2 py-1 rounded text-sm transition-colors ${
                      currentFile === f
                        ? (isDark ? 'bg-blue-900/40 text-blue-300 border border-blue-700/50 font-medium' : 'bg-blue-100 text-blue-700 font-medium')
                        : (isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-700 hover:bg-gray-100')
                    }`}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set('file', f);
                      params.delete('diagram');
                      router.replace(`${pathname}?${params.toString()}`);
                    }}
                  >
                    {f}
                  </button>
                </li>
              ))}
            </ul>
            {markdownFiles.length > 0 && (
              <ul className="space-y-1 mt-1" data-testid="markdown-files">
                {markdownFiles.map(mf => {
                  const diagrams = mdDiagrams[mf];
                  const isMdSelected = currentFile === mf;
                  const mdBadge = `text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wide ${
                    isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-gray-600'
                  }`;
                  return (
                    <li key={mf}>
                      <button
                        data-testid={`md-file-${mf}`}
                        className={`w-full text-left px-2 py-1 rounded text-sm transition-colors flex items-center space-x-1.5 ${
                          isMdSelected
                            ? (isDark ? 'bg-blue-900/40 text-blue-300 border border-blue-700/50 font-medium' : 'bg-blue-100 text-blue-700 font-medium')
                            : (isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-700 hover:bg-gray-100')
                        }`}
                        onClick={() => selectMarkdownFile(mf)}
                        title={`${mf} — select one of its mermaid diagrams to edit it`}
                      >
                        <FileText size={12} className="shrink-0 opacity-70" />
                        <span className="truncate flex-1">{mf}</span>
                        <span data-testid={`md-badge-${mf}`} className={mdBadge}>MD</span>
                      </button>
                      {diagrams && diagrams.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5" data-testid={`md-diagrams-${mf}`}>
                          {diagrams.map(d => {
                            const isDiagramSelected = isMdSelected && diagramIndex === d.index;
                            return (
                              <li key={d.index}>
                                <button
                                  data-testid={`md-diagram-${mf}-${d.index}`}
                                  className={`w-full text-left pl-6 pr-2 py-1 rounded text-xs transition-colors flex items-center space-x-1.5 ${
                                    isDiagramSelected
                                      ? (isDark ? 'bg-blue-900/40 text-blue-300 border border-blue-700/50 font-medium' : 'bg-blue-100 text-blue-700 font-medium')
                                      : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100')
                                  }`}
                                  onClick={() => selectMarkdownDiagram(mf, d.index)}
                                  title={`${mf} — mermaid diagram ${d.index + 1} (lines ${d.startLine}-${d.endLine})`}
                                >
                                  <span className={mdBadge}>MD</span>
                                  <span className="shrink-0">Diagram {d.index + 1}</span>
                                  <span className="truncate opacity-60 font-normal">{d.title}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {diagrams && diagrams.length === 0 && (
                        <p className={`pl-7 py-0.5 text-[10px] italic ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                          no mermaid diagrams
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mb-6">
            <h2 className={`text-xs font-bold uppercase ${isDark ? 'text-slate-400' : 'text-gray-500'} mb-2`}>Filters</h2>
            {regionRoots.length === 0 ? (
              <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-500'} italic`}>No regions found</p>
            ) : (
              <div className="-ml-4">{renderRegionTree(regionRoots)}</div>
            )}
          </div>

          {availableKeys.length > 0 && (
            <div className="mb-6">
              <h2 className={`text-xs font-bold uppercase ${isDark ? 'text-slate-400' : 'text-gray-500'} mb-2`}>Actors</h2>
              
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>By Key</span>
                  <button
                    type="button"
                    onClick={deselectView}
                    className={`text-[11px] font-medium transition-colors ${
                      isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-800'
                    }`}
                    title="Reset all filters"
                  >
                    Reset
                  </button>
                </div>
                <ul className="space-y-2">
                  {availableKeys.map(k => {
                    const currentState = hideKeys.has(k) ? 'off' : mergeCleanKeys.has(k) ? 'merged_clean' : mergeKeys.has(k) ? 'merged' : 'on';
                    const actors = actorRewriteMap.keyActors.get(k) ?? [];

                    const stillMergedBy = new Map<string, number>();
                    if (currentState === 'on' || currentState === 'off') {
                      for (const actor of actors) {
                        const winningKey = actorRewriteMap.mergedBy.get(actor);
                        if (winningKey && winningKey !== k) {
                          stillMergedBy.set(winningKey, (stillMergedBy.get(winningKey) ?? 0) + 1);
                        }
                      }
                    }

                    const overridingKeys = new Set<string>();
                    if (currentState === 'merged' || currentState === 'merged_clean') {
                      const winningCount = actors.filter(actor => actorRewriteMap.mergedBy.get(actor) === k).length;
                      if (winningCount === 0 && actors.length > 0) {
                        for (const actor of actors) {
                          const winner = actorRewriteMap.mergedBy.get(actor);
                          if (winner && winner !== k) {
                            overridingKeys.add(winner);
                          }
                        }
                      }
                    }

                    return (
                      <li key={k} className={`text-sm flex flex-col pl-2 border-l-2 ml-1 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                        <span className={`font-medium ${isDark ? 'text-slate-200' : 'text-gray-700'}`}>{k}</span>
                        <div className={`flex border rounded overflow-hidden text-[10px] mt-1 w-full ${isDark ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'}`}>
                          <button 
                            onClick={() => setActorState(k, 'on')} 
                            className={`flex-1 py-1 px-1 text-center font-medium transition-colors ${currentState === 'on' ? 'bg-blue-600 text-white shadow-xs' : (isDark ? 'text-slate-400 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-200')}`}
                          >
                            On
                          </button>
                          <button 
                            onClick={() => setActorState(k, 'off')} 
                            className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l ${isDark ? 'border-slate-700' : 'border-gray-200'} ${currentState === 'off' ? 'bg-blue-600 text-white shadow-xs' : (isDark ? 'text-slate-400 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-200')}`}
                          >
                            Off
                          </button>
                          <button 
                            onClick={() => setActorState(k, 'merged')} 
                            className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l ${isDark ? 'border-slate-700' : 'border-gray-200'} ${currentState === 'merged' ? 'bg-blue-600 text-white shadow-xs' : (isDark ? 'text-slate-400 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-200')}`}
                          >
                            Merged
                          </button>
                          <button 
                            onClick={() => setActorState(k, 'merged_clean')} 
                            className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l ${isDark ? 'border-slate-700' : 'border-gray-200'} ${currentState === 'merged_clean' ? 'bg-blue-600 text-white shadow-xs' : (isDark ? 'text-slate-400 hover:bg-slate-700' : 'text-gray-600 hover:bg-gray-200')}`}
                            title="Merge actors and hide their internal self-calls"
                          >
                            Clean
                          </button>
                        </div>
                        {Array.from(stillMergedBy.entries()).map(([winningKey, count]) => (
                          <button
                            key={winningKey}
                            type="button"
                            onClick={() => setActorState(winningKey, 'on')}
                            className={`text-left text-[11px] mt-1 transition-colors cursor-pointer hover:underline ${
                              isDark ? 'text-amber-400 hover:text-amber-300' : 'text-amber-700 hover:text-amber-900'
                            }`}
                            title={`Set ${winningKey} to On`}
                          >
                            {count} {count === 1 ? 'actor' : 'actors'} still merged via <span className="font-mono">{winningKey}</span>
                          </button>
                        ))}
                        {Array.from(overridingKeys).map(ok => (
                          <button
                            key={ok}
                            type="button"
                            onClick={() => setActorState(ok, 'on')}
                            className={`text-left text-[11px] mt-1 transition-colors cursor-pointer hover:underline ${
                              isDark ? 'text-amber-400 hover:text-amber-300' : 'text-amber-700 hover:text-amber-900'
                            }`}
                            title={`Set ${ok} to On`}
                          >
                            overridden by <span className="font-mono">{ok}</span>
                          </button>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className={`text-xs font-bold uppercase ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Saved Views</h2>
              <button 
                onClick={saveCurrentView}
                className={`p-1 rounded transition-colors ${isDark ? 'text-blue-400 hover:text-blue-300 hover:bg-slate-800' : 'text-blue-500 hover:text-blue-600 hover:bg-blue-50'}`}
                title="Save Current View"
              >
                <Save size={14} />
              </button>
            </div>
            <ul className="space-y-2">
              <li
                data-testid="saved-view-__default__"
                className={`flex items-center justify-between p-2 rounded border text-sm group cursor-pointer transition-colors ${
                  isDefaultViewActive
                    ? (isDark ? 'bg-blue-900/40 border-blue-500 text-blue-200 font-medium' : 'bg-blue-50 border-blue-500 text-blue-800 font-medium')
                    : (isDark ? 'bg-slate-800/60 border-slate-700 text-slate-200 hover:bg-slate-800' : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100')
                }`}
                onClick={deselectView}
                title="Show the full, unfiltered diagram"
              >
                <span className="truncate font-medium flex-1 mr-2 flex items-center gap-1.5" title="Default (full diagram)">
                  <span className="truncate">Default</span>
                  {isDefaultViewActive && (
                    <span
                      data-testid="active-view-badge"
                      className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${
                        isDark ? 'bg-blue-800 text-blue-200' : 'bg-blue-200 text-blue-800'
                      }`}
                    >
                      Active
                    </span>
                  )}
                </span>
                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deselectView();
                    }}
                    className={`p-1 rounded transition-colors ${isDark ? 'text-blue-400 hover:bg-slate-700' : 'text-blue-600 hover:bg-blue-100'}`}
                    title="Reset to full diagram"
                    data-testid="reset-to-default-view-btn"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </li>
              {(viewsData?.views ?? []).map(view => {
                const isSelected = selectedViewName === view.name;
                return (
                  <li
                    key={view.name}
                    data-testid={`saved-view-${view.name}`}
                    className={`flex items-center justify-between p-2 rounded border text-sm group cursor-pointer transition-colors ${
                      isSelected
                        ? (isDark ? 'bg-blue-900/40 border-blue-500 text-blue-200 font-medium' : 'bg-blue-50 border-blue-500 text-blue-800 font-medium')
                        : (isDark ? 'bg-slate-800/60 border-slate-700 text-slate-200 hover:bg-slate-800' : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100')
                    }`}
                    onClick={() => {
                      if (isSelected) {
                        deselectView();
                      } else {
                        loadView(view);
                      }
                    }}
                  >
                    <span className="truncate font-medium flex-1 mr-2 flex items-center gap-1.5" title={view.name}>
                      <span className="truncate">{view.name}</span>
                      {isSelected && (
                        <span
                          data-testid="active-view-badge"
                          className={`text-[10px] px-1.5 py-0.5 rounded font-normal ${
                            isDark ? 'bg-blue-800 text-blue-200' : 'bg-blue-200 text-blue-800'
                          }`}
                        >
                          Active
                        </span>
                      )}
                    </span>
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isSelected) {
                            deselectView();
                          } else {
                            loadView(view);
                          }
                        }}
                        className={`p-1 rounded transition-colors ${
                          isSelected
                            ? (isDark ? 'text-blue-400 hover:bg-slate-700' : 'text-blue-600 hover:bg-blue-100')
                            : (isDark ? 'text-emerald-400 hover:bg-slate-700' : 'text-green-600 hover:text-green-700 hover:bg-green-100')
                        }`}
                        title={isSelected ? "Exit View" : "Load View"}
                        data-testid={`load-view-btn-${view.name}`}
                      >
                        <Play size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteView(view.name);
                        }}
                        className={`p-1 rounded transition-colors ${isDark ? 'text-rose-400 hover:bg-slate-700' : 'text-red-500 hover:text-red-600 hover:bg-red-100'}`}
                        title="Delete View"
                        data-testid={`delete-view-btn-${view.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {(!viewsData || !viewsData.views || viewsData.views.length === 0) && (
              <p className={`text-xs mt-2 ${isDark ? 'text-slate-500' : 'text-gray-500'} italic`}>No saved views</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {storageBackend === 'memory' && (
          <div
            data-testid="memory-storage-banner"
            className={`px-4 py-2 text-xs font-medium flex items-center space-x-2 border-b ${isDark ? 'border-amber-700/50 bg-amber-900/30 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
            title="The server is running with in-memory storage: nothing is persisted and all diagrams are lost when the server restarts."
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span>In-memory storage — diagrams are not saved to disk and will be lost when the server restarts.</span>
          </div>
        )}
        <div data-testid="top-menu-bar" className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-y-2 gap-x-3 transition-colors ${
          isDark ? 'border-slate-800 bg-slate-900 text-slate-100' : 'border-gray-200 bg-white text-gray-900'
        }`}>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
            {isMarkdownDoc ? (
              <span
                data-testid="markdown-file-badge"
                className={`flex items-center space-x-1.5 px-2 py-1 text-xs rounded border ${isDark ? 'border-slate-700 text-slate-200 bg-slate-800/60' : 'border-gray-200 text-gray-700 bg-gray-50'}`}
              >
                <FileText size={13} />
                <span className="font-medium">{currentFile}</span>
              </span>
            ) : (
            <>
            <div className="relative w-64">
              <Search className={`absolute left-2 top-1/2 -translate-y-1/2 ${isDark ? 'text-slate-400' : 'text-gray-400'}`} size={16} />
              <input
                type="text"
                placeholder="Search diagram..."
                value={searchQuery}
                onChange={(e) => {
                  const params = new URLSearchParams(searchParams.toString());
                  if (e.target.value) {
                    params.set('q', e.target.value);
                  } else {
                    params.delete('q');
                  }
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                }}
                className={`w-full pl-8 pr-3 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDark ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-400' : 'bg-gray-50 border-gray-200 text-gray-900'
                }`}
              />
            </div>
            <button
              onClick={toggleEditMode}
              disabled={!editSupported}
              title={editSupported
                ? (editMode ? 'Exit edit mode' : 'Edit diagram')
                : 'Editing is only available for sequence and flowchart diagrams'}
              className={`p-1.5 rounded border transition-colors ${
                editMode
                  ? 'bg-blue-600 text-white border-blue-600'
                  : (isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-200 hover:bg-gray-100')
              } ${!editSupported ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Pencil size={16} />
            </button>
            {editMode && (
              <button
                onClick={toggleSidebarVisibility}
                title={isSidebarVisible ? 'Hide properties panel (Tab)' : 'Show properties panel (Tab)'}
                data-testid="toggle-sidebar"
                className={`p-1.5 rounded border transition-colors ${
                  isSidebarVisible
                    ? (isDark ? 'bg-blue-900/40 border-blue-600/50 text-blue-300' : 'bg-blue-50 border-blue-300 text-blue-700')
                    : (isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-200 hover:bg-gray-100')
                }`}
              >
                {isSidebarVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
            </>
            )}
            {editMode && (
              <>
                <button
                  onClick={handleAddParticipant}
                  disabled={isVisualLocked}
                  title={isVisualLocked ? 'Locked while editing source code' : 'Add Participant'}
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-200 hover:bg-gray-100'
                  } ${isVisualLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <UserPlus size={14} />
                  <span>Participant</span>
                </button>
                <button
                  onClick={handleAddMessage}
                  disabled={isVisualLocked || componentElements.length === 0}
                  title={isVisualLocked
                    ? 'Locked while editing source code'
                    : componentElements.length === 0
                      ? 'Add a participant first'
                      : 'Add Message'}
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                  } ${
                    isVisualLocked || componentElements.length === 0
                      ? 'opacity-40 cursor-not-allowed'
                      : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                  }`}
                >
                  <MessageSquarePlus size={14} />
                  <span>Message</span>
                </button>
                {rawModel.type === 'sequence' && (
                  <button
                    onClick={handleAddSequenceNote}
                    disabled={isVisualLocked || noteActorIds.length === 0}
                    title={isVisualLocked
                      ? 'Locked while editing source code'
                      : noteActorIds.length === 0
                        ? 'Add a participant first'
                        : 'Add Sequence Note'}
                    data-testid="add-sequence-note"
                    className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                      isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                    } ${
                      isVisualLocked || noteActorIds.length === 0
                        ? 'opacity-40 cursor-not-allowed'
                        : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                    }`}
                  >
                    <MessageSquareWarning size={14} />
                    <span>Note</span>
                  </button>
                )}
                <button
                  onClick={handleAddNote}
                  disabled={isVisualLocked || !rawCode}
                  title={isVisualLocked ? 'Locked while editing source code' : 'Add Sticky Note'}
                  data-testid="add-sticky-note"
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                  } ${
                    isVisualLocked || !rawCode ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-amber-950/40 hover:border-amber-700/60' : 'hover:bg-amber-50 hover:border-amber-300')
                  }`}
                >
                  <StickyNoteIcon size={14} className="text-amber-500" />
                  <span>+ Note</span>
                </button>
                <button
                  onClick={() => setShowNotes(!showNotes)}
                  title={showNotes ? 'Hide sticky notes' : 'Show sticky notes'}
                  data-testid="toggle-sticky-notes"
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    showNotes
                      ? (isDark ? 'bg-amber-950/60 border-amber-700/60 text-amber-300' : 'bg-amber-100 border-amber-300 text-amber-900')
                      : (isDark ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-gray-200 text-gray-500 hover:bg-gray-100')
                  }`}
                >
                  <span>Notes ({stickyNotes.length})</span>
                </button>
                <button
                  onClick={undo}
                  disabled={historyPast.length === 0}
                  title="Undo (Ctrl+Z)"
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                  } ${
                    historyPast.length === 0 ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                  }`}
                >
                  <Undo2 size={14} />
                  <span>Undo</span>
                </button>
                <button
                  onClick={redo}
                  disabled={historyFuture.length === 0}
                  title="Redo (Ctrl+Y)"
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                  } ${
                    historyFuture.length === 0 ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                  }`}
                >
                  <Redo2 size={14} />
                  <span>Redo</span>
                </button>
                {rawModel.type === 'flowchart' && (
                  <button
                    onClick={handleToggleOrientation}
                    disabled={isVisualLocked || !rawCode}
                    title="Toggle Diagram Orientation (TD / LR)"
                    data-testid="toggle-orientation"
                    className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                      isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                    } ${
                      isVisualLocked || !rawCode ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                    }`}
                  >
                    <ArrowDownUp size={14} />
                    <span>Orientation</span>
                  </button>
                )}
                {rawModel.type === 'sequence' && (
                  <button
                    onClick={handleToggleNumberedSteps}
                    disabled={isVisualLocked || !rawCode}
                    title="Toggle Numbered Steps (autonumber)"
                    data-testid="toggle-numbered-steps"
                    className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                      isNumbered
                        ? (isDark ? 'bg-blue-900/40 border-blue-600/50 text-blue-300 font-medium' : 'bg-blue-50 border-blue-300 text-blue-700 font-medium')
                        : (isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200')
                    } ${
                      isVisualLocked || !rawCode ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                    }`}
                  >
                    <ListOrdered size={14} />
                    <span>Numbered Steps</span>
                  </button>
                )}
                <button
                  onClick={handleCopyMermaid}
                  disabled={!rawCode}
                  title={isViewActive ? `Copy Mermaid (${activeView?.name})` : "Copy Mermaid Code"}
                  data-testid="copy-mermaid"
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                    isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
                  } ${
                    !rawCode ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
                  }`}
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : isViewActive ? 'Copy View' : 'Copy'}</span>
                </button>
              </>
            )}
            {!isMarkdownDoc && (
            <>
            <button
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                if (presentation) params.delete('present');
                else params.set('present', '1');
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              }}
              disabled={!editSupported || !rawCode}
              title="Present step-by-step (←/→ to step, Space to play/pause, Esc to exit)"
              data-testid="present-toggle"
              className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                presentation
                  ? 'bg-blue-600 text-white border-blue-600'
                  : (isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200')
              } ${
                !editSupported || !rawCode
                  ? 'opacity-40 cursor-not-allowed'
                  : presentation
                    ? ''
                    : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
              }`}
            >
              <Play size={14} />
              <span>{presentation ? 'Stop' : 'Present'}</span>
            </button>
            <button
              onClick={handleExportSvg}
              disabled={!rawCode}
              title="Export to SVG"
              data-testid="export-svg-btn"
              className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
              } ${
                !rawCode ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
              }`}
            >
              <Download size={14} />
              <span>Export SVG</span>
            </button>
            <button
              onClick={handleCopyPng}
              disabled={!rawCode}
              title="Copy high-DPI PNG to clipboard"
              data-testid="copy-png-btn"
              className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                isDark ? 'border-slate-700 text-slate-200' : 'border-gray-200'
              } ${
                !rawCode ? 'opacity-40 cursor-not-allowed' : (isDark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')
              }`}
            >
              {pngCopied ? <Check size={14} className="text-green-500" /> : <ImageIcon size={14} />}
              <span>{pngCopied ? 'PNG Copied' : 'Copy PNG'}</span>
            </button>
            </>
            )}
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Command Palette (Cmd+K / Ctrl+K)"
              data-testid="command-palette-trigger"
              className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-200 hover:bg-gray-100'
              }`}
            >
              <Command size={13} />
              <span>⌘K</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 flex-shrink-0 ml-auto">
            {isEmbeddedDiagram && diagramIndex !== null && (
              <button
                onClick={backToMarkdownDoc}
                title="Back to the markdown document, scrolled to this diagram"
                data-testid="back-to-markdown"
                className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border transition-colors ${
                  isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <ArrowLeft size={14} />
                <span>Back to markdown</span>
              </button>
            )}
            {isEmbeddedDiagram && diagramIndex !== null && (
              <span
                data-testid="embedded-diagram-badge"
                className={`text-xs flex items-center space-x-1 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}
                title="Diagram embedded in a markdown file — saving updates the .md file"
              >
                <FileText size={12} />
                <span>{currentFile} · Diagram {diagramIndex + 1}</span>
              </span>
            )}
            {STATIC_DEMO && (
              <span
                data-testid="static-demo-badge"
                className={`text-xs flex items-center space-x-1 px-2 py-0.5 rounded border font-medium ${
                  isDark ? 'border-blue-600/50 text-blue-400 bg-blue-900/20' : 'border-blue-400 text-blue-700 bg-blue-50'
                }`}
                title="Static demo — running entirely in your browser with no server. Explore freely; nothing is saved."
              >
                <Globe size={11} />
                <span>Live demo</span>
              </span>
            )}
            {isReadOnly && (
              <span
                data-testid="read-only-badge"
                className={`text-xs flex items-center space-x-1 px-2 py-0.5 rounded border font-medium ${
                  isDark ? 'border-amber-600/50 text-amber-400 bg-amber-900/20' : 'border-amber-400 text-amber-700 bg-amber-50'
                }`}
                title="This file is read-only — you can explore and edit on screen, but changes are not saved to disk"
              >
                <AlertTriangle size={11} />
                <span>Read-only</span>
              </span>
            )}
            {saveStatus !== 'idle' && !isReadOnly && !STATIC_DEMO && (
              <span
                data-testid="save-indicator"
                className={`text-xs ${
                  saveStatus === 'error'
                    ? 'text-red-500'
                    : saveStatus === 'saved'
                      ? 'text-green-600'
                      : 'text-blue-500'
                }`}
                title={saveStatus === 'error' ? (saveErrorMessage || "Contents aren't saved") : undefined}
              >
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save failed'}
              </span>
            )}
            {saveStatus === 'error' && !isReadOnly && !STATIC_DEMO && (
              <span data-testid="save-error" className="text-xs text-red-500 font-medium" title={saveErrorMessage || "Contents aren't saved"}>
                {saveErrorMessage && saveErrorMessage.toLowerCase().includes("aren't saved")
                  ? saveErrorMessage
                  : `Contents aren't saved${saveErrorMessage ? `: ${saveErrorMessage}` : ''}`}
              </span>
            )}
            {saveConflict && (
              <span data-testid="save-conflict" className="text-xs text-red-500" title={saveConflict}>
                Save conflict — the diagram changed on disk
              </span>
            )}
            {reloadNotice && (
              <span data-testid="reload-notice" className="text-xs text-green-600">
                Reloaded from disk
              </span>
            )}
            {warnings.length > 0 && (
              <div className="text-yellow-600 text-sm font-medium">
                {warnings.length} warning(s)
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 p-4 overflow-hidden relative min-w-0">
            {isMarkdownDoc ? (
              <MarkdownEditor
                code={rawCode}
                theme={theme}
                fileName={currentFile ?? ''}
                onCodeChange={handleMarkdownChange}
                onMarkdownEdit={handleMarkdownEdit}
                onUndo={undo}
                onRedo={redo}
                canUndo={historyPast.length > 0}
                canRedo={historyFuture.length > 0}
                onSelectDiagram={(index) => {
                  if (currentFile) selectMarkdownDiagram(currentFile, index);
                }}
                viewStates={mdViewStates}
                onViewStateChange={handleMarkdownViewStateChange}
                scrollToDiagram={scrollTarget}
                onDiagramScrolled={handleDiagramScrolled}
              />
            ) : (
              <>
                <DiagramViewer
                  code={processedCode}
                  searchQuery={searchQuery}
                  theme={theme}
                  editMode={editMode}
                  isVisualLocked={isVisualLocked}
                  presentation={presentation}
                  onExitPresentation={() => {
                    if (presentation) {
                      const params = new URLSearchParams(searchParams.toString());
                      params.delete('present');
                      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
                    }
                  }}
                  arrowStyles={resolvedArrowStyles}
                  nodeColors={viewsData}
                  selection={processedSelection}
                  onSelect={handleSelect}
                  onMoveParticipant={handleMoveParticipant}
                  onCreateMessageDrag={handleCreateMessageDrag}
                  onMoveMessageEndpoint={handleMoveMessageEndpoint}
                  onMoveEdgeEndpoint={handleMoveEdgeEndpoint}
                  onMoveMessage={handleMoveMessage}
                  notes={visibleStickyNotes}
                  showNotes={showNotes}
                  selectedNoteIds={selectedNoteIds}
                  onSelectNote={handleSelectNote}
                  onUpdateNote={handleUpdateNote}
                  onDeleteNote={handleDeleteNote}
                  onLabelEdit={handleInlineLabelEdit}
                  focusRequest={focusRequest}
                />
                {editMode && !isVisualLocked && !presentation && selectedRawElements.length > 0 && (
                  <CanvasContextToolbar
                    selectedElements={selectedRawElements}
                    diagramType={rawModel.type}
                    theme={theme}
                    config={viewsData}
                    arrowStyle={selectedArrowStyle}
                    wrapChecks={wrapChecks}
                    onSetColor={handleSetColor}
                    onSetType={handleSetType}
                    onSetDash={handleSetDash}
                    onSetAnimation={handleSetAnimation}
                    onSetParticipantKind={handleSetParticipantKind}
                    onSetNodeShape={handleSetNodeShape}
                    onAddSequenceNote={rawModel.type === 'sequence' ? handleAddSequenceNote : undefined}
                    onSetNotePlacement={handleSetNotePlacement}
                    onSetBlockType={handleSetBlockType}
                    onUnwrapBlock={handleUnwrapBlock}
                    onUpdateStickyNote={handleUpdateNote}
                    onGroupParticipants={handleGroupParticipants}
                    onGroupNodes={handleGroupNodes}
                    onWrapInBlock={handleWrapInBlock}
                    onWrapInRegion={handleWrapInRegion}
                    onRequestDelete={handleRequestDelete}
                  />
                )}
              </>
            )}
          </div>
          {editMode && isSidebarVisible && (
            <div
              data-testid="editor-sidebar"
              className={`relative flex-shrink-0 border-l flex flex-col ${
                isResizingSidebar ? '' : 'transition-[width] duration-150'
              } ${
                isDark ? 'border-slate-800 bg-slate-900 text-slate-100' : 'border-gray-200 bg-white text-gray-900'
              }`}
              style={{ width: activeSidebarWidth }}
            >
              {/* Drag handle on the left edge: resizes the sidebar (and with
                  it the diagram area) between MIN_SIDEBAR_WIDTH and the space
                  left for the diagram. */}
              <div
                data-testid="sidebar-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor panel"
                title="Drag to resize"
                onMouseDown={handleSidebarResizeStart}
                className={`absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 ${
                  isResizingSidebar ? 'bg-blue-500/50' : 'bg-transparent hover:bg-blue-500/30'
                }`}
              />
              {/* Tab Bar Header */}
              <div
                className={`flex items-center justify-between border-b px-2 py-1.5 text-xs font-medium select-none ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => {
                      setSidebarTab('properties');
                      if (editModeKind === 'code') {
                        switchToVisualMode();
                      }
                    }}
                    data-testid="tab-properties"
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded transition-colors ${
                      sidebarTab === 'properties' && !isSplitView
                        ? (isDark ? 'bg-slate-800 text-blue-400 font-semibold shadow-sm' : 'bg-white text-blue-600 font-semibold shadow-sm')
                        : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-900')
                    }`}
                  >
                    <Sliders size={13} />
                    <span>Properties</span>
                  </button>
                  <button
                    onClick={() => setSidebarTab('source')}
                    data-testid="tab-source"
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded transition-colors ${
                      sidebarTab === 'source' && !isSplitView
                        ? (isDark ? 'bg-slate-800 text-blue-400 font-semibold shadow-sm' : 'bg-white text-blue-600 font-semibold shadow-sm')
                        : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-900')
                    }`}
                  >
                    <Code size={13} />
                    <span>Mermaid Source</span>
                  </button>
                </div>

                <button
                  onClick={() => setIsSplitView(!isSplitView)}
                  title={isSplitView ? 'Single tab view' : 'Split view (side-by-side)'}
                  data-testid="toggle-split-view"
                  className={`p-1 rounded transition-colors ${
                    isSplitView
                      ? (isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700')
                      : (isDark ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' : 'text-gray-500 hover:bg-gray-100')
                  }`}
                >
                  <Columns size={14} />
                </button>
              </div>

              {/* Content Area */}
              <div className="flex-1 min-h-0 flex overflow-hidden">
                {isSplitView ? (
                  <>
                    <div className={`w-72 flex-shrink-0 border-r overflow-y-auto ${
                      isDark ? 'border-slate-800 bg-slate-900' : 'border-gray-200 bg-white'
                    }`}>
                      <EditorPanel
                        element={selectedRawElement}
                        selectedElements={selectedRawElements}
                        elementsTagInfo={selectedElementsTagInfo}
                        diagramType={rawModel.type}
                        theme={theme}
                        config={viewsData}
                        arrowStyle={selectedArrowStyle}
                        arrowTags={selectedArrowTags}
                        globalArrowStyle={viewsData?.defaultArrowStyle ?? null}
                        onSetGlobalColor={handleSetGlobalColor}
                        onSetGlobalWidth={handleSetGlobalWidth}
                        noteTags={selectedNoteTags}
                        noteActorIds={noteActorIds}
                        onEditNoteText={handleEditNoteText}
                        onSetNotePlacement={handleSetNotePlacement}
                        onSetNoteSpan={handleSetNoteSpan}
                        onEditBlockTitle={handleEditBlockTitle}
                        onSetBlockType={handleSetBlockType}
                        onUnwrapBlock={handleUnwrapBlock}
                        wrapChecks={wrapChecks}
                        regionTypes={regionTypes}
                        onWrapInBlock={handleWrapInBlock}
                        onWrapInRegion={handleWrapInRegion}
                        stickyNoteTags={selectedStickyNoteTags}
                        warning={editWarning}
                        pendingDelete={pendingDelete}
                        onEditLabel={handleEditLabel}
                        onSetColor={handleSetColor}
                        onSetType={handleSetType}
                        onSetWidth={handleSetWidth}
                        onSetDash={handleSetDash}
                        onSetAnimation={handleSetAnimation}
                        onAddTag={handleAddTag}
                        onRemoveTag={handleRemoveTag}
                        onUpdateNote={handleUpdateNote}
                        onSetKeyMode={handleSetArrowKeyMode}
                        onSetParticipantKind={handleSetParticipantKind}
                        onSetNodeShape={handleSetNodeShape}
                        onToggleActivation={handleToggleActivation}
                        onGroupParticipants={handleGroupParticipants}
                        onGroupNodes={handleGroupNodes}
                        onRequestDelete={handleRequestDelete}
                        onConfirmDelete={handleConfirmDelete}
                        onCancelDelete={handleCancelDelete}
                      />
                    </div>
                    <div className="flex-1 min-w-0 h-full overflow-hidden">
                      <SourceCodePanel
                        code={isViewActive ? viewCode : rawCode}
                        isVisualEditMode={isViewActive ? true : editModeKind === 'visual'}
                        changedLines={isViewActive ? [] : changedLines}
                        theme={theme}
                        validationError={isViewActive ? null : sourceValidationError}
                        onCodeChange={handleHandEditCode}
                        onSwitchToCodeMode={switchToCodeMode}
                        onSwitchToVisualMode={switchToVisualMode}
                        onCopy={handleCopyMermaid}
                        viewName={isViewActive ? activeView?.name : null}
                      />
                    </div>
                  </>
                ) : sidebarTab === 'properties' ? (
                  <div className={`w-full h-full overflow-y-auto ${
                    isDark ? 'bg-slate-900' : 'bg-white'
                  }`}>
                    <EditorPanel
                      element={selectedRawElement}
                      selectedElements={selectedRawElements}
                      elementsTagInfo={selectedElementsTagInfo}
                      diagramType={rawModel.type}
                      theme={theme}
                      config={viewsData}
                      arrowStyle={selectedArrowStyle}
                      arrowTags={selectedArrowTags}
                      globalArrowStyle={viewsData?.defaultArrowStyle ?? null}
                      onSetGlobalColor={handleSetGlobalColor}
                      onSetGlobalWidth={handleSetGlobalWidth}
                      noteTags={selectedNoteTags}
                      noteActorIds={noteActorIds}
                      onEditNoteText={handleEditNoteText}
                      onSetNotePlacement={handleSetNotePlacement}
                      onSetNoteSpan={handleSetNoteSpan}
                      onEditBlockTitle={handleEditBlockTitle}
                      onSetBlockType={handleSetBlockType}
                      onUnwrapBlock={handleUnwrapBlock}
                      wrapChecks={wrapChecks}
                      regionTypes={regionTypes}
                      onWrapInBlock={handleWrapInBlock}
                      onWrapInRegion={handleWrapInRegion}
                      stickyNoteTags={selectedStickyNoteTags}
                      warning={editWarning}
                      pendingDelete={pendingDelete}
                      onEditLabel={handleEditLabel}
                      onSetColor={handleSetColor}
                      onSetType={handleSetType}
                      onSetWidth={handleSetWidth}
                      onSetDash={handleSetDash}
                      onSetAnimation={handleSetAnimation}
                      onAddTag={handleAddTag}
                      onRemoveTag={handleRemoveTag}
                      onUpdateNote={handleUpdateNote}
                      onSetKeyMode={handleSetArrowKeyMode}
                      onSetParticipantKind={handleSetParticipantKind}
                      onSetNodeShape={handleSetNodeShape}
                      onToggleActivation={handleToggleActivation}
                      onGroupParticipants={handleGroupParticipants}
                      onGroupNodes={handleGroupNodes}
                      onRequestDelete={handleRequestDelete}
                      onConfirmDelete={handleConfirmDelete}
                      onCancelDelete={handleCancelDelete}
                    />
                  </div>
                ) : (
                  <div className="w-full h-full overflow-hidden">
                    <SourceCodePanel
                      code={isViewActive ? viewCode : rawCode}
                      isVisualEditMode={isViewActive ? true : editModeKind === 'visual'}
                      changedLines={isViewActive ? [] : changedLines}
                      theme={theme}
                      validationError={isViewActive ? null : sourceValidationError}
                      onCodeChange={handleHandEditCode}
                      onSwitchToCodeMode={switchToCodeMode}
                      onSwitchToVisualMode={switchToVisualMode}
                      onCopy={handleCopyMermaid}
                      viewName={isViewActive ? activeView?.name : null}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <CommandPalette
        open={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        theme={theme}
        files={files}
        markdownFiles={markdownFiles}
        mdDiagrams={mdDiagrams}
        currentFile={currentFile}
        diagramIndex={diagramIndex}
        elements={componentElements as (ParticipantElement | NodeElement)[]}
        views={viewsData?.views ?? []}
        activeViewName={selectedViewName}
        isDefaultViewActive={isDefaultViewActive}
        availableKeys={availableKeys}
        hideKeys={hideKeys}
        mergeKeys={mergeKeys}
        isMarkdownDoc={isMarkdownDoc}
        editMode={editMode}
        isSidebarVisible={isSidebarVisible}
        isSplitView={isSplitView}
        presentation={presentation}
        onSelectFile={(file, diagIdx) => {
          if (typeof diagIdx === 'number') {
            selectMarkdownDiagram(file, diagIdx);
          } else if (/\.(md|markdown)$/i.test(file)) {
            selectMarkdownFile(file);
          } else {
            const params = new URLSearchParams(searchParams.toString());
            params.set('file', file);
            params.delete('diagram');
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }
        }}
        onJumpToElement={handleJumpToElement}
        onSelectView={(view) => {
          if (view === null) {
            deselectView();
          } else {
            loadView(view);
          }
        }}
        onSetTagState={(key, state) => setActorState(key, state)}
        onCopyPng={handleCopyPng}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
        onCopyMermaid={handleCopyMermaid}
        onToggleEditMode={toggleEditMode}
        onToggleSidebar={toggleSidebarVisibility}
        onToggleSplitView={() => setIsSplitView(prev => !prev)}
        onToggleTheme={() => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('theme', theme === 'dark' ? 'default' : 'dark');
          router.replace(`${pathname}?${params.toString()}`);
        }}
        onTogglePresentation={() => {
          const params = new URLSearchParams(searchParams.toString());
          if (presentation) params.delete('present');
          else params.set('present', '1');
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }}
        onAddParticipant={handleAddParticipant}
        onAddStickyNote={handleAddNote}
      />

      {!isSidebarVisible && pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          data-testid="delete-dialog"
        >
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 rounded-lg shadow-xl p-4 w-80">
            <h3 className="text-sm font-semibold mb-2">
              Delete selected element?
            </h3>
            <div className="flex justify-end space-x-2">
              <button
                onClick={handleCancelDelete}
                className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                data-testid="confirm-delete"
                className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingNew && (
        <NewDiagramDialog
          initialKind={pendingNew}
          onCreate={createNewFile}
          onCancel={() => setPendingNew(null)}
        />
      )}
    </div>
  );
}

function NewDiagramDialog({
  initialKind = 'sequence',
  onCreate,
  onCancel,
}: {
  initialKind?: NewFileKind;
  onCreate: (name: string, kind: NewFileKind) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NewFileKind>(initialKind);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const err = await onCreate(name, kind);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="new-diagram-dialog"
    >
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-slate-100 rounded-lg shadow-xl p-4 w-80">
        <h3 className="text-sm font-semibold mb-2">New file</h3>
        <label className="block mb-2">
          <span className="text-xs text-gray-500 dark:text-slate-400">File name</span>
          <input
            type="text"
            data-testid="new-diagram-name"
            className="w-full mt-1 px-2 py-1 text-sm border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={kind === 'markdown' ? 'my-document' : 'my-diagram'}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
        <label className="block mb-3">
          <span className="text-xs text-gray-500 dark:text-slate-400">Type</span>
          <select
            data-testid="new-diagram-type"
            className="w-full mt-1 px-2 py-1 text-sm border border-gray-200 dark:border-slate-700 rounded bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={kind}
            onChange={(e) => setKind(e.target.value as NewFileKind)}
          >
            <option value="sequence">Sequence diagram (.mmd)</option>
            <option value="flowchart">Flowchart (.mmd)</option>
            <option value="markdown">Architecture document (.md)</option>
          </select>
        </label>
        {error && (
          <p data-testid="new-diagram-error" className="text-xs text-red-500 dark:text-red-400 mb-2">{error}</p>
        )}
        <div className="flex justify-end space-x-2">
          <button
            onClick={onCancel}
            data-testid="new-diagram-cancel"
            className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            data-testid="new-diagram-create"
            disabled={busy}
            className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
