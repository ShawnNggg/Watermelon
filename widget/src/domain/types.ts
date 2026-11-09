// Domain 类型定义 — 纯数据，零 DOM / Tauri 依赖

/** 工作状态机 phase */
export type Phase = "beforeWork" | "working" | "offWork" | "rest";

/** 休息日原因 */
export type RestReason = "weekend" | "holiday" | "leave";

/** 一天的 override（最高优先级） */
export type DayOverride =
  | { kind: "holiday" }
  | { kind: "leave" }
  | { kind: "overtime"; minutes: number };

/** 一天的 override 字典，key 是 `yyyy-MM-dd` */
export type DayOverrides = Record<string, DayOverride>;

/** 节假日/调休信息（来自日历 API / 离线缓存 / Calendar.app） */
export interface HolidayInfo {
  /** true = 放假；false = 调休补班 */
  isOffDay: boolean;
  name?: string;
  source: "calendar" | "holiday" | "none";
}

/** 日程 */
export interface WorkSchedule {
  /** 工作日编号，遵循 JS getDay() + 1 惯例：1=周日、2=周一、…、7=周六 */
  workdays: number[];
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}

/** 摸鱼会话 */
export interface MoyuSession {
  start: number; // epoch ms
  end?: number | null; // null = 进行中
}

/** resolveDay 的结果 */
export interface WorkdayResult {
  work: boolean;
  reason?: RestReason;
  holidayName?: string;
  /** 工作开始/结束 epoch ms */
  start?: number;
  end?: number;
  /** 不含加班的正常下班时间 */
  normalEnd?: number;
  /** 今日加班分钟数（0 = 无） */
  overtimeMin: number;
}

/** phaseAt 输出 — 一个时间点的业务快照 */
export interface PhaseSnapshot {
  phase: Phase;
  /** 0-1，仅 working 时有意义 */
  progress: number;
  /** 到"下一个里程碑"还剩多少 ms：working→下班 / beforeWork→上班 / rest→0 / offWork→0 */
  remaining: number;
  workday?: WorkdayResult;
}

/** 摸鱼统计快照 */
export interface MoyuSummary {
  active: boolean;
  /** 今天累计摸鱼时长 ms */
  totalMs: number;
  /** 当前进行中的会话 ms（仅 active=true 时） */
  currentMs: number;
}

/** 周末倒计时 */
export interface WeekendCountdown {
  /** 距今天（当前）最近的"下班时刻"epoch ms */
  target: number;
  remaining: number;
}

/** 引擎完整 state 输出（Domain 层的最终产物） */
export interface CountdownState {
  phase: Phase;
  progress: number;
  remaining: number;
  workday?: WorkdayResult;
  moyu: MoyuSummary;
  weekend?: WeekendCountdown;
}
