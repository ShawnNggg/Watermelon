import type { MiniGame } from "./types";
import { loadRecords, saveRecord } from "./records";

const COLS = 10;
const ROWS = 20;
const CELL = 15;

/** 0 号是空格占位，其余对应 7 种方块 */
const COLORS = ["#171B21", "#FF5D73", "#FFB547", "#7BD389", "#5FB0F5", "#B58BFF", "#4DD0C4", "#FFE066"];

const PIECES: number[][][] = [
  [[1, 1, 1, 1]], // I
  [[1, 1], [1, 1]], // O
  [[0, 1, 0], [1, 1, 1]], // T
  [[1, 0, 0], [1, 1, 1]], // J
  [[0, 0, 1], [1, 1, 1]], // L
  [[0, 1, 1], [1, 1, 0]], // S
  [[1, 1, 0], [0, 1, 1]], // Z
];

interface Piece {
  m: number[][];
  x: number;
  y: number;
  c: number;
}

function rotate(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0].length;
  const out: number[][] = Array.from({ length: cols }, () => new Array<number>(rows).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out[c][rows - 1 - r] = m[r][c];
  }
  return out;
}

export class TetrisGame implements MiniGame {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private overlay: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private linesEl: HTMLElement | null = null;
  private levelEl: HTMLElement | null = null;
  private bestEl: HTMLElement | null = null;

  private board: number[][] = [];
  private cur: Piece | null = null;
  private score = 0;
  private lines = 0;
  private level = 1;
  private over = false;
  private paused = false;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private bound = false;

  mount(host: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "gm-tetris";
    root.innerHTML = `
      <div class="gm-hud">
        <span>分数 <b class="s">0</b></span>
        <span>行 <b class="l">0</b></span>
        <span>等级 <b class="v">1</b></span>
        <span>最高 <b class="b">0</b></span>
      </div>
      <div class="gm-canvas-wrap">
        <canvas></canvas>
        <div class="gm-overlay"></div>
      </div>
      <div class="gm-tip">← → 移动 · ↑ 旋转 · ↓ 加速 · 空格 直落 · P 暂停</div>
    `;
    host.appendChild(root);

    const canvas = root.querySelector("canvas") as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = COLS * CELL * dpr;
    canvas.height = ROWS * CELL * dpr;
    canvas.style.width = `${COLS * CELL}px`;
    canvas.style.height = `${ROWS * CELL}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.canvas = canvas;
    this.ctx = ctx;
    this.overlay = root.querySelector(".gm-overlay") as HTMLElement;
    this.scoreEl = root.querySelector(".gm-hud .s") as HTMLElement;
    this.linesEl = root.querySelector(".gm-hud .l") as HTMLElement;
    this.levelEl = root.querySelector(".gm-hud .v") as HTMLElement;
    this.bestEl = root.querySelector(".gm-hud .b") as HTMLElement;

    this.reset();
  }

  start(): void {
    this.bind();
    if (this.over) return;
    if (!this.running) {
      this.running = true;
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  stop(): void {
    this.unbind();
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // —— 内部 ——

  private reset(): void {
    this.board = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.over = false;
    this.paused = false;
    this.acc = 0;
    this.last = 0;
    this.spawn();
    this.paintHud();
    this.updateOverlay();
    this.draw();
  }

  private bind(): void {
    if (this.bound) return;
    window.addEventListener("keydown", this.onKey);
    this.bound = true;
  }

  private unbind(): void {
    if (!this.bound) return;
    window.removeEventListener("keydown", this.onKey);
    this.bound = false;
  }

  private frame = (t: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.last) this.last = t;
    const dt = t - this.last;
    this.last = t;
    if (this.over || this.paused) {
      this.draw();
      return;
    }
    this.acc += dt;
    const speed = Math.max(90, 700 - (this.level - 1) * 65);
    if (this.acc >= speed) {
      this.acc = 0;
      this.step();
    }
    this.draw();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "p" || e.key === "P") {
      if (this.over) return;
      e.preventDefault();
      this.paused = !this.paused;
      this.updateOverlay();
      return;
    }
    if (this.over || this.paused) {
      if (e.key === "Enter" && this.over) {
        e.preventDefault();
        this.reset();
        this.start();
      }
      return;
    }
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        this.move(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        this.move(1);
        break;
      case "ArrowDown":
        e.preventDefault();
        this.step();
        break;
      case "ArrowUp":
        e.preventDefault();
        this.rotateCur();
        break;
      case " ":
        e.preventDefault();
        this.hardDrop();
        break;
      default:
        return;
    }
    this.draw();
  };

  private fit(m: number[][], x: number, y: number): boolean {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const bx = x + c;
        const by = y + r;
        if (bx < 0 || bx >= COLS || by >= ROWS) return false;
        if (by >= 0 && this.board[by][bx]) return false;
      }
    }
    return true;
  }

  private spawn(): void {
    const idx = Math.floor(Math.random() * PIECES.length);
    const m = PIECES[idx].map((row) => row.slice());
    const x = Math.floor((COLS - m[0].length) / 2);
    this.cur = { m, x, y: 0, c: idx + 1 };
    if (!this.fit(m, x, 0)) {
      this.cur = null;
      this.over = true;
      const isBest = saveRecord("tetris", this.score);
      this.updateOverlay(isBest);
      this.paintHud();
    }
  }

  private move(dx: number): void {
    const p = this.cur;
    if (!p) return;
    if (this.fit(p.m, p.x + dx, p.y)) p.x += dx;
  }

  private rotateCur(): void {
    const p = this.cur;
    if (!p) return;
    const m = rotate(p.m);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (this.fit(m, p.x + kick, p.y)) {
        p.m = m;
        p.x += kick;
        return;
      }
    }
  }

  /** 下落一格；落不下去就锁定 */
  private step(): void {
    const p = this.cur;
    if (!p) return;
    if (this.fit(p.m, p.x, p.y + 1)) {
      p.y++;
    } else {
      this.lock();
    }
  }

  private hardDrop(): void {
    const p = this.cur;
    if (!p) return;
    while (this.fit(p.m, p.x, p.y + 1)) p.y++;
    this.lock();
  }

  private lock(): void {
    const p = this.cur;
    if (!p) return;
    for (let r = 0; r < p.m.length; r++) {
      for (let c = 0; c < p.m[r].length; c++) {
        if (!p.m[r][c]) continue;
        const by = p.y + r;
        const bx = p.x + c;
        if (by >= 0) this.board[by][bx] = p.c;
      }
    }
    this.clearLines();
    if (!this.over) this.spawn();
    this.paintHud();
  }

  private clearLines(): void {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every((v) => v > 0)) {
        this.board.splice(r, 1);
        this.board.unshift(new Array<number>(COLS).fill(0));
        cleared++;
        r++;
      }
    }
    if (!cleared) return;
    const table = [0, 100, 300, 500, 800];
    this.score += (table[cleared] ?? 800) * this.level;
    this.lines += cleared;
    this.level = 1 + Math.floor(this.lines / 10);
  }

  private paintHud(): void {
    if (this.scoreEl) this.scoreEl.textContent = String(this.score);
    if (this.linesEl) this.linesEl.textContent = String(this.lines);
    if (this.levelEl) this.levelEl.textContent = String(this.level);
    if (this.bestEl) this.bestEl.textContent = String(Math.max(loadRecords().tetris, this.score));
  }

  private updateOverlay(isBest = false): void {
    const el = this.overlay;
    if (!el) return;
    if (this.over) {
      el.replaceChildren();
      const line = document.createElement("div");
      line.textContent = `游戏结束 · 得分 ${this.score}`;
      const sub = document.createElement("div");
      sub.textContent = isBest ? "新纪录！按 Enter 再来一局" : "按 Enter 再来一局";
      const btn = document.createElement("button");
      btn.className = "gm-btn";
      btn.textContent = "重新开始";
      btn.onclick = () => {
        this.reset();
        this.start();
      };
      el.append(line, sub, btn);
      el.classList.add("show");
    } else if (this.paused) {
      el.textContent = "已暂停（P 继续）";
      el.classList.add("show");
    } else {
      el.classList.remove("show");
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = COLS * CELL;
    const h = ROWS * CELL;
    ctx.fillStyle = COLORS[0];
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,.045)";
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL + 0.5, 0);
      ctx.lineTo(c * CELL + 0.5, h);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL + 0.5);
      ctx.lineTo(w, r * CELL + 0.5);
      ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = this.board[r][c];
        if (v) this.block(c, r, COLORS[v]);
      }
    }

    const p = this.cur;
    if (p && !this.over) {
      for (let r = 0; r < p.m.length; r++) {
        for (let c = 0; c < p.m[r].length; c++) {
          if (p.m[r][c]) this.block(p.x + c, p.y + r, COLORS[p.c]);
        }
      }
    }
  }

  private block(x: number, y: number, color: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = "rgba(255,255,255,.22)";
    ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, 2);
  }
}
