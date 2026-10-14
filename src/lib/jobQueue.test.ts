import { describe, it, expect } from 'vitest';
import { createJobQueue, JobError } from './jobQueue';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const waitForStatus = async (
  queue: ReturnType<typeof createJobQueue>,
  id: string,
  status: 'done' | 'failed',
) => {
  for (let i = 0; i < 100; i++) {
    const record = queue.get(id);
    if (record?.status === status) return record;
    await flush();
  }
  throw new Error(`job ${id} did not reach ${status}`);
};

describe('createJobQueue', () => {
  it('runs a job to done and reports its lifecycle', async () => {
    const queue = createJobQueue();
    const observed: string[] = [];
    const id = queue.enqueue(async () => {
      observed.push(queue.get(id)!.status);
    });
    expect(queue.get(id)?.status).toBe('queued');
    const record = await waitForStatus(queue, id, 'done');
    expect(record.status).toBe('done');
    expect(record.error).toBeUndefined();
    expect(observed).toEqual(['running']);
    expect(queue.size()).toBe(1);
  });

  it('runs jobs FIFO (in enqueue order)', async () => {
    const queue = createJobQueue();
    const order: number[] = [];
    const idA = queue.enqueue(async () => { await flush(); order.push(1); });
    const idB = queue.enqueue(async () => { order.push(2); });
    const idC = queue.enqueue(async () => { order.push(3); });
    await waitForStatus(queue, idC, 'done');
    await waitForStatus(queue, idA, 'done');
    await waitForStatus(queue, idB, 'done');
    expect(order).toEqual([1, 2, 3]);
  });

  it('captures a failure with its message', async () => {
    const queue = createJobQueue();
    const id = queue.enqueue(async () => {
      throw new Error('boom');
    });
    const record = await waitForStatus(queue, id, 'failed');
    expect(record.error).toBe('boom');
    expect(record.code).toBeUndefined();
  });

  it('captures a JobError code for the client', async () => {
    const queue = createJobQueue();
    const id = queue.enqueue(async () => {
      throw new JobError('conflict', 'changed on disk');
    });
    const record = await waitForStatus(queue, id, 'failed');
    expect(record.code).toBe('conflict');
    expect(record.error).toBe('changed on disk');
  });

  it('a failed job does not break the queue for later jobs', async () => {
    const queue = createJobQueue();
    const bad = queue.enqueue(async () => { throw new Error('boom'); });
    const good = queue.enqueue(async () => 42);
    await waitForStatus(queue, bad, 'failed');
    const record = await waitForStatus(queue, good, 'done');
    expect(record.status).toBe('done');
  });

  it('returns undefined for unknown job ids', () => {
    const queue = createJobQueue();
    expect(queue.get('nope')).toBeUndefined();
  });

  it('evicts the oldest terminal record beyond the capacity', async () => {
    const queue = createJobQueue(3);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(queue.enqueue(async () => i));
    }
    await waitForStatus(queue, ids[4], 'done');
    await flush();
    expect(queue.size()).toBeLessThanOrEqual(3);
    // the earliest terminal jobs are gone, the latest survives
    expect(queue.get(ids[0])).toBeUndefined();
    expect(queue.get(ids[4])).toBeDefined();
  });
});
