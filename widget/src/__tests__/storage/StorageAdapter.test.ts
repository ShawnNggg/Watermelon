// @vitest-environment jsdom
// 因为 LocalStorageAdapter 需要 jsdom 的 localStorage

import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorageAdapter, MIGRATION_MARKER, LEGACY_KEY_PREFIXES, createStorage } from "@/storage";

describe("LocalStorageAdapter", () => {
  let a: LocalStorageAdapter;
  beforeEach(() => {
    localStorage.clear();
    a = new LocalStorageAdapter();
  });

  it("set/get roundtrip (object)", async () => {
    await a.set("k", { a: 1, b: "x" });
    expect(await a.get("k")).toEqual({ a: 1, b: "x" });
  });

  it("set/get roundtrip (number)", async () => {
    await a.set("n", 42);
    expect(await a.get("n")).toBe(42);
  });

  it("get 不存在 → null", async () => {
    expect(await a.get("missing")).toBeNull();
  });

  it("has + delete", async () => {
    await a.set("k", 1);
    expect(await a.has("k")).toBe(true);
    await a.delete("k");
    expect(await a.has("k")).toBe(false);
    expect(await a.get("k")).toBeNull();
  });

  it("keys() 返回所有 key", async () => {
    await a.set("a", 1); await a.set("b", 2);
    expect((await a.keys()).sort()).toEqual(["a", "b"]);
  });

  it("close() noop", async () => { await a.close(); });
});

describe("LEGACY_KEY_PREFIXES", () => {
  it("覆盖现有所有 localStorage key", () => {
    const existing = [
      "watermelon-widget-cal-perm",
      "watermelon-widget-cal-cache-2026",
      "watermelon-widget-state",
      "wm-test",
    ];
    for (const k of existing) {
      expect(LEGACY_KEY_PREFIXES.some((p) => k.startsWith(p))).toBe(true);
    }
  });

  it("不误伤其他 app 的 key", () => {
    const other = ["toki.app.theme", "chrome-extension://xxx", "foo_bar"];
    for (const k of other) {
      expect(LEGACY_KEY_PREFIXES.some((p) => k.startsWith(p))).toBe(false);
    }
  });
});

describe("Migration 路径（通过 createStorage + LocalStorageAdapter 模拟）", () => {
  it("createStorage 无 Tauri runtime → 回退 LocalStorageAdapter", async () => {
    // 不在 Tauri 环境里，__TAURI__ 不存在
    const a = await createStorage();
    expect(a).toBeInstanceOf(LocalStorageAdapter);
  });

  it("LocalStorageAdapter 能同时读写 watermelon-widget-cal-perm 等旧 key 格式", async () => {
    localStorage.setItem("watermelon-widget-cal-perm", JSON.stringify("granted"));
    localStorage.setItem("watermelon-widget-cal-cache-2026", JSON.stringify({ "2026-05-09": { isOffDay: false } }));
    const a = new LocalStorageAdapter();
    expect(await a.get("watermelon-widget-cal-perm")).toBe("granted");
    const cache = await a.get<Record<string, unknown>>("watermelon-widget-cal-cache-2026");
    expect(cache?.["2026-05-09"]).toBeDefined();
  });

  it("MIGRATION_MARKER 常量在 store/ls 都用同一个 key", () => {
    expect(MIGRATION_MARKER).toBe("watermelon-widget-migrated-v2");
  });
});
