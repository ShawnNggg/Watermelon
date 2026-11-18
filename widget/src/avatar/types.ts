export type Phase = 'work' | 'slack' | 'overtime' | 'holiday' | 'leave' | 'offwork';
/** 与 animation-spec.xlsx「道具清单」严格对齐（18 个，输入名 p_<prop>） */
export type Prop =
  | 'laptop' | 'phone' | 'coffee' | 'phones' | 'snack' | 'bag' | 'glasses'
  | 'paper' | 'telephone' | 'fishing_rod' | 'takeout' | 'tea_cup'
  | 'cash' | 'watch' | 'drink' | 'blanket' | 'lunchbox' | 'festival_hat';
export type Fx = 'z' | 'heart' | 'surprise' | 'sweat' | 'money' | 'sparkle';
/** 角色变体（输入名 v_<variant>），不占道具槽 */
export type Variant = 'dark_circles' | 'back_turn';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** What the renderer is asked to show. Maps 1:1 onto Rive state machine inputs. */
export interface Intent {
  action: number;          // 1..50, selects the Action-layer animation (0 = none)
  pose: number | null;     // 0..4, null = keep current pose
  mood: number;            // 0..5
  props: Prop[];           // props shown; all others are hidden
  fx: Fx[];                // one-shot particle triggers
  variants?: Variant[];    // 角色变体（黑眼圈 / 背身），缺省全关
  tailSpeed?: number;      // 0..100
}

export type Trigger =
  | { kind: 'idle'; weight: number }
  | { kind: 'event'; name: string; phase?: Phase; while_action?: string; action?: string }
  | { kind: 'time'; name: string; minutes?: number; ranges?: string[]; days?: Weekday[]; config?: string; once_per_day?: boolean };

export interface ActionDef {
  id: number;
  key: string;
  category: 'work' | 'slack' | 'body' | 'interact' | 'time' | 'easter';
  name: string;
  phases: Phase[];
  type: 'loop' | 'oneshot';
  durationSec: number;
  priority: number;
  cooldownSec: number;
  interruptible: boolean;
  rive: Intent;
  poseKey: string | null;
  moodKey: string;
  trigger: Trigger;
  extraProps: string[];
}

export interface Ctx {
  phase: Phase;
  now: number;                           // ms
  lastPlayedAt: Record<string, number>;  // action key -> ms
  current: ActionDef | null;             // action currently playing
}

export interface TimeStats {
  noInteractionMinutes: number;
  slackMinutesToday: number;
  minutesToOffwork: number | null;
  weekday: Weekday;
  hhmm: string;                          // "13:30"
  dateFlags: string[];                   // e.g. ["payday"], ["festivals"]
}
