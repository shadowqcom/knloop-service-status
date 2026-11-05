<script lang="ts">
  interface Props {
    variant: 'error' | 'empty';
    message: string;
    detail?: string;
    onRetry: () => void;
  }

  let { variant, message, detail = '请检查网络连接或稍后重试', onRetry }: Props = $props();
</script>

<div class="p-12 text-center" data-testid={variant === 'error' ? 'error-state' : 'empty-state'}>
  <div class="flex flex-col items-center gap-4">
    <div class="flex h-20 w-20 items-center justify-center rounded-full bg-nodata/20">
      <svg class="h-10 w-10 text-nodata" aria-hidden="true"><use href="/icons.svg#icon-nodata"></use></svg>
    </div>
    <div class="flex flex-col items-center gap-2">
      <p class="text-lg text-text-primary">{message}</p>
      <p class="text-sm text-text-secondary">{detail}</p>
    </div>
    <button
      type="button"
      onclick={onRetry}
      class="mt-2 flex items-center gap-2 rounded-lg bg-gray-100 px-6 py-2.5 text-sm text-text-primary transition-colors hover:bg-gray-200"
      data-testid="retry-button"
    >
      <svg class="h-4 w-4" aria-hidden="true"><use href="/icons.svg#icon-success"></use></svg>
      重新加载
    </button>
  </div>
</div>
