<script lang="ts">
  interface Props {
    count?: number;
  }

  let { count = 3 }: Props = $props();
  const skeletons = $derived(Array.from({ length: count }, (_, index) => index));
  const blocks = Array.from({ length: 60 }, (_, index) => index);
</script>

<div class="divide-y divide-gray-100" data-testid="skeleton">
  {#each skeletons as item (item)}
    <div class="p-6">
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="skeleton h-5 w-5 rounded-full"></div>
          <div class="skeleton skeleton-text h-5 w-24"></div>
        </div>
        <div class="skeleton skeleton-text h-4 w-28"></div>
      </div>

      <div class="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-[2px] py-1">
        {#each blocks as block (block)}
          <div class="skeleton h-10 rounded-[2px]"></div>
        {/each}
      </div>

      <div class="mt-2 flex justify-between px-1">
        <div class="skeleton skeleton-text h-3 w-20"></div>
        <div class="skeleton skeleton-text h-3 w-24"></div>
      </div>

      <div class="skeleton mt-2 h-48 rounded"></div>
    </div>
  {/each}
</div>
