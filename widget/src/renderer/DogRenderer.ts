// Renderer 接口 —— 桌宠渲染器的统一契约
// 阶段 4：定义接口 + LegacyDogRenderer 包装现有 SVG
// 阶段 5：RiveDogRenderer 实现同一接口

import type { PetAction } from "@/behavior";
import type { Intent } from "@/avatar";

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
  /**
   * 完整意图（B2 契约）—— Rive 用它驱动 action/pose/mood/props/fx。
   * Legacy 渲染器可以忽略（内部已通过 setAction 拿到等价动作）。
   */
  setIntent?(intent: Intent, action: PetAction, defId: number): void;
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
  /**
   * 是否由 Renderer 自己绑 click。
   * main.ts 已经统一处理单击/双击/长按/拖拽手势，Rive 失败回退 Legacy 时必须传 false，
   * 否则一次点击会同时触发手势和 renderer 的 tap，导致动作连跳两次。
   */
  bindTap?: boolean;
  /** 气泡变化回调（可选，Shell 可以监听） */
  onActionChange?: (action: PetAction) => void;
}
