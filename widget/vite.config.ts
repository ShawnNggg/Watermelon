import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

/** ESM 下的 __dirname 兼容 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite config — widget 前端构建
 *
 * 阶段 1 目标：纯脚手架，功能零变化。
 * - root 指向 widget/ui/，index.html 原位不动（Vite 自动识别为入口）
 * - inline script 不做模块转换，原样输出到 dist
 * - dev server 起 http（Tauri webview dev 模式允许）
 */
export default defineConfig({
  root: "ui",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 1420,
    host: "127.0.0.1",
    strictPort: true,
  },
  preview: {
    port: 1421,
    host: "127.0.0.1",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  /** Vitest — 独立 root，不跟着 vite 的 ui/ root */
  test: {
    root: ".",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
