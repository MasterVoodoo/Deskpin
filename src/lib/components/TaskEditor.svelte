<script lang="ts">
  import { untrack } from 'svelte';
  import type { Task } from '$lib/types';
  import { parsePriority, stripPriority, writePriority, type Priority } from '$lib/labels';
  import { dueKey } from '$lib/today';

  let {
    task,
    error,
    onSave,
    onDelete,
    onClose,
  }: {
    task: Task;
    error?: string;
    onSave: (p: { title: string; notes: string; dueKey: string | null }) => void;
    onDelete: () => void;
    onClose: () => void;
  } = $props();

  // Read the task once: background polls must not overwrite what is being typed.
  const initial = untrack(() => task);
  let title = $state(initial.title ?? '');
  let body = $state(stripPriority(initial.notes));
  let due = $state(dueKey(initial) ?? '');
  let priority = $state<Priority>(parsePriority(initial.title, initial.notes));
  let confirming = $state(false);

  function save(e: SubmitEvent) {
    e.preventDefault();
    onSave({ title, notes: writePriority(body, priority), dueKey: due || null });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape closes the editor) -->
<form class="editor" onsubmit={save} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <!-- svelte-ignore a11y_autofocus -->
  <input bind:value={title} placeholder="Title" autofocus />
  <textarea bind:value={body} rows="3" placeholder="Notes"></textarea>
  <div class="line">
    <input type="date" bind:value={due} aria-label="Due date" />
    <select bind:value={priority} aria-label="Priority">
      <option value={null}>No priority</option>
      <option value={1}>P1</option>
      <option value={2}>P2</option>
      <option value={3}>P3</option>
    </select>
  </div>
  <div class="line">
    <button type="submit" class="primary">Save</button>
    <button type="button" onclick={onClose}>Cancel</button>
    <span class="spacer"></span>
    <button type="button" class="danger" onclick={() => (confirming ? onDelete() : (confirming = true))}>
      {confirming ? 'Confirm delete' : 'Delete'}
    </button>
  </div>
  {#if error}<p class="err">{error}</p>{/if}
</form>

<style>
  .editor { display: flex; flex-direction: column; gap: 4px; padding: 6px; margin: 4px 0; background: #fffbe0; border: 1px solid var(--line); border-radius: 4px; }
  input, textarea, select { font: inherit; color: inherit; border: 1px solid var(--line); border-radius: 3px; background: #fff; padding: 2px 4px; }
  textarea { resize: vertical; }
  .line { display: flex; gap: 6px; align-items: center; }
  .spacer { flex: 1; }
  .primary { padding: 2px 8px; border-radius: 4px; background: var(--ink); color: #fff7b1; }
  .danger { color: var(--red); }
</style>
