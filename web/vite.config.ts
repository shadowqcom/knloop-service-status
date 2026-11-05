import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// 构建产物输出到 Worker Static Assets 目录（worker/public，已 gitignore）
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: '../worker/public',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  }
});
