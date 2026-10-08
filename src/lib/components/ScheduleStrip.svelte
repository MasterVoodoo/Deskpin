<script lang="ts">
  import { countdown, type ScheduleItem } from '$lib/schedule';

  let { items, now, onOpen }: { items: ScheduleItem[]; now: Date; onOpen: (url: string) => void } = $props();

  const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
</script>

{#if items.length}
  <section>
    <h2>Schedule</h2>
    {#each items as item (item.id)}
      <button class="event {item.phase}" onclick={() => onOpen(item.link)}>
        <span class="time">{item.phase === 'allday' ? 'All day' : hhmm(item.start!)}</span>
        <span class="title">{item.title}</span>
        {#if item.phase === 'now'}<span class="tag">now</span>{/if}
        {#if item.phase === 'next'}<span class="tag">{countdown(now, item.start!)}</span>{/if}
      </button>
    {/each}
  </section>
{/if}

<style>
  section { padding: 0 10px 6px; border-bottom: 1px solid var(--line); }
  .event { display: flex; gap: 8px; width: 100%; text-align: left; padding: 2px 0; }
  .time { width: 56px; flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; opacity: 0.7; }
  .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 11px; opacity: 0.7; }
  .past { opacity: 0.4; }
  .now { font-weight: 600; }
  .now .time::before { content: '▶ '; }
</style>
