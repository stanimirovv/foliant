// Unified change notification for live reload. One emitter per (backend kind,
// dir), cached on globalThis so every route bundle — and every backend —
// shares it (Next.js dev compiles each route into its own bundle; per-bundle
// state would silently split the notification path).
//
// Two feeds converge here:
//  - API-mediated writes: every backend's writeFile pulses the emitter, so
//    saves made through this process reload every connected client (this is
//    the only feed the memory backend has — it has no external writer).
//  - External changes: the fs backend's chokidar watch and the s3 backend's
//    optional polling watch feed it too (see the /api/events route).
//
// The client dedupes by content, so a write observed through both feeds (fs:
// pulse + chokidar) is harmless.

import { StorageChangeEvent } from './types';

export type StorageChangeListener = (e: StorageChangeEvent) => void;

interface EmitterState {
  listeners: Set<StorageChangeListener>;
}

const GLOBAL_KEY = '__mermaidSequenceViewerStorageEvents__';
const globalStore = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Map<string, EmitterState> };

function registry(): Map<string, EmitterState> {
  if (!globalStore[GLOBAL_KEY]) globalStore[GLOBAL_KEY] = new Map();
  return globalStore[GLOBAL_KEY];
}

export function storageEventsKey(kind: string, dir: string): string {
  return `${kind}:${dir}`;
}

// Notify every subscriber that `file` in `dir` changed. Never throws: a broken
// listener must not fail the write that triggered it.
export function emitStorageChange(kind: string, dir: string, event: StorageChangeEvent): void {
  const state = registry().get(storageEventsKey(kind, dir));
  if (!state) return;
  for (const listener of [...state.listeners]) {
    try {
      listener(event);
    } catch {
      // ignore listener failures
    }
  }
}

// Subscribe to changes in `dir`. Returns an unsubscribe function.
export function subscribeStorageChanges(kind: string, dir: string, listener: StorageChangeListener): () => void {
  const key = storageEventsKey(kind, dir);
  let state = registry().get(key);
  if (!state) {
    state = { listeners: new Set() };
    registry().set(key, state);
  }
  state.listeners.add(listener);
  return () => {
    state!.listeners.delete(listener);
  };
}
