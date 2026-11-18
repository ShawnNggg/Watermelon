import type {
  BehaviorEvent,
  BehaviorOutput,
  BehaviorSnapshot,
  Mood,
  PetAction,
} from "./types";
import type { ActionDef, Ctx, Intent, Phase, TimeStats, Weekday } from "@/avatar";
import { ACTIONS, ACTION_BY_ID, AVATAR_INPUTS, pickIdle, resolveTimed } from "@/avatar";
import { DEF_BY_LEGACY, LEGACY_BY_ID } from "./actionMap";

/**
 * Mood → 候选 action 列表（权重相等时用 pickDistinct 随机 + 防重复）
 *
 * 与 index.html 的 `[data-act="xxx"]` 选择器一一对应，共 15 个动作：
 *   working 7 · moyu 2 · overtime 3 · happy 3
 *
 * 新形象（德国牧羊犬）只有坐姿单形态，缺姿态/道具的状态已删除：
 *   present / toilet / nap / sleep / melon / read / write / music / meeting / sigh
 */
export const ACTIONS_BY_MOOD: Record<Mood, readonly PetAction[]> = {
  beforeWork: ["dozing"],
  working: [
    "typing", "scolded", "dozing", "phone", "coffee", "stretch", "think",
  ],
  moyu: ["scroll", "snack"],
  overtime: ["overtime", "crunch", "despair"],
  happy: ["happy", "dance", "wag"],
  rest: ["happy", "wag"],
};

/** Mood → 50 动作库里的 Phase（用于调度器的 phases 过滤） */
const MOOD_PHASE: Record<Mood, Phase> = {
  beforeWork: "work",
  working: "work",
  moyu: "slack",
  overtime: "overtime",
  happy: "offwork",
  rest: "holiday",
};

/** Mood → Rive mood 输入值（0=calm 1=happy 2=panic 3=sleepy 4=surprised 5=smug） */
const MOOD_INPUT: Record<Mood, number> = {
  beforeWork: AVATAR_INPUTS.moods.sleepy,
  working: AVATAR_INPUTS.moods.calm,
  moyu: AVATAR_INPUTS.moods.calm,
  overtime: AVATAR_INPUTS.moods.panic,
  happy: AVATAR_INPUTS.moods.happy,
  rest: AVATAR_INPUTS.moods.sleepy,
};

/** 每个 mood 下可用的 ActionDef —— 只保留能映射到该 mood SVG 池的动作 */
const POOL_BY_MOOD: Record<Mood, readonly ActionDef[]> = (() => {
  const out = {} as Record<Mood, ActionDef[]>;
  for (const mood of Object.keys(ACTIONS_BY_MOOD) as Mood[]) {
    out[mood] = ACTIONS.filter((a) => {
      const legacy = LEGACY_BY_ID[a.id];
      return legacy !== undefined && ACTIONS_BY_MOOD[mood].includes(legacy);
    });
  }
  return out;
})();

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

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function hhmmOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 行为引擎 —— 纯状态机，零 DOM/Tauri 依赖
 *
 * A2 融合：对外接口（tick / handle / next）保持不变，
 * 内部改用 50 动作调度器（@/avatar scheduler）在 mood 池里挑选：
 *   resolveTimed（时间/星期/日期触发） > pickIdle（加权随机） > 兜底随机
 */
export class BehaviorEngine {
  private lastMood: Mood | null = null;
  private lastAction: PetAction | null = null;
  private lastDef: ActionDef | null = null;
  private cooldownUntil = 0;   // epoch ms；冷却期内相同 mood 不再随机换 action

  /** 每个动作上次播放时间（ms）—— 供调度器 cooldownSec 判定 */
  private lastPlayedAt: Record<string, number> = {};
  /** 最后一次用户交互时间 —— 供 no_interaction_minutes 判定 */
  private lastInteractionAt = 0;

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

    const picked = this.pickForMood(mood, snap, now, forcePick);
    this.lastMood = mood;

    const changed = picked.action !== this.lastAction;
    this.lastAction = picked.action;
    this.lastDef = picked.def;

    return this.output(picked.action, picked.def, mood, [], changed);
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
        const picked = this.pickForMood(nextMood, snap, now, true);
        this.lastMood = nextMood;
        const oneshots: string[] = [];
        // 特殊过渡：下班那一刻 → celebrate one-shot
        if (event.prev.phase === "working" && event.next.phase === "offWork") {
          oneshots.push("celebrate");
        }
        const changed = picked.action !== this.lastAction;
        this.lastAction = picked.action;
        this.lastDef = picked.def;
        return this.output(picked.action, picked.def, nextMood, oneshots, changed);
      }

      case "moyuStart": {
        const picked = this.pickForMood("moyu", snap, now, true);
        this.lastMood = "moyu";
        const changed = picked.action !== this.lastAction;
        this.lastAction = picked.action;
        this.lastDef = picked.def;
        return this.output(picked.action, picked.def, "moyu", ["surprise"], changed);
      }

      case "moyuEnd": {
        const mood = moodOf(snap); // 回到 working / overtime / happy
        const picked = this.pickForMood(mood, snap, now, true);
        this.lastMood = mood;
        const changed = picked.action !== this.lastAction;
        this.lastAction = picked.action;
        this.lastDef = picked.def;
        return this.output(picked.action, picked.def, mood, [], changed);
      }

      case "offWorkReached": {
        const picked = this.pickForMood("happy", snap, now, true);
        this.lastMood = "happy";
        const changed = picked.action !== this.lastAction;
        this.lastAction = picked.action;
        this.lastDef = picked.def;
        return this.output(picked.action, picked.def, "happy", ["celebrate"], changed);
      }

      case "nearOffWork": {
        // 距离下班 <5min —— 不强制切 happy（还在 working phase）
        return this.tick(snap, now);
      }

      case "tap": {
        // 点小狗 —— 保持当前 action，发一个 one-shot
        this.leaveInteraction(now);
        const out = this.tick(snap, now);
        return { ...out, oneshots: [...out.oneshots, "tap"] };
      }

      case "doubleTap": {
        this.leaveInteraction(now);
        const picked = this.pickEvent("double_tap", snap, now);
        return picked
          ? this.commit(picked, moodOf(snap), ["tap"], now)
          : { ...this.tick(snap, now), oneshots: ["tap"] };
      }

      case "longPress": {
        this.leaveInteraction(now);
        const picked = this.pickEvent("long_press", snap, now);
        return picked
          ? this.commit(picked, moodOf(snap), ["love"], now)
          : { ...this.tick(snap, now), oneshots: ["love"] };
      }

      case "dragStart": {
        this.leaveInteraction(now);
        const picked = this.pickEvent("drag_start", snap, now);
        return picked ? this.commit(picked, moodOf(snap), [], now) : this.tick(snap, now);
      }

      case "dragEnd": {
        this.leaveInteraction(now);
        const picked = this.pickEvent("drag_end", snap, now);
        return picked ? this.commit(picked, moodOf(snap), [], now) : this.tick(snap, now);
      }

      case "todoDone": {
        this.leaveInteraction(now);
        const picked = this.pickEvent("todo_done", snap, now);
        return picked ? this.commit(picked, moodOf(snap), ["love"], now) : this.tick(snap, now);
      }

      case "todoClear": {
        const out = this.tick(snap, now);
        return { ...out, oneshots: [...out.oneshots, "love"] };
      }

      case "beforeWorkArrive": {
        const picked = this.pickForMood("beforeWork", snap, now, true);
        this.lastMood = "beforeWork";
        const changed = picked.action !== this.lastAction;
        this.lastAction = picked.action;
        this.lastDef = picked.def;
        return this.output(picked.action, picked.def, "beforeWork", [], changed);
      }
    }
  }

  /** 点击小狗：立刻换一个当前 mood 下的动作（跳过冷却） */
  next(snap: BehaviorSnapshot, now: number = Date.now()): BehaviorOutput {
    const mood = moodOf(snap);
    this.leaveInteraction(now);
    // 跳过冷却 —— 用调度器换一个不同动作；pickForMood 内部会避开 lastAction
    const picked = this.pickForMood(mood, snap, now, true, true);
    this.lastMood = mood;
    const changed = picked.action !== this.lastAction;
    this.lastAction = picked.action;
    this.lastDef = picked.def;
    return this.output(picked.action, picked.def, mood, [], changed);
  }

  /** 调试面板：直接播放指定 id 的动作（不参与冷却/权重） */
  preview(id: number, snap: BehaviorSnapshot, now: number = Date.now()): BehaviorOutput {
    const def = ACTION_BY_ID.get(id);
    if (!def) return this.tick(snap, now);
    return this.commit(def, moodOf(snap), [], now);
  }

  /** 重置所有内部状态 —— 测试或重载时用 */
  reset(): void {
    this.lastMood = null;
    this.lastAction = null;
    this.lastDef = null;
    this.cooldownUntil = 0;
    this.lastPlayedAt = {};
    this.lastInteractionAt = 0;
  }

  // —— 内部 ——

  private leaveInteraction(now: number): void {
    this.lastInteractionAt = now;
  }

  /** 事件触发：在 mood 池里找匹配该事件的 ActionDef */
  private pickEvent(name: string, snap: BehaviorSnapshot, now: number): ActionDef | null {
    const mood = moodOf(snap);
    const pool = POOL_BY_MOOD[mood];
    const ctx: Ctx = {
      phase: MOOD_PHASE[mood],
      now,
      lastPlayedAt: this.lastPlayedAt,
      current: this.lastDef,
    };
    const list = pool.filter((a) => {
      const t = a.trigger;
      return t.kind === "event" && t.name === name;
    });
    if (!list.length) return null;
    // 事件动作直接生效（触发类动作优先级最高）
    return list.sort((a, b) => b.priority - a.priority)[0] ?? null;
  }

  private commit(
    def: ActionDef,
    mood: Mood,
    oneshots: string[],
    now: number,
  ): BehaviorOutput {
    this.lastPlayedAt[def.key] = now;
    this.cooldownUntil = now + this.ACTION_COOLDOWN_MS;
    const action = LEGACY_BY_ID[def.id] ?? this.lastAction ?? "typing";
    const changed = action !== this.lastAction;
    this.lastAction = action;
    this.lastDef = def;
    this.lastMood = mood;
    return this.output(action, def, mood, oneshots, changed);
  }

  private pickForMood(
    mood: Mood,
    snap: BehaviorSnapshot,
    now: number,
    force: boolean,
    skipCooldown = false,
  ): { action: PetAction; def: ActionDef | null } {
    const legacyPool = ACTIONS_BY_MOOD[mood];
    const pool = POOL_BY_MOOD[mood];

    if (pool.length === 0) {
      return { action: legacyPool[0] ?? "typing", def: null };
    }

    // 只有一个候选 —— 直接返回，别折腾
    if (legacyPool.length === 1) {
      const def = pool[0] ?? null;
      if (def) this.lastPlayedAt[def.key] = now;
      return { action: legacyPool[0], def };
    }

    // 冷却期 —— 保持不变（除非 force / skipCooldown）
    // 注意：这里不能要求 lastAction 在当前 mood 池内。preview / 事件（老板键）
    // 会指定跨池动作（例如 working 状态播 sleep），若按池过滤就会在下一帧被立刻覆盖。
    if (!force && !skipCooldown && now < this.cooldownUntil && this.lastAction != null) {
      return { action: this.lastAction, def: this.lastDef };
    }

    const ctx: Ctx = {
      phase: MOOD_PHASE[mood],
      now,
      lastPlayedAt: this.lastPlayedAt,
      current: force ? null : this.lastDef,
    };

    // 1) 时间/星期/日期触发（优先级最高）
    const timed = resolveTimed(pool.slice(), ctx, this.timeStats(snap, now));
    // 2) 空闲加权随机
    const picked = timed ?? pickIdle(pool.slice(), ctx) ?? null;

    let def = picked;
    let action = def ? LEGACY_BY_ID[def.id] : undefined;

    // 防重复：挑到和上次一样（或映射后一样）的就换一个
    if (!action || action === this.lastAction) {
      const candidates = pool.filter((d) => LEGACY_BY_ID[d.id] !== this.lastAction);
      const from = candidates.length ? candidates : pool;
      def = from[Math.floor(Math.random() * from.length)] ?? null;
      action = def ? LEGACY_BY_ID[def.id] : undefined;
    }

    if (!action) return { action: legacyPool[0], def: null };

    // 启动冷却 + 记录播放时间
    this.cooldownUntil = now + this.ACTION_COOLDOWN_MS;
    if (def) this.lastPlayedAt[def.key] = now;

    return { action, def };
  }

  /** 组装调度器需要的时间统计 */
  private timeStats(snap: BehaviorSnapshot, now: number): TimeStats {
    const d = new Date(now);
    return {
      noInteractionMinutes:
        this.lastInteractionAt > 0 ? Math.floor((now - this.lastInteractionAt) / 60_000) : 0,
      slackMinutesToday: snap.slackMinutesToday ?? 0,
      minutesToOffwork: snap.minutesToOffwork ?? null,
      weekday: WEEKDAYS[d.getDay()],
      hhmm: hhmmOf(d),
      dateFlags: snap.dateFlags ?? [],
    };
  }

  /** 组装输出 —— 补全 Intent（B2 契约：action / pose / mood / props / fx） */
  private output(
    action: PetAction,
    def: ActionDef | null,
    mood: Mood,
    oneshots: string[],
    changed: boolean,
  ): BehaviorOutput {
    const intent: Intent = def
      ? { ...def.rive }
      : this.syntheticIntent(action, mood);
    return { action, defId: def?.id ?? 0, intent, oneshots, actionChanged: changed };
  }

  /** 没有对应 ActionDef 时（25 动作里的 write / crunch 等），合成一份最小 Intent */
  private syntheticIntent(action: PetAction, mood: Mood): Intent {
    const fallback = ACTION_BY_ID.get(DEF_BY_LEGACY[action] ?? 1);
    if (fallback) {
      return {
        ...fallback.rive,
        mood: MOOD_INPUT[mood],
      };
    }
    return { action: 0, pose: null, mood: MOOD_INPUT[mood], props: [], fx: [] };
  }
}
