import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createSync, VISIBLE_MS, HIDDEN_MS, HEARTBEAT_MS, META_MS } from './sync';
import { AuthRequiredError, type Google } from './google';
import type { GTask, Snapshot, Task } from './types';

const today = '2026-10-08T00:00:00.000Z';

function fakeGoogle(tasks: GTask[] = []) {
  return {
    listTaskLists: vi.fn(async () => [{ id: 'L1', title: 'My Tasks' }]),
    listTasks: vi.fn(async (_listId: string): Promise<GTask[]> => tasks.map((t) => ({ ...t }))),
    getTask: vi.fn(async (_l: string, id: string) => ({ ...tasks.find((t) => t.id === id)! })),
    insertTask: vi.fn(async (..._args: unknown[]) => ({}) as GTask),
    patchTask: vi.fn(async (..._args: unknown[]) => ({}) as GTask),
    deleteTask: vi.fn(async (..._args: unknown[]) => undefined),
    listCalendars: vi.fn(async () => [{ id: 'C1', selected: true }]),
    listEvents: vi.fn(async (_id: string, _min: Date, _max: Date) => []),
  };
}

function setup(google = fakeGoogle(), loadCache: () => Promise<Snapshot | null> = async () => null) {
  const saveCache = vi.fn(async (_s: Snapshot) => {});
  const sync = createSync({ google: google as unknown as Google, now: () => new Date(), loadCache, saveCache });
  return { sync, google, saveCache };
}

const t1: GTask = { id: 't1', title: 'Call', notes: 'call back', status: 'needsAction', due: today };
const asTask = (t: GTask): Task => ({ ...t, listId: 'L1' });

let stopFns: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 10, 0));
});
afterEach(() => {
  stopFns.forEach((f) => f());
  stopFns = [];
  vi.useRealTimers();
});
async function started(google = fakeGoogle([t1]), loadCache?: () => Promise<Snapshot | null>) {
  const s = setup(google, loadCache);
  stopFns.push(s.sync.stop);
  await s.sync.start();
  return s;
}

describe('createSync', () => {
  it('fetches all lists and calendars, tags tasks with listId, saves cache', async () => {
    const { sync, saveCache } = await started();
    const state = get(sync.state);
    expect(state.status).toBe('synced');
    expect(state.snapshot!.tasks).toEqual([asTask(t1)]);
    expect(saveCache).toHaveBeenCalledTimes(1);
  });

  it('shows the cached snapshot while the first poll runs', async () => {
    const cache: Snapshot = { tasks: [asTask(t1)], events: [], syncedAt: 'x' };
    const google = fakeGoogle();
    google.listTasks.mockImplementation(() => new Promise(() => {}));
    const { sync } = setup(google, async () => cache);
    stopFns.push(sync.stop);
    void sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(get(sync.state)).toEqual({ snapshot: cache, status: 'syncing' });
  });

  // Review Focus 5
  it('starts normally when the cache cannot be loaded', async () => {
    const { sync } = await started(fakeGoogle([t1]), async () => { throw new Error('corrupt'); });
    expect(get(sync.state).status).toBe('synced');
  });

  it('polls every 15 s while visible and every 60 s while hidden', async () => {
    const { sync, google } = await started();
    expect(google.listTasks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(VISIBLE_MS);
    expect(google.listTasks).toHaveBeenCalledTimes(2);

    sync.setVisible(false);
    await vi.advanceTimersByTimeAsync(VISIBLE_MS);
    expect(google.listTasks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HIDDEN_MS - VISIBLE_MS);
    expect(google.listTasks).toHaveBeenCalledTimes(3);
  });

  it('polls immediately when shown', async () => {
    const { sync, google } = await started();
    sync.setVisible(false);
    sync.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(google.listTasks).toHaveBeenCalledTimes(2);
  });

  it('polls immediately after waking from sleep', async () => {
    const { google } = await started();
    vi.setSystemTime(Date.now() + 10 * 60_000); // clock jumped, timers did not fire
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(google.listTasks).toHaveBeenCalledTimes(2);
  });

  it('refreshes task lists and calendars only every 10 minutes', async () => {
    const { google } = await started();
    await vi.advanceTimersByTimeAsync(VISIBLE_MS * 3);
    expect(google.listTaskLists).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(META_MS);
    expect(google.listTaskLists).toHaveBeenCalledTimes(2);
    expect(google.listCalendars).toHaveBeenCalledTimes(2);
  });

  // Review Focus 3
  it('fetches the new day of events after midnight', async () => {
    vi.setSystemTime(new Date(2026, 9, 8, 23, 59, 50));
    const { google } = await started();
    await vi.advanceTimersByTimeAsync(VISIBLE_MS);
    const [, min, max] = google.listEvents.mock.calls.at(-1)!;
    expect(min).toEqual(new Date(2026, 9, 9));
    expect(max).toEqual(new Date(2026, 9, 10));
  });

  it('sets status auth on AuthRequiredError and keeps the snapshot', async () => {
    const cache: Snapshot = { tasks: [asTask(t1)], events: [], syncedAt: 'x' };
    const google = fakeGoogle();
    google.listTaskLists.mockRejectedValue(new AuthRequiredError());
    const { sync } = await started(google, async () => cache);
    expect(get(sync.state)).toEqual({ snapshot: cache, status: 'auth' });
  });

  it('sets status offline on network errors', async () => {
    const google = fakeGoogle();
    google.listTaskLists.mockRejectedValue(new TypeError('Failed to fetch'));
    const { sync } = await started(google);
    expect(get(sync.state).status).toBe('offline');
  });

  it('runs one more poll when asked during an in-flight poll', async () => {
    const { sync, google } = await started();
    let release!: () => void;
    google.listTasks.mockImplementationOnce(() => new Promise((r) => (release = () => r([]))));
    void sync.poll();
    const second = sync.poll();
    release();
    await second;
    expect(google.listTasks).toHaveBeenCalledTimes(3);
  });

  it('complete is optimistic, patches, then re-polls', async () => {
    const { sync, google } = await started();
    const pending = sync.complete(asTask(t1), true);
    expect(get(sync.state).snapshot!.tasks[0].status).toBe('completed');
    await pending;
    expect(google.patchTask).toHaveBeenCalledWith('L1', 't1', { status: 'completed' });
    expect(google.listTasks).toHaveBeenCalledTimes(2);
  });

  it('un-completing clears the completed timestamp', async () => {
    const { sync, google } = await started();
    await sync.complete(asTask(t1), false);
    expect(google.patchTask).toHaveBeenCalledWith('L1', 't1', { status: 'needsAction', completed: null });
  });

  it('a failed edit rejects and the re-poll reverts the optimistic change', async () => {
    const { sync, google } = await started();
    google.patchTask.mockRejectedValueOnce(new TypeError('offline'));
    await expect(sync.complete(asTask(t1), true)).rejects.toThrow('offline');
    expect(get(sync.state).snapshot!.tasks[0].status).toBe('needsAction');
  });

  it('setPriority rewrites the latest notes from Google', async () => {
    const { sync, google } = await started();
    await sync.setPriority(asTask(t1), 1);
    expect(google.getTask).toHaveBeenCalledWith('L1', 't1');
    expect(google.patchTask).toHaveBeenCalledWith('L1', 't1', { notes: '[P1]\ncall back' });
  });

  it('update sends only the given fields; null dueKey clears the due date', async () => {
    const { sync, google } = await started();
    await sync.update(asTask(t1), { title: 'New', dueKey: null });
    expect(google.patchTask).toHaveBeenCalledWith('L1', 't1', { title: 'New', due: null });
    await sync.update(asTask(t1), { notes: 'n', dueKey: '2026-10-09' });
    expect(google.patchTask).toHaveBeenCalledWith('L1', 't1', { notes: 'n', due: '2026-10-09T00:00:00.000Z' });
  });

  it('add inserts into the default list due today', async () => {
    const { sync, google } = await started();
    await sync.add('Buy milk');
    expect(google.insertTask).toHaveBeenCalledWith('@default', { title: 'Buy milk', due: today });
  });

  it('remove deletes the task', async () => {
    const { sync, google } = await started();
    await sync.remove(asTask(t1));
    expect(google.deleteTask).toHaveBeenCalledWith('L1', 't1');
  });
});
