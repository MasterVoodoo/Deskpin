import type { CalEvent, Calendar, GTask, TaskList, TaskPatch } from './types';

export class AuthRequiredError extends Error {
  constructor() {
    super('auth_required');
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type TokenFn = (force?: boolean) => Promise<string>;

const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const CAL = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;

export function createGoogle(fetchFn: FetchFn, getToken: TokenFn) {
  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const send = async (force: boolean) =>
      fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${await getToken(force)}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await send(false);
    if (res.status === 401) res = await send(true);
    if (res.status === 401) throw new AuthRequiredError();
    if (!res.ok) throw new HttpError(res.status, `${method} ${url} failed: ${res.status}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async function pages<T>(base: string): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(base);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await call<{ items?: T[]; nextPageToken?: string }>('GET', url.toString());
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  const taskUrl = (listId: string, id?: string) =>
    `${TASKS}/lists/${enc(listId)}/tasks${id ? `/${enc(id)}` : ''}`;

  return {
    listTaskLists: () => pages<TaskList>(`${TASKS}/users/@me/lists?maxResults=100`),
    listTasks: (listId: string) =>
      pages<GTask>(`${taskUrl(listId)}?showCompleted=true&showHidden=true&maxResults=100`),
    getTask: (listId: string, id: string) => call<GTask>('GET', taskUrl(listId, id)),
    insertTask: (listId: string, body: TaskPatch) => call<GTask>('POST', taskUrl(listId), body),
    patchTask: (listId: string, id: string, patch: TaskPatch) =>
      call<GTask>('PATCH', taskUrl(listId, id), patch),
    deleteTask: (listId: string, id: string) => call<void>('DELETE', taskUrl(listId, id)),
    listCalendars: async () =>
      (await pages<Calendar>(`${CAL}/users/me/calendarList?maxResults=250`)).filter((c) => c.selected),
    listEvents: (calendarId: string, timeMin: Date, timeMax: Date) =>
      pages<CalEvent>(
        `${CAL}/calendars/${enc(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=250` +
          `&timeMin=${enc(timeMin.toISOString())}&timeMax=${enc(timeMax.toISOString())}`,
      ),
  };
}

export type Google = ReturnType<typeof createGoogle>;
