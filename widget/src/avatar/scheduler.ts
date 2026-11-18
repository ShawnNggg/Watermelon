import type { ActionDef, Ctx, TimeStats } from './types';

export const canPreempt = (cur: ActionDef | null, next: ActionDef) =>
  !cur || cur.interruptible || next.priority > cur.priority;

function eligible(a: ActionDef, ctx: Ctx): boolean {
  if (!a.phases.includes(ctx.phase)) return false;
  const last = ctx.lastPlayedAt[a.key];
  return last === undefined || ctx.now - last >= a.cooldownSec * 1000;
}

const top = (list: ActionDef[]) => list.sort((a, b) => b.priority - a.priority)[0] ?? null;

/** Weighted random pick among idle-rotation actions valid for the current phase. */
export function pickIdle(actions: ActionDef[], ctx: Ctx, rng: () => number = Math.random): ActionDef | null {
  const pool = actions.filter((a) => a.trigger.kind === 'idle' && eligible(a, ctx) && canPreempt(ctx.current, a));
  const total = pool.reduce((s, a) => s + (a.trigger.kind === 'idle' ? a.trigger.weight : 0), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const a of pool) {
    r -= a.trigger.kind === 'idle' ? a.trigger.weight : 0;
    if (r <= 0) return a;
  }
  return pool[pool.length - 1] ?? null;
}

/** Event -> action (tap, drag_start, phase_enter, boss_key, ...). Highest priority wins. */
export function resolveEvent(
  actions: ActionDef[], name: string, ctx: Ctx, detail: { phase?: string; action?: string } = {},
): ActionDef | null {
  const list = actions.filter((a) => {
    const t = a.trigger;
    if (t.kind !== 'event' || t.name !== name || !eligible(a, ctx)) return false;
    if (t.phase && t.phase !== detail.phase) return false;
    if (t.action && t.action !== detail.action) return false;
    if (t.while_action && ctx.current?.key !== t.while_action) return false;
    return canPreempt(ctx.current, a);
  });
  return top(list);
}

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** Time/stat-driven triggers; call about once a minute. */
export function resolveTimed(actions: ActionDef[], ctx: Ctx, s: TimeStats): ActionDef | null {
  const now = toMin(s.hhmm);
  const list = actions.filter((a) => {
    const t = a.trigger;
    if (t.kind !== 'time' || !eligible(a, ctx) || !canPreempt(ctx.current, a)) return false;
    const m = t.minutes ?? 0;
    switch (t.name) {
      case 'idle_minutes':
      case 'no_interaction_minutes': return s.noInteractionMinutes >= m;
      case 'slack_every_minutes':
      case 'slack_total_minutes': return s.slackMinutesToday >= m;
      case 'near_offwork_minutes': return s.minutesToOffwork !== null && s.minutesToOffwork >= 0 && s.minutesToOffwork <= m;
      case 'time_window': return (t.ranges ?? []).some((r) => { const [a1, b1] = r.split('-'); return now >= toMin(a1) && now < toMin(b1); });
      case 'weekday': return (t.days ?? []).includes(s.weekday);
      case 'date': return !!t.config && s.dateFlags.includes(t.config);
      default: return false;
    }
  });
  return top(list);
}
