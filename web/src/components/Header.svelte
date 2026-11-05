<script lang="ts">
  interface Props {
    hidden?: boolean;
  }

  let { hidden = false }: Props = $props();
</script>

<header
  id="site-header"
  class="fixed left-0 right-0 top-0 z-50 h-16 bg-bg-secondary shadow-sm transition-transform duration-200 {hidden ? '-translate-y-16' : ''}"
>
  <div class="mx-auto flex h-full max-w-4xl items-center justify-between px-4">
    <a href="/" class="flex items-center gap-2 text-lg font-medium text-text-primary">
      <svg class="h-8 w-8 text-text-primary" aria-hidden="true"><use href="/icons.svg#icon-logo"></use></svg>
      <span>knloop</span>
    </a>
    <a
      href="https://github.com/shadowqcom/knloop-service-status"
      target="_blank"
      rel="nofollow"
      class="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 transition-colors hover:bg-gray-200"
    >
      <span class="text-sm">GitHub</span>
      <svg class="h-5 w-5" aria-hidden="true"><use href="/icons.svg#icon-github"></use></svg>
    </a>
  </div>
</header>
