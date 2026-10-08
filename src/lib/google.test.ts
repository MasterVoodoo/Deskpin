import { describe, it, expect, vi } from 'vitest';
import { createGoogle, AuthRequiredError, HttpError, type FetchFn } from './google';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const headers = (init: RequestInit | undefined) => init?.headers as Record<string, string>;

describe('createGoogle', () => {
  it('sends the bearer token and follows pagination', async () => {
    const fetchFn = vi.fn<FetchFn>()
      .mockResolvedValueOnce(json({ items: [{ id: '1' }], nextPageToken: 'n' }))
      .mockResolvedValueOnce(json({ items: [{ id: '2' }] }));
    const g = createGoogle(fetchFn, async () => 'tok');

    expect((await g.listTasks('L1')).map((t) => t.id)).toEqual(['1', '2']);
    const [url1, init1] = fetchFn.mock.calls[0];
    expect(url1).toContain('https://tasks.googleapis.com/tasks/v1/lists/L1/tasks');
    expect(url1).toContain('showCompleted=true');
    expect(url1).toContain('showHidden=true');
    expect(headers(init1).Authorization).toBe('Bearer tok');
    expect(fetchFn.mock.calls[1][0]).toContain('pageToken=n');
  });

  it('retries once with a forced token refresh on 401', async () => {
    const fetchFn = vi.fn<FetchFn>()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(json({ items: [] }));
    const getToken = vi.fn(async (force?: boolean) => (force ? 'new' : 'old'));
    await createGoogle(fetchFn, getToken).listTaskLists();

    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(headers(fetchFn.mock.calls[1][1]).Authorization).toBe('Bearer new');
  });

  it('throws AuthRequiredError when 401 persists', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => new Response('', { status: 401 }));
    await expect(createGoogle(fetchFn, async () => 't').listTaskLists()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws HttpError with the status on server errors', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => new Response('', { status: 503 }));
    await expect(createGoogle(fetchFn, async () => 't').listTaskLists()).rejects.toMatchObject({ status: 503 });
    await expect(createGoogle(fetchFn, async () => 't').listTaskLists()).rejects.toBeInstanceOf(HttpError);
  });

  it('handles 204 on delete', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => new Response(null, { status: 204 }));
    await createGoogle(fetchFn, async () => 't').deleteTask('L1', 'T1');
    expect(fetchFn.mock.calls[0][1]?.method).toBe('DELETE');
    expect(fetchFn.mock.calls[0][0]).toBe('https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/T1');
  });

  it('patchTask sends a JSON PATCH body', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json({ id: 'T1' }));
    await createGoogle(fetchFn, async () => 't').patchTask('L1', 'T1', { status: 'completed' });
    const init = fetchFn.mock.calls[0][1]!;
    expect(init.method).toBe('PATCH');
    expect(headers(init)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'completed' });
  });

  it('listCalendars keeps only selected calendars', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json({ items: [{ id: 'a', selected: true }, { id: 'b' }] }));
    expect((await createGoogle(fetchFn, async () => 't').listCalendars()).map((c) => c.id)).toEqual(['a']);
  });

  it('listEvents expands recurring events within the given bounds', async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json({ items: [] }));
    const min = new Date('2026-10-08T07:00:00.000Z');
    const max = new Date('2026-10-09T07:00:00.000Z');
    await createGoogle(fetchFn, async () => 't').listEvents('me@example.com', min, max);
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.pathname).toBe('/calendar/v3/calendars/me%40example.com/events');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('orderBy')).toBe('startTime');
    expect(url.searchParams.get('timeMin')).toBe(min.toISOString());
    expect(url.searchParams.get('timeMax')).toBe(max.toISOString());
  });
});
