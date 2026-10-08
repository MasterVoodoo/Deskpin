import { describe, it, expect } from 'vitest';
import { buildToday, localDateKey, dueKey, dueFromKey, daysBetween } from './today';
import type { Task } from './types';

// Tests run with TZ=America/Los_Angeles (vitest.config.ts).
const task = (over: Partial<Task>): Task => ({
  id: over.id ?? over.title ?? 'x',
  listId: 'L1',
  title: 'x',
  status: 'needsAction',
  ...over,
});
const due = (key: string) => dueFromKey(key);
const now = new Date(2026, 9, 8, 10, 0); // Oct 8, 10:00 local

describe('date keys', () => {
  it('localDateKey uses the local date, not UTC', () => {
    // 23:30 PDT on Oct 8 is 06:30 UTC on Oct 9
    expect(localDateKey(new Date(2026, 9, 8, 23, 30))).toBe('2026-10-08');
  });
  it('dueKey reads the date part with no timezone conversion', () => {
    // new Date('2026-10-08T00:00:00Z') is Oct 7 in Los Angeles; dueKey must still say Oct 8
    expect(dueKey({ due: '2026-10-08T00:00:00.000Z' })).toBe('2026-10-08');
    expect(dueKey({})).toBeNull();
  });
  it('dueFromKey builds the Tasks API due format', () => {
    expect(dueFromKey('2026-10-08')).toBe('2026-10-08T00:00:00.000Z');
  });
  it('daysBetween counts calendar days', () => {
    expect(daysBetween('2026-10-06', '2026-10-08')).toBe(2);
  });
});

describe('buildToday', () => {
  it('keeps due-today and overdue; drops future, undated, deleted, completed', () => {
    const tasks = [
      task({ id: 'today', due: due('2026-10-08') }),
      task({ id: 'over', due: due('2026-10-05') }),
      task({ id: 'future', due: due('2026-10-09') }),
      task({ id: 'undated' }),
      task({ id: 'deleted', due: due('2026-10-08'), deleted: true }),
      task({ id: 'doneOld', due: due('2026-10-08'), status: 'completed', completed: '2026-10-01T10:00:00.000Z' }),
    ];
    expect(buildToday(tasks, now).open.map((t) => t.id).sort()).toEqual(['over', 'today']);
  });

  it('sorts overdue oldest-first, then P1, P2, P3, unlabeled, then by title', () => {
    const tasks = [
      task({ id: 'b-plain', title: 'b plain', due: due('2026-10-08') }),
      task({ id: 'a-plain', title: 'a plain', due: due('2026-10-08') }),
      task({ id: 'p3', title: 'thing', notes: '[P3]', due: due('2026-10-08') }),
      task({ id: 'p1', title: 'z P1', due: due('2026-10-08') }),
      task({ id: 'p2', title: 'y', notes: '[P2]', due: due('2026-10-08') }),
      task({ id: 'over-new', title: 'over new', notes: '[P1]', due: due('2026-10-06') }),
      task({ id: 'over-old', title: 'over old', due: due('2026-10-03') }),
    ];
    expect(buildToday(tasks, now).open.map((t) => t.id)).toEqual([
      'over-old', 'over-new', 'p1', 'p2', 'p3', 'a-plain', 'b-plain',
    ]);
  });

  it('done today uses the local completion date, newest first', () => {
    const tasks = [
      // 06:00Z Oct 8 = 23:00 Oct 7 in LA: not today
      task({ id: 'yesterday', status: 'completed', completed: '2026-10-08T06:00:00.000Z' }),
      task({ id: 'morning', status: 'completed', completed: '2026-10-08T15:00:00.000Z' }),
      task({ id: 'later', status: 'completed', completed: '2026-10-08T18:00:00.000Z' }),
    ];
    expect(buildToday(tasks, now).done.map((t) => t.id)).toEqual(['later', 'morning']);
  });

  // Review Focus 2
  it('handles empty and missing titles without throwing', () => {
    const tasks = [
      task({ id: 'empty', title: '', due: due('2026-10-08') }),
      task({ id: 'missing', title: undefined, due: due('2026-10-08') }),
      task({ id: 'named', title: 'named', due: due('2026-10-08') }),
    ];
    expect(buildToday(tasks, now).open).toHaveLength(3);
  });

  // Review Focus 3
  it('rolls over at midnight', () => {
    const tasks = [
      task({ id: 'was-today', due: due('2026-10-08') }),
      task({ id: 'done', status: 'completed', completed: '2026-10-08T18:00:00.000Z' }),
    ];
    const afterMidnight = new Date(2026, 9, 9, 0, 5);
    const view = buildToday(tasks, afterMidnight);
    expect(view.open.map((t) => t.id)).toEqual(['was-today']);
    expect(daysBetween(dueKey(view.open[0])!, localDateKey(afterMidnight))).toBe(1);
    expect(view.done).toEqual([]);
  });
});
