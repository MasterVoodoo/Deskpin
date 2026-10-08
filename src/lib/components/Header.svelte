<script lang="ts">
  import type { SyncStatus } from '$lib/sync';

  let {
    now,
    status,
    syncedAt,
    mode,
    onToggleMode,
    onHide,
  }: {
    now: Date;
    status: SyncStatus;
    syncedAt?: string;
    mode: string;
    onToggleMode: () => void;
    onHide: () => void;
  } = $props();

  const date = $derived(now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
  const syncTitle = $derived(syncedAt ? `Last synced ${new Date(syncedAt).toLocaleTimeString()}` : 'Not synced yet');
</script>

<header data-tauri-drag-region>
  <span class="date" data-tauri-drag-region>{date}</span>
  <span class="dot {status}" title={syncTitle} aria-label={`Sync: ${status}`}></span>
  <button
    class="icon"
    class:active={mode === 'top'}
    onclick={onToggleMode}
    title={mode === 'top' ? 'Pinned on top (Ctrl+Alt+P)' : 'On desktop (Ctrl+Alt+P)'}
    aria-label="Toggle pin mode">📌</button
  >
  <button class="icon" onclick={onHide} title="Hide (Ctrl+Alt+D)" aria-label="Hide">─</button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    cursor: grab;
    user-select: none;
  }
  .date { flex: 1; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #9a9a9a; }
  .dot.synced { background: #2e9e4f; }
  .dot.syncing { background: #e0a100; }
  .icon { opacity: 0.45; }
  .icon.active { opacity: 1; }
</style>
