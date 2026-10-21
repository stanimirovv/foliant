import { NextResponse } from 'next/server';
import {
  getStorageBackend,
  resolveStorageDir,
  subscribeStorageChanges,
  StorageBackend,
  StorageChangeEvent,
} from '@/lib/storage';

// SSE live reload. Two feeds converge per directory:
//  - API-mediated writes: every backend's writeFile pulses the shared
//    storageEvents emitter (cached on globalThis), which this route subscribes
//    to — this is what makes live reload work on the memory backend.
//  - External changes: the active backend's watch() (fs: chokidar; s3:
//    optional polling) feeds the same client set.
// The event shape ({ event, file }) and the .mmd/.md/.markdown filter are
// unchanged; SSE client-cancel cleanup is preserved.

interface DirState {
  clients: Set<ReadableStreamDefaultController>;
  unsubscribeEmitter: () => void;
  unwatch?: () => void;
}

// Module-level in this one route bundle: every SSE request to /api/events
// shares it, and the per-dir watcher/subscription is created exactly once.
const dirs = new Map<string, DirState>();

function getOrCreateDirState(dir: string, backend: StorageBackend): DirState {
  const existing = dirs.get(dir);
  if (existing) return existing;

  const clients = new Set<ReadableStreamDefaultController>();
  const state: DirState = {
    clients,
    unsubscribeEmitter: () => undefined,
  };

  const broadcast = (e: StorageChangeEvent) => {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    clients.forEach(client => {
      try {
        client.enqueue(new TextEncoder().encode(data));
      } catch {
        clients.delete(client);
      }
    });
  };

  state.unsubscribeEmitter = subscribeStorageChanges(backend.name, dir, broadcast);
  state.unwatch = backend.watch?.(dir, broadcast);
  dirs.set(dir, state);
  return state;
}

export async function GET(request: Request) {
  const backend = getStorageBackend();
  const dir = resolveStorageDir(request);
  const state = getOrCreateDirState(dir, backend);

  const stream = new ReadableStream({
    start(controller) {
      state.clients.add(controller);
    },
    cancel(controller) {
      state.clients.delete(controller);
      // Last client for this directory gone: tear down the per-dir state so
      // the shared emitter subscription and the backend watcher do not leak
      // for directories nobody is looking at anymore (the fs backend closes
      // its watcher the same way when the last subscriber leaves). Without
      // this, a long-lived dev/test server accumulates one chokidar watcher
      // per directory ever opened, until the process stops responding.
      if (state.clients.size === 0) {
        dirs.delete(dir);
        state.unsubscribeEmitter();
        state.unwatch?.();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

export const dynamic = 'force-dynamic';
