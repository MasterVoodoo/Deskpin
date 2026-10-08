<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { createSync } from '$lib/sync';
  import { buildToday } from '$lib/today';
  import { buildSchedule } from '$lib/schedule';
  import * as bridge from '$lib/tauri';
  import { AuthRequiredError } from '$lib/google';
  import Header from '$lib/components/Header.svelte';
  import ScheduleStrip from '$lib/components/ScheduleStrip.svelte';
  import TaskRow from '$lib/components/TaskRow.svelte';
  import TaskEditor from '$lib/components/TaskEditor.svelte';
  import QuickAdd from '$lib/components/QuickAdd.svelte';
  import { nextPriority, parsePriority } from '$lib/labels';
  import type { Task } from '$lib/types';

  const sync = createSync({
    google: bridge.google,
    now: () => new Date(),
    loadCache: bridge.loadCache,
    saveCache: bridge.saveCache,
  });
  const syncState = sync.state;

  let now = $state(new Date());
  let mode = $state('top');
  let showDone = $state(false);
  let signingIn = $state(false);
  let errors = $state<Record<string, string>>({});
  let editing = $state<string | null>(null);

  const snapshot = $derived($syncState.snapshot);
  const view = $derived(snapshot ? buildToday(snapshot.tasks, now) : { open: [], done: [] });
  const schedule = $derived(snapshot ? buildSchedule(snapshot.events, now) : []);

  /** Runs an action; on failure shows the message under the given key and returns false. */
  async function guard(key: string, fn: () => Promise<unknown>): Promise<boolean> {
    delete errors[key];
    try {
      await fn();
      return true;
    } catch (e) {
      errors[key] =
        e instanceof AuthRequiredError
          ? 'Signed out of Google. Sign in again to save.'
          : e instanceof Error
            ? e.message
            : String(e);
      return false;
    }
  }

  async function saveEdit(task: Task, patch: { title: string; notes: string; dueKey: string | null }) {
    if (await guard(task.id, () => sync.update(task, patch))) editing = null;
  }

  async function deleteTask(task: Task) {
    if (await guard(task.id, () => sync.remove(task))) editing = null;
  }

  const cycle = (task: Task) =>
    guard(task.id, () => sync.setPriority(task, nextPriority(parsePriority(task.title, task.notes))));

  async function signIn() {
    signingIn = true;
    await guard('signin', bridge.signIn);
    signingIn = false;
    await sync.poll();
  }

  onMount(() => {
    const tick = setInterval(() => (now = new Date()), 30_000);
    const unlisteners = [
      bridge.onVisibility((v) => sync.setVisible(v)),
      bridge.onMode((m) => (mode = m)),
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) void sync.poll();
      }),
    ];
    bridge.getMode().then((m) => (mode = m));
    void sync.start();
    return () => {
      clearInterval(tick);
      sync.stop();
      unlisteners.forEach((p) => p.then((off) => off()));
    };
  });
</script>

<main class="note">
  <Header
    {now}
    status={$syncState.status}
    syncedAt={snapshot?.syncedAt}
    {mode}
    onToggleMode={() => bridge.toggleMode()}
    onHide={() => bridge.hideWindow()}
  />

  {#if $syncState.status === 'auth'}
    <div class="banner">
      {snapshot ? 'Signed out of Google.' : 'Connect your Google account to see your tasks.'}
      <button class="primary" onclick={signIn} disabled={signingIn}>
        {signingIn ? 'Waiting for browser…' : snapshot ? 'Sign in again' : 'Sign in with Google'}
      </button>
      {#if errors.signin}<p class="err">{errors.signin}</p>{/if}
    </div>
  {/if}

  <ScheduleStrip items={schedule} {now} onOpen={(url) => bridge.openUrl(url)} />

  <section class="tasks">
    <h2>Tasks</h2>
    {#each view.open as task (task.id)}
      {#if editing === task.id}
        <TaskEditor
          {task}
          error={errors[task.id]}
          onSave={(p) => saveEdit(task, p)}
          onDelete={() => deleteTask(task)}
          onClose={() => (editing = null)}
        />
      {:else}
        <TaskRow
          {task}
          {now}
          error={errors[task.id]}
          onToggle={() => guard(task.id, () => sync.complete(task, true))}
          onCycle={() => cycle(task)}
          onOpen={() => (editing = task.id)}
        />
      {/if}
    {:else}
      {#if snapshot}<p class="empty">Nothing due today.</p>{/if}
    {/each}

    {#if view.done.length}
      <button class="done-toggle" onclick={() => (showDone = !showDone)}>
        {showDone ? '▾' : '▸'} Done today ({view.done.length})
      </button>
      {#if showDone}
        {#each view.done as task (task.id)}
          <TaskRow {task} {now} error={errors[task.id]} onToggle={() => guard(task.id, () => sync.complete(task, false))} />
        {/each}
      {/if}
    {/if}
  </section>

  <QuickAdd error={errors.add} onAdd={(title) => guard('add', () => sync.add(title))} />
</main>

<style>
  :global(html, body) {
    margin: 0;
    background: #fff7b1;
    font: 13px/1.4 'Segoe UI', system-ui, sans-serif;
  }
  :global(button) { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
  :global(h2) { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; margin: 8px 0 4px; }
  :global(.err) { color: var(--red); font-size: 12px; margin: 2px 0 6px 22px; }
  .note {
    --ink: #3b3420;
    --line: #e6d97a;
    --red: #c0392b;
    color: var(--ink);
    height: 100vh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1px solid var(--line);
    overflow: hidden;
  }
  .banner { padding: 8px 10px; border-bottom: 1px solid var(--line); background: #fff1a0; }
  .primary { margin-left: 6px; padding: 2px 8px; border-radius: 4px; background: var(--ink); color: #fff7b1; }
  .tasks { flex: 1; overflow-y: auto; padding: 0 10px 8px; }
  .empty { opacity: 0.6; }
  .done-toggle { margin-top: 8px; opacity: 0.7; }
</style>
