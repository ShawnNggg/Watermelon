/**
 * 小游戏统一接口 —— GamesPanel 负责生命周期
 *
 * 约定：
 *   mount  第一次切到该标签时调用，只建 DOM
 *   start  切到该游戏 / 抽屉打开 / 窗口恢复可见
 *   stop   切走 / 抽屉关闭 / 窗口隐藏 —— 必须停掉全部计时器与键盘监听
 */
export interface MiniGame {
  mount(host: HTMLElement): void;
  start(): void;
  stop(): void;
}
