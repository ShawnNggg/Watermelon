import type { MiniGame } from "./types";
import { loadRecords, saveRecord } from "./records";

/** 保留的已知数个数（36 → 中等难度） */
const CLUES = 36;

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 第 i 格所在行/列/宫已用数字的位掩码（bit d 表示数字 d 已用） */
function usedMask(g: number[], i: number): number {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  let mask = 0;
  for (let k = 0; k < 9; k++) {
    mask |= 1 << g[r * 9 + k];
    mask |= 1 << g[k * 9 + c];
    mask |= 1 << g[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)];
  }
  return mask;
}

/** 数解个数（最多数到 limit 个，用于唯一解校验） */
function countSolutions(g: number[], limit = 2): number {
  const i = g.indexOf(0);
  if (i < 0) return 1;
  const used = usedMask(g, i);
  let total = 0;
  for (let d = 1; d <= 9; d++) {
    if (used & (1 << d)) continue;
    g[i] = d;
    total += countSolutions(g, limit - total);
    g[i] = 0;
    if (total >= limit) return total;
  }
  return total;
}

/** 生成完整解 */
function filled(): number[] {
  const g = new Array<number>(81).fill(0);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    if (g[i]) return fill(i + 1);
    const used = usedMask(g, i);
    for (const d of shuffled(digits)) {
      if (used & (1 << d)) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
      g[i] = 0;
    }
    return false;
  };
  fill(0);
  return g;
}

/** 挖空并保证唯一解 */
function makePuzzle(): number[] {
  const solution = filled();
  const puzzle = solution.slice();
  const order = shuffled([...Array(81).keys()]);
  const target = 81 - CLUES;
  let removed = 0;
  for (const i of order) {
    if (removed >= target) break;
    const bak = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle, 2) !== 1) puzzle[i] = bak;
    else removed++;
  }
  return puzzle;
}

/**
 * 数独：9×9，中等难度，输入冲突标红，全部填对自动结算。
 */
export class SudokuGame implements MiniGame {
  private gridEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private tipEl: HTMLElement | null = null;
  private inputs: HTMLInputElement[] = [];
  private done = false;
  private begun = false;
  private sec = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  mount(host: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "gm-sudoku";
    root.innerHTML = `
      <div class="gm-hud">
        <span>⏱ <b class="t">00:00</b></span>
        <span>难度 中 · 36 个已知数</span>
        <button class="gm-btn" title="换一题">换一题</button>
      </div>
      <div class="gm-sgrid"></div>
      <div class="gm-tip">点格子输入 1–9 · 方向键移动 · 冲突标红</div>
    `;
    host.appendChild(root);

    this.gridEl = root.querySelector(".gm-sgrid") as HTMLElement;
    this.timeEl = root.querySelector(".gm-hud .t") as HTMLElement;
    this.tipEl = root.querySelector(".gm-tip") as HTMLElement;
    const again = root.querySelector(".gm-btn") as HTMLButtonElement;
    again.onclick = () => this.newPuzzle();

    for (let i = 0; i < 81; i++) {
      const inp = document.createElement("input");
      inp.className = "gm-scell";
      inp.maxLength = 1;
      inp.inputMode = "numeric";
      if (i % 9 === 2 || i % 9 === 5) inp.classList.add("br");
      if (Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5) inp.classList.add("bb");
      inp.addEventListener("input", () => this.onInput(i));
      inp.addEventListener("keydown", (e) => this.onCellKey(e, i));
      inp.addEventListener("focus", () => inp.select());
      this.gridEl.appendChild(inp);
      this.inputs.push(inp);
    }
    this.newPuzzle();
  }

  start(): void {
    if (this.begun && !this.done && !this.timer) {
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
    this.paintTime();
  };

  private newPuzzle(): void {
    this.stop();
    const puzzle = makePuzzle();
    this.done = false;
    this.begun = false;
    this.sec = 0;
    this.paintTime();
    this.inputs.forEach((inp, i) => {
      const v = puzzle[i];
      inp.value = v ? String(v) : "";
      inp.readOnly = v > 0;
      inp.classList.toggle("given", v > 0);
      inp.classList.remove("bad");
    });
    const best = loadRecords().sudokuSec;
    if (this.tipEl) {
      this.tipEl.textContent = best
        ? `点格子输入 1–9 · 历史最快 ${this.fmt(best)}`
        : "点格子输入 1–9 · 方向键移动 · 冲突标红";
    }
  }

  private onInput(i: number): void {
    const inp = this.inputs[i];
    if (inp.readOnly) return;
    const v = inp.value.replace(/[^1-9]/g, "").slice(-1);
    inp.value = v;
    if (v && !this.begun) {
      this.begun = true;
      this.timer = setInterval(this.tick, 1000);
    }
    this.check();
    if (v) {
      const next = this.nextEmpty(i);
      if (next >= 0) this.inputs[next].focus();
    }
  }

  private onCellKey(e: KeyboardEvent, i: number): void {
    const move: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowRight: i + 1,
      ArrowUp: i - 9,
      ArrowDown: i + 9,
    };
    const dest = move[e.key];
    if (dest !== undefined && dest >= 0 && dest < 81) {
      e.preventDefault();
      this.inputs[dest].focus();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const inp = this.inputs[i];
      if (inp.readOnly) return;
      e.preventDefault();
      inp.value = "";
      this.check();
    }
  }

  private nextEmpty(i: number): number {
    for (let k = i + 1; k < 81; k++) if (!this.inputs[k].value) return k;
    for (let k = 0; k < i; k++) if (!this.inputs[k].value) return k;
    return -1;
  }

  private check(): void {
    const vals = this.inputs.map((x) => Number(x.value) || 0);
    const groups: number[][] = [];
    for (let r = 0; r < 9; r++) groups.push([...Array(9)].map((_, c) => r * 9 + c));
    for (let c = 0; c < 9; c++) groups.push([...Array(9)].map((_, r) => r * 9 + c));
    for (let b = 0; b < 9; b++) {
      const br = Math.floor(b / 3) * 3;
      const bc = (b % 3) * 3;
      groups.push([...Array(9)].map((_, k) => (br + Math.floor(k / 3)) * 9 + bc + (k % 3)));
    }
    const bad = new Set<number>();
    for (const g of groups) {
      const seen = new Map<number, number[]>();
      for (const idx of g) {
        const v = vals[idx];
        if (!v) continue;
        const list = seen.get(v);
        if (list) list.push(idx);
        else seen.set(v, [idx]);
      }
      for (const list of seen.values()) {
        if (list.length > 1) for (const idx of list) bad.add(idx);
      }
    }
    this.inputs.forEach((inp, i) => inp.classList.toggle("bad", bad.has(i)));
    if (!this.done && vals.every((v) => v > 0) && bad.size === 0) this.finish();
  }

  private finish(): void {
    this.done = true;
    this.stop();
    const isBest = saveRecord("sudokuSec", this.sec, true);
    if (this.tipEl) {
      this.tipEl.textContent = `完成！用时 ${this.fmt(this.sec)}${isBest ? " · 新纪录！" : ""}`;
    }
  }

  private paintTime(): void {
    if (this.timeEl) this.timeEl.textContent = this.fmt(this.sec);
  }

  private fmt(sec: number): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(Math.floor(sec / 60))}:${p(sec % 60)}`;
  }
}
