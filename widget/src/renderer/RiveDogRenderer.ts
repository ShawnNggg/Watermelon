import type { DogRenderer, RendererOptions } from "./DogRenderer";
import { LEGACY_BY_ID } from "@/behavior";
import type { PetAction } from "@/behavior";
import type { Intent } from "@/avatar";
import { AvatarRiveRenderer } from "@/avatar";
import { LegacyDogRenderer } from "./LegacyDogRenderer";

/** RiveDogRenderer 专属构造参数 */
export interface RiveRendererOptions extends RendererOptions {
  /** .riv 文件的 URL —— 由 Vite 作为 static asset 打包 */
  rivUrl: string;
  /** wasm 文件 URL —— 离线可用，不走 CDN */
  wasmUrl?: string;
  /** Rive 状态机名（约定 DogSM） */
  stateMachineName?: string;
  /** canvas 元素（不传就自动 create 一个塞进 #widget） */
  canvas?: HTMLCanvasElement;
}

/**
 * RiveDogRenderer —— DogRenderer 接口的 Rive 实现
 *
 * 内部使用 @/avatar 的 AvatarRiveRenderer（B2 完整契约）：
 *   number  inputs: action / pose / mood / tailSpeed / lookX / lookY
 *   boolean inputs: p_laptop / p_phone / p_coffee / p_phones / p_snack / p_bag / p_glasses / drag
 *   trigger inputs: play / tap / fx_z / fx_heart / fx_surprise / fx_sweat / fx_money / fx_sparkle
 *
 * 缺 .riv / wasm / 状态机输入 → 自动 fallback 到 LegacyDogRenderer。
 */
export class RiveDogRenderer implements DogRenderer {
  /** Rive 实际 load 成功了？ */
  isActive = false;

  private inner: AvatarRiveRenderer | null = null;
  private fallback: LegacyDogRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private dogEl: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private pending: Intent | null = null;
  private destroyed = false;

  readonly opts: RiveRendererOptions;

  constructor(opts: RiveRendererOptions) {
    this.opts = { stateMachineName: "DogSM", ...opts };
    void this.boot();
  }

  /** 轻量探测资产是否存在：HEAD 一次就够，不触发 wasm 运行时加载 */
  private async assetExists(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return true;
      // 404 才判定缺失；405/501 表示协议不支持 HEAD，交给正式加载流程判断
      return res.status !== 404;
    } catch {
      return true;
    }
  }

  private async boot(): Promise<void> {
    try {
      // 预检 .riv 是否存在：缺失时直接回退 Legacy，
      // 避免每次都白加载 2.2MB 的 Rive wasm 运行时（低配机器上会卡住首屏数秒）
      if (!(await this.assetExists(this.opts.rivUrl))) {
        throw new Error(`缺少 ${this.opts.rivUrl}`);
      }

      const canvas =
        this.opts.canvas ??
        document.querySelector<HTMLCanvasElement>("#dog-rive") ??
        this.createCanvas();
      if (!canvas) throw new Error("#widget 不存在，无法挂载 canvas");
      this.canvas = canvas;

      const inner = await AvatarRiveRenderer.create({
        canvas,
        src: this.opts.rivUrl,
        wasmUrl: this.opts.wasmUrl,
        stateMachine: this.opts.stateMachineName,
      });

      if (this.destroyed) {
        inner.destroy();
        return;
      }
      this.inner = inner;
      this.isActive = true;
      // Rive 生效时把原生 SVG 藏起来，避免两套动画叠在一起
      document.body.classList.add("rive-on");
      this.syncCanvasSize();
      this.observer = new ResizeObserver(() => this.syncCanvasSize());
      if (this.dogEl) this.observer.observe(this.dogEl);
      if (this.pending) {
        inner.apply(this.pending);
        this.pending = null;
      }
    } catch (e) {
      console.warn("[RiveDogRenderer] Rive 不可用，fallback Legacy：", e);
      if (this.destroyed) return;
      // bindTap:false —— 手势已由 main.ts 统一接管，避免一次点击换两次动作
      this.fallback = new LegacyDogRenderer({ bindTap: false });
      if (this.pending) {
        this.fallback.setAction(legacyOf(this.pending));
        this.pending = null;
      }
    }
  }

  /** 让 canvas 与 #dogSvg 的占位完全重合（挂件窗口高度会随内容变化） */
  private syncCanvasSize(): void {
    if (!this.canvas || !this.dogEl) return;
    const host = this.dogEl.parentElement;
    if (!host) return;
    const r = this.dogEl.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.left = `${r.left - hr.left}px`;
    this.canvas.style.top = `${r.top - hr.top}px`;
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.inner?.resize();
  }

  private createCanvas(): HTMLCanvasElement | null {
    const dog = document.getElementById("dogSvg");
    const host = dog?.parentElement ?? document.getElementById("widget");
    if (!host) return null;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.id = "dog-rive";
    canvas.style.cssText =
      "position:absolute;pointer-events:none;z-index:2;";
    host.appendChild(canvas);
    this.dogEl = dog;
    return canvas;
  }

  // —— DogRenderer 接口 ——

  setAction(action: PetAction): void {
    if (this.fallback) this.fallback.setAction(action);
  }

  setIntent(intent: Intent, action: PetAction): void {
    if (this.inner) this.inner.apply(intent);
    else if (this.fallback) this.fallback.setAction(action);
    else this.pending = intent;
  }

  setBubble(text: string): void {
    this.fallback?.setBubble(text);
  }

  setStatusChip(text: string): void {
    this.fallback?.setStatusChip(text);
  }

  setProgress(_n: number): void {
    this.fallback?.setProgress(_n);
  }

  trigger(name: string): void {
    if (this.inner) {
      if (name === "tap") { this.inner.tap(); return; }
      if (name === "drag") { this.inner.setDrag(true); return; }
      if (name === "dragEnd") { this.inner.setDrag(false); return; }
      const fx = TRIGGER_FX[name];
      if (fx) this.inner.apply(intentWithFx(fx));
      else console.warn(`[RiveDogRenderer] 未识别的 trigger：${name}`);
    } else {
      this.fallback?.trigger(name);
    }
  }

  pause(): void {
    this.inner?.pause();
    this.fallback?.pause();
  }

  resume(): void {
    this.inner?.resume();
    this.fallback?.resume();
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
    document.body.classList.remove("rive-on");
    this.inner?.destroy();
    this.inner = null;
    this.fallback?.destroy();
    this.fallback = null;
    if (this.canvas?.id === "dog-rive") this.canvas.remove();
    this.canvas = null;
    this.dogEl = null;
  }
}

/** 兼容旧测试/外部引用 —— Rive 状态机的一次性 trigger 名单 */
export const RIVE_TRIGGERS = [
  "tap", "love", "surprise", "sleepy", "celebrate",
] as const;

/** Behavior 层 oneshot 名 → Rive fx 触发器（B2 契约） */
const TRIGGER_FX: Record<string, string> = {
  tap: "tap",
  love: "heart",
  heart: "heart",
  celebrate: "sparkle",
  sparkle: "sparkle",
  sleepy: "z",
  z: "z",
  surprise: "surprise",
  sweat: "sweat",
  money: "money",
};

/** 兜底：仅拿到 Intent 时反推 Legacy 动作 */
function legacyOf(intent: Intent): PetAction {
  return LEGACY_BY_ID[intent.action] ?? "typing";
}

/** 构造只带一个 fx 的 Intent —— 用于爱心 / 庆祝等一次性特效 */
function intentWithFx(fx: string): Intent {
  return {
    action: 0,
    pose: null,
    mood: 0,
    props: [],
    fx: [fx as Intent["fx"][number]],
  };
}
