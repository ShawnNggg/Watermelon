import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ACTION_BY_KEY,
  canPreempt,
  pickIdle,
  resolveEvent,
  resolveTimed,
} from "@/avatar";
import type { ActionDef, Ctx, TimeStats } from "@/avatar";

const by = (k: string) => ACTION_BY_KEY.get(k)! as ActionDef;

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  phase: "work",
  now: 1e9,
  lastPlayedAt: {},
  current: null,
  ...over,
});

const stats = (o: Partial<TimeStats> = {}): TimeStats => ({
  noInteractionMinutes: 0,
  slackMinutesToday: 0,
  minutesToOffwork: null,
  weekday: "wed",
  hhmm: "10:00",
  dateFlags: [],
  ...o,
});

describe("avatar/actions.json 数据完整性", () => {
  it("恰好 50 个动作，id 与 key 唯一", () => {
    expect(ACTIONS.length).toBe(50);
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(50);
    expect(new Set(ACTIONS.map((a) => a.key)).size).toBe(50);
  });
});

describe("pickIdle", () => {
  it("只挑当前 phase 的动作", () => {
    for (let i = 0; i < 200; i++) {
      const a = pickIdle(ACTIONS.slice(), ctx({ phase: "slack" }))!;
      expect(a.phases).toContain("slack");
    }
  });

  it("冷却未过 → 返回 null", () => {
    const only = ACTIONS.filter((a) => a.key === "drink_coffee");
    const r = pickIdle(only, ctx({ lastPlayedAt: { drink_coffee: 1e9 - 1000 } }));
    expect(r).toBeNull();
  });
});

describe("resolveEvent", () => {
  it("tap → tap_wag", () => {
    expect(resolveEvent(ACTIONS.slice(), "tap", ctx())!.key).toBe("tap_wag");
  });

  it("睡觉被 tap → startled_awake", () => {
    const r = resolveEvent(
      ACTIONS.slice(),
      "tap",
      ctx({ phase: "leave", current: by("sleep_deep") }),
    );
    expect(r!.key).toBe("startled_awake");
  });

  it("boss_key → boss_alert", () => {
    expect(resolveEvent(ACTIONS.slice(), "boss_key", ctx({ phase: "slack" }))!.key).toBe(
      "boss_alert",
    );
  });

  it("不可打断的 boss_alert 不会被 tap 覆盖", () => {
    const r = resolveEvent(
      ACTIONS.slice(),
      "tap",
      ctx({ phase: "slack", current: by("boss_alert") }),
    );
    expect(r).toBeNull();
  });

  it("phase_enter(offwork) → offwork_cheer", () => {
    const r = resolveEvent(ACTIONS.slice(), "phase_enter", ctx({ phase: "offwork" }), {
      phase: "offwork",
    });
    expect(r!.key).toBe("offwork_cheer");
  });

  it("drag_start → dangle_legs", () => {
    expect(resolveEvent(ACTIONS.slice(), "drag_start", ctx())!.key).toBe("dangle_legs");
  });
});

describe("resolveTimed", () => {
  it("6 分钟无交互 + leave → sleep_deep", () => {
    const r = resolveTimed(
      ACTIONS.slice(),
      ctx({ phase: "leave" }),
      stats({ noInteractionMinutes: 6 }),
    );
    expect(r!.key).toBe("sleep_deep");
  });

  it("周五 → friday_excite", () => {
    expect(resolveTimed(ACTIONS.slice(), ctx(), stats({ weekday: "fri" }))!.key).toBe(
      "friday_excite",
    );
  });

  it("12:10 → lunch", () => {
    expect(resolveTimed(ACTIONS.slice(), ctx(), stats({ hhmm: "12:10" }))!.key).toBe("lunch");
  });

  it("摸鱼超 60 分钟 → slack_hour_badge", () => {
    const r = resolveTimed(
      ACTIONS.slice(),
      ctx({ phase: "slack" }),
      stats({ slackMinutesToday: 65 }),
    );
    expect(r!.key).toBe("slack_hour_badge");
  });

  it("距下班 10 分钟 → check_watch", () => {
    expect(resolveTimed(ACTIONS.slice(), ctx(), stats({ minutesToOffwork: 10 }))!.key).toBe(
      "check_watch",
    );
  });
});

describe("canPreempt", () => {
  it("高优先级可打断低优先级", () => {
    expect(canPreempt(by("sleep_deep"), by("boss_alert"))).toBe(true);
  });
});
