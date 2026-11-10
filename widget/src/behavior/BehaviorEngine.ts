import type {
  BehaviorEvent,
  BehaviorOutput,
  BehaviorSnapshot,
  Mood,
  PetAction,
} from "./types";

/**
 * Mood → 候选 action 列表（权重相等时用 pickDistinct 随机 + 防重复）
 *
 * 与 index.html 的 `[data-act="xxx"]` 选择器一一对应，共 25 个动作：
 *   working 13 · moyu 5 · overtime 3 · happy 3 · rest 1（dozing 与 beforeWork 共用）
 */
export const ACTIONS_BY_MOOD: Record<Mood, readonly PetAction[]> = {
  beforeWork: ["dozing"],
  working: [
    "typing", "present", "scolded", "dozing", "phone", "coffee", "stretch",
    "think", "read", "write", "music", "meeting", "sigh",
  ],
  moyu: ["melon", "toilet", "scroll", "snack", "nap"],
  overtime: ["overtime", "crunch", "despair"],
  happy: ["happy", "dance", "wag"],
  rest: ["sleep"],
};

/** 从 Domain 快照映射到 Behavior 的 Mood —— 纯函数，零 DOM 依赖 */
export function moodOf(snap: BehaviorSnapshot): Mood {
  if (snap.phase === "beforeWork") return "beforeWork";
  if (snap.phase === "offWork") return "happy";
  if (snap.phase === "rest") return "rest";
  // working 阶段内部细分：overtime > moyu > 普通搬砖
  if (snap.overtimeMin > 0) return "overtime";
  if (snap.moyuActive) return "moyu";
  return "working";
}

/**
 * 行为引擎 —— 纯状态机，零 DOM/Tauri 依赖
 *
 * 职责：
 * 1. 维护 lastAction / lastMood / cooldownUntil 内部状态
 * 2. 给定 Domain 快照 + 事件 → 输出当前 action + oneshots
 * 3. 支持优先级：phaseChange > moyuToggle > overtime > 普通轮换
 * 4. 冷却 + 防连续重复
 */
export class BehaviorEngine {
  private lastMood: Mood | null = null;
  private lastAction: PetAction | null = null;
  private cooldownUntil = 0;   // epoch ms；冷却期内相同 mood 不再随机换 action

  /** 两次轮换之间的间隔（ms）—— 2 分钟换一个动作 */
  readonly ROTATE_INTERVAL_MS = 120_000;

  /** action 冷却（ms）—— 冷却内同一 mood 保持当前动作，到期才轮换 */
  readonly ACTION_COOLDOWN_MS = 120_000;

  /**
   * 每帧 / 每次 render 调用：根据快照挑选当前 action。
   * 这是"正常运行"路径，不处理事件。
   */
  tick(snap: BehaviorSnapshot, now: number = Date.now()): BehaviorOutput {
    const mood = moodOf(snap);
    const forcePick = mood !== this.lastMood; // mood 变了 → 强制重选

    const action = this.pickForMood(mood, now, forcePick);
    this.lastMood = mood;

    const changed = action !== this.lastAction;
    this.lastAction = action;

    return { action, oneshots: [], actionChanged: changed };
  }

  /**
   * 事件驱动 —— 立刻处理一个事件，可能覆盖 tick() 的默认行为。
   * 返回 BehaviorOutput；调用方决定是否替换 tick() 的结果。
   */
  handle(
    event: BehaviorEvent,
    snap: BehaviorSnapshot,
    now: number = Date.now(),
  ): BehaviorOutput {
    switch (event.kind) {
      case "phaseChange": {
        // 高优先级 —— 阶段变了立刻重选
        const nextMood = moodOf(snap);
        const action = this.pickForMood(nextMood, now, true);
        this.lastMood = nextMood;
        const oneshots: string[] = [];
        // 特殊过渡：下班那一刻 → celebrate one-shot
        if (event.prev.phase === "working" && event.next.phase === "offWork") {
          oneshots.push("celebrate");
        }
        const changed = action !== this.lastAction;
        this.lastAction = action;
        return { action, oneshots, actionChanged: changed };
      }

      case "moyuStart": {
        const action = this.pickForMood("moyu", now, true);
        this.lastMood = "moyu";
        const changed = action !== this.lastAction;
        this.lastAction = action;
        return { action, oneshots: ["surprise"], actionChanged: changed };
      }

      case "moyuEnd": {
        const mood = moodOf(snap); // 回到 working / overtime / happy
        const action = this.pickForMood(mood, now, true);
        this.lastMood = mood;
        const changed = action !== this.lastAction;
        this.lastAction = action;
        return { action, oneshots: [], actionChanged: changed };
      }

      case "offWorkReached": {
        const action = this.pickForMood("happy", now, true);
        this.lastMood = "happy";
        const changed = action !== this.lastAction;
        this.lastAction = action;
        return { action, oneshots: ["celebrate"], actionChanged: changed };
      }

      case "nearOffWork": {
        // 距离下班 <5min —— 不强制切 happy（还在 working phase）
        // 但可以放宽 rotate 间隔，或在 oneshots 里提示即将下班
        return this.tick(snap, now);
      }

      case "tap": {
        // 点小狗 —— 保持当前 action，发一个 one-shot
        const out = this.tick(snap, now);
        return { ...out, oneshots: [...out.oneshots, "tap"] };
      }

      case "todoClear": {
        const out = this.tick(snap, now);
        return { ...out, oneshots: [...out.oneshots, "love"] };
      }

      case "beforeWorkArrive": {
        const action = this.pickForMood("beforeWork", now, true);
        this.lastMood = "beforeWork";
        const changed = action !== this.lastAction;
        this.lastAction = action;
        return { action, oneshots: [], actionChanged: changed };
      }
    }
  }

  /** 点击小狗：立刻换一个当前 mood 下的动作（跳过冷却） */
  next(snap: BehaviorSnapshot, now: number = Date.now()): BehaviorOutput {
    const mood = moodOf(snap);
    const action = this.pickForMood(mood, now, true);
    this.lastMood = mood;
    const changed = action !== this.lastAction;
    this.lastAction = action;
    return { action, oneshots: [], actionChanged: changed };
  }

  /** 重置所有内部状态 —— 测试或重载时用 */
  reset(): void {
    this.lastMood = null;
    this.lastAction = null;
    this.cooldownUntil = 0;
  }

  // —— 内部 ——

  private pickForMood(mood: Mood, now: number, force: boolean): PetAction {
    const list = ACTIONS_BY_MOOD[mood];
    if (list.length === 0) return "typing";

    // 只有一个候选 —— 直接返回，别折腾
    if (list.length === 1) return list[0];

    // 冷却期 + 上次 action 还在列表里 —— 保持不变（除非 force=true）
    if (
      !force &&
      now < this.cooldownUntil &&
      this.lastAction != null &&
      list.includes(this.lastAction)
    ) {
      return this.lastAction;
    }

    // 从列表里 pick 一个 != lastAction 的
    let next = pick(list);
    let guard = 0;
    while (next === this.lastAction && guard++ < 10) {
      next = pick(list);
    }

    // 启动冷却
    this.cooldownUntil = now + this.ACTION_COOLDOWN_MS;
    return next;
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
