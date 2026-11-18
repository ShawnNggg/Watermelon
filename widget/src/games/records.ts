/** 小游戏历史记录（localStorage） */

const KEY = "watermelon-widget-games-v1";

export interface GameRecords {
  /** 打字最高 WPM */
  typingWpm: number;
  /** 俄罗斯方块最高分 */
  tetris: number;
  /** 扫雷最快通关秒数（0 = 未通关） */
  minesSec: number;
  /** 数独最快通关秒数（0 = 未通关） */
  sudokuSec: number;
}

const DEFAULTS: GameRecords = {
  typingWpm: 0,
  tetris: 0,
  minesSec: 0,
  sudokuSec: 0,
};

export function loadRecords(): GameRecords {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<GameRecords>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 写入一条记录；lowerIsBetter = true 时数值越小越好。返回是否刷新了纪录 */
export function saveRecord<K extends keyof GameRecords>(
  key: K,
  value: number,
  lowerIsBetter = false,
): boolean {
  if (value <= 0) return false;
  const all = loadRecords();
  const old = all[key];
  const better = old === 0 || (lowerIsBetter ? value < old : value > old);
  if (!better) return false;
  all[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 隐私模式等场景静默失败 */
  }
  return true;
}
