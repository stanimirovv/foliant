'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  FileCode,
  FileText,
  User,
  Eye,
  Tag,
  Download,
  Copy,
  Image as ImageIcon,
  Columns,
  PanelRight,
  Moon,
  Sun,
  Play,
  Pencil,
  UserPlus,
  StickyNote as StickyNoteIcon,
  CornerDownLeft,
  X,
} from 'lucide-react';
import { ParticipantElement, NodeElement } from '@/lib/model';
import { SavedView } from '@/lib/views';
import type { MdDiagramMeta } from '@/lib/markdownTypes';

export interface CommandItem {
  id: string;
  testId: string;
  category: 'Actions' | 'Jump to Element' | 'Saved Views' | 'Tag Filters' | 'Switch File';
  label: string;
  subtitle?: string;
  badge?: string;
  keywords?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  theme: 'default' | 'dark';
  files: string[];
  markdownFiles: string[];
  mdDiagrams: Record<string, MdDiagramMeta[]>;
  currentFile: string | null;
  diagramIndex: number | null;
  elements: (ParticipantElement | NodeElement)[];
  views: SavedView[];
  activeViewName: string | null;
  isDefaultViewActive: boolean;
  availableKeys: string[];
  hideKeys: Set<string>;
  mergeKeys: Set<string>;
  isMarkdownDoc: boolean;
  editMode: boolean;
  isSidebarVisible: boolean;
  isSplitView: boolean;
  presentation: boolean;
  onSelectFile: (file: string, diagramIdx?: number) => void;
  onJumpToElement: (rawKey: string) => void;
  onSelectView: (view: SavedView | null) => void;
  onSetTagState: (key: string, state: 'on' | 'off' | 'merged') => void;
  onCopyPng: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onCopyMermaid: () => void;
  onToggleEditMode: () => void;
  onToggleSidebar: () => void;
  onToggleSplitView: () => void;
  onToggleTheme: () => void;
  onTogglePresentation: () => void;
  onAddParticipant: () => void;
  onAddStickyNote: () => void;
}

export default function CommandPalette({
  open,
  onClose,
  theme,
  files,
  markdownFiles,
  mdDiagrams,
  currentFile,
  diagramIndex,
  elements,
  views,
  activeViewName,
  isDefaultViewActive,
  availableKeys,
  hideKeys,
  mergeKeys,
  isMarkdownDoc,
  editMode,
  isSidebarVisible,
  isSplitView,
  presentation,
  onSelectFile,
  onJumpToElement,
  onSelectView,
  onSetTagState,
  onCopyPng,
  onExportPng,
  onExportSvg,
  onCopyMermaid,
  onToggleEditMode,
  onToggleSidebar,
  onToggleSplitView,
  onToggleTheme,
  onTogglePresentation,
  onAddParticipant,
  onAddStickyNote,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];

    // 1. Jump to Element (Participants / Flowchart Nodes)
    if (!isMarkdownDoc) {
      for (const el of elements) {
        const displayLabel =
          el.kind === 'participant'
            ? el.alias
              ? `${el.alias} (${el.id})`
              : el.id
            : el.label
              ? `${el.label} (${el.id})`
              : el.id;
        list.push({
          id: `jump:${el.key}`,
          testId: `cmd-jump-${el.id}`,
          category: 'Jump to Element',
          label: `Jump to ${displayLabel}`,
          subtitle: el.kind === 'participant' ? 'Participant' : 'Flowchart Node',
          keywords: `${el.id} ${displayLabel} focus center actor node participant`,
          icon: <User size={14} className="text-blue-500" />,
          onSelect: () => onJumpToElement(el.key),
        });
      }
    }

    // 2. Actions & Export
    if (!isMarkdownDoc) {
      list.push({
        id: 'action:copy-png',
        testId: 'cmd-copy-png',
        category: 'Actions',
        label: 'Copy Diagram as PNG to Clipboard',
        subtitle: 'High-DPI (2x) PNG image',
        keywords: 'png image clipboard copy screenshot export',
        icon: <ImageIcon size={14} className="text-emerald-500" />,
        onSelect: onCopyPng,
      });
      list.push({
        id: 'action:export-png',
        testId: 'cmd-export-png',
        category: 'Actions',
        label: 'Export Diagram as PNG',
        subtitle: 'Download high-DPI .png file',
        keywords: 'png download image export save',
        icon: <Download size={14} className="text-emerald-500" />,
        onSelect: onExportPng,
      });
      list.push({
        id: 'action:export-svg',
        testId: 'cmd-export-svg',
        category: 'Actions',
        label: 'Export Diagram as SVG',
        subtitle: 'Download standalone .svg file',
        keywords: 'svg vector download export',
        icon: <Download size={14} className="text-blue-500" />,
        onSelect: onExportSvg,
      });
      list.push({
        id: 'action:copy-mermaid',
        testId: 'cmd-copy-mermaid',
        category: 'Actions',
        label: 'Copy Mermaid Code',
        subtitle: 'Copy diagram syntax to clipboard',
        keywords: 'copy code mermaid text syntax',
        icon: <Copy size={14} className="text-slate-400" />,
        onSelect: onCopyMermaid,
      });
      if (editMode) {
        list.push({
          id: 'action:add-participant',
          testId: 'cmd-add-participant',
          category: 'Actions',
          label: 'Add Participant / Node',
          badge: '1',
          keywords: 'new actor participant node create',
          icon: <UserPlus size={14} className="text-blue-500" />,
          onSelect: onAddParticipant,
        });
        list.push({
          id: 'action:add-sticky-note',
          testId: 'cmd-add-sticky-note',
          category: 'Actions',
          label: 'Add Sticky Note',
          badge: '2',
          keywords: 'new sticky note annotation card',
          icon: <StickyNoteIcon size={14} className="text-amber-500" />,
          onSelect: onAddStickyNote,
        });
        list.push({
          id: 'action:toggle-sidebar',
          testId: 'cmd-toggle-sidebar',
          category: 'Actions',
          label: isSidebarVisible ? 'Hide Properties Sidebar' : 'Show Properties Sidebar',
          badge: 'Tab',
          keywords: 'sidebar panel properties source toggle',
          icon: <PanelRight size={14} className="text-blue-400" />,
          onSelect: onToggleSidebar,
        });
        list.push({
          id: 'action:toggle-split-view',
          testId: 'cmd-toggle-split-view',
          category: 'Actions',
          label: isSplitView ? 'Exit Split View' : 'Open Split View (Properties + Source)',
          keywords: 'split monaco code side by side',
          icon: <Columns size={14} className="text-purple-400" />,
          onSelect: onToggleSplitView,
        });
      }
      list.push({
        id: 'action:toggle-present',
        testId: 'cmd-toggle-present',
        category: 'Actions',
        label: presentation ? 'Stop Presentation Mode' : 'Start Presentation Walkthrough',
        keywords: 'present walkthrough play step',
        icon: <Play size={14} className="text-emerald-400" />,
        onSelect: onTogglePresentation,
      });
      list.push({
        id: 'action:toggle-edit-mode',
        testId: 'cmd-toggle-edit-mode',
        category: 'Actions',
        label: editMode ? 'Exit Edit Mode (Read-Only View)' : 'Enter Edit Mode',
        keywords: 'edit lock view mode',
        icon: <Pencil size={14} className="text-blue-400" />,
        onSelect: onToggleEditMode,
      });
    }

    list.push({
      id: 'action:toggle-theme',
      testId: 'cmd-toggle-theme',
      category: 'Actions',
      label: theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
      keywords: 'theme dark light appearance mode',
      icon:
        theme === 'dark' ? (
          <Sun size={14} className="text-amber-400" />
        ) : (
          <Moon size={14} className="text-blue-500" />
        ),
      onSelect: onToggleTheme,
    });

    // 3. Saved Views
    if (!isMarkdownDoc) {
      list.push({
        id: 'view:__default__',
        testId: 'cmd-view-default',
        category: 'Saved Views',
        label: 'View: Default (Full Diagram)',
        badge: isDefaultViewActive ? 'Active' : undefined,
        keywords: 'view default reset all full unfiltered',
        icon: <Eye size={14} className="text-blue-400" />,
        onSelect: () => onSelectView(null),
      });
      for (const v of views) {
        const isActive = activeViewName === v.name;
        list.push({
          id: `view:${v.name}`,
          testId: `cmd-view-${v.name}`,
          category: 'Saved Views',
          label: `View: ${v.name}`,
          badge: isActive ? 'Active' : undefined,
          keywords: `view saved ${v.name}`,
          icon: <Eye size={14} className="text-emerald-400" />,
          onSelect: () => onSelectView(v),
        });
      }
    }

    // 4. Tag Filters
    if (!isMarkdownDoc) {
      for (const k of availableKeys) {
        const isOff = hideKeys.has(k);
        const isMerged = mergeKeys.has(k);
        const currentStatus = isOff ? 'Off' : isMerged ? 'Merged' : 'On';
        const nextState: 'on' | 'off' = isOff ? 'on' : 'off';
        list.push({
          id: `tag:toggle:${k}`,
          testId: `cmd-tag-${k}`,
          category: 'Tag Filters',
          label: `${isOff ? 'Show' : 'Hide'} Tag #${k}`,
          subtitle: `Currently ${currentStatus}`,
          badge: `#${k}`,
          keywords: `tag filter key ${k} hide show`,
          icon: <Tag size={14} className="text-amber-400" />,
          onSelect: () => onSetTagState(k, nextState),
        });
        if (!isMerged) {
          list.push({
            id: `tag:merge:${k}`,
            testId: `cmd-tag-merge-${k}`,
            category: 'Tag Filters',
            label: `Merge Tag #${k}`,
            subtitle: 'Collapse tagged actors into a single domain',
            badge: `#${k}`,
            keywords: `tag merge collapse domain ${k}`,
            icon: <Tag size={14} className="text-purple-400" />,
            onSelect: () => onSetTagState(k, 'merged'),
          });
        }
      }
    }

    // 5. Switch File
    for (const f of files) {
      const isCurrent = currentFile === f && diagramIndex === null;
      list.push({
        id: `file:${f}`,
        testId: `cmd-file-${f}`,
        category: 'Switch File',
        label: f,
        badge: isCurrent ? 'Current' : undefined,
        keywords: `file diagram open switch ${f}`,
        icon: <FileCode size={14} className="text-blue-400" />,
        onSelect: () => onSelectFile(f),
      });
    }
    for (const mf of markdownFiles) {
      const isCurrentDoc = currentFile === mf && diagramIndex === null;
      list.push({
        id: `mdfile:${mf}`,
        testId: `cmd-file-${mf}`,
        category: 'Switch File',
        label: mf,
        subtitle: 'Markdown Document',
        badge: isCurrentDoc ? 'Current' : undefined,
        keywords: `markdown doc file open ${mf}`,
        icon: <FileText size={14} className="text-emerald-400" />,
        onSelect: () => onSelectFile(mf),
      });
      const embedded = mdDiagrams[mf] ?? [];
      for (const d of embedded) {
        const isCurrentEmbedded = currentFile === mf && diagramIndex === d.index;
        list.push({
          id: `mddiag:${mf}:${d.index}`,
          testId: `cmd-file-${mf}-${d.index}`,
          category: 'Switch File',
          label: `${mf} › ${d.title}`,
          subtitle: `Embedded diagram (#${d.index + 1})`,
          badge: isCurrentEmbedded ? 'Current' : undefined,
          keywords: `markdown embedded diagram ${mf} ${d.title}`,
          icon: <FileCode size={14} className="text-indigo-400" />,
          onSelect: () => onSelectFile(mf, d.index),
        });
      }
    }

    return list;
  }, [
    isMarkdownDoc,
    elements,
    editMode,
    isSidebarVisible,
    isSplitView,
    presentation,
    theme,
    views,
    activeViewName,
    isDefaultViewActive,
    availableKeys,
    hideKeys,
    mergeKeys,
    files,
    markdownFiles,
    mdDiagrams,
    currentFile,
    diagramIndex,
    onJumpToElement,
    onCopyPng,
    onExportPng,
    onExportSvg,
    onCopyMermaid,
    onAddParticipant,
    onAddStickyNote,
    onToggleSidebar,
    onToggleSplitView,
    onTogglePresentation,
    onToggleEditMode,
    onToggleTheme,
    onSelectView,
    onSetTagState,
    onSelectFile,
  ]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const tokens = q.split(/\s+/);
    return items.filter((item) => {
      const haystack = `${item.label} ${item.subtitle ?? ''} ${item.category} ${item.keywords ?? ''}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const isDark = theme === 'dark';
  const clampedIndex =
    filteredItems.length > 0
      ? Math.min(activeIndex, filteredItems.length - 1)
      : 0;

  const executeItem = (item: CommandItem) => {
    item.onSelect();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredItems.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex(
          (prev) => (prev - 1 + filteredItems.length) % filteredItems.length,
        );
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredItems[clampedIndex];
      if (target) {
        executeItem(target);
      }
    }
  };

  return (
    <div
      data-testid="command-palette-backdrop"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-sm"
    >
      <div
        data-testid="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-xl rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[70vh] ${
          isDark
            ? 'bg-slate-900 border-slate-700 text-slate-100'
            : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div
          className={`flex items-center px-3.5 py-2.5 border-b ${
            isDark ? 'border-slate-800' : 'border-gray-200'
          }`}
        >
          <Search
            size={16}
            className={`mr-2.5 flex-shrink-0 ${
              isDark ? 'text-slate-400' : 'text-gray-400'
            }`}
          />
          <input
            ref={inputRef}
            type="text"
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, participant/node name, view, tag, or file..."
            className="w-full bg-transparent text-sm focus:outline-none placeholder:text-gray-400 dark:placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              data-testid="command-palette-clear"
              aria-label="Clear command query"
              onClick={() => setQuery('')}
              className="p-1 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <X size={14} />
            </button>
          )}
          <span
            className={`ml-2 px-1.5 py-0.5 text-[10px] rounded border font-mono ${
              isDark
                ? 'border-slate-700 bg-slate-800 text-slate-400'
                : 'border-gray-200 bg-gray-100 text-gray-500'
            }`}
          >
            ESC
          </span>
        </div>

        <div
          data-testid="command-palette-list"
          className="overflow-y-auto p-1.5 space-y-0.5 flex-1"
        >
          {filteredItems.length === 0 ? (
            <div
              data-testid="command-palette-empty"
              className="py-8 text-center text-xs text-gray-400 dark:text-slate-500"
            >
              No matching commands, elements, views, or files
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === clampedIndex;
              const prevCategory =
                idx > 0 ? filteredItems[idx - 1].category : null;
              const showCategoryHeader = item.category !== prevCategory;
              return (
                <React.Fragment key={item.id}>
                  {showCategoryHeader && (
                    <div
                      className={`px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider select-none ${
                        isDark ? 'text-slate-500' : 'text-gray-400'
                      }`}
                    >
                      {item.category}
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid={item.testId}
                    data-active={String(isSelected)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => executeItem(item)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                      isSelected
                        ? isDark
                          ? 'bg-blue-600/25 text-blue-200'
                          : 'bg-blue-50 text-blue-900'
                        : isDark
                          ? 'text-slate-200 hover:bg-slate-800/70'
                          : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="flex-shrink-0">{item.icon}</span>
                      <div className="truncate">
                        <span className="font-medium">{item.label}</span>
                        {item.subtitle && (
                          <span
                            className={`ml-2 text-[11px] ${
                              isDark ? 'text-slate-400' : 'text-gray-400'
                            }`}
                          >
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-1.5 flex-shrink-0 ml-2">
                      {item.badge && (
                        <span
                          className={`px-1.5 py-0.5 text-[10px] rounded font-mono ${
                            isDark
                              ? 'bg-slate-800 text-slate-300 border border-slate-700'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                      {isSelected && (
                        <CornerDownLeft
                          size={12}
                          className={isDark ? 'text-blue-400' : 'text-blue-600'}
                        />
                      )}
                    </div>
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
