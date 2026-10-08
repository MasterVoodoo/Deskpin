import { writable, type Readable } from 'svelte/store';
import { AuthRequiredError, type Google } from './google';
import { writePriority, type Priority } from './labels';
import { dueFromKey, localDateKey } from './today';
import type { Calendar, Snapshot, Task, TaskList, TaskPatch } from './types';

export const VISIBLE_MS = 15_000;
export const HIDDEN_MS = 60_000;
export const META_MS = 10 * 60_000;
export const HEARTBEAT_MS = 5_000;
export const WAKE_GAP_MS = 30_000;

export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'auth';

export interface SyncState {
  snapshot: Snapshot | null;
  status: SyncStatus;
}

export interface SyncDeps {
  google: Google;
  now: () => Date;
  loadCache: () => Promise<Snapshot | null>;
  saveCache: (s: Snapshot) => Promise<void>;
}

export function dayBounds(now: Date): [Date, Date] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start, end];
}

export function createSync(deps: SyncDeps) {
  const state = writable<SyncState>({ snapshot: null, status: 'syncing' });

  let lists: TaskList[] = [];
  let calendars: Calendar[] = [];
  let metaAt = -Infinity;
  let visible = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lastBeat = 0;
  let inFlight: Promise<void> | null = null;
  let again = false;

  async function fetchAll(): Promise<Snapshot> {
    const now = deps.now();
    if (now.getTime() - metaAt > META_MS) {
      [lists, calendars] = await Promise.all([deps.google.listTaskLists(), deps.google.listCalendars()]);
      metaAt = now.getTime();
    }
    const [start, end] = dayBounds(now);
    const [taskGroups, eventGroups] = await Promise.all([
      Promise.all(lists.map(async (l) => (await deps.google.listTasks(l.id)).map((t) => ({ ...t, listId: l.id })))),
      Promise.all(calendars.map((c) => deps.google.listEvents(c.id, start, end))),
    ]);
    return { tasks: taskGroups.flat(), events: eventGroups.flat(), syncedAt: now.toISOString() };
  }

  async function runPoll() {
    state.update((s) => ({ ...s, status: 'syncing' }));
    try {
      const snapshot = await fetchAll();
      state.set({ snapshot, status: 'synced' });
      await deps.saveCache(snapshot).catch(() => {});
    } catch (e) {
      // Any failure keeps the last snapshot; rate limits and 5xx simply wait for the next poll.
      state.update((s) => ({ ...s, status: e instanceof AuthRequiredError ? 'auth' : 'offline' }));
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void poll(), visible ? VISIBLE_MS : HIDDEN_MS);
  }

  /** Coalesces: a poll requested while one is running makes it run once more. Never rejects. */
  function poll(): Promise<void> {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        again = false;
        await runPoll();
      } while (again);
      inFlight = null;
      schedule();
    })();
    return inFlight;
  }

  async function start() {
    const cached = await deps.loadCache().catch(() => null);
    if (cached) state.set({ snapshot: cached, status: 'syncing' });
    lastBeat = deps.now().getTime();
    // Timers do not fire while the PC sleeps; a big gap between beats means we just woke up.
    heartbeat = setInterval(() => {
      const t = deps.now().getTime();
      if (t - lastBeat > WAKE_GAP_MS) void poll();
      lastBeat = t;
    }, HEARTBEAT_MS);
    await poll();
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
  }

  function setVisible(v: boolean) {
    visible = v;
    if (v) void poll();
    else schedule();
  }

  function patchLocal(id: string, fn: (t: Task) => Task) {
    state.update((s) =>
      s.snapshot ? { ...s, snapshot: { ...s.snapshot, tasks: s.snapshot.tasks.map((t) => (t.id === id ? fn(t) : t)) } } : s,
    );
  }

  /** Runs an API edit, then always re-polls so the view matches Google (reverting on failure). */
  async function edit(apply: () => Promise<unknown>) {
    try {
      await apply();
    } finally {
      await poll();
    }
  }

  return {
    state: state as Readable<SyncState>,
    start,
    stop,
    poll,
    setVisible,

    complete(t: Task, done: boolean) {
      patchLocal(t.id, (x) => ({
        ...x,
        status: done ? 'completed' : 'needsAction',
        completed: done ? deps.now().toISOString() : undefined,
      }));
      const patch: TaskPatch = done ? { status: 'completed' } : { status: 'needsAction', completed: null };
      return edit(() => deps.google.patchTask(t.listId, t.id, patch));
    },

    setPriority(t: Task, p: Priority) {
      patchLocal(t.id, (x) => ({ ...x, notes: writePriority(x.notes, p) }));
      return edit(async () => {
        const fresh = await deps.google.getTask(t.listId, t.id);
        await deps.google.patchTask(t.listId, t.id, { notes: writePriority(fresh.notes, p) });
      });
    },

    update(t: Task, patch: { title?: string; notes?: string; dueKey?: string | null }) {
      const body: TaskPatch = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.notes !== undefined) body.notes = patch.notes;
      if (patch.dueKey !== undefined) body.due = patch.dueKey ? dueFromKey(patch.dueKey) : null;
      return edit(() => deps.google.patchTask(t.listId, t.id, body));
    },

    remove(t: Task) {
      return edit(() => deps.google.deleteTask(t.listId, t.id));
    },

    add(title: string) {
      return edit(() =>
        deps.google.insertTask('@default', { title, due: dueFromKey(localDateKey(deps.now())) }),
      );
    },
  };
}
