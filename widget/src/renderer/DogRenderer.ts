// Renderer 接口 —— 桌宠渲染器的统一契约
// 阶段 4：定义接口 + LegacyDogRenderer 包装现有 SVG
// 阶段 5：RiveDogRenderer 实现同一接口

import type { PetAction } from "@/behavior";

/**
 * 桌宠渲染器 —— 纯契约，不 import DOM。
 *
 * 职责：把 Behavior 层的输出（action + oneshots）
 *       变成可视化的小狗动画 + 气泡 + 状态标签 + 进度条。
 *
 * 两种实现：
 *   LegacyDogRenderer — 包装现有 SVG 小狗（阶段 4）
 *   RiveDogRenderer   — Rive 状态机驱动（阶段 5）
 */
export interface DogRenderer {
  /** 切换小狗形态 —— 对应 CSS .widget[data-act="xxx"] 或 Rive state machine */
  setAction(action: PetAction): void;
  /** 设置气泡框文字 —— 比如 "我要下班！" / "摸鱼 5 分钟，净赚 ¥30" */
  setBubble(text: string): void;
  /** 设置状态标签 —— 左下角 "搬砖中" / "摸鱼中" / "下班啦" */
  setStatusChip(text: string): void;
  /** 设置圆环进度 0-1 */
  setProgress(n: number): void;
  /** 触发 one-shot —— 比如 "celebrate" → 小狗蹦跶 */
  trigger(name: string): void;
  /** 窗口隐藏时暂停渲染 */
  pause(): void;
  /** 窗口恢复时继续 */
  resume(): void;
  /** 销毁所有 DOM 引用 + 事件监听 + 定时器 */
  destroy(): void;
}

/** 两个实现的工厂 */
export type RendererKind = "legacy" | "rive";

export interface RendererOptions {
  /** 点击回调 —— Renderer 检测到用户点小狗时调用 Shell.handleEvent({kind:"tap"}) */
  onTap?: () => void;
  /** 气泡变化回调（可选，Shell 可以监听） */
  onActionChange?: (action: PetAction) => void;
}
