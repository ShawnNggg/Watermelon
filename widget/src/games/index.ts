import type { MiniGame } from "./types";
import { TypingGame } from "./typing";
import { TetrisGame } from "./tetris";
import { MinesweeperGame } from "./minesweeper";
import { SudokuGame } from "./sudoku";

export type GameId = "typing" | "tetris" | "mines" | "sudoku";

interface TabDef {
  id: GameId;
  label: string;
  create: () => MiniGame;
}

const TABS: TabDef[] = [
  { id: "typing", label: "假装很忙", create: () => new TypingGame() },
  { id: "tetris", label: "俄罗斯方块", create: () => new TetrisGame() },
  { id: "mines", label: "扫雷", create: () => new MinesweeperGame() },
  { id: "sudoku", label: "数独", create: () => new SudokuGame() },
];

/**
 * 摸鱼游戏面板 —— 负责标签切换与生命周期
 *
 * 每个游戏懒加载：第一次切到该标签才建 DOM。
 * 切走 / 关闭抽屉 / 窗口隐藏时统一 stop()，避免后台空转。
 */
export class GamesPanel {
  private tabButtons = new Map<GameId, HTMLButtonElement>();
  private games = new Map<GameId, MiniGame>();
  private wraps = new Map<GameId, HTMLElement>();
  private activeId: GameId = "typing";
  private active: MiniGame | null = null;
  private open = false;
  private built = false;

  constructor(
    private tabsHost: HTMLElement,
    private bodyHost: HTMLElement,
    private onLayout: () => void,
  ) {}

  /** 抽屉打开 */
  show(): void {
    this.open = true;
    this.activate(this.activeId);
  }

  /** 抽屉关闭 */
  hide(): void {
    this.open = false;
    this.active?.stop();
    this.active = null;
  }

  /** 窗口不可见 —— 暂停当前游戏 */
  pause(): void {
    if (this.open) this.active?.stop();
  }

  /** 窗口恢复可见 —— 继续当前游戏 */
  resume(): void {
    if (this.open && this.active) this.active.start();
  }

  // —— 内部 ——

  private build(): void {
    if (this.built) return;
    this.built = true;
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.className = "seg-btn";
      btn.textContent = tab.label;
      btn.onclick = () => this.activate(tab.id);
      this.tabsHost.appendChild(btn);
      this.tabButtons.set(tab.id, btn);
    }
  }

  private activate(id: GameId): void {
    this.build();
    this.active?.stop();

    let game = this.games.get(id);
    let wrap = this.wraps.get(id);
    if (!game || !wrap) {
      wrap = document.createElement("div");
      wrap.className = "gm-game";
      wrap.hidden = true;
      this.bodyHost.appendChild(wrap);
      game = TABS.find((t) => t.id === id)!.create();
      game.mount(wrap);
      this.games.set(id, game);
      this.wraps.set(id, wrap);
    }

    for (const [gid, el] of this.wraps) el.hidden = gid !== id;
    this.activeId = id;
    this.active = game;
    for (const [gid, btn] of this.tabButtons) btn.classList.toggle("on", gid === id);

    if (this.open) game.start();
    this.onLayout();
  }
}
