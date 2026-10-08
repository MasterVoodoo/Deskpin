<script lang="ts">
  import type { Task } from '$lib/types';
  import { parsePriority } from '$lib/labels';
  import { daysBetween, dueKey, localDateKey } from '$lib/today';

  let { task, now, error, onToggle }: { task: Task; now: Date; error?: string; onToggle: () => void } = $props();

  const done = $derived(task.status === 'completed');
  const priority = $derived(parsePriority(task.title, task.notes));
  const overdue = $derived(!done && dueKey(task) ? daysBetween(dueKey(task)!, localDateKey(now)) : 0);
  const doneAt = $derived(
    done && task.completed
      ? new Date(task.completed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : '',
  );
</script>

<div class="row" class:overdue={overdue > 0} class:done>
  <input type="checkbox" checked={done} onchange={onToggle} aria-label="Done" />
  <span class="title">{task.title || '(untitled)'}</span>
  {#if priority}<span class="chip p{priority}">P{priority}</span>{/if}
  {#if overdue > 0}<span class="overdue-tag">OVERDUE {overdue}d</span>{/if}
  {#if doneAt}<span class="at">{doneAt}</span>{/if}
</div>
{#if error}<p class="err">{error}</p>{/if}

<style>
  .row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
  .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .overdue .title, .overdue-tag { color: var(--red); }
  .overdue-tag { font-size: 10px; font-weight: 700; }
  .chip { font-size: 10px; padding: 0 6px; border-radius: 8px; color: #fff; }
  .p1 { background: #c0392b; }
  .p2 { background: #e67e22; }
  .p3 { background: #7f8c8d; }
  .done .title { text-decoration: line-through; opacity: 0.6; }
  .at { font-size: 11px; opacity: 0.6; }
</style>
