import { describe, it, expect } from 'vitest';
import { buildSchedule, countdown } from './schedule';
import type { CalEvent } from './types';

const at = (h: number, m = 0, day = 8) => new Date(2026, 9, day, h, m).toISOString();
const ev = (id: string, start: string, end: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id, summary: id, htmlLink: `https://calendar.google.com/${id}`,
  start: { dateTime: start }, end: { dateTime: end }, ...over,
});
const now = new Date(2026, 9, 8, 10, 45);

describe('buildSchedule', () => {
  it('classifies timed events in start order', () => {
    const items = buildSchedule(
      [ev('later', at(16), at(17)), ev('past', at(9), at(9, 15)), ev('next', at(14), at(15)), ev('now', at(10, 30), at(11, 30))],
      now,
    );
    expect(items.map((i) => [i.id, i.phase])).toEqual([
      ['past', 'past'], ['now', 'now'], ['next', 'next'], ['later', 'later'],
    ]);
  });

  it('puts all-day events first', () => {
    const allDay: CalEvent = { id: 'offsite', summary: 'Offsite', htmlLink: 'x', start: { date: '2026-10-08' }, end: { date: '2026-10-09' } };
    const items = buildSchedule([ev('a', at(9), at(10)), allDay], now);
    expect(items[0]).toMatchObject({ id: 'offsite', phase: 'allday', start: null });
  });

  it('hides cancelled and declined events', () => {
    const items = buildSchedule([
      ev('cancelled', at(12), at(13), { status: 'cancelled' }),
      ev('declined', at(12), at(13), { attendees: [{ self: true, responseStatus: 'declined' }] }),
      ev('accepted', at(12), at(13), { attendees: [{ self: true, responseStatus: 'accepted' }] }),
    ], now);
    expect(items.map((i) => i.id)).toEqual(['accepted']);
  });

  // Review Focus 4
  it('dedupes the same event from two calendars', () => {
    const items = buildSchedule([ev('dup', at(12), at(13)), ev('dup', at(12), at(13))], now);
    expect(items).toHaveLength(1);
  });

  it('labels events without a summary as (busy)', () => {
    expect(buildSchedule([ev('x', at(12), at(13), { summary: undefined })], now)[0].title).toBe('(busy)');
  });

  it('treats an event that started yesterday and is still running as now', () => {
    expect(buildSchedule([ev('overnight', at(22, 0, 7), at(11))], now)[0].phase).toBe('now');
  });
});

describe('countdown', () => {
  it('formats hours and minutes', () => {
    expect(countdown(now, new Date(2026, 9, 8, 14, 15))).toBe('in 3h 30m');
  });
  it('formats minutes only under an hour', () => {
    expect(countdown(now, new Date(2026, 9, 8, 11, 10))).toBe('in 25m');
  });
});
