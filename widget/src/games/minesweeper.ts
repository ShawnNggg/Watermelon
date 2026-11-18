import type { MiniGame } from "./types";
import { loadRecords, saveRecord } from "./records";

const N = 9;
const MINES = 10;

interface Cell {
  mine: boolean;
  open: boolean;
  flag: boolean;
  boom: boolean;
  n: number;
}

/** 扫雷：9×9 / 10 雷；首点安全，右键插旗 */
export class MinesweeperGame implements MiniGame {
  private gridEl: HTMLElement | null = null;
  private mineEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private faceEl: HTMLElement | null = null;
  private tipEl: HTMLElement | null = null;
  private inputs: HTMLButtonElement[] = [];

  private cells: Cell[] = [];
  private started = false;
  private over = false;
  private opened = 0;
  private flags = 0;
  private sec = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  mount(host: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "gm-mines";
    root.innerHTML = `
      <div class="gm-hud">
        <span>💣 <b class="m">${MINES}</b></span>
        <button class="gm-face" title="重新开始">🙂</button>
        <span>⏱ <b class="t">0</b>s</span>
      </div>
      <div class="gm-grid"></div>
      <div class="gm-tip">左键翻开 · 右键插旗</div>
    `;
    host.appendChild(root);

    this.gridEl = root.querySelector(".gm-grid") as HTMLElement;
    this.mineEl = root.querySelector(".gm-hud .m") as HTMLElement;
    this.timeEl = root.querySelector(".gm-hud .t") as HTMLElement;
    this.faceEl = root.querySelector(".gm-face") as HTMLElement;
    this.tipEl = root.querySelector(".gm-tip") as HTMLElement;

    this.gridEl.style.gridTemplateColumns = `repeat(${N}, 26px)`;
    for (let i = 0; i < N * N; i++) {
      const b = document.createElement("button");
      b.className = "gm-cell";
      b.dataset.i = String(i);
      b.addEventListener("click", () => this.revealAt(i));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.toggleFlag(i);
      });
      this.gridEl.appendChild(b);
      this.inputs.push(b);
    }
    this.faceEl.addEventListener("click", () => this.reset());
    this.reset();
  }

  start(): void {
    if (this.started && !this.over && !this.timer) {
      this.timer = setInterval(this.tick, 1000);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // —— 内部 ——

  private tick = (): void => {
    this.sec++;
    if (this.timeEl) this.timeEl.textContent = String(this.sec);
  };

  private reset(): void {
    this.stop();
    this.cells = Array.from({ length: N * N }, () => ({
      mine: false,
      open: false,
      flag: false,
      boom: false,
      n: 0,
    }));
    this.started = false;
    this.over = false;
    this.opened = 0;
    this.flags = 0;
    this.sec = 0;
    if (this.faceEl) this.faceEl.textContent = "🙂";
    if (this.tipEl) this.tipEl.textContent = "左键翻开 · 右键插旗";
    this.paint();
  }

  private placeMines(safe: number): void {
    const banned = new Set<number>([safe, ...this.neighbors(safe)]);
    const pool: number[] = [];
    for (let i = 0; i < N * N; i++) if (!banned.has(i)) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const idx of pool.slice(0, MINES)) this.cells[idx].mine = true;
    for (let i = 0; i < N * N; i++) {
      this.cells[i].n = this.neighbors(i).filter((k) => this.cells[k].mine).length;
    }
  }

  private neighbors(i: number): number[] {
    const r = Math.floor(i / N);
    const c = i % N;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) out.push(nr * N + nc);
      }
    }
    return out;
  }

  private revealAt(i: number): void {
    if (this.over) return;
    const cell = this.cells[i];
    if (cell.flag || cell.open) return;
    if (!this.started) {
      this.started = true;
      this.placeMines(i);
      this.timer = setInterval(this.tick, 1000);
    }
    if (cell.mine) {
      cell.open = true;
      cell.boom = true;
      this.lose();
      return;
    }
    this.flood(i);
    if (this.opened === N * N - MINES) this.winGame();
    this.paint();
  }

  private flood(start: number): void {
    const stack = [start];
    while (stack.length) {
      const idx = stack.pop() as number;
      const cell = this.cells[idx];
      if (cell.open || cell.flag || cell.mine) continue;
      cell.open = true;
      this.opened++;
      if (cell.n === 0) {
        for (const nb of this.neighbors(idx)) {
          if (!this.cells[nb].open) stack.push(nb);
        }
      }
    }
  }

  private toggleFlag(i: number): void {
    if (this.over) return;
    const cell = this.cells[i];
    if (cell.open) return;
    cell.flag = !cell.flag;
    this.flags += cell.flag ? 1 : -1;
    if (this.mineEl) this.mineEl.textContent = String(MINES - this.flags);
    this.paint();
  }

  private lose(): void {
    this.over = true;
    this.stop();
    for (const c of this.cells) if (c.mine) c.open = true;
    if (this.faceEl) this.faceEl.textContent = "😵";
    if (this.tipEl) this.tipEl.textContent = "踩雷了，再来一次";
    this.paint();
  }

  private winGame(): void {
    this.over = true;
    this.stop();
    for (const c of this.cells) if (c.mine) c.flag = true;
    this.flags = MINES;
    if (this.mineEl) this.mineEl.textContent = "0";
    if (this.faceEl) this.faceEl.textContent = "😎";
    const isBest = saveRecord("minesSec", this.sec, true);
    const best = loadRecords().minesSec;
    if (this.tipEl) {
      this.tipEl.textContent = `扫完了 · 用时 ${this.sec}s${isBest ? " · 新纪录！" : ` · 最佳 ${best}s`}`;
    }
    this.paint();
  }

  private paint(): void {
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      const btn = this.inputs[i];
      if (!btn) continue;
      const cls = ["gm-cell"];
      if (c.open) cls.push("open");
      if (c.flag) cls.push("flag");
      if (c.open && c.mine) cls.push(c.boom ? "boom" : "mine");
      if (c.open && c.n > 0) cls.push(`n${c.n}`);
      btn.className = cls.join(" ");
      btn.textContent = c.open ? (c.mine ? "💣" : c.n > 0 ? String(c.n) : "") : c.flag ? "🚩" : "";
    }
    if (this.mineEl && !this.over) this.mineEl.textContent = String(Math.max(0, MINES - this.flags));
    if (this.timeEl) this.timeEl.textContent = String(this.sec);
  }
}
