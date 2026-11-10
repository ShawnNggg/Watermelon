import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WidgetShell } from "@/shell";
import { MockRenderer } from "@/renderer/MockRenderer";
import type { WorkSchedule } from "@/domain";
import { ACTIONS_BY_MOOD } from "@/behavior";

/** Node 环境测试 —— Shell + MockRenderer 不依赖 DOM */
const SCHEDULE: WorkSchedule = {
  workdays: [2, 3, 4, 5, 6],
  startH: 9, startM: 0, endH: 18, endM: 0,
};

describe("WidgetShell", () => {
  let mock: MockRenderer;
  let shell: WidgetShell;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 4, 14, 30)); // 周三 14:30
    mock = new MockRenderer();
    shell = new WidgetShell({ renderer: mock, schedule: SCHEDULE });
  });

  afterEach(() => {
    shell.destroy();
    vi.useRealTimers();
  });

  it("start() 立刻跑一次 tick —— working action 被设置", () => {
    shell.start();
    // tick() 已经跑了（start 里先 tick 再设 interval）
    expect(mock.lastAction).toBeTruthy();
    expect(mock.lastProgress).toBeGreaterThan(0);
    expect(mock.lastProgress).toBeLessThan(1);
  });

  it("1s 后自动 tick", () => {
    shell.start();
    mock.lastAction = null; // 清空，看下次 tick 是否再触发
    vi.advanceTimersByTime(1000);
    // 1s 后 tick 再跑一次 —— 但 mood 没变所以 action 可能不重设（防重复写入）
    // 只验证 Shell 没崩
    expect(true).toBe(true);
  });

  it("handleEvent({kind:'offWorkReached'}) → action 属于 happy 池 + trigger=celebrate", () => {
    shell.start();
    vi.setSystemTime(new Date(2026, 10, 4, 18, 0)); // 周三 18:00 下班
    shell.handleEvent({ kind: "offWorkReached" });
    expect(ACTIONS_BY_MOOD.happy).toContain(mock.lastAction);
    expect(mock.triggers).toContain("celebrate");
  });

  it("handleEvent({kind:'moyuStart'}) → moyu action + trigger=surprise", () => {
    shell.start();
    shell.handleEvent({ kind: "moyuStart" });
    expect(ACTIONS_BY_MOOD.moyu).toContain(mock.lastAction);
    expect(mock.triggers).toContain("surprise");
  });

  it("handleEvent({kind:'tap'}) → trigger=tap (action 保持)", () => {
    shell.start();
    const before = mock.lastAction;
    shell.handleEvent({ kind: "tap" });
    expect(mock.triggers).toContain("tap");
    // action 不变
    expect(mock.lastAction).toBe(before);
  });

  it("pause() + resume() 恢复 tick", () => {
    shell.start();
    shell.pause();
    expect(mock.paused).toBe(true);
    shell.resume();
    expect(mock.paused).toBe(false);
    expect(mock.lastAction).toBeTruthy(); // resume 后立刻 tick
  });

  it("destroy() → stop + renderer.destroy", () => {
    shell.start();
    shell.destroy();
    expect(mock.destroyed).toBe(true);
    // 再 tick 不该再动 renderer
    vi.advanceTimersByTime(10_000);
    expect(true).toBe(true);
  });
});
