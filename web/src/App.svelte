<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './components/Header.svelte';
  import WarningList from './components/WarningList.svelte';
  import LoadingSkeleton from './components/LoadingSkeleton.svelte';
  import ErrorState from './components/ErrorState.svelte';
  import ServiceCard from './components/ServiceCard.svelte';
  import SummarySection from './components/SummarySection.svelte';
  import Footer from './components/Footer.svelte';
  import {
    DEFAULT_POLL_SECONDS,
    DEFAULT_STALE_AFTER_MIN,
    applyFreshness,
    buildDashboard,
    parseStatusJson,
    parseStatusSnapshot
  } from './lib/status';
  import type { Dashboard, StatusSnapshot, Warning } from './lib/status';

  const CACHE_KEY = 'knloop:web:status:v3';
  const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 8000;
  const POLL_MS = DEFAULT_POLL_SECONDS * 1000;
  // 回前台时最多每 60 秒补一次请求，避免频繁切换标签页造成请求风暴。
  const VISIBILITY_REFRESH_MIN_MS = 60 * 1000;

  let dashboard = $state<Dashboard | null>(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let errorMessage = $state<string | null>(null);
  let sourceLabel = $state('');
  let selectedDays = $state<Record<string, string | null>>({});
  let hideHeader = $state(false);

  let inFlight: Promise<void> | null = null;
  let lastRequestAt = 0;
  let lastScrollY = 0;
  let scrollTicking = false;

  const services = $derived(dashboard?.services ?? []);
  const warnings = $derived.by(() => {
    const list: Warning[] = dashboard ? [...dashboard.warnings] : [];
    if (errorMessage && dashboard) {
      const stamp = dashboard.generatedAtText
        ? dashboard.generatedAtText + (dashboard.relativeTime ? '，' + dashboard.relativeTime : '')
        : dashboard.lastUpdateText;
      list.push({
        type: 'refresh-failed',
        message: '刷新失败，显示缓存数据（最后更新：' + stamp + '）'
      });
    }
    return list;
  });

  function readCache(): StatusSnapshot | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { savedAt?: unknown; snapshot?: unknown };
      if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return parseStatusSnapshot(parsed.snapshot);
    } catch {
      return null;
    }
  }

  function writeCache(snapshot: StatusSnapshot): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), snapshot }));
    } catch {
      // 隐私模式/配额不足时静默降级，不影响页面
    }
  }

  async function fetchSnapshot(force = false): Promise<StatusSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // 常规轮询走浏览器缓存 + ETag/304 协商；手动刷新用 no-cache 强制向 Worker 校验一次，
      // 避免 60 秒浏览器缓存让用户点“刷新”看不到变化（Worker 侧仍优先命中边缘缓存，不额外查 D1）。
      const response = await fetch('/api/status', {
        cache: force ? 'no-cache' : 'default',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return parseStatusJson(await response.text());
    } finally {
      clearTimeout(timer);
    }
  }

  function refresh(force = false): Promise<void> {
    if (inFlight) return inFlight;
    lastRequestAt = Date.now();
    refreshing = true;
    if (!dashboard) loading = true;
    inFlight = (async () => {
      try {
        const snapshot = await fetchSnapshot(force);
        dashboard = buildDashboard(snapshot, { now: Date.now(), staleAfterMinutes: DEFAULT_STALE_AFTER_MIN });
        errorMessage = null;
        sourceLabel = 'Worker API';
        loading = false;
        writeCache(snapshot);
      } catch {
        errorMessage = '数据加载失败，请检查网络后重试';
        loading = false;
        if (dashboard) {
          dashboard = applyFreshness(dashboard, { now: Date.now(), staleAfterMinutes: DEFAULT_STALE_AFTER_MIN });
        }
      } finally {
        refreshing = false;
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function toggleDay(key: string, date: string | null): void {
    selectedDays = { ...selectedDays, [key]: date };
  }

  function handleScroll(): void {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY || 0;
      hideHeader = currentY > lastScrollY && currentY > 64;
      lastScrollY = currentY;
      scrollTicking = false;
    });
  }

  onMount(() => {
    const cached = readCache();
    if (cached) {
      dashboard = buildDashboard(cached, { now: Date.now(), staleAfterMinutes: DEFAULT_STALE_AFTER_MIN });
      sourceLabel = '本地缓存';
      loading = false;
    }

    void refresh();

    lastScrollY = window.scrollY || 0;
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refresh();
    }, POLL_MS);

    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRequestAt < VISIBILITY_REFRESH_MIN_MS) return;
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });
</script>

<svelte:window onscroll={handleScroll} />

<Header hidden={hideHeader} />

<main class="mx-auto w-full max-w-4xl flex-1 px-4 pb-8 pt-24">
  <section class="flex flex-col items-center py-4">
    <h1 class="text-3xl font-normal text-text-primary">knloop 服务状态</h1>
  </section>

  <WarningList {warnings} />

  <section class="overflow-hidden rounded-lg bg-bg-secondary shadow-lg" data-testid="main-card">
    {#if errorMessage && !dashboard}
      <ErrorState variant="error" message={errorMessage} onRetry={() => void refresh(true)} />
    {:else if loading && !dashboard}
      <LoadingSkeleton />
    {:else if dashboard && services.length === 0}
      <ErrorState
        variant="empty"
        message="暂无监控数据"
        detail="等待采集或稍后重试"
        onRetry={() => void refresh(true)}
      />
    {:else if dashboard}
      <div class="divide-y divide-gray-100">
        {#each services as service (service.key)}
          <ServiceCard
            {service}
            selectedDay={selectedDays[service.key] ?? null}
            onSelectDay={(date) => toggleDay(service.key, date)}
          />
        {/each}
      </div>

      {#if refreshing}
        <div class="flex flex-col items-center justify-center gap-4 border-t border-gray-100 py-8" data-testid="refreshing">
          <div class="flex items-center gap-2">
            <span class="loading-dot h-3 w-3 rounded-full bg-failure"></span>
            <span class="loading-dot loading-dot-delay-1 h-3 w-3 rounded-full bg-partial"></span>
            <span class="loading-dot loading-dot-delay-2 h-3 w-3 rounded-full bg-success"></span>
            <span class="loading-dot loading-dot-delay-3 h-3 w-3 rounded-full bg-success"></span>
            <span class="loading-dot loading-dot-delay-4 h-3 w-3 rounded-full bg-success"></span>
          </div>
          <p class="text-sm tracking-widest text-text-secondary">数据刷新中...</p>
        </div>
      {/if}
    {/if}
  </section>

  {#if dashboard && services.length > 0}
    <SummarySection
      summary={dashboard.summary}
      overallStatus={dashboard.overallStatus}
      lastUpdateText={dashboard.lastUpdateText}
      {refreshing}
      onRefresh={() => void refresh(true)}
    />
  {/if}
</main>

<Footer />
