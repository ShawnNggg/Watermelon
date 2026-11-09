import type {
  DayOverrides,
  HolidayInfo,
  WorkdayResult,
  WorkSchedule,
} from "./types";
import { DAY_MS, dayKey, startOfDay } from "./dateUtils";

/**
 * 解析某一天的"是否工作日 / 上下班时刻 / 加班 / 放假 / 调休"。
 *
 * 纯函数：输入全是值，不依赖 localStorage / Tauri / DOM。
 * 优先级（跟 index.html 完全一致）：
 *   1. 用户手动 override（holiday / leave → 休息；overtime → 先继续算时间）
 *   2. 节假日数据源命中（isOffDay=true → 放；isOffDay=false → 调休补班）
 *   3. 本地 schedule.workdays.includes(dayOfWeek) 判定
 */
export function resolveDay(
  date: Date | number,
  schedule: WorkSchedule,
  overrides: DayOverrides = {},
  holiday: HolidayInfo | null = null,
): WorkdayResult {
  const day = typeof date === "number" ? new Date(date) : date;
  const key = dayKey(day);
  const ov = overrides[key];

  // —— 最高优先级：用户手动 override ——
  if (ov?.kind === "holiday") return { work: false, reason: "holiday", overtimeMin: 0 };
  if (ov?.kind === "leave") return { work: false, reason: "leave", overtimeMin: 0 };

  // —— 节假日数据源命中 ——
  if (holiday) {
    if (holiday.isOffDay) {
      return {
        work: false,
        reason: "holiday",
        holidayName: holiday.name,
        overtimeMin: 0,
      };
    }
    // isOffDay=false → 调休补班，强制 work=true，跳过周末判定
  } else if (!schedule.workdays.includes(day.getDay() + 1)) {
    // 没命中节假日数据 → 回退到本地 schedule
    return { work: false, reason: "weekend", overtimeMin: 0 };
  }

  // —— 到这里：workday 或调休补班 ——
  const sod = startOfDay(day);
  const start = new Date(sod);
  start.setHours(schedule.startH, schedule.startM, 0, 0);
  let end = new Date(sod);
  end.setHours(schedule.endH, schedule.endM, 0, 0);
  const normalEnd = new Date(end);

  if (ov?.kind === "overtime") {
    end = new Date(end.getTime() + ov.minutes * 60_000);
  }

  const limit = new Date(sod.getTime() + DAY_MS - 1000);
  if (end.getTime() > limit.getTime()) end = limit;

  if (end.getTime() <= start.getTime()) {
    return { work: false, reason: "weekend", overtimeMin: 0 };
  }

  return {
    work: true,
    start: start.getTime(),
    end: end.getTime(),
    normalEnd: normalEnd.getTime(),
    overtimeMin: ov?.kind === "overtime" ? ov.minutes : 0,
    holidayName: holiday?.source === "holiday" ? holiday.name : undefined,
  };
}
