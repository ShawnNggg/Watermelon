import type { DogRenderer, RendererOptions } from "./DogRenderer";
import type { PetAction } from "@/behavior";
import { LegacyDogRenderer } from "./LegacyDogRenderer";

/** RiveDogRenderer 专属构造参数 */
export interface RiveRendererOptions extends RendererOptions {
  /** .riv 文件的 URL —— 由 Vite 作为 static asset 打包 */
  rivUrl: string;
  /** wasm 文件 URL —— 离线可用，不走 CDN */
  wasmUrl?: string;
  /** Rive 状态机名（约定 DogSM） */
  stateMachineName?: string;
  /** canvas 元素（不传就找 <canvas id="dog-rive">，再没有就自动 create 一个塞进 widget） */
  canvas?: HTMLCanvasElement;
}

/**
 * RiveDogRenderer —— 用 Rive v2 runtime 驱动桌宠
 *
 * 约定（阶段 5 开始前先写进 Rive 编辑器状态机）：
 *   state machine name: DogSM
 *   number inputs:      mode   (0=beforeWork, 1=working, 2=moyu, 3=overtime, 4=happy, 5=rest)
 *                       progress (0-1)
 *   trigger inputs:     tap / love / surprise / sleepy / celebrate
 *
 * 缺 .riv 文件 / Rive load 失败 → 自动 fallback 到 LegacyDogRenderer。
 * 调用方可以通过 `isActive` 字段判断当前走哪个实现。
 */
export class RiveDogRenderer implements DogRenderer {
  /** Rive 实际 load 成功了？ */
  readonly isActive!: boolean;
  /** 如果 Rive 不可用 → fallback 到 LegacyDogRenderer，所有接口透传给它 */
  private fallback: LegacyDogRenderer | null = null;

  private rive: import("@rive-app/canvas").Rive | null = null;
  private canvas!: HTMLCanvasElement;
  private opts!: Required<Pick<RiveRendererOptions, "rivUrl" | "stateMachineName">> & RiveRendererOptions;

  /** 启动 promise —— 外部可以 await 等 rive ready */
  readonly ready: Promise<void>;
  private _destroyed = false;
  private _paused = false;

  constructor(opts: RiveRendererOptions) {
    this.opts = {
      stateMachineName: "DogSM",
      ...opts,
    };

    // 1. 找到或创建 canvas
    const existingCanvas =
      opts.canvas ?? document.querySelector<HTMLCanvasElement>("#dog-rive");
    if (existingCanvas) {
      this.canvas = existingCanvas;
    } else {
      // 没传 canvas 也没现成的 —— 自动 create 一个，插到 widget 元素里
      const widget = document.getElementById("widget");
      if (!widget) {
        // DOM 还没挂载 → fallback
        console.warn("[RiveDogRenderer] #widget 不存在，fallback Legacy");
        this.fallback = new LegacyDogRenderer(opts);
        this.isActive = false;
        this.ready = Promise.resolve();
        return;
      }
      this.canvas = document.createElement("canvas");
      this.canvas.id = "dog-rive";
      this.canvas.width = 200;
      this.canvas.height = 200;
      // 透明背景，层级在 SVG 小狗之上
      this.canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;";
      widget.appendChild(this.canvas);
    }

    // 2. 异步 load .riv —— load 失败就 fallback
    this.isActive = false; // 等 ready resolve 后 true
    this.ready = this.tryLoadRive().then((ok) => {
      (this as { isActive: boolean }).isActive = ok;
    });
  }

  // —— DogRenderer 接口实现 ——

  setAction(action: PetAction): void {
    if (this.fallback) {
      this.fallback.setAction(action);
      return;
    }
    // 还没 ready 就先记下来 —— ready 后 applyRiveInput 会用到
    this._pendingAction = action;
    this.applyRiveInputs();
  }

  setBubble(text: string): void {
    if (this.fallback) { this.fallback.setBubble(text); return; }
    // Rive 不渲染 bubble —— 目前 shell 还没接 bubble；将来要 Rive 里画 bubble 的话
    // 要么用 Rive Text Run API（setTextRunValueAtPath），要么继续用 DOM overlay
    // 暂时无操作
  }

  setStatusChip(text: string): void {
    if (this.fallback) { this.fallback.setStatusChip(text); return; }
    // 同上 —— status chip 用 DOM overlay 渲染
  }

  setProgress(n: number): void {
    if (this.fallback) { this.fallback.setProgress(n); return; }
    this._pendingProgress = Math.max(0, Math.min(1, n));
    this.applyRiveInputs();
  }

  trigger(name: string): void {
    if (this.fallback) { this.fallback.trigger(name); return; }
    if (!this.rive || !this._readyResolved) return;
    // 按约定，triggers 是 Rive boolean 输入（fire 一次 → true → 立即自动 reset）
    try {
      this.rive.fireStateAtPath(name, this.opts.stateMachineName);
    } catch (e) {
      // fireStateAtPath 可能因为输入不存在而 throw —— 静默忽略
      console.debug(`[RiveDogRenderer] trigger("${name}") 失败：`, e);
    }
  }

  pause(): void {
    if (this.fallback) { this.fallback.pause(); return; }
    this._paused = true;
    if (this.rive && this._readyResolved && !this._destroyed) {
      try { this.rive.pause(); } catch { /* ignore */ }
    }
  }

  resume(): void {
    if (this.fallback) { this.fallback.resume(); return; }
    this._paused = false;
    if (this.rive && this._readyResolved && !this._destroyed) {
      try { this.rive.play(); } catch { /* ignore */ }
    }
  }

  destroy(): void {
    this._destroyed = true;
    if (this.fallback) { this.fallback.destroy(); return; }
    if (this.rive) {
      try { this.rive.cleanup(); } catch { /* ignore */ }
      this.rive = null;
    }
    // 自动创建的 canvas 我们自己 remove
    if (this.canvas.parentElement && this.canvas.id === "dog-rive") {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }

  // —— 内部 ——

  private _readyResolved = false;
  private _pendingAction: PetAction = "typing";
  private _pendingProgress = 0;

  private async tryLoadRive(): Promise<boolean> {
    try {
      // 动态 import —— 没装 @rive-app/canvas 或 import 失败就 fallback
      const mod = await import("@rive-app/canvas").catch((e) => {
        throw new Error(`[RiveDogRenderer] import("@rive-app/canvas") 失败: ${e}`);
      });

      const { Rive, RuntimeLoader } = mod;

      // 1. 设置本地 wasm URL —— 离线可用，不走 CDN
      //    Vite 会把 node_modules/@rive-app/canvas/rive.wasm 当 asset 处理
      //    import.meta.resolve("@rive-app/canvas/rive.wasm") 得到最终打包 URL
      if (this.opts.wasmUrl) {
        RuntimeLoader.setWasmUrl(this.opts.wasmUrl);
      } else {
        try {
          // ESM import.meta.resolve 在 Vite/Rollup 里会解析到最终 URL
          const wasmUrl = new URL(
            "@rive-app/canvas/rive.wasm",
            import.meta.url,
          ).toString();
          RuntimeLoader.setWasmUrl(wasmUrl);
        } catch {
          // import.meta.resolve 不支持时用默认 —— RuntimeLoader 会自动从包 dist 里找
        }
      }

      // 2. 实例化 Rive
      const rive = new Rive({
        canvas: this.canvas,
        src: this.opts.rivUrl,
        stateMachines: this.opts.stateMachineName,
        autoplay: true,
        onLoad: () => {
          this._readyResolved = true;
          this.rive = rive;
          this.applyRiveInputs();
        },
        onLoadError: (err) => {
          console.warn("[RiveDogRenderer] .riv load 失败：", err);
          throw err; // 让下面 catch 接住
        },
      });

      // 等 onLoad 回调（或错误）
      await new Promise<void>((resolve, reject) => {
        // Rive v2 用 event 字符串："load" / "loadError"
        // 这俩 event 类型没有在 RiveEventType enum 里，直接用字符串
        (rive as unknown as { on: (event: string, cb: () => void) => void }).on(
          "load", () => resolve(),
        );
        (rive as unknown as { on: (event: string, cb: (e: unknown) => void) => void }).on(
          "loadError", (err) => reject(err),
        );
        // 超时保护 —— 10s 还没 onLoad 就算失败
        setTimeout(() => reject(new Error("Rive load timeout")), 10_000);
      });

      return true;
    } catch (e) {
      console.warn("[RiveDogRenderer] Rive load 失败，fallback LegacyDogRenderer：", e);
      // 失败就 fallback
      this.fallback = new LegacyDogRenderer(this.opts);
      return false;
    }
  }

  /** 根据 action + progress 映射到 DogSM state machine 输入 */
  private applyRiveInputs(): void {
    if (!this.rive || !this._readyResolved || this._destroyed) return;
    const mode = actionToRiveMode(this._pendingAction);
    try {
      // Rive 2.x 新 API：setNumberStateAtPath
      this.rive.setNumberStateAtPath("mode", mode, this.opts.stateMachineName);
      this.rive.setNumberStateAtPath(
        "progress",
        this._pendingProgress,
        this.opts.stateMachineName,
      );
    } catch (e) {
      console.debug("[RiveDogRenderer] applyRiveInputs 失败：", e);
    }
  }
}

/** PetAction → Rive DogSM.mode 数值输入 */
function actionToRiveMode(action: PetAction): number {
  // 约定（Rive 编辑器里要写同样的 mapping）：
  // 0 beforeWork   1 working   2 moyu   3 overtime   4 happy   5 rest
  switch (action) {
    case "dozing": return 0;           // beforeWork mood → mode=0
    case "melon":
    case "toilet": return 2;           // moyu mood → mode=2
    case "overtime": return 3;
    case "happy": return 4;
    case "sleep": return 5;
    default: return 1;                 // typing/present/scolded/phone → mode=1 working
  }
}

/** 触发名 → Rive DogSM boolean trigger 输入 */
export const RIVE_TRIGGERS = [
  "tap", "love", "surprise", "sleepy", "celebrate",
] as const;
