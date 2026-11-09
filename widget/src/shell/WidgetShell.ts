import { CountdownEngine } from "@/domain";
import type {
  BehaviorSnapshot,
  BehaviorEvent,
  PetAction,
} from "@/behavior";
import { BehaviorEngine } from "@/behavior";
import type { DayOverrides, HolidayInfo, MoyuSession, WorkSchedule } from "@/domain";
import type { DogRenderer } from "@/renderer";

/**
 * WidgetShell —— 粘合 Domain + Behavior + Renderer 的 orchestration 层
 *
 * 职责：
 * 1. 每 1s 从 Domain 取 state → 喂给 BehaviorEngine.tick() → 调 Renderer.setAction()
 * 2. 暴露 handleEvent() —— UI 层 tap/moyu/... 事件统一入口
 * 3. 暴露 pause()/resume() —— 窗口隐藏/恢复
 * 4. 持有所有依赖的实例 + 状态
 *
 * 注意：这个类依赖 DOM（需要 DogRenderer 是 LegacyDogRenderer 实例），
 *       但接口定义不依赖 DOM —— 可在测试里用 MockRenderer。
 */
export class WidgetShell {
  private domain: CountdownEngine;
  private behavior: BehaviorEngine;
  private renderer: DogRenderer;
  private schedule: WorkSchedule;
  private overrides: DayOverrides = {};
  private moyuSessions: MoyuSession[] = [];
  private running = false;
  private tickTimer: number | null = null;

  /** 构造：所有依赖从外部注入，方便测试 */
  constructor(opts: {
    renderer: DogRenderer;
    schedule: WorkSchedule;
    holidayProvider?: (date: Date) => HolidayInfo | null;
    moyuSessions?: MoyuSession[];
  }) {
    this.domain = new CountdownEngine(opts.holidayProvider);
    this.behavior = new BehaviorEngine();
    this.renderer = opts.renderer;
    this.schedule = opts.schedule;
    this.moyuSessions = opts.moyuSessions ?? [];
  }

  /** 启动 tick loop —— 每 1s 一次，轻量 */
  start(): void {
    if (this.running) return;
    this.running = true;
    // 立刻跑一次
    this.tick();
    // 然后每 1s tick（setInterval 足够；将来可以换成 requestAnimationFrame + 1s 节流）
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer != null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** 窗口隐藏 —— 暂停渲染 + 行为引擎 reset（防止回来那一刻状态错乱） */
  pause(): void {
    this.renderer.pause();
    this.behavior.reset();
  }

  /** 窗口恢复 */
  resume(): void {
    this.renderer.resume();
    this.behavior.reset(); // 回来后重算一遍
    this.tick();
  }

  /** UI 层事件入口 —— 小狗点击、按钮按、待办清零等 */
  handleEvent(event: BehaviorEvent): void {
    const snap = this.currentSnapshot();
    const out = this.behavior.handle(event, snap);
    this.applyOutput(out.action, out.oneshots);
  }

  /** 更新 overrides —— 手动放假/请假/加班等 */
  setOverrides(ov: DayOverrides): void {
    this.overrides = ov;
  }

  /** 更新摸鱼会话 —— 摸鱼开始/结束时调 */
  setMoyuSessions(s: MoyuSession[]): void {
    this.moyuSessions = s;
  }

  /** 更新日程 —— 上班时间/下班时间/工作日 */
  setSchedule(s: WorkSchedule): void {
    this.schedule = s;
  }

  destroy(): void {
    this.stop();
    this.renderer.destroy();
  }

  // —— 内部 ——

  private tick(): void {
    if (!this.running) return;
    const now = Date.now();
    const snap = this.currentSnapshotAt(now);
    const out = this.behavior.tick(snap, now);
    this.applyOutput(out.action, out.oneshots);
    // 进度条（只有 working 阶段显示进度；rest/happy 也可以显示）
    const st = this.domain.state(now, this.schedule, this.overrides, this.moyuSessions);
    this.renderer.setProgress(st.progress);
  }

  private currentSnapshot(now: number = Date.now()): BehaviorSnapshot {
    return this.currentSnapshotAt(now);
  }

  private currentSnapshotAt(now: number): BehaviorSnapshot {
    const st = this.domain.state(now, this.schedule, this.overrides, this.moyuSessions);
    return {
      phase: st.phase,
      moyuActive: st.moyu.active,
      overtimeMin: st.workday?.overtimeMin ?? 0,
    };
  }

  private applyOutput(action: PetAction, oneshots: string[]): void {
    this.renderer.setAction(action);
    for (const shot of oneshots) {
      this.renderer.trigger(shot);
    }
  }
}
