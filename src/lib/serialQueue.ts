// A FIFO executor that runs async tasks strictly one at a time. Used on the
// server as the process-wide storage write lock (see storage/index.ts) and on
// the client to send saves in order, never overlapping (see ClientPage).

export interface SerialQueue {
  // Runs `task` after every previously queued task has settled; resolves or
  // rejects with the task's own outcome. A failing task never blocks the
  // tasks queued behind it.
  run<T>(task: () => Promise<T>): Promise<T>;
  // Resolves once every task queued so far has settled.
  whenIdle(): Promise<void>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
    whenIdle(): Promise<void> {
      return tail.then(() => undefined);
    },
  };
}
