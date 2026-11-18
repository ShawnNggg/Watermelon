// Avatar 动作库 —— 50 个动作 + 调度策略（vendor 自 watermelon-avatar）
//
// 纯数据 + 纯函数，零 DOM / Tauri 依赖。Behavior 层用它做决策，
// Renderer 层用 ActionDef.rive 的 Intent 驱动 Rive 状态机。

import type { ActionDef } from "./types";
import raw from "./actions.json";

export type {
  ActionDef,
  Ctx,
  Fx,
  Intent,
  Phase,
  Prop,
  TimeStats,
  Trigger,
  Weekday,
} from "./types";

export { canPreempt, pickIdle, resolveEvent, resolveTimed } from "./scheduler";
export { AvatarRiveRenderer } from "./AvatarRiveRenderer";
export type { AvatarRenderer } from "./renderer";
export type { RiveDogOptions } from "./AvatarRiveRenderer";

/** actions.json 的原始结构 */
interface ActionLibrary {
  version: number;
  inputs: {
    poses: Record<string, number>;
    moods: Record<string, number>;
    props: string[];
    fx: string[];
  };
  actions: ActionDef[];
}

const lib = raw as unknown as ActionLibrary;

/** 全部 50 个动作定义 */
export const ACTIONS: readonly ActionDef[] = lib.actions;

/** Rive 输入枚举（poses / moods / props / fx） */
export const AVATAR_INPUTS = lib.inputs;

export const ACTION_BY_ID: ReadonlyMap<number, ActionDef> = new Map(
  ACTIONS.map((a) => [a.id, a]),
);

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> = new Map(
  ACTIONS.map((a) => [a.key, a]),
);
