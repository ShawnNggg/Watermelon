import { describe, it, expect, vi, beforeEach } from "vitest";
// @vitest-environment jsdom — LegacyDogRenderer 需要 DOM

import { createRenderer, loadRendererKind, saveRendererKind } from "@/renderer";
import { LegacyDogRenderer } from "@/renderer";
import { RIVE_TRIGGERS } from "@/renderer/RiveDogRenderer";

/** 构造一个最小 DOM —— LegacyDogRenderer 需要 #widget/#bubble/#statusChip */
function setupDom(): void {
  document.body.innerHTML = `
    <div id="widget" class="widget" data-act="typing">
      <div id="bubble" class="bubble">…</div>
      <svg><circle id="ringFg" stroke-dasharray="175.9"/></svg>
    </div>
    <div id="statusChip">搬砖中</div>
  `;
}

describe("rendererFactory", () => {
  beforeEach(() => {
    setupDom();
    localStorage.clear();
  });

  it("kind=legacy → 返回 LegacyDogRenderer", () => {
    const r = createRenderer("legacy");
    expect(r).toBeInstanceOf(LegacyDogRenderer);
  });

  it("kind=rive + 无 rivUrl → fallback LegacyDogRenderer", () => {
    const r = createRenderer("rive");
    expect(r).toBeInstanceOf(LegacyDogRenderer);
  });

  it("kind=null + localStorage='legacy' → 返回 LegacyDogRenderer", () => {
    localStorage.setItem("watermelon-widget-renderer", "legacy");
    const r = createRenderer(null);
    expect(r).toBeInstanceOf(LegacyDogRenderer);
  });

  it("kind=auto + localStorage='rive' + 无 rivUrl → fallback Legacy", () => {
    localStorage.setItem("watermelon-widget-renderer", "rive");
    const r = createRenderer("auto");
    expect(r).toBeInstanceOf(LegacyDogRenderer);
  });

  it("save/load roundtrip", () => {
    saveRendererKind("rive");
    expect(loadRendererKind()).toBe("rive");
    saveRendererKind("legacy");
    expect(loadRendererKind()).toBe("legacy");
    localStorage.clear();
    expect(loadRendererKind()).toBeNull();
  });
});

describe("RIVE_TRIGGERS constant", () => {
  it("包含约定的 5 个触发器", () => {
    expect(RIVE_TRIGGERS).toContain("tap");
    expect(RIVE_TRIGGERS).toContain("love");
    expect(RIVE_TRIGGERS).toContain("surprise");
    expect(RIVE_TRIGGERS).toContain("sleepy");
    expect(RIVE_TRIGGERS).toContain("celebrate");
    expect(RIVE_TRIGGERS.length).toBe(5);
  });
});

describe("LegacyDogRenderer DOM 操作", () => {
  beforeEach(() => { setupDom(); });

  it("setAction → 写 #widget.dataset.act", () => {
    const r = new LegacyDogRenderer();
    r.setAction("happy");
    expect(document.getElementById("widget")?.dataset.act).toBe("happy");
  });

  it("setBubble → 写 #bubble.textContent", () => {
    const r = new LegacyDogRenderer();
    r.setBubble("下班啦！");
    expect(document.getElementById("bubble")?.textContent).toBe("下班啦！");
  });

  it("setStatusChip → 写 #statusChip.textContent", () => {
    const r = new LegacyDogRenderer();
    r.setStatusChip("摸鱼中");
    expect(document.getElementById("statusChip")?.textContent).toBe("摸鱼中");
  });

  it("setProgress → 写 #ringFg.strokeDashoffset", () => {
    const r = new LegacyDogRenderer();
    r.setProgress(0.5);
    const ring = document.getElementById("ringFg") as SVGCircleElement | null;
    // circumference ≈ 175.9, 0.5 → offset ≈ 87.95
    const off = ring?.style.strokeDashoffset ?? "";
    expect(parseFloat(off)).toBeCloseTo(87.95, 1);
  });

  it("pause/resume → pause 不写入 DOM", () => {
    const r = new LegacyDogRenderer();
    r.pause();
    r.setAction("happy"); // 被 pause 吞了
    expect(document.getElementById("widget")?.dataset.act).toBe("typing"); // 原值没变
    r.resume();
    r.setAction("happy");
    expect(document.getElementById("widget")?.dataset.act).toBe("happy");
  });

  it("click 触发 onTap callback", () => {
    const onTap = vi.fn();
    const r = new LegacyDogRenderer({ onTap });
    document.getElementById("widget")?.dispatchEvent(new Event("click"));
    expect(onTap).toHaveBeenCalled();
  });

  it("destroy → 解除 click listener", () => {
    const onTap = vi.fn();
    const r = new LegacyDogRenderer({ onTap });
    r.destroy();
    document.getElementById("widget")?.dispatchEvent(new Event("click"));
    expect(onTap).not.toHaveBeenCalled();
  });

  it("防重复写入 — 同一 action 不重复写 DOM", () => {
    const r = new LegacyDogRenderer();
    r.setAction("typing"); // 第一次 → 写
    const widget = document.getElementById("widget")!;
    widget.dataset.act = "present"; // 手动改 DOM 看 renderer 会不会覆盖
    r.setAction("typing"); // 第二次同 action → 不写
    expect(widget.dataset.act).toBe("present"); // renderer 没覆盖
  });
});
