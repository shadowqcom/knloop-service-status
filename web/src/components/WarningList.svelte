<script lang="ts">
  import type { Warning } from '../lib/status';

  interface Props {
    warnings: Warning[];
  }

  let { warnings }: Props = $props();
</script>

{#if warnings.length > 0}
  <section class="mb-4 w-full space-y-2" aria-live="polite">
    {#each warnings as warning (warning.type + warning.message)}
      <div
        class="flex items-start gap-2 rounded-lg px-4 py-3 text-sm text-text-primary {warning.type === 'stale' ? 'bg-partial/10' : 'bg-failure/10'}"
        role="alert"
        data-testid="warning"
        data-warning-type={warning.type}
      >
        <svg
          class="mt-0.5 h-4 w-4 flex-shrink-0 {warning.type === 'stale' ? 'text-partial' : 'text-failure'}"
          aria-hidden="true"
        >
          <use href="/icons.svg#icon-partial"></use>
        </svg>
        <span>{warning.message}</span>
      </div>
    {/each}
  </section>
{/if}
