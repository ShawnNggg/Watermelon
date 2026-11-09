// StorageAdapter — 持久化抽象层
//
// 设计：统一 StorageAdapter 接口，两个实现：
//   1. TauriStoreAdapter — 调 @tauri-apps/plugin-store（生产环境）
//   2. LocalStorageAdapter — 纯 localStorage（测试/非 Tauri 环境）
//
// 一次性迁移：首次启动时检查 tauri-plugin-store 是否可用。
//   如果 localStorage 有数据但 store 没有 → 把所有 key 搬到 store，再清 localStorage 旧 key。
//   如果 store 有数据 → 直接用，不管 localStorage。
//   迁移失败 → 保留原数据，回退 localStorage 读。
//
// 所有异常静默 fallback —— 绝不因为存储问题崩掉应用。

export interface StorageAdapter {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  close(): Promise<void>;
}

/** localStorage 实现 —— 测试/无 Tauri 环境兜底 */
export class LocalStorageAdapter implements StorageAdapter {
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      // 兼容两种格式：JSON.parse 或直接字符串
      try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
    } catch { return null; }
  }
  async set(key: string, value: unknown): Promise<void> {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch { /* quota 满了 / private mode — 静默 */ }
  }
  async has(key: string): Promise<boolean> {
    try { return localStorage.getItem(key) != null; } catch { return false; }
  }
  async delete(key: string): Promise<void> {
    try { localStorage.removeItem(key); } catch { /* noop */ }
  }
  async keys(): Promise<string[]> {
    try {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i) ?? "");
      return out;
    } catch { return []; }
  }
  async close(): Promise<void> { /* noop */ }
}

/** Tauri store 实现 —— 有 Tauri runtime 时用 */
export class TauriStoreAdapter implements StorageAdapter {
  private store: Awaited<ReturnType<typeof import("@tauri-apps/plugin-store").load>>;

  /** path: store 文件名，autoSave debounce 毫秒 */
  static async create(path = "watermelon.json", autoSave = 200): Promise<TauriStoreAdapter> {
    const mod = await import("@tauri-apps/plugin-store").catch(() => {
      throw new Error("[TauriStoreAdapter] @tauri-apps/plugin-store 未安装");
    });
    const store = await mod.load(path, { autoSave });
    return new TauriStoreAdapter(store);
  }

  constructor(store: TauriStoreAdapter["store"]) {
    this.store = store;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    try { return (await this.store.get<T>(key)) ?? null; } catch { return null; }
  }
  async set(key: string, value: unknown): Promise<void> {
    try { await this.store.set(key, value); } catch { /* noop */ }
  }
  async has(key: string): Promise<boolean> {
    try { return await this.store.has(key); } catch { return false; }
  }
  async delete(key: string): Promise<void> {
    try { await this.store.delete(key); } catch { /* noop */ }
  }
  async keys(): Promise<string[]> {
    try { return await this.store.keys(); } catch { return []; }
  }
  async close(): Promise<void> {
    try { await this.store.save?.(); } catch { /* noop */ }
  }
}

/** 统一工厂 —— 先试 Tauri store，失败回退 localStorage */
export async function createStorage(
  path = "watermelon.json",
  autoSave = 200,
): Promise<StorageAdapter> {
  try {
    // 检测 Tauri runtime 是否真的在
    const hasTauri = typeof window !== "undefined" &&
      // 两种可能：withGlobalTauri=true 走 window.__TAURI__；或者前端显式 import { load } 成功
      ((window as unknown as { __TAURI_PLUGIN_STORE__?: unknown }).__TAURI_PLUGIN_STORE__ != null ||
       (window as unknown as { __TAURI__?: { store?: unknown } }).__TAURI__?.store != null);

    if (!hasTauri) throw new Error("No Tauri store runtime available");

    const store = await TauriStoreAdapter.create(path, autoSave);
    await runMigration(store);
    return store;
  } catch {
    console.info("[storage] Tauri store 不可用，回退 localStorage");
    return new LocalStorageAdapter();
  }
}

/**
 * 一次性迁移 —— localStorage 里的 Watermelon key 搬到 Tauri store
 *
 * 只搬 watermelon-widget-* 前缀的 key，不碰其他应用数据。
 * 成功后 localStorage 里的旧 key 删掉（迁移标记 "watermelon-widget-migrated" 留着，下次不重复）。
 * 迁移过程任何一步失败都静默返回 —— 原数据留在 localStorage 不动。
 */
export const MIGRATION_MARKER = "watermelon-widget-migrated-v2";
export const LEGACY_KEY_PREFIXES = ["watermelon-widget-", "wm-"];

async function runMigration(store: StorageAdapter): Promise<void> {
  try {
    // 1. 检查有没有迁过
    const alreadyMigrated = await store.has(MIGRATION_MARKER);
    if (alreadyMigrated) return;

    // 2. 枚举 localStorage 里的 Watermelon key
    const allLSKeys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k != null && LEGACY_KEY_PREFIXES.some((p) => k.startsWith(p))) {
          allLSKeys.push(k);
        }
      }
    } catch { /* 没 localStorage 就跳过 */ }

    // 3. 没东西要迁 → 直接打标记（下次启动不再查）
    if (allLSKeys.length === 0) {
      await store.set(MIGRATION_MARKER, true);
      return;
    }

    console.info(`[storage] 首次迁移：${allLSKeys.length} 个 key → Tauri store`);

    // 4. 逐个搬
    let success = true;
    for (const k of allLSKeys) {
      try {
        const raw = localStorage.getItem(k);
        if (raw == null) continue;
        // 尝试 JSON parse（现有所有 key 都是 JSON.stringify 存的）
        let val: unknown = raw;
        try { val = JSON.parse(raw); } catch { /* 保持原字符串 */ }
        await store.set(k, val);
        // 成功后删 localStorage 里的
        localStorage.removeItem(k);
      } catch (e) {
        console.warn(`[storage] 迁移 ${k} 失败：`, e);
        success = false;
        break; // 一个失败就停，不删其他 localStorage 数据
      }
    }

    // 5. 全部成功 → 打标记；失败 → 下次启动再试（localStorage 数据没动）
    if (success) await store.set(MIGRATION_MARKER, true);
  } catch (e) {
    console.warn("[storage] 迁移过程异常（不影响原数据）：", e);
  }
}
