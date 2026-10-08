import type { CalEvent } from './types';

export type Phase = 'allday' | 'past' | 'now' | 'next' | 'later';

export interface ScheduleItem {
  id: string;
  title: string;
  start: Date | null;
  end: Date | null;
  phase: Phase;
  link: string;
}

const declined = (e: CalEvent) =>
  e.attendees?.some((a) => a.self && a.responseStatus === 'declined') ?? false;

const item = (e: CalEvent, start: Date | null, end: Date | null, phase: Phase): ScheduleItem => ({
  id: e.id, title: e.summary?.trim() || '(busy)', start, end, phase, link: e.htmlLink,
});

export function buildSchedule(events: CalEvent[], now: Date): ScheduleItem[] {
  // The same event can arrive from several calendars (shared invites). Only my own calendar's copy
  // carries my response, so a decline on any copy hides the event; then keep one copy per id.
  const declinedIds = new Set(events.filter(declined).map((e) => e.id));
  const unique = [...new Map(events.filter((e) => !declinedIds.has(e.id)).map((e) => [e.id, e])).values()];
  const live = unique.filter((e) => e.status !== 'cancelled');

  const allDay = live.filter((e) => e.start.date).map((e) => item(e, null, null, 'allday'));

  let nextGiven = false;
  const timed = live
    .filter((e) => e.start.dateTime)
    .map((e) => ({ e, start: new Date(e.start.dateTime!), end: new Date(e.end.dateTime ?? e.start.dateTime!) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ e, start, end }) => {
      let phase: Phase;
      if (end <= now) phase = 'past';
      else if (start <= now) phase = 'now';
      else if (!nextGiven) { phase = 'next'; nextGiven = true; }
      else phase = 'later';
      return item(e, start, end, phase);
    });

  return [...allDay, ...timed];
}

export function countdown(now: Date, to: Date): string {
  const mins = Math.max(0, Math.round((to.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `in ${h}h ${mins % 60}m` : `in ${mins}m`;
}
