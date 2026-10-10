'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import DiagramViewer from './DiagramViewer';
import EditorPanel from './EditorPanel';
import { processMermaid, transformActors, ActorTransformOptions } from '@/lib/preprocessor';
import { extractRegions, RegionNode } from '@/lib/parser';
import { Search, Moon, Sun, Folder, Save, Trash2, Play, Pencil, UserPlus, MessageSquarePlus } from 'lucide-react';
import { parseViewsData, updateViewsData, DiagramConfig, SavedView } from '@/lib/views';
import { parseModel, ModelElement } from '@/lib/model';
import {
  editMessageLabel, renameParticipant, addParticipant, addMessage, deleteElement,
  setArrowType, setActorColor, addTag, removeTag, setArrowStyle, getArrowStyle,
  EditResult, ArrowStylePatch,
} from '@/lib/editor';
import { buildSelectionMap } from '@/lib/svgmap';
import { rewriteArrowStyles } from '@/lib/styling';
import { PendingDelete } from './EditorPanel';

export default function ClientPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [files, setFiles] = useState<string[]>([]);
  const [rawCode, setRawCode] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);

  // Editing state (EDITING_PLAN.md Steps 7+): `selection` is a RAW element
  // key. DiagramViewer reports the PROCESSED key on click; it is resolved to
  // the raw element through the selection map and the RAW key is stored, so
  // the selection survives transforms that reorder the processed diagram
  // (e.g. colored participants regrouped into box blocks).
  const [selection, setSelection] = useState<string | null>(null);
  const [editWarning, setEditWarning] = useState<string | null>(null);
  // Two-phase delete (EDITING_PLAN.md Step 8): the transform runs on request
  // so the confirm dialog can list the cascaded elements; the new code is
  // applied only on confirm.
  const [pendingDelete, setPendingDelete] = useState<(PendingDelete & { code: string }) | null>(null);
  
  const currentFile = searchParams.get('file');
  const searchQuery = searchParams.get('q') || '';
  const theme = (searchParams.get('theme') as 'default' | 'dark') || 'default';
  const dirParam = searchParams.get('dir') || '';
  
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
    
    const newQueryString = params.toString();
    if (newQueryString === searchParams.toString()) {
      setRefreshKey(k => k + 1);
    } else {
      router.replace(`${pathname}?${newQueryString}`, { scroll: false });
    }
  };
  
  // Hidden paths
  const hiddenPathsParam = searchParams.get('hidden') || '';
  const hiddenPaths = useMemo(() => new Set(hiddenPathsParam.split(',').filter(Boolean)), [hiddenPathsParam]);

  const mergeColorParam = searchParams.get('merge_color') || '';
  const mergeColors = useMemo(() => new Set(mergeColorParam.split(',').filter(Boolean)), [mergeColorParam]);

  const hideColorParam = searchParams.get('hide_color') || '';
  const hideColors = useMemo(() => new Set(hideColorParam.split(',').filter(Boolean)), [hideColorParam]);

  const mergeCleanColorParam = searchParams.get('merge_clean_color') || '';
  const mergeCleanColors = useMemo(() => new Set(mergeCleanColorParam.split(',').filter(Boolean)), [mergeCleanColorParam]);

  const mergeKeyParam = searchParams.get('merge_key') || '';
  const mergeKeys = useMemo(() => new Set(mergeKeyParam.split(',').filter(Boolean)), [mergeKeyParam]);

  const hideKeyParam = searchParams.get('hide_key') || '';
  const hideKeys = useMemo(() => new Set(hideKeyParam.split(',').filter(Boolean)), [hideKeyParam]);

  const mergeCleanKeyParam = searchParams.get('merge_clean_key') || '';
  const mergeCleanKeys = useMemo(() => new Set(mergeCleanKeyParam.split(',').filter(Boolean)), [mergeCleanKeyParam]);

  const toggleSetParam = (paramName: string, value: string, currentSet: Set<string>) => {
    const newSet = new Set(currentSet);
    if (newSet.has(value)) {
      newSet.delete(value);
    } else {
      newSet.add(value);
    }
    const params = new URLSearchParams(searchParams.toString());
    if (newSet.size > 0) {
      params.set(paramName, Array.from(newSet).join(','));
    } else {
      params.delete(paramName);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const toggleHiddenPath = (path: string) => toggleSetParam('hidden', path, hiddenPaths);

  const setActorState = (type: 'color' | 'key', id: string, state: 'on' | 'off' | 'merged' | 'merged_clean') => {
    const params = new URLSearchParams(searchParams.toString());
    const mergeParamName = type === 'color' ? 'merge_color' : 'merge_key';
    const mergeCleanParamName = type === 'color' ? 'merge_clean_color' : 'merge_clean_key';
    const hideParamName = type === 'color' ? 'hide_color' : 'hide_key';
    
    const currentMerge = new Set(type === 'color' ? mergeColors : mergeKeys);
    const currentMergeClean = new Set(type === 'color' ? mergeCleanColors : mergeCleanKeys);
    const currentHide = new Set(type === 'color' ? hideColors : hideKeys);

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

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/files${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`)
      .then(r => r.json())
      .then(data => {
        if (ignore) return;
        setFiles(data.files || []);
        if (!currentFile && data.files && data.files.length > 0) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('file', data.files[0]);
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }
      });
    return () => { ignore = true; };
  }, [currentFile, pathname, router, searchParams, dirParam, refreshKey]);

  const loadFile = useCallback(async (filename: string) => {
    try {
      const r = await fetch(`/api/file/${filename}${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`);
      const data = await r.json();
      setRawCode(data.content || '');
    } catch (e) {
      console.error(e);
    }
  }, [dirParam]);

  useEffect(() => {
    if (currentFile) {
      loadFile(currentFile);
      setSelection(null);
      setPendingDelete(null);
    } else {
      setRawCode('');
      setSelection(null);
      setPendingDelete(null);
    }
  }, [currentFile, loadFile]);

  useEffect(() => {
    const evtSource = new EventSource(`/api/events${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`);
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (currentFile && data.file === currentFile) {
        loadFile(currentFile);
      }
    };
    return () => evtSource.close();
  }, [currentFile, loadFile, dirParam]);

  const [debouncedCode, setDebouncedCode] = useState(rawCode);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedCode(rawCode);
    }, 500);
    return () => clearTimeout(handler);
  }, [rawCode]);

  const regionRoots = useMemo(() => extractRegions(debouncedCode), [debouncedCode]);

  const viewsData = useMemo<DiagramConfig | null>(() => {
    return parseViewsData(rawCode);
  }, [rawCode]);

  const availableColors = useMemo(() => {
    if (!viewsData?.actors) return [];
    const colors = new Set<string>();
    Object.values(viewsData.actors).forEach(a => { if (a.color) colors.add(a.color); });
    return Array.from(colors);
  }, [viewsData]);

  const availableKeys = useMemo(() => {
    if (!viewsData?.actors) return [];
    const keys = new Set<string>();
    Object.values(viewsData.actors).forEach(a => { if (a.keys) a.keys.forEach(k => keys.add(k)); });
    return Array.from(keys);
  }, [viewsData]);

  const actorOptions = useMemo<ActorTransformOptions>(() => ({
    mergeByColor: Array.from(mergeColors),
    mergeCleanByColor: Array.from(mergeCleanColors),
    mergeByKeys: Array.from(mergeKeys),
    mergeCleanByKeys: Array.from(mergeCleanKeys),
    hideColors: Array.from(hideColors),
    hideKeys: Array.from(hideKeys)
  }), [mergeColors, mergeCleanColors, mergeKeys, mergeCleanKeys, hideColors, hideKeys]);

  const { code: processedCode, warnings: procWarnings } = useMemo(() => {
    const actorTransformed = transformActors(debouncedCode, viewsData, actorOptions);

    return processMermaid(actorTransformed, {
      isRegionVisible: (region) => !hiddenPaths.has(region.path)
    });
  }, [debouncedCode, hiddenPaths, viewsData, actorOptions]);

  useEffect(() => {
    setWarnings(procWarnings);
  }, [procWarnings]);

  // --- Edit mode (EDITING_PLAN.md Step 7 walking skeleton) ---
  const editParam = searchParams.get('edit') === '1';
  const rawModel = useMemo(() => parseModel(rawCode), [rawCode]);
  const editSupported = rawModel.type !== 'unknown';  // R-01: sequence + flowchart only
  const editMode = editParam && editSupported;

  const selectionMap = useMemo(
    () => buildSelectionMap(rawCode, processedCode, viewsData, actorOptions),
    [rawCode, processedCode, viewsData, actorOptions]
  );
  // Inverse of the selection map (raw key -> processed key) for the highlight.
  const rawToProcessed = useMemo(() => {
    const map = new Map<string, string>();
    selectionMap.forEach((rawEl, processedKey) => { map.set(rawEl.key, processedKey); });
    return map;
  }, [selectionMap]);
  const processedSelection = selection ? rawToProcessed.get(selection) ?? null : null;

  const selectedRawElement = useMemo(
    () => (selection ? rawModel.elements.find(e => e.key === selection) ?? null : null),
    [selection, rawModel]
  );

  // DiagramViewer click: processed key -> raw key.
  const handleSelect = (processedKey: string | null) => {
    if (!processedKey) {
      setSelection(null);
      return;
    }
    const raw = selectionMap.get(processedKey);
    setSelection(raw ? raw.key : null);
  };
  const resolvedArrowStyles = useMemo(
    () => rewriteArrowStyles(viewsData, actorOptions),
    [viewsData, actorOptions]
  );

  const toggleEditMode = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (editMode) {
      params.delete('edit');
    } else {
      params.set('edit', '1');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // --- Edit dispatch (EDITING_PLAN.md Steps 7-8): every panel action runs a
  // pure transform over (rawCode, viewsData) and applies the result. ---
  const applyEditResult = (result: EditResult) => {
    if (result.warning) {
      setEditWarning(result.warning);
      return;
    }
    setEditWarning(null);
    setRawCode(result.code);
  };

  const selectedComponent = selectedRawElement && (selectedRawElement.kind === 'participant' || selectedRawElement.kind === 'node')
    ? selectedRawElement
    : null;
  const selectedArrow = selectedRawElement && (selectedRawElement.kind === 'message' || selectedRawElement.kind === 'edge')
    ? selectedRawElement
    : null;

  const selectedArrowStyle = useMemo(
    () => (selectedArrow ? getArrowStyle(rawCode, viewsData, selectedArrow.key) : null),
    [selectedArrow, rawCode, viewsData]
  );

  // Current arrow style as a complete patch (setArrowStyle replaces the whole
  // entry, so single-field edits must carry the other fields along).
  const currentArrowPatch = (): ArrowStylePatch => {
    const cur = selectedArrowStyle ?? {};
    return {
      color: cur.color,
      width: cur.width,
      dash: cur.dash && cur.dash !== 'solid' ? cur.dash : undefined,
    };
  };

  const handleEditLabel = (newLabel: string) => {
    if (!selectedRawElement) return;
    const fn = selectedComponent ? renameParticipant : editMessageLabel;
    applyEditResult(fn(rawCode, viewsData, selectedRawElement.key, newLabel));
  };

  const handleSetColor = (color: string) => {
    if (selectedComponent) {
      applyEditResult(setActorColor(rawCode, viewsData, selectedComponent.key, color));
    } else if (selectedArrow) {
      const patch = currentArrowPatch();
      patch.color = color.trim() || undefined;
      applyEditResult(setArrowStyle(rawCode, viewsData, selectedArrow.key, patch));
    }
  };

  const handleSetType = (operator: string) => {
    if (!selectedArrow) return;
    if (selectedArrow.operator === operator) return;
    applyEditResult(setArrowType(rawCode, viewsData, selectedArrow.key, operator));
  };

  const handleSetWidth = (width: number | '') => {
    if (!selectedArrow) return;
    const patch = currentArrowPatch();
    patch.width = width === '' ? undefined : width;
    applyEditResult(setArrowStyle(rawCode, viewsData, selectedArrow.key, patch));
  };

  const handleSetDash = (dash: 'solid' | 'dashed' | 'dotted') => {
    if (!selectedArrow) return;
    const patch = currentArrowPatch();
    patch.dash = dash === 'solid' ? undefined : dash;
    applyEditResult(setArrowStyle(rawCode, viewsData, selectedArrow.key, patch));
  };

  const handleAddTag = (tag: string) => {
    if (!selectedComponent) return;
    applyEditResult(addTag(rawCode, viewsData, selectedComponent.key, tag));
  };

  const handleRemoveTag = (tag: string) => {
    if (!selectedComponent) return;
    applyEditResult(removeTag(rawCode, viewsData, selectedComponent.key, tag));
  };

  const handleRequestDelete = () => {
    if (!selectedRawElement) return;
    const result = deleteElement(rawCode, viewsData, selectedRawElement.key);
    if (result.warning) {
      setEditWarning(result.warning);
      return;
    }
    const cascaded = (result.cascaded ?? [])
      .map(k => rawModel.elements.find(e => e.key === k))
      .filter((e): e is ModelElement => e !== undefined);
    setPendingDelete({ code: result.code, element: selectedRawElement, cascaded });
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    setRawCode(pendingDelete.code);
    setPendingDelete(null);
    setSelection(null);
    setEditWarning(null);
  };

  const handleCancelDelete = () => setPendingDelete(null);

  // --- Add Participant / Add Message (EDITING_PLAN.md 4.12) ---
  const componentElements = useMemo(
    () => rawModel.elements.filter(e => e.kind === 'participant' || e.kind === 'node'),
    [rawModel]
  );

  const handleAddParticipant = () => {
    const afterKey = selectedComponent ? selectedComponent.key : undefined;
    applyEditResult(addParticipant(rawCode, viewsData, afterKey));
  };

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
    const afterKey = selectedArrow ? selectedArrow.key : undefined;
    applyEditResult(addMessage(rawCode, viewsData, fromEl.key, toEl.key, afterKey));
  };

  const saveCurrentView = async () => {
    if (!currentFile) return;
    const name = window.prompt('Enter view name:');
    if (!name) return;

    const currentViews = viewsData?.views ? [...viewsData.views] : [];
    const existingIndex = currentViews.findIndex(v => v.name === name);

    const newView: SavedView = {
      name,
      hiddenPaths: Array.from(hiddenPaths)
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

    try {
      await fetch(`/api/file/${currentFile}${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: newCode })
      });
      setRawCode(newCode);
    } catch (e) {
      console.error('Failed to save view', e);
    }
  };

  const deleteView = async (name: string) => {
    if (!currentFile || !viewsData?.views) return;
    if (!window.confirm(`Delete view "${name}"?`)) return;

    const currentViews = viewsData.views.filter(v => v.name !== name);
    const newData: DiagramConfig | null = (currentViews.length > 0 || (viewsData && viewsData.actors && Object.keys(viewsData.actors).length > 0)) ? {
      ...(viewsData || {}),
      version: 1,
      views: currentViews
    } : null;

    const newCode = updateViewsData(rawCode, newData);

    try {
      await fetch(`/api/file/${currentFile}${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: newCode })
      });
      setRawCode(newCode);
    } catch (e) {
      console.error('Failed to delete view', e);
    }
  };

  const loadView = (view: SavedView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (view.hiddenPaths.length > 0) {
      params.set('hidden', view.hiddenPaths.join(','));
    } else {
      params.delete('hidden');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const renderRegionTree = (nodes: RegionNode[]) => {
    return (
      <ul className="pl-4 space-y-1">
        {nodes.map(node => {
          const isHidden = hiddenPaths.has(node.path);
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
    <div className="flex h-screen bg-gray-50  text-gray-900 ">
      <div className="w-64 border-r border-gray-200  bg-white  flex flex-col">
        <div className="p-4 border-b border-gray-200  flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <img src="/logo.png" alt="Logo" className="w-6 h-6 rounded-md object-cover" />
            <h1 className="font-bold">Mermaid Viewer</h1>
          </div>
          <button 
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('theme', theme === 'dark' ? 'default' : 'dark');
              router.replace(`${pathname}?${params.toString()}`);
            }}
            className="p-1 rounded hover:bg-gray-100 "
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-6">
            <h2 className="text-xs font-bold uppercase text-gray-500 mb-2 flex items-center">
              <Folder size={14} className="mr-1" /> Directory
            </h2>
            <form onSubmit={handleDirSubmit} className="mb-2">
              <input
                type="text"
                placeholder="Paste absolute path..."
                value={customDirInput}
                onChange={e => setCustomDirInput(e.target.value)}
                className="w-full px-2 py-1 text-sm border rounded mb-1"
              />
              <button type="submit" className="w-full bg-blue-500 text-white rounded py-1 text-sm hover:bg-blue-600">
                Load Directory
              </button>
            </form>
            {recentDirs.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-gray-400">Recent:</span>
                <ul className="space-y-1 mt-1">
                  {recentDirs.map(d => (
                    <li key={d}>
                      <button
                        className="w-full text-left text-xs truncate text-blue-600 hover:underline"
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
                        {d}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mb-6">
            <h2 className="text-xs font-bold uppercase text-gray-500 mb-2 flex items-center">
              <Folder size={14} className="mr-1" /> Files
            </h2>
            <ul className="space-y-1">
              {files.map(f => (
                <li key={f}>
                  <button
                    className={`w-full text-left px-2 py-1 rounded text-sm ${currentFile === f ? 'bg-blue-100  text-blue-700 ' : 'hover:bg-gray-100 '}`}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set('file', f);
                      router.replace(`${pathname}?${params.toString()}`);
                    }}
                  >
                    {f}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-6">
            <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Filters</h2>
            {regionRoots.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No regions found</p>
            ) : (
              <div className="-ml-4">{renderRegionTree(regionRoots)}</div>
            )}
          </div>

          {(availableColors.length > 0 || availableKeys.length > 0) && (
            <div className="mb-6">
              <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Actors</h2>
              
              {availableColors.length > 0 && (
                <div className="mb-3">
                  <span className="text-xs font-semibold text-gray-400 block mb-1">By Color</span>
                  <ul className="space-y-2">
                    {availableColors.map(c => {
                      const currentState = hideColors.has(c) ? 'off' : mergeCleanColors.has(c) ? 'merged_clean' : mergeColors.has(c) ? 'merged' : 'on';
                      return (
                        <li key={c} className="text-sm flex flex-col pl-2 border-l-2 border-gray-200 ml-1">
                          <span className="font-medium text-gray-700">{c}</span>
                          <div className="flex border border-gray-200 rounded overflow-hidden text-[10px] mt-1 w-full bg-gray-50">
                            <button 
                              onClick={() => setActorState('color', c, 'on')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors ${currentState === 'on' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              On
                            </button>
                            <button 
                              onClick={() => setActorState('color', c, 'off')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${currentState === 'off' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              Off
                            </button>
                            <button 
                              onClick={() => setActorState('color', c, 'merged')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${currentState === 'merged' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              Merged
                            </button>
                            <button 
                              onClick={() => setActorState('color', c, 'merged_clean')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${currentState === 'merged_clean' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                              title="Merge actors and hide their internal self-calls"
                            >
                              Clean
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {availableKeys.length > 0 && (
                <div className="mb-3">
                  <span className="text-xs font-semibold text-gray-400 block mb-1">By Key</span>
                  <ul className="space-y-2">
                    {availableKeys.map(k => {
                      const currentState = hideKeys.has(k) ? 'off' : mergeCleanKeys.has(k) ? 'merged_clean' : mergeKeys.has(k) ? 'merged' : 'on';
                      return (
                        <li key={k} className="text-sm flex flex-col pl-2 border-l-2 border-gray-200 ml-1">
                          <span className="font-medium text-gray-700">{k}</span>
                          <div className="flex border border-gray-200 rounded overflow-hidden text-[10px] mt-1 w-full bg-gray-50">
                            <button 
                              onClick={() => setActorState('key', k, 'on')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors ${currentState === 'on' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              On
                            </button>
                            <button 
                              onClick={() => setActorState('key', k, 'off')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${currentState === 'off' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              Off
                            </button>
                            <button 
                              onClick={() => setActorState('key', k, 'merged')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${currentState === 'merged' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              Merged
                            </button>
                            <button 
                              onClick={() => setActorState('key', k, 'merged_clean')} 
                              className={`flex-1 py-1 px-1 text-center font-medium transition-colors border-l border-gray-200 ${currentState === 'merged_clean' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}
                              title="Merge actors and hide their internal self-calls"
                            >
                              Clean
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase text-gray-500">Saved Views</h2>
              <button 
                onClick={saveCurrentView}
                className="text-blue-500 hover:text-blue-600 p-1 rounded hover:bg-blue-50"
                title="Save Current View"
              >
                <Save size={14} />
              </button>
            </div>
            {(!viewsData || !viewsData.views || viewsData.views.length === 0) ? (
              <p className="text-xs text-gray-500 italic">No saved views</p>
            ) : (
              <ul className="space-y-2">
                {viewsData.views.map(view => (
                  <li key={view.name} className="flex items-center justify-between bg-gray-50 p-2 rounded border text-sm group">
                    <span className="truncate font-medium flex-1 mr-2" title={view.name}>
                      {view.name}
                    </span>
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => loadView(view)} 
                        className="text-green-600 hover:text-green-700 p-1 hover:bg-green-100 rounded"
                        title="Load View"
                      >
                        <Play size={14} />
                      </button>
                      <button 
                        onClick={() => deleteView(view.name)} 
                        className="text-red-500 hover:text-red-600 p-1 hover:bg-red-100 rounded"
                        title="Delete View"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-gray-200  bg-white  flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
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
                className="w-full pl-8 pr-3 py-1 text-sm border rounded bg-gray-50   focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={toggleEditMode}
              disabled={!editSupported}
              title={editSupported
                ? (editMode ? 'Exit edit mode' : 'Edit diagram')
                : 'Editing is only available for sequence and flowchart diagrams'}
              className={`p-1.5 rounded border ${
                editMode
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-gray-200  hover:bg-gray-100 '
              } ${!editSupported ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Pencil size={16} />
            </button>
            {editMode && (
              <>
                <button
                  onClick={handleAddParticipant}
                  title="Add Participant"
                  className="flex items-center space-x-1 px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-100"
                >
                  <UserPlus size={14} />
                  <span>Participant</span>
                </button>
                <button
                  onClick={handleAddMessage}
                  disabled={componentElements.length === 0}
                  title={componentElements.length === 0
                    ? 'Add a participant first'
                    : 'Add Message'}
                  className={`flex items-center space-x-1 px-2 py-1 text-xs rounded border border-gray-200 ${
                    componentElements.length === 0
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <MessageSquarePlus size={14} />
                  <span>Message</span>
                </button>
              </>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="text-yellow-600 text-sm font-medium">
              {warnings.length} warning(s)
            </div>
          )}
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 p-4 overflow-hidden relative min-w-0">
            <DiagramViewer
              code={processedCode}
              searchQuery={searchQuery}
              theme={theme}
              editMode={editMode}
              arrowStyles={resolvedArrowStyles}
              nodeColors={viewsData}
              selection={processedSelection}
              onSelect={handleSelect}
            />
          </div>
          {editMode && (
            <div className="w-72 flex-shrink-0 border-l border-gray-200  bg-white  overflow-y-auto">
              <EditorPanel
                element={selectedRawElement}
                diagramType={rawModel.type}
                config={viewsData}
                arrowStyle={selectedArrowStyle}
                warning={editWarning}
                pendingDelete={pendingDelete}
                onEditLabel={handleEditLabel}
                onSetColor={handleSetColor}
                onSetType={handleSetType}
                onSetWidth={handleSetWidth}
                onSetDash={handleSetDash}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                onRequestDelete={handleRequestDelete}
                onConfirmDelete={handleConfirmDelete}
                onCancelDelete={handleCancelDelete}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
