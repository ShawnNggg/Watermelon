// DayKey + startOfDay — 两个 Domain 层最常用的日期小工具
// 纯函数，不依赖时区库

const DAY_MS = 86_400_000;

/** yyyy-MM-dd 字符串，匹配 localStorage / 节假日 map 的 key 格式 */
export function dayKey(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 返回 date 当天 00:00:00 local time 的 Date */
export function startOfDay(date: Date | number): Date {
  const d = typeof date === "number" ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export { DAY_MS };
