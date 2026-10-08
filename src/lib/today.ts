import type { Task } from './types';
import { parsePriority } from './labels';

const pad = (n: number) => String(n).padStart(2, '0');

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Google stores due as midnight UTC; the date part is the real value. Never convert to local. */
export function dueKey(t: { due?: string }): string | null {
  return t.due ? t.due.slice(0, 10) : null;
}

export function dueFromKey(key: string): string {
  return `${key}T00:00:00.000Z`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000);
}

export interface TodayView {
  open: Task[];
  done: Task[];
}

export function buildToday(tasks: Task[], now: Date): TodayView {
  const today = localDateKey(now);
  const live = tasks.filter((t) => !t.deleted);

  const open = live.filter((t) => {
    const key = dueKey(t);
    return t.status === 'needsAction' && key !== null && key <= today;
  });
  const done = live.filter(
    (t) => t.status === 'completed' && t.completed && localDateKey(new Date(t.completed)) === today,
  );

  const rank = (t: Task) => parsePriority(t.title, t.notes) ?? 4;
  open.sort((a, b) => {
    const da = dueKey(a)!, db = dueKey(b)!;
    const ao = da < today, bo = db < today;
    if (ao !== bo) return ao ? -1 : 1;
    if (ao && da !== db) return da < db ? -1 : 1;
    const pr = rank(a) - rank(b);
    if (pr) return pr;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
  done.sort((a, b) => b.completed!.localeCompare(a.completed!));

  return { open, done };
}
