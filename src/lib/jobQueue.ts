// Minimal in-process background job queue for the server. Jobs run FIFO off
// the request path: a route enqueues a job and returns its id immediately, the
// client polls the job's status. Module-level state is shared across route
// handler invocations because the app runs on a single custom Node server
// (same pattern as the SSE watcher registry in api/events/route.ts).

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRecord {
  id: string;
  status: JobStatus;
  code?: string;   // machine-readable failure code, e.g. 'conflict' | 'not-found'
  error?: string;  // human-readable failure message
  createdAt: number;
  updatedAt: number;
}

export interface JobQueue {
  enqueue<T>(fn: () => Promise<T>): string;
  get(id: string): JobRecord | undefined;
  size(): number;
}

// A job failure that carries a machine-readable code (surfaced to the client
// as JobRecord.code).
export class JobError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'JobError';
    this.code = code;
  }
}

const DEFAULT_MAX_RECORDS = 200;

export function createJobQueue(maxRecords: number = DEFAULT_MAX_RECORDS): JobQueue {
  const jobs = new Map<string, JobRecord>();
  let chain: Promise<void> = Promise.resolve();
  let counter = 0;

  // Evict the oldest terminal records beyond capacity. Queued/running jobs
  // are never evicted; `exceptId` (the job that just settled) is kept so the
  // client polling it still gets a result.
  const evictOldestTerminal = (exceptId?: string) => {
    while (jobs.size > maxRecords) {
      let evicted = false;
      for (const [id, record] of jobs) {
        if (id === exceptId) continue;
        if (record.status !== 'queued' && record.status !== 'running') {
          jobs.delete(id);
          evicted = true;
          break;
        }
      }
      if (!evicted) break;
    }
  };

  return {
    enqueue<T>(fn: () => Promise<T>): string {
      const id = `job_${Date.now().toString(36)}_${(counter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const record: JobRecord = {
        id,
        status: 'queued',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      jobs.set(id, record);
      evictOldestTerminal();
      chain = chain.then(async () => {
        record.status = 'running';
        record.updatedAt = Date.now();
        try {
          await fn();
          record.status = 'done';
        } catch (err) {
          record.status = 'failed';
          record.error = err instanceof Error ? err.message : String(err);
          if (err instanceof JobError) {
            record.code = err.code;
          }
        }
        record.updatedAt = Date.now();
        evictOldestTerminal(record.id);
      });
      return id;
    },

    get(id: string): JobRecord | undefined {
      const record = jobs.get(id);
      return record ? { ...record } : undefined;
    },

    size(): number {
      return jobs.size;
    },
  };
}

// Shared queue for the API routes.
export const defaultJobQueue = createJobQueue();
