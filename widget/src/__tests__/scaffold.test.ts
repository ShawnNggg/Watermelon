// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * 阶段 1 的 sanity check — 验证 vitest + 测试基础设施真的能跑
 * 阶段 2 会在此加入 Domain 层测试
 */
describe("scaffold sanity", () => {
  it("1 + 1 = 2", () => {
    expect(1 + 1).toBe(2);
  });

  it("import from src works", async () => {
    const mod = await import("@/index");
    expect(mod.WIDGET_VERSION).toMatch(/^\d+\.\d+/);
  });
});
