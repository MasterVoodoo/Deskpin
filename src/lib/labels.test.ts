import { describe, it, expect } from 'vitest';
import { parsePriority, writePriority, stripPriority, nextPriority } from './labels';

describe('parsePriority', () => {
  it.each([
    ['[P1] in notes', 'Task', '[P1]\nmore', 1],
    ['bare p2 in title', 'p2 fix bug', '', 2],
    ['P3 in title', 'Email Ana P3', undefined, 3],
    ['priority: high in notes', 'Task', 'Priority: High', 1],
    ['priority:medium without space', 'Task', 'priority:medium', 2],
    ['low priority in title', 'Low priority: tidy desk', '', 3],
    ['highest of several wins', 'P3 thing', 'priority: high', 1],
  ] as const)('%s', (_, title, notes, want) => {
    expect(parsePriority(title, notes)).toBe(want);
  });

  it.each([
    ['bare "high"', 'Call high school', ''],
    ['"urgent"', 'urgent stuff', 'urgent'],
    ['p10', 'Read p10 of manual', ''],
    ['mp3', 'Download mp3', ''],
    ['label on second notes line', 'Task', 'first\n[P1]'],
  ] as const)('ignores %s', (_, title, notes) => {
    expect(parsePriority(title, notes)).toBeNull();
  });

  it('canonical notes label overrides the title', () => {
    expect(parsePriority('Call P1 client', '[P3]')).toBe(3);
  });

  it('handles CRLF notes', () => {
    expect(parsePriority('Task', '[P2]\r\nbody')).toBe(2);
  });

  it('handles a missing title', () => {
    expect(parsePriority(undefined, '[P1]')).toBe(1);
  });
});

describe('writePriority', () => {
  it('adds a label to empty notes', () => expect(writePriority(undefined, 1)).toBe('[P1]'));
  it('prepends the label and keeps the body', () =>
    expect(writePriority('call back', 2)).toBe('[P2]\ncall back'));
  it('replaces an existing label', () =>
    expect(writePriority('[P1]\ncall back', 3)).toBe('[P3]\ncall back'));
  it('removes the label', () => expect(writePriority('[P1]\ncall back', null)).toBe('call back'));
  it('turns label-only notes into empty notes', () => expect(writePriority('[P2]', null)).toBe(''));
  it('keeps a CRLF body intact', () =>
    expect(writePriority('[P1]\r\na\r\nb', 2)).toBe('[P2]\na\r\nb'));
  it('leaves a non-canonical first line alone', () =>
    expect(writePriority('priority: high', 3)).toBe('[P3]\npriority: high'));
});

describe('stripPriority / nextPriority', () => {
  it('strips the label line', () => expect(stripPriority('[P1]\nbody')).toBe('body'));
  it('cycles P1 → P2 → P3 → none → P1', () => {
    expect([1, 2, 3, null].map((p) => nextPriority(p as 1 | 2 | 3 | null))).toEqual([2, 3, null, 1]);
  });
});
