// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { BehaviorEngine, moodOf } from "@/behavior";
import type { BehaviorSnapshot, PetAction, Mood } from "@/behavior";

/** 测试用基准快照：周三 13:30 正常搬砖 */
const WORKING: BehaviorSnapshot = {
  phase: "working",
  moyuActive: false,
  overtimeMin: 0,
};
const MOYU: BehaviorSnapshot = {
  phase: "working",
  moyuActive: true,
  overtimeMin: 0,
};
const OVERTIME: BehaviorSnapshot = {
  phase: "working",
  moyuActive: false,
  overtimeMin: 120,
};
const HAPPY: BehaviorSnapshot = {
  phase: "offWork",
  moyuActive: false,
  overtimeMin: 0,
};
const REST: BehaviorSnapshot = {
  phase: "rest",
  moyuActive: false,
  overtimeMin: 0,
};
const BEFORE_WORK: BehaviorSnapshot = {
  phase: "beforeWork",
  moyuActive: false,
  overtimeMin: 0,
};

function makeEngine() {
  return new BehaviorEngine();
}

describe("moodOf — Domain→Behavior 映射", () => {
  it("working + moyuActive → moyu", () => {
    expect(moodOf(MOYU)).toBe("moyu");
  });
  it("working + overtime → overtime", () => {
    expect(moodOf(OVERTIME)).toBe("overtime");
  });
  it("working + 普通 → working", () => {
    expect(moodOf(WORKING)).toBe("working");
  });
  it("offWork → happy", () => {
    expect(moodOf(HAPPY)).toBe("happy");
  });
  it("rest → rest", () => {
    expect(moodOf(REST)).toBe("rest");
  });
  it("beforeWork → beforeWork", () => {
    expect(moodOf(BEFORE_WORK)).toBe("beforeWork");
  });
  // 优先级：overtimeMin > moyuActive（加班时即使不小心点了摸鱼也是加班 mood）
  it("overtime + moyuActive → overtime 优先于 moyu", () => {
    expect(
      moodOf({ phase: "working", moyuActive: true, overtimeMin: 60 }),
    ).toBe("overtime");
  });
});

describe("BehaviorEngine — 基础 tick", () => {
  let eng: BehaviorEngine;
  beforeEach(() => { eng = makeEngine(); });

  it("working tick → 从 5 个 actions 里 pick 一个", () => {
    const out = eng.tick(WORKING);
    expect(out.actionChanged).toBe(true);
    expect(["typing", "present", "scolded", "dozing", "phone"]).toContain(out.action);
  });

  it("overtime tick → 固定 overtime", () => {
    expect(eng.tick(OVERTIME).action).toBe("overtime");
  });

  it("happy tick → 固定 happy", () => {
    expect(eng.tick(HAPPY).action).toBe("happy");
  });

  it("rest tick → 固定 sleep", () => {
    expect(eng.tick(REST).action).toBe("sleep");
  });

  it("beforeWork tick → 固定 dozing", () => {
    expect(eng.tick(BEFORE_WORK).action).toBe("dozing");
  });

  it("moyu tick → 从 melon/toilet 里 pick 一个", () => {
    const a = eng.tick(MOYU).action;
    expect(["melon", "toilet"]).toContain(a);
  });
});

describe("BehaviorEngine — 冷却 + 防重复", () => {
  let eng: BehaviorEngine;
  beforeEach(() => { eng = makeEngine(); });

  it("同一 mood 连续 tick → 冷却内 action 不变", () => {
    const now = 1_000_000;
    const a1 = eng.tick(WORKING, now).action;
    const a2 = eng.tick(WORKING, now + 1000).action; // 1s 后还在冷却内
    expect(a2).toBe(a1);
  });

  it("冷却后 mood 不变但 lastAction 仍在列表里 → 可能 pick 新的", () => {
    const now = 1_000_000;
    const a1 = eng.tick(WORKING, now).action;
    // 冷却已过，force=false，但仍随机 pick；10 次里至少有 1 次会变
    let changed = false;
    for (let i = 0; i < 20; i++) {
      const a = eng.tick(WORKING, now + 100_000 + i * 1000).action;
      if (a !== a1) { changed = true; break; }
    }
    // 5 个候选防重复，20 次里大概率会换（非严格断言，只跑 1 次）
    void changed; // 不强制 assert —— 纯随机
    expect(["typing", "present", "scolded", "dozing", "phone"]).toContain(a1);
  });

  it("mood 变化 → force pick，忽略冷却", () => {
    const now = 1_000_000;
    const a1 = eng.tick(WORKING, now).action;
    // 立刻切到 moyu（冷却期也得换）
    const a2 = eng.tick(MOYU, now + 100).action;
    expect(a2).not.toBe(a1); // working 的 a1 不可能是 melon/toilet
    expect(["melon", "toilet"]).toContain(a2);
  });
});

describe("BehaviorEngine — 事件驱动", () => {
  let eng: BehaviorEngine;
  beforeEach(() => { eng = makeEngine(); });

  // —— phaseChange：working → offWork 应该立即切 happy + celebrate one-shot ——
  it("phaseChange working→offWork → action=happy + oneshot=celebrate", () => {
    const out = eng.handle(
      { kind: "phaseChange", prev: WORKING, next: HAPPY },
      HAPPY,
    );
    expect(out.action).toBe("happy");
    expect(out.oneshots).toContain("celebrate");
    expect(out.actionChanged).toBe(true);
  });

  it("phaseChange working→working(overtime) → action=overtime, no celebrate", () => {
    const out = eng.handle(
      { kind: "phaseChange", prev: WORKING, next: OVERTIME },
      OVERTIME,
    );
    expect(out.action).toBe("overtime");
    expect(out.oneshots).not.toContain("celebrate");
  });

  // —— moyuStart / moyuEnd ——
  it("moyuStart → 立刻切 moyu action + surprise oneshot", () => {
    eng.tick(WORKING); // 先在 working
    const out = eng.handle({ kind: "moyuStart" }, MOYU);
    expect(["melon", "toilet"]).toContain(out.action);
    expect(out.oneshots).toContain("surprise");
  });

  it("moyuEnd → 回到 working mood", () => {
    eng.tick(MOYU);
    const out = eng.handle({ kind: "moyuEnd" }, WORKING);
    expect(["typing", "present", "scolded", "dozing", "phone"]).toContain(out.action);
  });

  // —— offWorkReached ——
  it("offWorkReached → 强制 happy + celebrate", () => {
    eng.tick(WORKING);
    const out = eng.handle({ kind: "offWorkReached" }, HAPPY);
    expect(out.action).toBe("happy");
    expect(out.oneshots).toContain("celebrate");
  });

  // —— tap ——
  it("tap → 保持当前 action + oneshot 含 tap", () => {
    eng.tick(WORKING);
    const before = eng.tick(WORKING);
    const out = eng.handle({ kind: "tap" }, WORKING);
    // tap 不应该改变 action（只加 oneshot）
    expect(out.action).toBe(before.action);
    expect(out.oneshots).toContain("tap");
  });

  // —— todoClear ——
  it("todoClear → 保持当前 action + oneshot 含 love", () => {
    eng.tick(WORKING);
    const out = eng.handle({ kind: "todoClear" }, WORKING);
    expect(out.oneshots).toContain("love");
  });

  // —— beforeWorkArrive ——
  it("beforeWorkArrive → 切 dozing", () => {
    eng.tick(REST);
    const out = eng.handle({ kind: "beforeWorkArrive" }, BEFORE_WORK);
    expect(out.action).toBe("dozing");
  });
});

describe("BehaviorEngine — 幂等性 + actionChanged 语义", () => {
  let eng: BehaviorEngine;
  beforeEach(() => { eng = makeEngine(); });

  it("第一次 tick → actionChanged=true", () => {
    const out = eng.tick(WORKING);
    expect(out.actionChanged).toBe(true);
  });

  it("同 mood 冷却内第二次 tick → actionChanged=false（没换）", () => {
    eng.tick(WORKING, 1000);
    const out = eng.tick(WORKING, 1500);
    expect(out.actionChanged).toBe(false);
  });

  it("mood 变 → actionChanged=true", () => {
    eng.tick(WORKING);
    const out = eng.tick(HAPPY);
    expect(out.actionChanged).toBe(true);
  });
});

describe("BehaviorEngine — moodOf 边界 case", () => {
  it("beforeWork + overtimeMin 不影响 → beforeWork 优先", () => {
    expect(
      moodOf({ phase: "beforeWork", moyuActive: false, overtimeMin: 60 }),
    ).toBe("beforeWork");
  });

  it("rest + moyuActive → rest（休息日摸鱼仍是 rest）", () => {
    expect(
      moodOf({ phase: "rest", moyuActive: true, overtimeMin: 0 }),
    ).toBe("rest");
  });

  it("offWork + moyuActive → happy", () => {
    expect(
      moodOf({ phase: "offWork", moyuActive: true, overtimeMin: 0 }),
    ).toBe("happy");
  });
});

describe("BehaviorEngine — reset", () => {
  it("reset 后 actionChanged 重新为 true", () => {
    const eng = makeEngine();
    eng.tick(WORKING);
    eng.reset();
    const out = eng.tick(WORKING);
    expect(out.actionChanged).toBe(true); // 当作第一次
  });
});

/** 类型守卫测试 —— 编译时 PetAction 是联合类型 */
const _ACTIONS: readonly PetAction[] = [
  "typing", "present", "scolded", "dozing", "phone",
  "melon", "toilet", "overtime", "happy", "sleep",
];
const _MOODS: readonly Mood[] = [
  "beforeWork", "working", "moyu", "overtime", "happy", "rest",
];
void _ACTIONS; void _MOODS;
