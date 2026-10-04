'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import DiagramViewer from './DiagramViewer';
import { processMermaid } from '@/lib/preprocessor';
import { extractRegions, RegionNode } from '@/lib/parser';
import { Search, Moon, Sun, Folder } from 'lucide-react';

export default function ClientPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [files, setFiles] = useState<string[]>([]);
  const [rawCode, setRawCode] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  
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
    router.replace(`${pathname}?${params.toString()}`);
  };
  
  // Hidden paths
  const hiddenPathsParam = searchParams.get('hidden') || '';
  const hiddenPaths = useMemo(() => new Set(hiddenPathsParam.split(',').filter(Boolean)), [hiddenPathsParam]);

  const toggleHiddenPath = (path: string) => {
    const newHidden = new Set(hiddenPaths);
    if (newHidden.has(path)) {
      newHidden.delete(path);
    } else {
      newHidden.add(path);
    }
    const params = new URLSearchParams(searchParams.toString());
    if (newHidden.size > 0) {
      params.set('hidden', Array.from(newHidden).join(','));
    } else {
      params.delete('hidden');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    fetch(`/api/files${dirParam ? `?dir=${encodeURIComponent(dirParam)}` : ''}`)
      .then(r => r.json())
      .then(data => {
        setFiles(data.files || []);
        if (!currentFile && data.files && data.files.length > 0) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('file', data.files[0]);
          router.replace(`${pathname}?${params.toString()}`);
        }
      });
  }, [currentFile, pathname, router, searchParams, dirParam]);

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

  const { code: processedCode, warnings: procWarnings } = useMemo(() => {
    return processMermaid(debouncedCode, {
      isRegionVisible: (region) => !hiddenPaths.has(region.path)
    });
  }, [debouncedCode, hiddenPaths]);

  useEffect(() => {
    setWarnings(procWarnings);
  }, [procWarnings]);

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
                          router.replace(`${pathname}?${params.toString()}`);
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

          <div>
            <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Filters</h2>
            {regionRoots.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No regions found</p>
            ) : (
              <div className="-ml-4">{renderRegionTree(regionRoots)}</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-gray-200  bg-white  flex items-center justify-between">
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
          {warnings.length > 0 && (
            <div className="text-yellow-600 text-sm font-medium">
              {warnings.length} warning(s)
            </div>
          )}
        </div>
        
        <div className="flex-1 p-4 overflow-hidden relative">
          <DiagramViewer code={processedCode} searchQuery={searchQuery} theme={theme} />
        </div>
      </div>
    </div>
  );
}
