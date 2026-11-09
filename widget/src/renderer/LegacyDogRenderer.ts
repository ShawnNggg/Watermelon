import type { DogRenderer, RendererOptions } from "./DogRenderer";
import type { PetAction } from "@/behavior";

/**
 * LegacyDogRenderer —— 包装 widget/ui/index.html 里的手写 SVG 小狗
 *
 * 对应 index.html 里直接写 DOM 的那层（widget.dataset.act / bubble.textContent 等），
 * 现在通过 DogRenderer 接口暴露出来。Rive 阶段切到 RiveDogRenderer 时替换这个实现。
 *
 * Legacy 模式下 trigger(oneshot) 暂不做额外效果 —— CSS keyframes animation 已经通过
 * data-act 切换自动触发。RiveDogRenderer 才会真的把 oneshot 翻译成 state machine input。
 */
export class LegacyDogRenderer implements DogRenderer {
  private widget: HTMLElement;
  private bubble: HTMLElement;
  private chip: HTMLElement;
  private ringFg?: SVGCircleElement | null;
  private dog?: HTMLElement | null;
  private lastAction: PetAction | null = null;
  private paused = false;
  private opts: RendererOptions;

  constructor(opts: RendererOptions = {}) {
    this.opts = opts;

    // 查找关键 DOM 元素 —— 找不到就 throw，因为没小狗就没法渲染
    const w = document.getElementById("widget");
    const b = document.getElementById("bubble");
    const c = document.getElementById("statusChip");
    if (!w || !b || !c) {
      throw new Error(
        "LegacyDogRenderer: 找不到 #widget / #bubble / #statusChip —— DOM 还没挂载？",
      );
    }
    this.widget = w;
    this.bubble = b;
    this.chip = c;

    // 可选元素 —— 圆环进度和小狗主体
    this.ringFg = document.querySelector<SVGCircleElement>("#ringFg");
    this.dog = document.getElementById("dog");

    // 绑定点击事件 —— 用户点小狗 → notify Shell 发 BehaviorEvent.tap
    this.widget.addEventListener("click", this.handleTap);
  }

  setAction(action: PetAction): void {
    if (this.paused) return;
    if (this.lastAction === action) return; // 防重复写入
    this.widget.dataset.act = action;
    this.lastAction = action;
    this.opts.onActionChange?.(action);
  }

  setBubble(text: string): void {
    if (this.paused) return;
    this.bubble.textContent = text;
  }

  setStatusChip(text: string): void {
    if (this.paused) return;
    this.chip.textContent = text;
  }

  setProgress(n: number): void {
    if (!this.ringFg || this.paused) return;
    // 圆环 SVG 周长 = 2πr，当前 index.html 用的是 r=28，周长 ≈ 175.9
    // 实际值从元素的 stroke-dasharray 读，兼容将来改半径
    const circumference = parseFloat(this.ringFg.getAttribute("stroke-dasharray") ?? "176");
    const offset = circumference * (1 - Math.max(0, Math.min(1, n)));
    this.ringFg.style.strokeDashoffset = String(offset);
  }

  trigger(_name: string): void {
    // Legacy 模式：CSS keyframes 已经通过 data-act 切换自动触发了。
    // oneshot 暂时不做额外处理。RiveDogRenderer 会真正把 name 翻译成 state machine input。
    // 这里留个 hook，将来如果要加额外 CSS class 触发 animation 可以挂在这里。
  }

  pause(): void {
    this.paused = true;
    // 暂停小狗身上的 CSS animation
    if (this.dog) {
      this.dog.style.animationPlayState = "paused";
    }
  }

  resume(): void {
    this.paused = false;
    if (this.dog) {
      this.dog.style.animationPlayState = "running";
    }
  }

  destroy(): void {
    this.widget.removeEventListener("click", this.handleTap);
    if (this.dog) this.dog.style.animationPlayState = "";
    // DOM 元素不 remove —— 由调用方（页面本身）管理
  }

  /** 暴露给 Shell 读当前 action（幂等判断用） */
  get currentAction(): PetAction | null {
    return this.lastAction;
  }

  private handleTap = (ev: Event): void => {
    // 别让点击穿透到下面（桌面透明窗口）
    ev.stopPropagation();
    this.opts.onTap?.();
  };
}
