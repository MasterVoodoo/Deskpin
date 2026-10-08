<script lang="ts">
  let { onAdd, error }: { onAdd: (title: string) => Promise<boolean>; error?: string } = $props();

  let title = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    busy = true;
    // Keep the typed text if saving fails.
    if (await onAdd(t)) title = '';
    busy = false;
  }
</script>

<form onsubmit={submit}>
  <input bind:value={title} placeholder="+ Add task for today…" disabled={busy} aria-label="Add task for today" />
  {#if error}<p class="err">{error}</p>{/if}
</form>

<style>
  form { padding: 6px 10px; border-top: 1px solid var(--line); }
  input { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: transparent; border: 0; outline: none; }
</style>
