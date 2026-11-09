// Tauri 全局类型声明 —— 让 tsc 认 window.__TAURI__
// 不引 @tauri-apps/api 包（我们用 withGlobalTauri: true）
// 只声明用到的最小子集

export {};

declare global {
  interface Window {
    /** withGlobalTauri=true 时由 Tauri runtime 注入 */
    __TAURI__?: {
      core?: {
        invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      event?: {
        listen?: (event: string, handler: (payload: unknown) => void) => Promise<{ id: number }>;
        unlisten?: (id: number) => Promise<void>;
        emit?: (event: string, payload?: unknown) => Promise<void>;
      };
      window?: {
        getCurrent?: () => {
          startDragging?: () => Promise<void>;
          setFocus?: () => Promise<void>;
          close?: () => Promise<void>;
        };
      };
      store?: unknown; // plugin-store 注入的 handle
    };
  }
}
