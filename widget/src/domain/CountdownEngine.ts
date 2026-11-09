import type {
  CountdownState,
  DayOverrides,
  HolidayInfo,
  MoyuSession,
  PhaseSnapshot,
  WeekendCountdown,
  WorkdayResult,
  WorkSchedule,
} from "./types";
import { DAY_MS, startOfDay } from "./dateUtils";
import { resolveDay } from "./WorkdayResolver";

/**
 * 倒计时引擎 — 纯函数，时钟可注入，无 DOM/Tauri 依赖。
 *
 * 对应 index.html 里的 statusAt / moyuMs / weekendCountdown 等，
 * 从业务逻辑中剥离出来作为 Domain 层唯一真相源。
 */
export class CountdownEngine {
  constructor(
    /** 外部可注入：某一天的 HolidayInfo。null 表示查不到。 */
    public holidayProvider: (date: Date) => HolidayInfo | null = () => null,
  ) {}

  /** 某时间点的 phase + progress + remaining 快照 */
  phaseAt(
    now: Date | number,
    schedule: WorkSchedule,
    overrides: DayOverrides = {},
  ): PhaseSnapshot {
    const t = typeof now === "number" ? now : now.getTime();
    const date = new Date(t);
    const r = resolveDay(date, schedule, overrides, this.holidayProvider(date));

    if (!r.work) {
      return { phase: "rest", progress: 0, remaining: 0, workday: r };
    }
    if (t < (r.start ?? 0)) {
      return {
        phase: "beforeWork",
        progress: 0,
        remaining: (r.start ?? 0) - t,
        workday: r,
      };
    }
    if (t < (r.end ?? 0)) {
      const total = (r.end ?? 0) - (r.start ?? 0);
      const elapsed = t - (r.start ?? 0);
      const progress = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;
      return {
        phase: "working",
        progress,
        remaining: (r.end ?? 0) - t,
        workday: r,
      };
    }
    return { phase: "offWork", progress: 1, remaining: 0, workday: r };
  }

  /** 摸鱼会话统计 — 累计今天时长 + 是否进行中 */
  moyuSummary(
    date: Date | number,
    sessions: MoyuSession[],
    now: Date | number,
  ): { active: boolean; totalMs: number; currentMs: number } {
    const d = typeof date === "number" ? new Date(date) : date;
    const sod = startOfDay(d).getTime();
    const eod = sod + DAY_MS;
    const nowMs = typeof now === "number" ? now : now.getTime();

    let total = 0;
    let active = false;
    let currentMs = 0;
    for (const s of sessions) {
      const end = s.end ?? nowMs;
      const overlapStart = Math.max(s.start, sod);
      const overlapEnd = Math.min(end, eod);
      if (overlapEnd > overlapStart) {
        total += overlapEnd - overlapStart;
      }
      if (s.end == null && s.start < nowMs) {
        active = true;
        currentMs = Math.max(0, nowMs - s.start);
      }
    }
    return { active, totalMs: total, currentMs };
  }

  /** 周末倒计时 — 扫 4 周找下一个有效的"下班时刻" */
  weekendCountdown(
    now: Date | number,
    schedule: WorkSchedule,
    overrides: DayOverrides = {},
  ): WeekendCountdown | undefined {
    const nowMs = typeof now === "number" ? now : now.getTime();
    const date = new Date(nowMs);
    // 周一 00:00 的 offset (JS getDay: 0=周日, 1=周一, ..., 6=周六)
    // (d.getDay() + 6) % 7 → 周一=0, 周二=1, ..., 周日=6
    const mon0 = (date.getDay() + 6) % 7;
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(startOfDay(date).getTime() + (w * 7 - mon0) * DAY_MS);
      let lastEnd: number | null = null;
      for (let i = 0; i < 7; i++) {
        const probe = new Date(weekStart.getTime() + i * DAY_MS);
        const r = resolveDay(probe, schedule, overrides, this.holidayProvider(probe));
        if (r.work && r.end) lastEnd = r.end;
      }
      if (lastEnd != null && lastEnd > nowMs) {
        return { target: lastEnd, remaining: lastEnd - nowMs };
      }
    }
    return undefined;
  }

  /** 把 phaseAt + moyuSummary + weekendCountdown 合起来 —— 模拟 Swift 版 CountdownEngine.state() */
  state(
    now: Date | number,
    schedule: WorkSchedule,
    overrides: DayOverrides = {},
    moyuSessions: MoyuSession[] = [],
  ): CountdownState {
    const t = typeof now === "number" ? now : now.getTime();
    const phase = this.phaseAt(t, schedule, overrides);
    const moyu = this.moyuSummary(t, moyuSessions, t);
    const weekend = this.weekendCountdown(t, schedule, overrides);
    return {
      phase: phase.phase,
      progress: phase.progress,
      remaining: phase.remaining,
      workday: phase.workday,
      moyu,
      weekend,
    };
  }

  /** 下一个休息日 00:00 — 周末进度条要用 */
  nextRestDayStart(
    now: Date | number,
    schedule: WorkSchedule,
    overrides: DayOverrides = {},
  ): Date | null {
    const nowMs = typeof now === "number" ? now : now.getTime();
    const date = new Date(nowMs);
    const mon0 = (date.getDay() + 6) % 7;
    for (let w = 0; w < 3; w++) {
      const weekStart = new Date(startOfDay(date).getTime() + (w * 7 - mon0) * DAY_MS);
      for (let i = 0; i < 7; i++) {
        const probe = new Date(weekStart.getTime() + i * DAY_MS);
        const r = resolveDay(probe, schedule, overrides, this.holidayProvider(probe));
        if (!r.work && startOfDay(probe).getTime() >= startOfDay(date).getTime()) {
          return startOfDay(probe);
        }
      }
    }
    return null;
  }
}

/** 重新导出，方便外部只从 CountdownEngine/WorkdayResolver 入口消费 */
export type { WorkdayResult };
