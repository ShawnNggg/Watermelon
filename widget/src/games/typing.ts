import type { MiniGame } from "./types";
import { loadRecords, saveRecord } from "./records";

/** 一局 60 秒 */
const ROUND_MS = 60_000;
/** 忙碌指数打满所需字符数 */
const BUSY_CHARS = 320;

/** 假装在忙的代码/命令池（纯 ASCII，避免输入法打断） */
const POOL = [
  'const deadline = new Date("18:00");',
  'git commit -m "fix: offwork bug"',
  "SELECT * FROM todos WHERE done = 0;",
  "npm run build -- --production",
  "if (boss.nearby) { lookBusy(); }",
  "async function pretend() { await sleep(); }",
  "// TODO: rename this variable later",
  "docker compose up -d --build",
  "ssh deploy@prod-server -p 22",
  'return Promise.resolve("done");',
  'console.log("still working...");',
  "kubectl get pods -n production",
  "curl -s https://api.example.com/health",
  "export const busy = true;",
  "while (clock < 18) { type(); }",
  "for (let i = 0; i < 99; i++) wait();",
  'grep -rn "deadline" ./src',
  "git push origin feature/almost-done",
];

/**
 * 打字游戏：把每一句话当作一行代码敲进假 IDE，
 * 看起来像在改 bug，实际上在摸鱼。
 */
export class TypingGame implements MiniGame {
  private root: HTMLElement | null = null;
  private editorEl!: HTMLElement;
  private histEl!: HTMLElement;
  private lineEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private wpmEl!: HTMLElement;
  private accEl!: HTMLElement;
  private busyEl!: HTMLElement;
  private tipEl!: HTMLElement;

  private target = "";
  private pos = 0;
  private correct = 0;
  private wrong = 0;
  private history: string[] = [];
  private remaining = ROUND_MS;
  private lastTick = 0;
  private begun = false;
  private ended = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private shakeTimer: ReturnType<typeof setTimeout> | null = null;
  private bound = false;

  mount(host: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "gm-typing";
    root.innerHTML = `
      <div class="gm-editor">
        <div class="gm-editor-bar"><i></i><i></i><i></i><span>main.ts — 假装很忙</span></div>
        <div class="gm-code-area">
          <div class="gm-hist"></div>
          <div class="gm-code-line"></div>
        </div>
      </div>
      <div class="gm-stats">
        <span>⏱ <b class="t">60</b>s</span>
        <span>⚡ <b class="w">0</b> WPM</span>
        <span>✓ <b class="a">100</b>%</span>
      </div>
      <div class="gm-busy"><div class="gm-busy-fill"></div></div>
      <div class="gm-tip"></div>
    `;
    host.appendChild(root);
    this.root = root;
    this.editorEl = root.querySelector(".gm-editor") as HTMLElement;
    this.histEl = root.querySelector(".gm-hist") as HTMLElement;
    this.lineEl = root.querySelector(".gm-code-line") as HTMLElement;
    this.timeEl = root.querySelector(".gm-stats .t") as HTMLElement;
    this.wpmEl = root.querySelector(".gm-stats .w") as HTMLElement;
    this.accEl = root.querySelector(".gm-stats .a") as HTMLElement;
    this.busyEl = root.querySelector(".gm-busy-fill") as HTMLElement;
    this.tipEl = root.querySelector(".gm-tip") as HTMLElement;
    this.reset();
  }

  start(): void {
    this.bind();
    if (!this.begun || this.ended) return;
    if (!this.timer) {
      this.lastTick = Date.now();
      this.timer = setInterval(this.tick, 200);
    }
  }

  stop(): void {
    this.unbind();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.shakeTimer) {
      clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
  }

  // —— 内部 ——

  private reset(): void {
    this.stop();
    this.begun = false;
    this.ended = false;
    this.remaining = ROUND_MS;
    this.correct = 0;
    this.wrong = 0;
    this.pos = 0;
    this.history = [];
    this.target = this.pickLine();
    this.histEl.replaceChildren();
    this.paintLine();
    this.paintStats();
    const best = loadRecords().typingWpm;
    this.tipEl.textContent = best
      ? `敲键盘开始 · 历史最佳 ${best} WPM`
      : "敲键盘开始 · 正在假装改 bug";
  }

  private pickLine(): string {
    const rest = POOL.filter((l) => l !== this.target);
    return rest[Math.floor(Math.random() * rest.length)] ?? POOL[0];
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

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Tab" || e.key.length !== 1 || this.ended) return;
    e.preventDefault();
    if (!this.begun) {
      this.begun = true;
      this.lastTick = Date.now();
      this.timer = setInterval(this.tick, 200);
      this.tipEl.textContent = "保持这个手速，老板以为你在写代码";
    }
    if (e.key === this.target[this.pos]) {
      this.pos++;
      this.correct++;
      if (this.pos >= this.target.length) {
        this.history.push(this.target);
        if (this.history.length > 4) this.history.shift();
        this.histEl.replaceChildren(
          ...this.history.map((txt) => {
            const d = document.createElement("div");
            d.className = "gm-code-line done";
            d.textContent = txt;
            return d;
          }),
        );
        this.target = this.pickLine();
        this.pos = 0;
      }
      this.paintLine();
    } else {
      this.wrong++;
      this.shake();
    }
    this.paintStats();
  };

  private tick = (): void => {
    const t = Date.now();
    this.remaining = Math.max(0, this.remaining - (t - this.lastTick));
    this.lastTick = t;
    this.paintStats();
    if (this.remaining <= 0) this.finish();
  };

  private shake(): void {
    this.lineEl.classList.remove("shake");
    // 强制 reflow，让同一行连续打错也能重播动画
    void this.lineEl.offsetWidth;
    this.lineEl.classList.add("shake");
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    this.shakeTimer = setTimeout(() => this.lineEl.classList.remove("shake"), 180);
  }

  private paintLine(): void {
    const frag = document.createDocumentFragment();
    const ok = document.createElement("span");
    ok.className = "ok";
    ok.textContent = this.target.slice(0, this.pos);
    if (ok.textContent) frag.appendChild(ok);
    const caret = document.createElement("span");
    caret.className = "gm-caret";
    frag.appendChild(caret);
    const rest = document.createElement("span");
    rest.textContent = this.target.slice(this.pos);
    if (rest.textContent) frag.appendChild(rest);
    this.lineEl.replaceChildren(frag);
  }

  private paintStats(): void {
    const elapsed = ROUND_MS - this.remaining;
    this.timeEl.textContent = String(Math.ceil(this.remaining / 1000));
    const wpm = elapsed > 400 ? Math.round(this.correct / 5 / (elapsed / 60000)) : 0;
    this.wpmEl.textContent = String(wpm);
    const total = this.correct + this.wrong;
    this.accEl.textContent = String(total ? Math.round((this.correct / total) * 100) : 100);
    this.busyEl.style.width = `${Math.min(100, Math.round((this.correct / BUSY_CHARS) * 100))}%`;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const wpm = Math.round(this.correct / 5 / (ROUND_MS / 60000));
    const total = this.correct + this.wrong;
    const acc = total ? Math.round((this.correct / total) * 100) : 100;
    const isBest = saveRecord("typingWpm", wpm);
    this.wpmEl.textContent = String(wpm);
    this.timeEl.textContent = "0";

    const box = document.createElement("div");
    box.className = "gm-result";
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = `${wpm} WPM`;
    const sub = document.createElement("div");
    sub.textContent = `准确率 ${acc}% · 看起来忙碌了 60 秒${isBest ? " · 新纪录！" : ""}`;
    const again = document.createElement("button");
    again.className = "gm-btn";
    again.textContent = "再来一局";
    again.onclick = () => {
      box.remove();
      this.reset();
      this.start();
    };
    box.append(big, sub, again);
    this.editorEl.appendChild(box);
    this.tipEl.textContent = "摸鱼结束 · 老板刚刚路过";
  }
}
