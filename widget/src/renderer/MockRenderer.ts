import type { DogRenderer, RendererOptions } from "@/renderer";
import type { PetAction } from "@/behavior";

/**
 * 纯内存 MockRenderer —— 给 Shell 测试用。
 * 不依赖 DOM，所有 DogRenderer 接口调用都记下来方便断言。
 */
export class MockRenderer implements DogRenderer {
  lastAction: PetAction | null = null;
  lastBubble: string | null = null;
  lastChip: string | null = null;
  lastProgress: number | null = null;
  triggers: string[] = [];
  paused = false;
  destroyed = false;
  tapListeners: Array<() => void> = [];

  /** 测试辅助 —— 触发一次 tap，模拟用户点小狗 */
  fireTap(): void {
    for (const cb of this.tapListeners) cb();
  }

  // —— DogRenderer 接口 ——
  setAction(a: PetAction): void { this.lastAction = a; }
  setBubble(t: string): void { this.lastBubble = t; }
  setStatusChip(t: string): void { this.lastChip = t; }
  setProgress(n: number): void { this.lastProgress = n; }
  trigger(name: string): void { this.triggers.push(name); }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  destroy(): void { this.destroyed = true; }

  constructor(_opts: RendererOptions = {}) {}
}
