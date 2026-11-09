import { describe, it, expect } from "vitest";
import {
  CountdownEngine,
  resolveDay,
  dayKey,
  startOfDay,
  DAY_MS,
} from "@/domain";
import type { HolidayInfo, WorkSchedule } from "@/domain";

const DEFAULT_SCHEDULE: WorkSchedule = {
  // Mon=2..Fri=6（遵循 JS getDay()+1：周日=1，周一=2，…，周六=7）
  workdays: [2, 3, 4, 5, 6],
  startH: 9,
  startM: 0,
  endH: 18,
  endM: 0,
};

/** 构造一个 Date：传 local y/m/d/h/m/s */
function mk(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s);
}

/** 找已知的：周三 / 周五 / 周六 / 周日 / 2026-05-09（劳动节调休补班，周六） */
// 2026-05-09 是周六（调休补班，isOffDay=false）
// 2026-10-01 是周四（国庆，isOffDay=true）
// 2026-11-09 是周一（今天）
// 用 getDay() 先自证日期正确
describe("date anchors sanity", () => {
  it("2026-11-09 is Monday (getDay=1)", () => {
    expect(mk(2026, 11, 9).getDay()).toBe(1);
  });
  it("2026-05-09 is Saturday (getDay=6)", () => {
    expect(mk(2026, 5, 9).getDay()).toBe(6);
  });
  it("2026-10-01 is Thursday (getDay=4)", () => {
    expect(mk(2026, 10, 1).getDay()).toBe(4);
  });
  it("2026-11-14 is Saturday (getDay=6)", () => {
    expect(mk(2026, 11, 14).getDay()).toBe(6);
  });
});

describe("dayKey / startOfDay", () => {
  it("dayKey formats yyyy-MM-dd", () => {
    expect(dayKey(mk(2026, 11, 9, 15, 30))).toBe("2026-11-09");
  });
  it("dayKey with single-digit month/day", () => {
    expect(dayKey(mk(2026, 5, 1, 8, 0))).toBe("2026-05-01");
  });
  it("startOfDay zeros time", () => {
    const d = startOfDay(mk(2026, 11, 9, 15, 30, 45));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

describe("resolveDay", () => {
  // —— 场景 1：周三 13:30（普通工作日）——
  it("周三 13:30 — 工作日，start=09:00 end=18:00", () => {
    const wed = mk(2026, 11, 4, 13, 30); // 2026-11-04 周三
    expect(wed.getDay()).toBe(3);
    const r = resolveDay(wed, DEFAULT_SCHEDULE);
    expect(r.work).toBe(true);
    expect(r.start).toBe(mk(2026, 11, 4, 9, 0).getTime());
    expect(r.end).toBe(mk(2026, 11, 4, 18, 0).getTime());
    expect(r.normalEnd).toBe(r.end);
    expect(r.overtimeMin).toBe(0);
  });

  // —— 场景 2：周六无节假日 ——
  it("周六 10:00 — 周末休息", () => {
    const sat = mk(2026, 11, 14, 10, 0);
    expect(sat.getDay()).toBe(6);
    const r = resolveDay(sat, DEFAULT_SCHEDULE);
    expect(r.work).toBe(false);
    expect(r.reason).toBe("weekend");
  });

  // —— 场景 3：周日 ——
  it("周日 — 周末休息", () => {
    const sun = mk(2026, 11, 15, 12, 0);
    expect(sun.getDay()).toBe(0);
    const r = resolveDay(sun, DEFAULT_SCHEDULE);
    expect(r.work).toBe(false);
    expect(r.reason).toBe("weekend");
  });

  // —— 场景 4：2026-05-09 周六 + 节假日调休补班 ——
  it("2026-05-09 周六 + 调休补班 — 仍然 work=true", () => {
    const satMakeup = mk(2026, 5, 9, 10, 0);
    expect(satMakeup.getDay()).toBe(6);
    const holiday: HolidayInfo = {
      isOffDay: false,
      name: "劳动节",
      source: "holiday",
    };
    const r = resolveDay(satMakeup, DEFAULT_SCHEDULE, {}, holiday);
    expect(r.work).toBe(true);
    expect(r.start).toBe(mk(2026, 5, 9, 9, 0).getTime());
    expect(r.end).toBe(mk(2026, 5, 9, 18, 0).getTime());
  });

  // —— 场景 5：2026-10-01 周四 + 国庆 ——
  it("2026-10-01 周四 + 国庆 — work=false holiday", () => {
    const thu = mk(2026, 10, 1, 10, 0);
    expect(thu.getDay()).toBe(4);
    const holiday: HolidayInfo = {
      isOffDay: true,
      name: "国庆节",
      source: "holiday",
    };
    const r = resolveDay(thu, DEFAULT_SCHEDULE, {}, holiday);
    expect(r.work).toBe(false);
    expect(r.reason).toBe("holiday");
    expect(r.holidayName).toBe("国庆节");
  });

  // —— 场景 6：手动 override holiday 优先级最高 ——
  it("手动 holiday override 优先于工作日", () => {
    const mon = mk(2026, 11, 9, 10, 0);
    expect(mon.getDay()).toBe(1);
    const r = resolveDay(mon, DEFAULT_SCHEDULE, {
      "2026-11-09": { kind: "holiday" },
    });
    expect(r.work).toBe(false);
    expect(r.reason).toBe("holiday");
  });

  // —— 场景 7：手动 leave override ——
  it("leave override — reason=leave", () => {
    const mon = mk(2026, 11, 9, 10, 0);
    const r = resolveDay(mon, DEFAULT_SCHEDULE, {
      "2026-11-09": { kind: "leave" },
    });
    expect(r.work).toBe(false);
    expect(r.reason).toBe("leave");
  });

  // —— 场景 8：overtime override ——
  it("overtime +120min → end 延长到 20:00", () => {
    const wed = mk(2026, 11, 4, 13, 30);
    const r = resolveDay(wed, DEFAULT_SCHEDULE, {
      "2026-11-04": { kind: "overtime", minutes: 120 },
    });
    expect(r.work).toBe(true);
    expect(r.overtimeMin).toBe(120);
    expect(r.end).toBe(mk(2026, 11, 4, 20, 0).getTime());
    expect(r.normalEnd).toBe(mk(2026, 11, 4, 18, 0).getTime());
  });

  // —— 场景 9：overtime 跨午夜截断 ——
  it("overtime 到 23:00 + 2h → 被截断到 23:59:59.999", () => {
    const lateSchedule: WorkSchedule = {
      workdays: [2, 3, 4, 5, 6],
      startH: 21,
      startM: 0,
      endH: 23,
      endM: 0,
    };
    const wed = mk(2026, 11, 4, 22, 0);
    const r = resolveDay(wed, lateSchedule, {
      "2026-11-04": { kind: "overtime", minutes: 120 },
    });
    expect(r.work).toBe(true);
    expect(r.end).toBeLessThan(mk(2026, 11, 5, 0, 0).getTime());
  });
});

describe("CountdownEngine — phaseAt", () => {
  const eng = new CountdownEngine();

  // —— 场景 A：周三 08:00 — beforeWork ——
  it("周三 08:00 — phase=beforeWork, remaining=1h", () => {
    const t = mk(2026, 11, 4, 8, 0);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("beforeWork");
    expect(snap.progress).toBe(0);
    expect(snap.remaining).toBe(60 * 60 * 1000); // 1h
  });

  // —— 场景 B：周三 13:30 — working, progress≈50% ——
  it("周三 13:30 — phase=working, progress≈50%", () => {
    const t = mk(2026, 11, 4, 13, 30);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("working");
    expect(snap.progress).toBeGreaterThan(0.45);
    expect(snap.progress).toBeLessThan(0.55);
  });

  // —— 场景 C：周三 18:00 整 — offWork ——
  it("周三 18:00 — phase=offWork, progress=1", () => {
    const t = mk(2026, 11, 4, 18, 0);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("offWork");
    expect(snap.progress).toBe(1);
  });

  // —— 场景 D：周三 19:00 + overtime 120min — 还在 working ——
  it("周三 19:00 + overtime 2h — 仍在 working，progress≈67%", () => {
    const t = mk(2026, 11, 4, 19, 0);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE, {
      "2026-11-04": { kind: "overtime", minutes: 120 },
    });
    expect(snap.phase).toBe("working");
    // 9:00-20:00=11h, 19:00 时 elapsed=10h → 10/11≈0.91
    expect(snap.progress).toBeGreaterThan(0.85);
  });

  // —— 场景 E：周六下午 — rest ——
  it("周六 15:00 — phase=rest", () => {
    const t = mk(2026, 11, 14, 15, 0);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("rest");
    expect(snap.workday?.reason).toBe("weekend");
  });
});

describe("CountdownEngine — moyuSummary", () => {
  const eng = new CountdownEngine();

  it("无会话 — active=false, totalMs=0", () => {
    const t = mk(2026, 11, 4, 14, 0);
    const m = eng.moyuSummary(t, [], t);
    expect(m.active).toBe(false);
    expect(m.totalMs).toBe(0);
  });

  it("进行中会话 — active=true, currentMs≈30min", () => {
    const start = mk(2026, 11, 4, 13, 30).getTime();
    const now = mk(2026, 11, 4, 14, 0).getTime();
    const m = eng.moyuSummary(now, [{ start }], now);
    expect(m.active).toBe(true);
    expect(m.currentMs).toBe(30 * 60 * 1000);
  });

  it("已结束会话 — active=false, totalMs=30min", () => {
    const start = mk(2026, 11, 4, 13, 30).getTime();
    const end = mk(2026, 11, 4, 14, 0).getTime();
    const now = mk(2026, 11, 4, 15, 0).getTime();
    const m = eng.moyuSummary(now, [{ start, end }], now);
    expect(m.active).toBe(false);
    expect(m.totalMs).toBe(30 * 60 * 1000);
  });

  it("跨天会话 — 只统计当天部分", () => {
    // 昨天 23:30 开始，今天 00:30 结束 → 今天只算 30min
    const start = mk(2026, 11, 3, 23, 30).getTime();
    const end = mk(2026, 11, 4, 0, 30).getTime();
    const now = mk(2026, 11, 4, 10, 0).getTime();
    const m = eng.moyuSummary(now, [{ start, end }], now);
    expect(m.totalMs).toBe(30 * 60 * 1000);
  });

  it("今天两个会话都累计", () => {
    const sessions = [
      { start: mk(2026, 11, 4, 10, 0).getTime(), end: mk(2026, 11, 4, 10, 30).getTime() },
      { start: mk(2026, 11, 4, 14, 0).getTime(), end: mk(2026, 11, 4, 14, 15).getTime() },
    ];
    const now = mk(2026, 11, 4, 15, 0).getTime();
    const m = eng.moyuSummary(now, sessions, now);
    expect(m.totalMs).toBe(45 * 60 * 1000); // 45 min
  });
});

describe("CountdownEngine — holidayProvider 注入", () => {
  /** 模拟 Calendar.app 离线缓存：2026-05-09 补班 / 2026-10-01 国庆 */
  const HOLIDAY_CACHE: Record<string, HolidayInfo> = {
    "2026-05-09": { isOffDay: false, name: "劳动节", source: "calendar" },
    "2026-10-01": { isOffDay: true, name: "国庆节", source: "calendar" },
  };
  const eng = new CountdownEngine((d) => HOLIDAY_CACHE[dayKey(d)] ?? null);

  it("2026-05-09（周六 + 补班）→ phase=working", () => {
    const t = mk(2026, 5, 9, 10, 0);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("working");
  });

  it("2026-10-01（周四 + 国庆）→ phase=rest, reason=holiday", () => {
    const t = mk(2026, 10, 1, 10, 0);
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("rest");
    expect(snap.workday?.reason).toBe("holiday");
    expect(snap.workday?.holidayName).toBe("国庆节");
  });

  it("未命中节假日 → 回退 workdays 判定", () => {
    const t = mk(2026, 11, 14, 10, 0); // 周六，不在缓存里
    const snap = eng.phaseAt(t, DEFAULT_SCHEDULE);
    expect(snap.phase).toBe("rest");
    expect(snap.workday?.reason).toBe("weekend");
  });
});

describe("CountdownEngine — weekendCountdown + state", () => {
  const eng = new CountdownEngine();

  it("周三 13:30 → weekendCountdown = 本周最后一个工作日下班（周五 18:00）", () => {
    const t = mk(2026, 11, 4, 13, 30); // 2026-11-04 周三
    const wc = eng.weekendCountdown(t, DEFAULT_SCHEDULE);
    expect(wc).toBeDefined();
    expect(wc!.target).toBe(mk(2026, 11, 6, 18, 0).getTime()); // 周五 18:00
    expect(wc!.remaining).toBe(wc!.target - t.getTime());
  });

  it("周五 17:00 → state 完整输出", () => {
    const t = mk(2026, 11, 6, 17, 0);
    const st = eng.state(t, DEFAULT_SCHEDULE);
    expect(st.phase).toBe("working");
    // 9:00-18:00=9h, 17:00 elapsed=8h → 8/9≈0.889
    expect(st.progress).toBeCloseTo(0.889, 2);
    expect(st.progress).toBeLessThan(1);
    expect(st.remaining).toBe(60 * 60 * 1000); // 还剩 1h 下班
    expect(st.moyu.active).toBe(false);
    expect(st.weekend).toBeDefined();
    expect(st.weekend!.target).toBe(mk(2026, 11, 6, 18, 0).getTime());
    expect(st.weekend!.remaining).toBe(60 * 60 * 1000);
  });

  it("周五 17:00 + 摸鱼会话进行中", () => {
    const t = mk(2026, 11, 6, 17, 0).getTime();
    const st = eng.state(t, DEFAULT_SCHEDULE, {}, [
      { start: mk(2026, 11, 6, 15, 30).getTime() },
    ]);
    expect(st.phase).toBe("working");
    expect(st.moyu.active).toBe(true);
    expect(st.moyu.totalMs).toBeGreaterThan(0);
    expect(st.moyu.currentMs).toBeCloseTo(90 * 60 * 1000, 0); // ~90min
  });
});
