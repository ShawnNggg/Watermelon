import type { DogRenderer, RendererKind } from "./DogRenderer";
import { LegacyDogRenderer } from "./LegacyDogRenderer";
import { RiveDogRenderer } from "./RiveDogRenderer";
import type { RiveRendererOptions } from "./RiveDogRenderer";

/** renderer 选择持久化 key —— 存 localStorage（v2：默认改为 Rive，旧 key 不再读取） */
export const RENDERER_KEY = "watermelon-widget-renderer-v2";

/** 默认渲染器：Rive。缺 dog.riv 时 RiveDogRenderer 内部自动回退 Legacy。 */
export const DEFAULT_RENDERER_KIND: RendererKind = "rive";

/**
 * 根据配置创建 Renderer 的工厂。
 * - kind="legacy" → LegacyDogRenderer
 * - kind="rive" → RiveDogRenderer（内部 try-load .riv，失败自动 fallback Legacy）
 * - kind="auto" 或 null/undefined → 先试 rive，再 fallback
 */
export function createRenderer(
  kind: RendererKind | "auto" | null | undefined,
  opts?: {
    rive?: RiveRendererOptions;
    legacy?: ConstructorParameters<typeof LegacyDogRenderer>[0];
  },
): DogRenderer {
  const k = kind ?? loadRendererKind();
  if (k === "legacy") {
    return new LegacyDogRenderer(opts?.legacy);
  }
  if (k === "rive" || k === "auto") {
    if (opts?.rive?.rivUrl) {
      // RiveDogRenderer 内部自己处理 fallback —— .riv 加载失败会自动退回 Legacy
      return new RiveDogRenderer(opts.rive);
    }
    // 没传 rivUrl → 自动回退 legacy
    console.info("[rendererFactory] rivUrl 未提供，fallback Legacy");
    return new LegacyDogRenderer(opts?.legacy);
  }
  return new LegacyDogRenderer(opts?.legacy);
}

/** 持久化 renderer 选择 */
export function saveRendererKind(kind: RendererKind): void {
  try {
    localStorage.setItem(RENDERER_KEY, kind);
  } catch { /* noop */ }
}

export function loadRendererKind(): RendererKind {
  try {
    const v = localStorage.getItem(RENDERER_KEY);
    if (v === "legacy" || v === "rive") return v;
  } catch { /* noop */ }
  return DEFAULT_RENDERER_KIND;
}
