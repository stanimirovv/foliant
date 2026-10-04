import { NextResponse } from 'next/server';
import chokidar from 'chokidar';
import { getDiagramsDir } from '@/lib/config';

interface DirState {
  watcher: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  clients: Set<ReadableStreamDefaultController>;
}

const dirs = new Map<string, DirState>();

function getOrCreateDirState(dir: string): DirState {
  if (!dirs.has(dir)) {
    const clients = new Set<ReadableStreamDefaultController>();
    const watcher = chokidar.watch('*.mmd', { cwd: dir, ignoreInitial: true });
    
    watcher.on('all', (event: string, file: string) => {
      const data = `data: ${JSON.stringify({ event, file })}\n\n`;
      clients.forEach(client => {
        try {
          client.enqueue(new TextEncoder().encode(data));
        } catch {
          clients.delete(client);
        }
      });
    });

    dirs.set(dir, { watcher, clients });
  }
  return dirs.get(dir)!;
}

export async function GET(request: Request) {
  const diagramsDir = getDiagramsDir(request);
  const state = getOrCreateDirState(diagramsDir);

  const stream = new ReadableStream({
    start(controller) {
      state.clients.add(controller);
    },
    cancel(controller) {
      state.clients.delete(controller);
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
