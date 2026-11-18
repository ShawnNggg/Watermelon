// 50 动作库 → 现有 15 个 SVG 动作的映射（A2 融合方案）
//
// Rive 版按 50 个独立 action 播放；Legacy SVG 版只有 15 个 [data-act] 动画，
// 这里把每个 ActionDef 落到最接近的 SVG 动作上，保证两套渲染器行为一致。
// 新形象缺姿态/道具的动作已并入语义最接近的保留动作。

import type { PetAction } from "./types";

/** Rive action id (1-50) → Legacy SVG data-act */
export const LEGACY_BY_ID: Readonly<Record<number, PetAction>> = {
  // —— 搬砖 ——
  1: "typing",          // typing
  2: "think",          // frown_screen 皱眉看屏幕
  3: "coffee",          // drink_coffee
  4: "think",           // flip_docs
  5: "phone",           // meeting_nod
  6: "phone",           // phone_call
  7: "scolded",         // pull_hair 抓头崩溃
  8: "stretch",         // stretch
  9: "stretch",         // rub_neck
  10: "happy",          // task_done 完成待办
  // —— 摸鱼 ——
  11: "scroll",         // sneak_phone
  12: "scolded",        // boss_alert 老板来了
  13: "scroll",         // video_giggle
  14: "snack",          // sneak_snack
  15: "scroll",         // headphones_groove
  16: "scroll",         // secret_gaming
  17: "scroll",         // fishing 带薪钓鱼
  18: "scroll",         // wait_delivery
  19: "coffee",         // make_tea 泡茶
  20: "dozing",         // slump_chair 瘫在椅子上
  21: "think",          // stare_window 望着窗外
  // —— 身体 ——
  22: "happy",          // count_money 数工资
  23: "dozing",         // yawn
  24: "dozing",         // nod_off
  25: "dozing",         // sleep_deep
  26: "dozing",         // startled_awake 惊醒
  27: "snack",          // hungry
  28: "snack",          // lunch
  // —— 互动 ——
  29: "wag",            // tap_wag
  30: "wag",            // pet_head
  31: "dance",          // double_flip
  32: "happy",          // long_press_coax
  33: "happy",          // dangle_legs
  34: "happy",          // land_cushion
  35: "dance",          // chase_tail
  36: "wag",            // seek_attention
  // —— 时间 ——
  37: "typing",         // clock_in 打卡
  38: "think",          // check_watch 看还有多久下班
  39: "happy",          // offwork_cheer
  40: "happy",          // pack_leave
  41: "happy",          // holiday_lounge
  42: "happy",          // leave_blanket
  43: "overtime",       // overtime_night
  44: "dance",          // friday_excite
  45: "despair",        // monday_blue
  46: "wag",            // todo_clear_smug
  // —— 彩蛋 ——
  47: "happy",          // slack_hour_badge 摸鱼一小时勋章
  48: "happy",          // payday_rain 发薪日
  49: "dance",          // festival_costume 节日换装
  50: "despair",        // sulk_ignored 被冷落
};

/** Legacy SVG data-act → 兜底 Rive action id（30 个 tap_wag 之类） */
export const DEF_BY_LEGACY: Readonly<Partial<Record<PetAction, number>>> = {
  typing: 1,
  scolded: 12,
  dozing: 24,
  phone: 6,
  coffee: 3,
  stretch: 8,
  think: 21,
  scroll: 13,
  snack: 14,
  overtime: 43,
  crunch: 1,
  despair: 45,
  happy: 39,
  dance: 44,
  wag: 29,
};
