"use strict";

import { resolveDay as resolveDayPure } from "./domain";
import type { DayOverride, DayOverrides, HolidayInfo, MoyuSession, RestReason, WorkdayResult, WorkSchedule } from "./domain";
import { BehaviorEngine, moodOf } from "./behavior";
import type { BehaviorSnapshot, PetAction } from "./behavior";

const be = new BehaviorEngine();
// Tauri 真挂件模式：透明白底 + 隐藏演示元素
if (window.__TAURI__) document.body.classList.add("in-app");

/** 节假日表项（HOLIDAY_MAP / CAL_MAP 共用） */
interface HolidayEntry {
  name?: string;
  isOffDay: boolean;
  source?: "calendar" | "holiday" | "none";
}

/** 本地持久化状态 */
interface WidgetState {
  onboarded: boolean;
  restMode: string;
  schedule: WorkSchedule;
  salary: number;
  otRate: number;
  overrides: DayOverrides;
  todos: { id: number; title: string; done: boolean }[];
  moyuSessions: MoyuSession[];
  skin: string;
}

/* ============ 状态 ============ */
const LS_KEY = "watermelon-widget-v1";
// 休息模式预设（周一=1 … 周日=7）
const REST_PRESETS: Record<string, { label: string; workdays: number[] | null }> = {
  double:    { label: "双休",  workdays: [2,3,4,5,6] },
  "single-sun": { label: "单休·周日", workdays: [2,3,4,5,6,7] },
  "single-sat": { label: "单休·周六", workdays: [1,2,3,4,5,6] },
  custom:    { label: "自定义", workdays: null }   // workdays 由用户手动勾
};
const defaultState = (): WidgetState => ({
  onboarded: false,
  restMode: "double",   // 休息模式预设
  schedule: { workdays: [2,3,4,5,6], startH: 9, startM: 0, endH: 18, endM: 0 },
  salary: 0,          // 月薪，0 = 未录入
  otRate: 0,          // 加班费倍率，0 = 没有加班费
  overrides: {},      // dayKey -> { kind, minutes? }
  todos: [],
  moyuSessions: [],
  skin: "watermelon"  // 当前皮肤 id
});
function load(): WidgetState {
  try {
    const raw: any = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    // 兼容迁移：旧版 overrides 用 type 字段，新版 domain 用 kind
    if (raw.overrides) {
      for (const [k, v] of Object.entries<any>(raw.overrides)) {
        if (v && typeof v === "object" && "type" in v && !("kind" in v)) {
          raw.overrides[k] = { kind: v.type, ...(v.minutes != null ? { minutes: v.minutes } : {}) };
        }
      }
    }
    return Object.assign(defaultState(), raw);
  }
  catch { return defaultState(); }
}
let S: WidgetState = load();
const save = () => localStorage.setItem(LS_KEY, JSON.stringify(S));
const DAY_MS = 86400000;   // 提前声明，initHolidays 要用到

/* ============ 节假日接口（api.jiejiariapi.com） ============
 * 浏览器端 fetch 被 CORS 挡掉，所以内嵌国务院节假日通知的离线 JSON，
 * 同时后台偷偷尝试 fetch（未来接 Tauri sidecar / 其他 CORS 友好源可以覆盖缓存）。
 *
 * 用法：resolveDay 里优先查 getHolidayInfo(day)
 *   - 命中 && isOffDay=true  → 法定放假（reason="holiday"，holidayName="春节"）
 *   - 命中 && isOffDay=false → 调休补班（reason 留空，强制 work=true）
 *   - 没命中                  → 回退 S.schedule.workdays
 */
const HOLIDAY_API = "https://api.jiejiariapi.com/v1";
const HOLIDAY_CACHE_PREFIX = "watermelon-widget-hol-";
let HOLIDAY_MAP: Record<string, HolidayEntry> = {};   // 合并后的 { "YYYY-MM-DD": { name, isOffDay, source } }

// 内嵌国务院节假日通知数据（节假日里标注过的日期，含调休补班）
// 来源：api.jiejiariapi.com/v1/holidays/{year}（国务院办公厅每年 11 月发布次年节假日）
const OFFLINE_HOLIDAYS: Record<number, Record<string, { name: string; isOffDay: boolean }>> = {
  2025: {
    "2025-01-01": { name: "元旦", isOffDay: true },
    "2025-01-26": { name: "春节", isOffDay: false },
    "2025-01-28": { name: "春节", isOffDay: true },
    "2025-01-29": { name: "春节", isOffDay: true },
    "2025-01-30": { name: "春节", isOffDay: true },
    "2025-01-31": { name: "春节", isOffDay: true },
    "2025-02-01": { name: "春节", isOffDay: true },
    "2025-02-02": { name: "春节", isOffDay: true },
    "2025-02-03": { name: "春节", isOffDay: true },
    "2025-02-04": { name: "春节", isOffDay: true },
    "2025-02-08": { name: "春节", isOffDay: false },
    "2025-04-04": { name: "清明节", isOffDay: true },
    "2025-04-05": { name: "清明节", isOffDay: true },
    "2025-04-06": { name: "清明节", isOffDay: true },
    "2025-04-27": { name: "劳动节", isOffDay: false },
    "2025-05-01": { name: "劳动节", isOffDay: true },
    "2025-05-02": { name: "劳动节", isOffDay: true },
    "2025-05-03": { name: "劳动节", isOffDay: true },
    "2025-05-04": { name: "劳动节", isOffDay: true },
    "2025-05-05": { name: "劳动节", isOffDay: true },
    "2025-05-31": { name: "端午节", isOffDay: true },
    "2025-06-01": { name: "端午节", isOffDay: true },
    "2025-06-02": { name: "端午节", isOffDay: true },
    "2025-09-28": { name: "国庆节,中秋节", isOffDay: false },
    "2025-10-01": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-02": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-03": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-04": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-05": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-06": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-07": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-08": { name: "国庆节,中秋节", isOffDay: true },
    "2025-10-11": { name: "国庆节,中秋节", isOffDay: false },
  },
  2026: {
    "2026-01-01": { name: "元旦", isOffDay: true },
    "2026-01-02": { name: "元旦", isOffDay: true },
    "2026-01-03": { name: "元旦", isOffDay: true },
    "2026-01-04": { name: "元旦", isOffDay: false },
    "2026-02-10": { name: "北小年", isOffDay: false },
    "2026-02-11": { name: "南小年", isOffDay: false },
    "2026-02-14": { name: "春节", isOffDay: false },
    "2026-02-15": { name: "春节", isOffDay: true },
    "2026-02-16": { name: "除夕", isOffDay: true },
    "2026-02-17": { name: "春节", isOffDay: true },
    "2026-02-18": { name: "春节", isOffDay: true },
    "2026-02-19": { name: "春节", isOffDay: true },
    "2026-02-20": { name: "春节", isOffDay: true },
    "2026-02-21": { name: "春节", isOffDay: true },
    "2026-02-22": { name: "春节", isOffDay: true },
    "2026-02-23": { name: "春节", isOffDay: true },
    "2026-02-28": { name: "春节", isOffDay: false },
    "2026-04-04": { name: "清明节", isOffDay: true },
    "2026-04-05": { name: "清明节", isOffDay: true },
    "2026-04-06": { name: "清明节", isOffDay: true },
    "2026-05-01": { name: "劳动节", isOffDay: true },
    "2026-05-02": { name: "劳动节", isOffDay: true },
    "2026-05-03": { name: "劳动节", isOffDay: true },
    "2026-05-04": { name: "劳动节", isOffDay: true },
    "2026-05-05": { name: "劳动节", isOffDay: true },
    "2026-05-09": { name: "劳动节", isOffDay: false },
    "2026-06-19": { name: "端午节", isOffDay: true },
    "2026-06-20": { name: "端午节", isOffDay: true },
    "2026-06-21": { name: "端午节", isOffDay: true },
    "2026-09-20": { name: "国庆节", isOffDay: false },
    "2026-09-25": { name: "中秋节", isOffDay: true },
    "2026-09-26": { name: "中秋节", isOffDay: true },
    "2026-09-27": { name: "中秋节", isOffDay: true },
    "2026-10-01": { name: "国庆节", isOffDay: true },
    "2026-10-02": { name: "国庆节", isOffDay: true },
    "2026-10-03": { name: "国庆节", isOffDay: true },
    "2026-10-04": { name: "国庆节", isOffDay: true },
    "2026-10-05": { name: "国庆节", isOffDay: true },
    "2026-10-06": { name: "国庆节", isOffDay: true },
    "2026-10-07": { name: "国庆节", isOffDay: true },
    "2026-10-10": { name: "国庆节", isOffDay: false },
  },
};

function getHolidayInfo(day: Date): HolidayEntry | null {
  return HOLIDAY_MAP[dayKey(day)] || null;
}

// 初始化：先从 localStorage / 内嵌数据拿一份，保证立刻可用
(function initHolidaysSync() {
  const y = new Date().getFullYear();
  const map: Record<string, HolidayEntry> = {};
  [y - 1, y, y + 1].forEach(yr => {
    const raw = localStorage.getItem(HOLIDAY_CACHE_PREFIX + yr);
    if (raw) {
      try {
        const parsed: any = JSON.parse(raw);
        Object.entries<any>(parsed.data || {}).forEach(([k, v]) => { map[k] = { ...v, source: "holiday" }; });
        return;
      } catch {}
    }
    const offline = OFFLINE_HOLIDAYS[yr];
    if (offline) {
      Object.entries(offline).forEach(([k, v]) => { map[k] = { ...v, source: "holiday" }; });
    }
  });
  HOLIDAY_MAP = map;
})();

// 后台偷偷尝试 fetch（成功的话覆盖缓存，跨年自动拉新年份）
async function refreshHolidayYear(year: number): Promise<Record<string, HolidayEntry> | null> {
  try {
    const res = await fetch(`${HOLIDAY_API}/holidays/${year}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json: any = await res.json();
    const flat: Record<string, HolidayEntry> = {};
    for (const [k, v] of Object.entries<any>(json || {})) {
      flat[k] = { name: v.name, isOffDay: v.isOffDay, source: "holiday" };
    }
    localStorage.setItem(HOLIDAY_CACHE_PREFIX + year, JSON.stringify({ fetchedAt: Date.now(), data: flat }));
    return flat;
  } catch {
    // CORS 或离线 → 安静失败
    return null;
  }
}
(async function refreshLoop() {
  const y = new Date().getFullYear();
  const results = await Promise.all([refreshHolidayYear(y), refreshHolidayYear(y + 1)]);
  const map = { ...HOLIDAY_MAP };
  for (const r of results) if (r) Object.assign(map, r);
  HOLIDAY_MAP = map;
  if (typeof render === "function") render();
})();

/* ============ 本地日历（macOS Calendar.app 读取） ============
 * 依赖：用户在系统设置里给 Watermelon 授权日历权限
 * 依赖：用户的 Calendar.app 里订阅了「中国法定节假日」日历（iCloud 日历列表里一键订阅）
 *
 * 判定规则：
 *   日历标题包含 "假" / "日" / "holiday" 关键字 → isOffDay=true
 *   日历标题包含 "班" / "补" / "调" / "workday" → isOffDay=false（调休补班）
 *   标题包含 both 关键词 → isOffDay=true（休假优先）
 *   用户自己的会议 / 日程（title 不含节假日关键词）→ 忽略
 *
 * 优先级：calendar 源 > holiday API 离线源 > workdays.includes
 */
const CAL_CACHE_KEY = "watermelon-widget-cal-";
let CAL_MAP: Record<string, HolidayEntry> = {};   // { "YYYY-MM-DD": { name, isOffDay, source: "calendar" } }
let CAL_PERM = localStorage.getItem("watermelon-widget-cal-perm");  // "granted" | "denied" | null

const CAL_HOLIDAY_KEYWORDS = ["假", "法定", "节日", "除夕", "holiday", "Holiday", "日"];
const CAL_WORKDAY_KEYWORDS = ["班", "补", "调", "调休", "workday", "Workday"];

async function requestCalendarPermission() {
  if (!window.__TAURI__) return "unsupported";
  try {
    const status = await window.__TAURI__!.core!.invoke!("grant_calendar_permission") as string;
    CAL_PERM = status;
    localStorage.setItem("watermelon-widget-cal-perm", status);
    if (status === "granted") await refreshCalendarEvents();
    return status;
  } catch (e) {
    // permission_denied → 用户没在系统设置给权限
    CAL_PERM = String(e).includes("permission_denied") ? "denied" : "error";
    localStorage.setItem("watermelon-widget-cal-perm", CAL_PERM);
    return CAL_PERM;
  }
}

async function refreshCalendarEvents() {
  if (!window.__TAURI__) return null;
  const now = new Date();
  const y = now.getFullYear();
  const start = `${y - 1}-01-01`;
  const end = `${y + 2}-12-31`;  // 多预拉一年
  try {
    const raw = await window.__TAURI__!.core!.invoke!("get_calendar_events", { startDate: start, endDate: end }) as string;
    const events = JSON.parse(raw || "[]");
    const map: Record<string, HolidayEntry> = {};
    for (const ev of events) {
      const title = (ev.title || "").trim();
      if (!title) continue;
      const isHoliday = CAL_HOLIDAY_KEYWORDS.some(k => title.includes(k));
      const isWorkday = CAL_WORKDAY_KEYWORDS.some(k => title.includes(k));
      if (!isHoliday && !isWorkday) continue;  // 用户日程，跳过
      let isOffDay = isHoliday && !isWorkday;
      // 标题同时包含节假日和补班关键词 → 休假优先（如"国庆放假 补班"这种少见情况）
      map[ev.date] = {
        name: title.split(/[，,·]/)[0] || title,  // 取逗号前第一个词当简称
        isOffDay,
        source: "calendar",
      };
    }
    CAL_MAP = map;
    localStorage.setItem(CAL_CACHE_KEY + y, JSON.stringify({ fetchedAt: Date.now(), data: map }));
    // 合并到 HOLIDAY_MAP（calendar 覆盖离线 holiday）
    const merged = { ...HOLIDAY_MAP };
    for (const [k, v] of Object.entries(map)) merged[k] = v;
    HOLIDAY_MAP = merged;
    if (typeof render === "function") render();
    console.log(`📅 Calendar: 从 Calendar.app 读到 ${Object.keys(map).length} 个节假日事件`);
    return map;
  } catch (e) {
    if (String(e).includes("permission_denied")) {
      CAL_PERM = "denied";
      localStorage.setItem("watermelon-widget-cal-perm", "denied");
    }
    return null;
  }
}

// 启动时先读缓存，后台异步刷新
(function initCalendarFromCache() {
  const y = new Date().getFullYear();
  const raw = localStorage.getItem(CAL_CACHE_KEY + y);
  if (raw) {
    try {
      const parsed: any = JSON.parse(raw);
      CAL_MAP = parsed.data || {};
      for (const [k, v] of Object.entries(CAL_MAP)) HOLIDAY_MAP[k] = v;
    } catch {}
  }
})();
// 后台异步读 Calendar（不阻塞启动）
(async function asyncCalendarRefresh() {
  if (CAL_PERM === "granted" || CAL_PERM === null) {
    await refreshCalendarEvents();
  }
})();


/* ============ 皮肤系统 ============ */
// 皮肤 = 一组 CSS 变量覆盖。新增皮肤只要在 SKINS 里加一项，不用改别处。
const SKIN_KEYS = [
  "flesh", "flesh-light", "flesh-mid", "rind-dark", "rind-light", "seed", "cream",
  "panel-rgb", "bubble", "accent-soft", "line", "green-soft", "card-bg", "card-border",
  "btn-soft", "dog-body", "dog-ear", "dog-inner", "dog-line", "cheek", "text", "text-dim"
];
// 启动时记下 :root 的默认值，切皮肤时先全部还原再覆盖
const BASE_VARS: Record<string, string> = {};
SKIN_KEYS.forEach(k => {
  BASE_VARS[k] = getComputedStyle(document.documentElement).getPropertyValue("--" + k).trim();
});

const SKINS: { id: string; name: string; vars: Record<string, string> }[] = [
  { id: "watermelon", name: "西瓜红", vars: {} },
  { id: "matcha", name: "抹茶", vars: {
      "flesh": "#5FB86A", "flesh-light": "#D6EFD9", "flesh-mid": "#8ED09A",
      "rind-dark": "#2E7D52", "rind-light": "#9ADFAE", "seed": "#25372B",
      "cream": "#FAFFFA", "panel-rgb": "250, 255, 250",
      "accent-soft": "#EDF7EE", "line": "#E3EDE4", "green-soft": "#E7F5EA",
      "card-bg": "#F1FAF2", "card-border": "#D5EBD8", "btn-soft": "#EEF6EE",
      "dog-ear": "#A8823F", "dog-line": "#E7D6B6", "cheek": "#C9E3A6",
      "text": "#23302A", "text-dim": "#8B9A90"
  }},
  { id: "grape", name: "葡萄", vars: {
      "flesh": "#8B7BE0", "flesh-light": "#E6E1FF", "flesh-mid": "#B4A6F0",
      "rind-dark": "#5B49B8", "rind-light": "#B9AEF5", "seed": "#231F3C",
      "cream": "#FCFAFF", "panel-rgb": "253, 251, 255",
      "accent-soft": "#F2EEFF", "line": "#E8E2F5", "green-soft": "#EFEBFA",
      "card-bg": "#F5F2FF", "card-border": "#DED7F5", "btn-soft": "#F1EDFA",
      "dog-ear": "#A8825A", "dog-line": "#E7D6B6", "cheek": "#D3B8E0",
      "text": "#2A2440", "text-dim": "#928CA6"
  }},
  { id: "ocean", name: "海盐", vars: {
      "flesh": "#48A6DE", "flesh-light": "#D6EEFB", "flesh-mid": "#87C9F0",
      "rind-dark": "#2578AE", "rind-light": "#9FD8F5", "seed": "#1B2C3A",
      "cream": "#F8FCFF", "panel-rgb": "249, 253, 255",
      "accent-soft": "#EAF5FD", "line": "#E0ECF5", "green-soft": "#E8F4FC",
      "card-bg": "#F0F8FF", "card-border": "#D3E8F8", "btn-soft": "#EDF5FA",
      "cheek": "#FFC2CE", "dog-line": "#E7D6B6",
      "text": "#1F2C38", "text-dim": "#8B9AA6"
  }},
  { id: "caramel", name: "奶茶", vars: {
      "flesh": "#CE8A50", "flesh-light": "#F6E2CD", "flesh-mid": "#E5AE7C",
      "rind-dark": "#8A5A2B", "rind-light": "#DDB37E", "seed": "#33241A",
      "cream": "#FFFBF5", "panel-rgb": "255, 251, 245",
      "accent-soft": "#FBF0E3", "line": "#EDE0D0", "green-soft": "#F7EFE2",
      "card-bg": "#FDF6EC", "card-border": "#EBDCC7", "btn-soft": "#F3EBE0",
      "dog-body": "#F5E1BE", "dog-ear": "#B07A45", "dog-inner": "#FCEED2",
      "dog-line": "#E8D5AE", "cheek": "#E8B79C",
      "text": "#3A2A1C", "text-dim": "#A2927F"
  }},
  { id: "sakura", name: "樱花", vars: {
      "flesh": "#EF6A9B", "flesh-light": "#FFDCE7", "flesh-mid": "#F79DBD",
      "rind-dark": "#BE4A78", "rind-light": "#F7B7CC", "seed": "#3B2130",
      "cream": "#FFFAFC", "panel-rgb": "255, 250, 252",
      "accent-soft": "#FFEFF4", "line": "#F5E3E8", "green-soft": "#FBEDF2",
      "card-bg": "#FFF3F7", "card-border": "#F8D9E4", "btn-soft": "#FBEDF1",
      "cheek": "#FFB0C4", "dog-line": "#E7D6B6",
      "text": "#3A2530", "text-dim": "#A68E99"
  }},
  { id: "night", name: "暗夜", vars: {
      "flesh": "#FF7A90", "flesh-light": "#5A3B45", "flesh-mid": "#C7677C",
      "rind-dark": "#2F9C6B", "rind-light": "#3E6B55", "seed": "#14161C",
      "cream": "#2C2C36", "panel-rgb": "38, 38, 46", "bubble": "#32323E",
      "accent-soft": "#3E3038", "line": "#45444F", "green-soft": "#2C3A33",
      "card-bg": "#2E3833", "card-border": "#3C4A42", "btn-soft": "#37373F",
      "dog-body": "#E8D7B8", "dog-ear": "#9C7440", "dog-inner": "#4A4034",
      "dog-line": "#C9B695", "cheek": "#C97F8D",
      "text": "#F2EDE6", "text-dim": "#9C96A2"
  }}
];

function applySkin(id: string) {
  const skin = SKINS.find(s => s.id === id) || SKINS[0];
  const root = document.documentElement.style;
  SKIN_KEYS.forEach(k => {
    root.removeProperty("--" + k);
    if (skin.vars[k]) root.setProperty("--" + k, skin.vars[k]);
  });
  S.skin = skin.id; save();
  syncSkinUI();
}

function syncSkinUI() {
  const row = $("skinRow");
  if (!row) return;
  row.innerHTML = "";
  SKINS.forEach(sk => {
    const b = document.createElement("button");
    b.className = "skin-btn" + (S.skin === sk.id ? " on" : "");
    b.title = sk.name;
    const sw = document.createElement("span");
    sw.className = "skin-swatch";
    sw.style.background = `linear-gradient(135deg, ${sk.vars.flesh || BASE_VARS.flesh} 0 50%, ${sk.vars["rind-dark"] || BASE_VARS["rind-dark"]} 50% 100%)`;
    const nm = document.createElement("span");
    nm.className = "skin-name"; nm.textContent = sk.name;
    b.append(sw, nm);
    b.onclick = () => applySkin(sk.id);
    row.appendChild(b);
  });
}

function syncCalUI() {
  const tag = $("calPermTag");
  const grantBtn = $("calGrantBtn");
  const refreshBtn = $("calRefreshBtn");
  const infoLine = $("calInfoLine");
  if (!tag || !grantBtn) return;

  const perm = CAL_PERM || null;
  const calCount = Object.keys(CAL_MAP || {}).length;

  // 状态标签
  if (perm === "granted") {
    tag.textContent = "✅ 已授权";
    tag.style.background = "rgba(95,184,106,.18)";
    tag.style.color = "#2E7D52";
  } else if (perm === "denied") {
    tag.textContent = "❌ 未授权";
    tag.style.background = "rgba(255,93,115,.15)";
    tag.style.color = "#D63E54";
  } else {
    tag.textContent = "未设置";
    tag.style.background = "rgba(0,0,0,.06)";
    tag.style.color = "var(--text-dim)";
  }

  // 主按钮文字
  if (perm === "granted") {
    grantBtn.textContent = "重新授权";
    grantBtn.style.display = "none";  // 已授权隐藏，只留刷新
  } else {
    grantBtn.style.display = "";
    grantBtn.textContent = perm === "denied" ? "重新请求授权" : "授权读取日历";
  }
  refreshBtn.style.display = perm === "granted" ? "" : "none";

  // 信息行
  if (perm === "granted" && calCount > 0) {
    infoLine.innerHTML = `📅 Calendar.app 已读取 <b>${calCount}</b> 条节假日事件`;
  } else if (perm === "granted" && calCount === 0) {
    infoLine.innerHTML = "⚠️ 已授权但没读到节假日事件 — 去 Calendar.app 订阅「中国法定节假日」试试";
  } else if (perm === "denied") {
    infoLine.innerHTML = "需要在「系统设置 → 隐私与安全性 → 日历」里给 Watermelon 权限";
  } else {
    infoLine.innerHTML = "授权后自动从 Calendar.app 读取，无需联网 API";
  }

  // 绑定事件（只绑一次）
  if (!(grantBtn as any)._calBound) {
    grantBtn.onclick = async () => {
      grantBtn.textContent = "请求权限中…";
      const status = await requestCalendarPermission();
      if (status === "granted") {
        grantBtn.textContent = "✅ 已授权";
      } else if (status === "denied") {
        grantBtn.textContent = "❌ 去系统设置";
      }
      syncCalUI();
    };
    (grantBtn as any)._calBound = true;
  }
  if (!(refreshBtn as any)._calBound) {
    refreshBtn.onclick = async () => {
      refreshBtn.textContent = "刷新中…";
      await refreshCalendarEvents();
      refreshBtn.textContent = "刷新";
      syncCalUI();
    };
    (refreshBtn as any)._calBound = true;
  }
}

/* ============ 窗口高度自适应 ============ */
// 内容长高了就让真窗口跟着长高，不用滚动条
let fitTimer: ReturnType<typeof setTimeout> | number = 0;
let lastFitH = 0;
function autoFit() {
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    const w = $("widget");
    const sc = $("wScroll");
    // 先解除约束再测：否则被裁切时 scrollHeight 会被客户端高度“污染”，内容变少后无法回落
    document.body.classList.remove("capped");
    w.style.height = "";
    // 用滚动容器的 scrollHeight 测真实内容高度（窗口被裁切时 rect 高度不可靠）
    const contentH = Math.ceil((sc ? sc.scrollHeight : w.scrollHeight) + 16 + 14);
    const ob = $("onboarding");
    const obNeed = ob && ob.classList.contains("show")
      ? Math.ceil($("obCard").getBoundingClientRect().height + 44)
      : 0;
    const need = Math.max(contentH, obNeed);
    const avail = Math.max(240, (window.screen.availHeight || 900) - 24);
    const h = Math.round(Math.min(Math.max(need, 200), avail));
    const capped = need > avail;
    // 触顶时：固定窗口高度，让内部容器滚动，底部圆角由 .widget 保留
    document.body.classList.toggle("capped", capped);
    w.style.height = capped ? (h - 14) + "px" : "";
    if (Math.abs(h - lastFitH) < 4) return;
    lastFitH = h;
    window.__TAURI__!.core!.invoke!("set_widget_height", { height: h }).catch(() => {});
  }, 30);
}

/* ============ 演示时钟 ============ */
let sim: { base: number; setAt: number } | null = null;
const now = (): Date => sim ? new Date(sim.base + (Date.now() - sim.setAt)) : new Date();
const startOfDay = (d: Date | number): Date => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const fmtHM = (d: Date | number): string => { const x = new Date(d); return `${String(x.getHours()).padStart(2,"0")}:${String(x.getMinutes()).padStart(2,"0")}`; };
function fmtHMSms(ms: number): string {
  const t = Math.max(0, ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(t/3600000))}:${p(Math.floor(t/60000)%60)}:${p(Math.floor(t/1000)%60)}`;
}

/* ============ 引擎（同 Swift 核心逻辑） ============ */
/** statusAt 的快照：type 为判别字段，各分支字段互不重叠 */
type DayStatus =
  | { type: "rest"; reason?: RestReason; holidayName?: string }
  | { type: "beforeWork"; start: number; end: number }
  | { type: "working"; work: true; start: number; end: number; normalEnd: number; overtimeMin: number; holidayName?: string; remaining: number; progress: number }
  | { type: "offWork"; day: WorkdayResult };

// 桥接函数：domain 层返回 epoch ms 数字，内部统一转成 Date 供渲染层沿用旧逻辑
function resolveDay(day: Date): WorkdayResult {
  const h = getHolidayInfo(day);
  const holiday: HolidayInfo | null = h
    ? { isOffDay: h.isOffDay, name: h.name, source: (h.source || "holiday") as HolidayInfo["source"] }
    : null;
  return resolveDayPure(day, S.schedule, S.overrides, holiday);
}
function statusAt(t: Date): DayStatus {
  const tn = t.getTime();
  const r = resolveDay(t);
  if (!r.work) return { type: "rest", reason: r.reason, holidayName: r.holidayName };
  const start = r.start!, end = r.end!;
  if (tn < start) return { type: "beforeWork", start, end };
  if (tn < end) {
    return {
      type: "working", work: true, start, end,
      normalEnd: r.normalEnd!, overtimeMin: r.overtimeMin, holidayName: r.holidayName,
      remaining: end - tn, progress: (tn - start) / (end - start),
    };
  }
  return { type: "offWork", day: r };
}
function weekendCountdown(t: Date): number | null {
  const mon0 = (t.getDay() + 6) % 7;
  for (let w = 0; w < 4; w++) {
    const ws = new Date(startOfDay(t).getTime() + (w * 7 - mon0) * DAY_MS);
    let lastEnd: number | null = null;
    for (let i = 0; i < 7; i++) {
      const r = resolveDay(new Date(ws.getTime() + i * DAY_MS));
      if (r.work) lastEnd = r.end!;
    }
    if (lastEnd && lastEnd > t.getTime()) return lastEnd - t.getTime();
  }
  return null;
}

// 找下一个休息日的 00:00 —— 以当前 workdays 为准，先看本周，不够看下周
function nextRestDayStart(t: Date): Date | null {
  const mon0 = (t.getDay() + 6) % 7;
  for (let w = 0; w < 3; w++) {
    const ws = new Date(startOfDay(t).getTime() + (w * 7 - mon0) * DAY_MS);
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws.getTime() + i * DAY_MS);
      if (!resolveDay(d).work) {
        // 休息日在今天或之后才返回
        if (d.getTime() >= startOfDay(t).getTime()) return d;
      }
    }
  }
  return null;
}

// 上一个休息日的 24:00（= 上一个休息日 00:00 + DAY_MS）—— 用来算已休了多少
function prevRestDayEnd(t: Date): Date | null {
  const mon0 = (t.getDay() + 6) % 7;
  for (let w = 0; w < 3; w++) {
    const ws = new Date(startOfDay(t).getTime() - ((w + 1) * 7 + mon0) * DAY_MS);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(ws.getTime() + i * DAY_MS);
      if (!resolveDay(d).work) return new Date(d.getTime() + DAY_MS);
    }
  }
  return null;
}

// 周末进度条渲染：从周一 00:00 → 下个休息日 00:00 的墙钟进度
function renderWeekendBar(t: Date) {
  const restStart = nextRestDayStart(t);
  const bar = $("weekendBar"), fill = $("weekendFill"), marker = $("weekendMarker"), info = $("weekendInfo");
  if (!restStart) { bar.style.display = "none"; return; }
  bar.style.display = "";

  // 今天本身就在休息日 → 进度 100%，显示"尽情休息"
  const todayRest = !resolveDay(t).work;
  if (todayRest) {
    fill.style.width = "100%";
    marker.style.left = "100%";
    info.innerHTML = `<b>休</b> — 尽情摸瓜`;
    return;
  }

  // 起点选最近一个休息日结束时刻（跨周一也成立），避免"周一早上进度从 0% 开始"的体感问题
  // 但更直观的是"本周一 00:00 → 下个休息日 00:00"，让进度条在周一早上从 0 慢慢爬
  const mon0 = (t.getDay() + 6) % 7;
  const weekStart = new Date(startOfDay(t).getTime() - mon0 * DAY_MS);

  const span = restStart.getTime() - weekStart.getTime();
  const progress = Math.max(0, Math.min(1, (t.getTime() - weekStart.getTime()) / span));
  fill.style.width = (progress * 100) + "%";
  marker.style.left = (progress * 100) + "%";

  // 文案：距下个休息日还有 Hh Mm · 本周已过 N%
  const remainMs = restStart.getTime() - t.getTime();
  const rh = Math.floor(remainMs / 3600000);
  const rm = Math.floor(remainMs % 3600000 / 60000);
  // 已工作天数（从本周一开始扫 workdays 且 startOfDay(d) ≤ startOfDay(t) 的数量）
  let doneDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * DAY_MS);
    const r = resolveDay(d);
    if (r.work && startOfDay(d).getTime() <= startOfDay(t).getTime()) doneDays++;
  }
  info.innerHTML = `距休息 <b>${rh}h${rm}</b> · 本周已过 ${Math.round(progress*100)}%（上班 ${doneDays} 天）`;
}
// 一周进度：从本周一开始扫 7 天
interface WeekDay { rest?: boolean; done: boolean; today?: boolean; frac: number; date: Date; overtimeMin: number }
function weekProgress(t: Date) {
  const mon0 = (t.getDay() + 6) % 7;
  const ws = new Date(startOfDay(t).getTime() - mon0 * DAY_MS);
  const days: WeekDay[] = [];     // 7 天逐日状态
  let totalWorkMs = 0, doneWorkMs = 0, totalWorkdays = 0, doneWorkdays = 0;
  let todayProgress = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws.getTime() + i * DAY_MS);
    const r = resolveDay(d);
    if (!r.work) { days.push({ rest: true, done: false, frac: 0, date: d, overtimeMin: 0 }); continue; }
    totalWorkdays++;
    const dayMs = r.end! - r.start!;
    totalWorkMs += dayMs;
    let frac = 0;
    if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()) {
      // 今天
      frac = Math.max(0, Math.min(1, (t.getTime() - r.start!) / dayMs));
      todayProgress = frac;
      days.push({ done: frac >= 1, today: true, frac, date: d, overtimeMin: r.overtimeMin });
    } else if (d < startOfDay(t)) {
      doneWorkdays++; doneWorkMs += dayMs;
      days.push({ done: true, frac: 1, date: d, overtimeMin: r.overtimeMin });
    } else {
      days.push({ done: false, today: false, frac: 0, date: d, overtimeMin: r.overtimeMin });
    }
  }
  return { days, totalWorkdays, doneWorkdays, todayProgress };
}
function renderWeekBar(t: Date) {
  const w = weekProgress(t);
  const bar = $("weekBar"); bar.innerHTML = "";
  const labels = document.createElement("div");
  labels.className = "week-labels";
  const track = document.createElement("div");
  track.className = "week-track";
  const CN = ["一","二","三","四","五","六","日"];
  const mon0 = (t.getDay() + 6) % 7;
  w.days.forEach((d, i) => {
    // label
    const lbl = document.createElement("div");
    lbl.textContent = CN[i];
    if (i === mon0) lbl.className = "today";
    labels.appendChild(lbl);
    // seg
    const seg = document.createElement("div");
    seg.className = "seg";
    if (d.rest) seg.classList.add("rest");
    else if (d.done) seg.classList.add("done", "work");
    else if (d.today) { seg.classList.add("today", "work"); }
    else seg.classList.add("work");
    if (d.overtimeMin) seg.classList.add("ot");
    track.appendChild(seg);
  });
  bar.append(labels, track);
  // summary
  const total = w.totalWorkdays;
  const doneCount = w.doneWorkdays + (w.days.find(x => x.today && x.frac > 0) ? 1 : 0);
  const r = resolveDay(t);
  if (r.work && r.end! > t.getTime()) {
    const remH = Math.floor((r.end! - t.getTime()) / 3600000);
    const remM = Math.floor((r.end! - t.getTime()) % 3600000 / 60000);
    $("weekSummary").innerHTML = `本周 ${doneCount}/${total} 工作日 · 今日还剩 <b>${remH}h${remM}m</b>`;
  } else if (r.work) {
    $("weekSummary").innerHTML = `本周 ${doneCount}/${total} 工作日 · 今日已圆满`;
  } else {
    $("weekSummary").innerHTML = `本周 ${doneCount}/${total} 工作日`;
  }
  // 距休息进度条（基于当前 workdays / overrides 自动算）
  renderWeekendBar(t);
}
function moyuMs(t: Date) {
  const ds = startOfDay(t).getTime(), de = ds + DAY_MS;
  let total = 0, active = false;
  for (const s of S.moyuSessions) {
    const end = s.end == null ? t.getTime() : s.end;
    const a = Math.max(s.start, ds), b = Math.min(end, de);
    if (b > a) total += b - a;
    if (s.end == null) active = true;
  }
  return { ms: total, active };
}

/* ============ 钱 ============ */
// 时薪 = 月薪 / 21.75 计薪日 / 每日工时
function perSecondWage() {
  const hours = (S.schedule.endH * 60 + S.schedule.endM - S.schedule.startH * 60 - S.schedule.startM) / 60;
  if (!S.salary || hours <= 0) return 0;
  return S.salary / 21.75 / hours / 3600;
}
const fmtMoney = (v: number) => "¥" + v.toFixed(4);

/* ============ 幽默文案 ============ */
const LINES = {
  working: ["砖烫手也得搬，瓜熟了才算完", "认真搬砖，西瓜会有的", "当前状态：假装很忙", "老板画的饼还在锅里", "每一秒都是钱，别浪费"],
  moyu: ["带薪摸鱼，血赚不亏", "这班是越上越有性价比", "放心摸，狗帮你盯着老板", "摸鱼不是摆烂，是行为艺术", "工资照发，快乐加倍"],
  offWork: ["下班不积极，思想有问题", "今日份的班就上到这了", "溜了溜了，瓜都等急了", "打卡走人，头也不回"],
  rest: ["今天不上班，瓜随便吃", "周末的空气都是甜的", "休息是为了更好地摸鱼"],
  beforeWork: ["还没上班，再赖五分钟", "早八人，打工魂", "新的一天，新的砖"],
  overtime: ["人在工位，魂在床位", "这班加得，狗都困了", "加班费结一下？（灵魂拷问）"],
};

/* ============ 桌宠动作调度 ============ */
const ACT_LINES: Record<string, string[]> = {
  typing: ["噼里啪啦一顿敲，其实在斗图", "键盘冒火星，产出为零", "这个需求很简单.jpg"],
  present: ["我简单讲两句（第 40 分钟）", "大家看这条曲线……它不乐观", "PPT 第 87 页，坚持住"],
  scolded: ["是是是，马上改（第 8 版）", "好的收到，问题都怪我", "耳朵已关闭，灵魂已下班"],
  dozing: ["我没睡，我在闭目思考", "眼皮：我先下班了", "zzz…啊！老板我在听！"],
  phone: ["喂您好，方案已发您邮箱（没发）", "好好好，都可以谈", "客户说要五彩斑斓的黑"],
  coffee: ["第三杯了，心跳有点快", "咖啡续命，命是续上了，人还是困", "这杯喝完就干活（骗自己）"],
  stretch: ["伸个懒腰，骨头都在抗议", "站起来走两步，假装很健康", "工位待久了，腰已经不是我的了"],
  think: ["这个需求……为什么？", "想不明白，先发会儿呆", "大脑正在加载，请稍候"],
  read: ["文档三百页，重点一句话", "看完了，等于没看", "已阅，不懂，但大受震撼"],
  write: ["记笔记：会后……（忘了）", "字写得挺好看，没人看", "周报憋了半天，就两句"],
  music: ["戴上耳机，世界与我无关", "这歌单是打工人的精神止痛药", "音量 100%，老板也听不见"],
  meeting: ["这个会，可以拉个会讨论", "会议结论：下次再开个会", "摄像头关了，人在被窝"],
  sigh: ["唉……（此处省略一万字）", "深呼吸，还能撑", "叹气不扣钱，多叹两口"],
  melon: ["吧唧吧唧…这瓜真甜", "摸鱼赚的钱，才是赚的钱", "帮我盯着点老板，汪"],
  toilet: ["厕所，打工人最后的净土", "带薪蹲坑，赚到", "刷完这条视频就回去…真的"],
  scroll: ["就刷五分钟（已过两小时）", "手指在划，灵魂在飘", "这条视频我必须看完……下一条也是"],
  snack: ["偷吃一口，快乐加倍", "零食藏抽屉，老板找不到", "下午三点的糖分，是刚需"],
  nap: ["趴五分钟（其实半小时）", "工位午睡，姿势越怪睡得越香", "老板路过我就假装看屏幕"],
  overtime: ["人在工位，魂在床位", "这班加得，狗都困了", "加班费结一下？（灵魂拷问）"],
  crunch: ["Deadline 在前，键盘冒烟", "手速拉满，脑速归零", "改完这版就发（第 12 版）"],
  despair: ["这活儿干不完，根本干不完", "看着屏幕，屏幕看着我", "算了，先发会儿呆吧"],
  happy: ["下班不积极，思想有问题", "今日份的班就上到这了", "溜了溜了，瓜都等急了"],
  dance: ["下班了，舞可以跳起来了", "快乐到模糊", "老板不在，怎么开心怎么来"],
  wag: ["尾巴已经摇成螺旋桨", "今天没加班，尾巴表示同意", "开心得语无伦次，汪！"],
  sleep: ["今天不上班，瓜随便吃", "呼……zzz", "睡到自然醒，人生赢家"],
};
// BehaviorEngine 单例，tick() 取代旧 PET_ACTS 随机挑选
let petMood = "", petAct: PetAction | "" = "", petTimer: ReturnType<typeof setTimeout> | number = 0;
let _lastSnap: BehaviorSnapshot | null = null;  // 缓存最近一次 BehaviorSnapshot，定时轮换时复用
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
function petLine() {
  if (petMood === "beforeWork") return pick(LINES.beforeWork);
  if (petMood === "rest") return pick(LINES.rest);
  if (petMood === "happy") return pick(LINES.offWork);
  if (petMood === "overtime") return pick(LINES.overtime);
  return pick(ACT_LINES[petAct] || LINES.working);
}
function rotateAct() {
  // 定时轮换：用缓存的 snap 再 tick 一次，BehaviorEngine 内部 cooldown 过期后会返回新 action
  if (_lastSnap) {
    const out = be.tick(_lastSnap);
    if (out.action !== petAct) {
      petAct = out.action;
      $("widget").dataset.act = out.action;
      setBubble(petLine());
    }
  }
  const intervalMs = be.ROTATE_INTERVAL_MS || 120000;
  petTimer = setTimeout(rotateAct, intervalMs);
}
// 桥接：从 render() 算出的状态组装 BehaviorSnapshot，交给 BehaviorEngine
function petSetMood(snap: BehaviorSnapshot) {
  _lastSnap = snap;
  const out = be.tick(snap);
  const mood = moodOf(snap);
  if (mood !== petMood || out.action !== petAct) {
    petMood = mood;
    petAct = out.action;
    $("widget").dataset.act = out.action;
    setBubble(petLine());
    clearTimeout(petTimer);
    rotateAct();
  }
}

/* ============ 渲染 ============ */
const $ = (id: string) => document.getElementById(id) as HTMLElement;
function setBubble(text: string) {
  const b = $("bubble");
  b.classList.add("fade");
  setTimeout(() => { b.textContent = text; b.classList.remove("fade"); }, 250);
}

function render() {
  const t = now();
  const st = statusAt(t);
  const my = moyuMs(t);
  const wage = perSecondWage();

  // 圆环几何：dasharray = "圆周 圆周"（dash + gap），offset 才能控制可见弧长
  const CIRC = 2 * Math.PI * 48;
  const ringFg = $("ringFg");
  const ringTime = $("ringTime");
  const ringLabel = $("ringLabel");
  const ringPct = $("ringPct");

  // 状态与桌宠心情（保留原逻辑）
  let mood = "working", chip = ["搬砖中", ""], ringCls = "";
  let progress = 0, arcLabel = "", centerBig = "", centerLabel = "", centerMs = false;

  if (st.type === "working") {
    progress = st.progress;
    // 调休补班：本地 workday 里没这天，但 API 标注了
    const isMakeup = !S.schedule.workdays.includes(t.getDay() + 1);
    const makeupTag = isMakeup && (() => { const h = getHolidayInfo(t); return h && !h.isOffDay ? `（调休补班 · ${h.name}）` : ""; })();
    centerBig = fmtHMSms(st.remaining);
    arcLabel = `今天 ${fmtHM(st.start)}–${fmtHM(st.end)}${st.overtimeMin ? "·加班" : ""}`;
    mood = my.active ? "moyu" : (st.overtimeMin ? "overtime" : "working");
    chip = my.active ? ["摸鱼中", ""] : (st.overtimeMin ? ["加班中", ""] : ["搬砖中" + makeupTag, ""]);
    ringCls = my.active ? "moyu" : (st.overtimeMin ? "" : "");
    if (my.active) {
      centerBig = fmtHMSms(my.ms);
      centerLabel = "带薪摸鱼时长";
      centerMs = true;
      ringCls = "moyu";
    } else {
      centerLabel = makeupTag ? "补班日 · 距离下班" : "距离下班";
    }
  } else if (st.type === "beforeWork") {
    progress = 0;
    centerBig = fmtHMSms(st.start - t.getTime());
    centerLabel = "距离上班";
    chip = ["还没上班", "green"];
    mood = "beforeWork";
    ringCls = "green";
  } else if (st.type === "offWork") {
    progress = 1;
    centerBig = "已下班";
    centerLabel = "今天圆满啦";
    chip = ["已下班", "green"];
    mood = "happy";
    ringCls = "green";
  } else {
    progress = 0;
    const hol = st.holidayName;
    const reasonKey = st.reason ?? "weekend";
    if (st.reason === "holiday" && hol) {
      centerBig = hol;
      centerLabel = "法定假日 · 尽情瓜";
      chip = [hol + "放假", "green"];
    } else {
      centerBig = { weekend: "周末愉快", holiday: "今天放假", leave: "今天请假" }[reasonKey];
      centerLabel = "瓜都是甜的";
      chip = [{ weekend: "周末愉快", holiday: "今天放假", leave: "今天请假" }[reasonKey], "green"];
    }
    mood = "rest";
    ringCls = "green";
  }

  // 圆环渲染：dasharray 需要 "C C"（dash+gap 两段），offset 从 C 递减到 0 来显示弧
  // SVG 元素 className 是 SVGAnimatedString，不能直接赋值，用 setAttribute 或 classList
  ringFg.setAttribute("class", "ring-fg " + ringCls);
  ringFg.style.strokeDasharray = `${CIRC} ${CIRC}`;
  ringFg.style.strokeDashoffset = String(CIRC * (1 - Math.max(0, Math.min(1, progress))));
  ringTime.innerHTML = centerBig + (centerMs ? `<span class="ms">.${String(my.ms % 1000).padStart(3,"0")}</span>` : "");
  ringLabel.textContent = centerLabel;
  ringPct.textContent = Math.round(progress * 100) + "%";

  // 桌宠 + status chip —— 用 BehaviorSnapshot 桥接到 BehaviorEngine
  const behSnap = {
    phase: st.type,                 // "beforeWork" | "working" | "offWork" | "rest"
    moyuActive: !!my.active,
    overtimeMin: st.type === "working" ? st.overtimeMin : 0,
  };
  petSetMood(behSnap);
  $("statusChip").textContent = chip[0];
  $("statusChip").className = "status-chip " + chip[1];

  // 一周进度条
  renderWeekBar(t);

  // 摸鱼进账
  if (wage > 0 && my.ms > 0) {
    $("moneyMoyu").classList.remove("hidden");
    $("moyuMoney").textContent = "+" + fmtMoney(my.ms / 1000 * wage);
  } else if (wage <= 0) {
    $("moneyMoyu").classList.remove("hidden");
    $("moyuMoney").textContent = "录月薪后开算";
  } else {
    $("moyuMoney").textContent = "+" + fmtMoney(0);
  }

  // 加班亏/赚
  const todayR = resolveDay(t);
  if (todayR.work && todayR.overtimeMin > 0 && wage > 0) {
    $("moneyOt").classList.remove("hidden");
    const secs = todayR.overtimeMin * 60;
    if (S.otRate > 0) {
      $("otTitle").textContent = "加班费回血";
      $("moneyOt").classList.remove("loss");
      $("otMoney").textContent = "+" + fmtMoney(secs * wage * S.otRate);
    } else {
      $("otTitle").textContent = "今日加班白给";
      $("moneyOt").classList.add("loss");
      $("otMoney").textContent = "-" + fmtMoney(secs * wage);
    }
  } else {
    $("moneyOt").classList.add("hidden");
  }

  // 主按钮：根据状态显示摸鱼/加班
  const btn = $("mainBtn");
  const r = resolveDay(t);
  const ov = S.overrides[dayKey(t)];
  if (my.active) {
    btn.textContent = "继续搬砖";
    btn.className = "main-btn moyu-ing";
  } else if (st.type === "working" && r.overtimeMin > 0) {
    btn.textContent = "结束加班";
    btn.className = "main-btn ot-ing";
  } else if (st.type === "working") {
    btn.textContent = "开始摸鱼";
    btn.className = "main-btn";
  } else if (st.type === "offWork" && r.work) {
    // 下班了但今天本来是工作日 → 加班入口
    btn.textContent = ov && ov.kind === "overtime" ? "结束加班" : "开始加班";
    btn.className = "main-btn ot-ing";
  } else if (st.type === "beforeWork" && r.work) {
    btn.textContent = "还没上班";
    btn.className = "main-btn";
  } else {
    btn.textContent = "今天休息";
    btn.className = "main-btn";
  }

  // 今日特殊
  $("overrideNote").textContent = ov ? `（${{overtime:"加班+2h",holiday:"放假",leave:"请假"}[ov.kind]}）` : "";

  // 内容高度会随状态/钱卡变化，定期校准窗口高度（无变化时不会真的调整）
  autoFit();
}

/* ============ 交互 ============ */
function toggleMoyu() {
  const t = now();
  const st = statusAt(t);
  const r = resolveDay(t);
  const my = moyuMs(t);
  const ov = S.overrides[dayKey(t)];
  const inOvertime = r.work && r.overtimeMin > 0; // 当前正在加班

  // 摸鱼中 → 结束摸鱼
  if (my.active) {
    const active = S.moyuSessions.find(s => s.end == null);
    if (active) active.end = t.getTime();
    save(); render();
    return;
  }

  // 加班中 → 结束加班（清掉 override）
  if (inOvertime) { setOv(null); return; }

  // 下班后的工作日 → 开始加班 +60 分钟（可叠加）
  if (st.type === "offWork" && r.work) { setOv({ kind: "overtime", minutes: 60 }); return; }

  // 上班中 → 开始摸鱼
  if (st.type === "working") {
    S.moyuSessions.push({ start: t.getTime(), end: null });
    save(); render();
  }
}
$("mainBtn").onclick = toggleMoyu;
// 点小狗：立刻换一个动作（不再触发摸鱼）
function petNext() {
  if (!_lastSnap) return;
  const out = be.next(_lastSnap);
  petMood = moodOf(_lastSnap);
  petAct = out.action;
  $("widget").dataset.act = out.action;
  setBubble(petLine());
  clearTimeout(petTimer);
  rotateAct();
}
$("dogSvg").onclick = petNext;

$("todoToggle").onclick = () => { $("todoDrawer").classList.toggle("open"); $("gearDrawer").classList.remove("open"); autoFit(); };
$("gearToggle").onclick = () => { $("gearDrawer").classList.toggle("open"); $("todoDrawer").classList.remove("open"); syncSettingsUI(); autoFit(); };

function renderTodos() {
  const ul = $("todoList"); ul.innerHTML = "";
  for (const item of S.todos) {
    const li = document.createElement("li");
    if (item.done) li.className = "done";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = item.done;
    cb.onchange = () => { item.done = cb.checked; save(); renderTodos(); };
    const sp = document.createElement("span"); sp.className = "t"; sp.textContent = item.title;
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕";
    del.onclick = () => { S.todos = S.todos.filter(x => x.id !== item.id); save(); renderTodos(); };
    li.append(cb, sp, del); ul.appendChild(li);
  }
  $("todoLeft").textContent = String(S.todos.filter(x => !x.done).length);
  autoFit();  // 待办增减后窗口跟着长/缩
}
$("todoAddBtn").onclick = () => {
  const v = ($("todoInput") as HTMLInputElement).value.trim(); if (!v) return;
  S.todos.push({ id: Date.now(), title: v, done: false });
  ($("todoInput") as HTMLInputElement).value = ""; save(); renderTodos();
};

/* ---- 设置 ---- */
const WD: [string, number][] = [["一",2],["二",3],["三",4],["四",5],["五",6],["六",7],["日",1]];
function syncSettingsUI() {
  const row = $("wdRow"); row.innerHTML = "";
  WD.forEach(([label, code]) => {
    const b = document.createElement("button");
    b.className = "wd-btn" + (S.schedule.workdays.includes(code) ? " on" : "");
    b.textContent = label;
    b.onclick = () => {
      const i = S.schedule.workdays.indexOf(code);
      i >= 0 ? S.schedule.workdays.splice(i, 1) : S.schedule.workdays.push(code);
      b.classList.toggle("on"); save(); render();
    };
    row.appendChild(b);
  });
  ($("startTime") as HTMLInputElement).value = `${String(S.schedule.startH).padStart(2,"0")}:${String(S.schedule.startM).padStart(2,"0")}`;
  ($("endTime") as HTMLInputElement).value = `${String(S.schedule.endH).padStart(2,"0")}:${String(S.schedule.endM).padStart(2,"0")}`;
  ($("salaryInput") as HTMLInputElement).value = String(S.salary || "");
  document.querySelectorAll("#otRateRow .seg-btn").forEach(el => {
    const b = el as HTMLElement;
    b.classList.toggle("on", Number(b.dataset.rate) === S.otRate);
    b.onclick = () => { S.otRate = Number(b.dataset.rate); save(); syncSettingsUI(); render(); };
  });
  syncSkinUI();
  syncCalUI();
}
$("startTime").onchange = e => { const [h,m] = (e.target as HTMLInputElement).value.split(":").map(Number); S.schedule.startH=h; S.schedule.startM=m; save(); render(); };
$("endTime").onchange = e => { const [h,m] = (e.target as HTMLInputElement).value.split(":").map(Number); S.schedule.endH=h; S.schedule.endM=m; save(); render(); };
$("salaryInput").onchange = e => { S.salary = Math.max(0, Number((e.target as HTMLInputElement).value) || 0); save(); render(); };

function setOv(v: DayOverride | null) { const k = dayKey(now()); v ? S.overrides[k] = v : delete S.overrides[k]; save(); render(); }
$("ovOvertime").onclick = () => setOv({ kind: "overtime", minutes: 120 });
$("ovHoliday").onclick = () => setOv({ kind: "holiday" });
$("ovLeave").onclick = () => setOv({ kind: "leave" });
$("ovClear").onclick = () => setOv(null);

/* ---- 演示时间机 ---- */
function monday(base: Date): Date { const d = startOfDay(base); return new Date(d.getTime() - ((base.getDay()+6)%7) * DAY_MS); }
const PRESETS: Record<string, (b: Date) => Date> = {
  "wed-noon": (b: Date) => { const m = monday(b); m.setDate(m.getDate()+2); m.setHours(13,30,0,0); return m; },
  "fri-1700": (b: Date) => { const m = monday(b); m.setDate(m.getDate()+4); m.setHours(17,0,0,0); return m; },
  "sat-noon": (b: Date) => { const m = monday(b); m.setDate(m.getDate()+5); m.setHours(11,0,0,0); return m; },
};
document.querySelectorAll("[data-sim]").forEach(el => {
  const btn = el as HTMLElement;
  btn.onclick = () => {
    document.querySelectorAll("[data-sim]").forEach(x => x.classList.remove("on"));
    const key = btn.dataset.sim || "";
    if (key === "real") sim = null;
    else { btn.classList.add("on"); const d = PRESETS[key](new Date()); sim = { base: d.getTime(), setAt: Date.now() }; }
    render();
  };
});

/* ============ 首次引导 ============ */
const OB_STEPS = [
  () => `
    <h2>先说好你几点上下班</h2>
    <div class="ob-sub">狗要掐着点替你盼下班</div>
    <div class="field"><label>上班时间</label><input type="time" id="obStart" value="09:00"></div>
    <div class="field"><label>下班时间</label><input type="time" id="obEnd" value="18:00"></div>
    <div class="ob-actions"><button class="main-btn" id="obNext">下一步</button></div>`,
  () => `
    <h2>你家是单休还是双休？</h2>
    <div class="ob-sub">决定「距周末还有多久」进度条和一周进度的计算</div>
    <div class="seg-row" id="obRestRow" style="flex-direction:column; gap:8px; margin-top:6px">
      <button class="seg-btn rest-pick on" data-rest="double" style="padding:10px; font-size:13px;">
        <b style="font-size:14px;">双休</b><br><span style="font-weight:normal; font-size:11px; opacity:.7">周一到周五上班 · 周六周日休息</span>
      </button>
      <button class="seg-btn rest-pick" data-rest="single-sun" style="padding:10px; font-size:13px;">
        <b style="font-size:14px;">单休 · 周日</b><br><span style="font-weight:normal; font-size:11px; opacity:.7">周一到周六上班 · 只有周日休息</span>
      </button>
      <button class="seg-btn rest-pick" data-rest="single-sat" style="padding:10px; font-size:13px;">
        <b style="font-size:14px;">单休 · 周六</b><br><span style="font-weight:normal; font-size:11px; opacity:.7">周二到周日上班 · 只有周六休息</span>
      </button>
    </div>
    <div class="ob-actions"><button class="main-btn" id="obNext">下一步</button></div>`,
  () => `
    <h2>月薪多少？</h2>
    <div class="ob-sub">放心，狗嘴很严。录了它，摸鱼的每一毫秒都给你折算成钱</div>
    <div class="field"><label>月薪（元）</label><input type="number" id="obSalary" placeholder="例如 15000" min="0" step="500"></div>
    <div class="ob-actions">
      <button class="ob-skip" id="obSkip">先不录</button>
      <button class="main-btn" id="obNext">下一步</button>
    </div>`,
  () => `
    <h2>加班有加班费吗？</h2>
    <div class="ob-sub">没有的话，加班时长按「白给」算；有就按倍率算「回血」</div>
    <div class="seg-row" style="margin-top:4px" id="obRateRow">
      <button class="seg-btn on" data-rate="0">没有（落泪）</button>
      <button class="seg-btn" data-rate="1.5">1.5×</button>
      <button class="seg-btn" data-rate="2">2×</button>
      <button class="seg-btn" data-rate="3">3×</button>
    </div>
    <div class="ob-actions"><button class="main-btn" id="obNext">下一步</button></div>`,
  () => `
    <h2>读取你的日历？</h2>
    <div class="ob-sub" style="line-height:1.55">
      如果你在 Mac 日历里订阅了「中国法定节假日」，我就能自动识别<br>
      <b>法定放假（春节/国庆不上班）</b>和<b>调休补班（周六补班）</b> ——<br>
      不用手动录国务院通知，也不需要联网。
    </div>
    <div style="background:var(--bubble); border-radius:12px; padding:10px 12px; font-size:12px; margin-top:6px; line-height:1.6;">
      📅 怎么订阅中国法定节假日日历：<br>
      ① 打开 Mac「日历」App → 菜单栏「日历」→「添加订阅日历」<br>
      ② 在系统设置 → 日历 → 日历权限里给 Watermelon ✅
    </div>
    <div class="ob-actions" style="justify-content:space-between; gap:8px">
      <button class="ob-skip" id="obSkipCal">暂时不要</button>
      <button class="main-btn" id="obCalGrant" style="flex:1">授权读取日历 →</button>
    </div>`,
];
let obStep = 0, obRate = 0, obRest = "double";
function showOb() {
  const card = $("obCard");
  card.innerHTML = OB_STEPS[obStep]();
  $("onboarding").classList.add("show");
  autoFit();

  // 休息模式选择（obStep=1）—— 选好立刻落到 S.schedule.workdays
  if (obStep === 1) {
    document.querySelectorAll("#obRestRow .rest-pick").forEach(el => {
      const b = el as HTMLElement;
      b.onclick = () => {
        document.querySelectorAll("#obRestRow .rest-pick").forEach(x => x.classList.remove("on"));
        b.classList.add("on");
        obRest = b.dataset.rest ?? "double";
        const preset = REST_PRESETS[obRest];
        if (preset && preset.workdays) S.schedule.workdays = [...preset.workdays];
        S.restMode = obRest;
      };
    });
    $("obNext").onclick = () => { save(); obStep++; showOb(); };
    return;
  }

  if (obStep === 3) {
    document.querySelectorAll("#obRateRow .seg-btn").forEach(el => {
      const b = el as HTMLElement;
      b.onclick = () => {
        document.querySelectorAll("#obRateRow .seg-btn").forEach(x => x.classList.remove("on"));
        b.classList.add("on"); obRate = Number(b.dataset.rate);
      };
    });
    $("obNext").onclick = () => {
      S.otRate = obRate; save(); obStep++; showOb();
    };
    return;
  }

  if (obStep === 4) {
    // 日历授权 — 可选步
    const grant = $("obCalGrant");
    const skip = $("obSkipCal");
    grant.onclick = async () => {
      $("obCalGrant").textContent = "请求权限中…";
      const status = await requestCalendarPermission();
      if (status === "granted") {
        $("obCalGrant").textContent = "✅ 已授权";
      } else if (status === "denied") {
        $("obCalGrant").textContent = "❌ 未授权（系统设置里改）";
      } else if (status === "unsupported") {
        $("obCalGrant").textContent = "浏览器预览不支持";
      }
      setTimeout(() => {
        S.onboarded = true; save();
        $("onboarding").classList.remove("show"); render();
      }, 1200);
    };
    skip.onclick = () => {
      S.onboarded = true; save();
      $("onboarding").classList.remove("show"); render();
    };
    return;
  }
  $("obNext").onclick = () => {
    if (obStep === 0) {
      const [sh, sm] = ($("obStart") as HTMLInputElement).value.split(":").map(Number);
      const [eh, em] = ($("obEnd") as HTMLInputElement).value.split(":").map(Number);
      S.schedule.startH = sh; S.schedule.startM = sm; S.schedule.endH = eh; S.schedule.endM = em;
    } else if (obStep === 2) {
      S.salary = Math.max(0, Number(($("obSalary") as HTMLInputElement).value) || 0);
    }
    save(); obStep++; showOb();
  };
  const skip = $("obSkip");
  if (skip) skip.onclick = () => { save(); obStep++; showOb(); };
}

/* ============ 启动 & 省电调度 ============ */
// 只在窗口可见时渲染；摸鱼才需要 47ms 毫秒级刷新，平时 1s 足够
let renderTimer: ReturnType<typeof setTimeout> | number = 0;
const isVisible = () => document.visibilityState === "visible";

function loopRender() {
  clearTimeout(renderTimer);
  renderTimer = 0;
  if (!isVisible()) return;
  render();
  renderTimer = setTimeout(loopRender, moyuMs(now()).active ? 47 : 1000);
}

function setAwake(awake: boolean) {
  if (awake) {
    document.body.classList.remove("paused");
    if (!renderTimer) loopRender();
    if (!petTimer && petMood) rotateAct(); // 恢复桌宠动作轮换
  } else {
    document.body.classList.add("paused");
    clearTimeout(renderTimer); renderTimer = 0;
    clearTimeout(petTimer); petTimer = 0;
  }
}

applySkin(S.skin);
renderTodos();
setAwake(isVisible());
document.addEventListener("visibilitychange", () => setAwake(isVisible()));
// 托盘显示/隐藏窗口时由 Rust 发事件，精确控制暂停
if (window.__TAURI__ && window.__TAURI__.event) {
  window.__TAURI__!.event!.listen!("wm:visibility", e => setAwake(!!e.payload));
}

/* ============ 自动更新 ============
 * 托盘菜单"检查更新" → Rust emit wm:check-update → 前端触发
 * 启动时也自动后台 check 一次（不打扰用户，有新版才弹气泡）
 */
async function runUpdateCheck(manual = false) {
  const updater = window.__TAURI__?.plugin?.updater;
  if (!updater) { if (manual) setBubble("当前版本不支持自动更新"); return; }

  try {
    if (manual) setBubble("检查更新中…");
    const update = await updater.check();
    if (!update) {
      if (manual) setBubble("已是最新版本 ✨");
      return;
    }
    setBubble(`发现新版本 v${update.version}，开始下载…`);
    // 监听下载进度（可选）
    try {
      await updater.onUpdaterEvent(event => {
        if (event.event === "Progress") {
          const pct = Math.round((event.data?.progress || 0) * 100);
          if (pct % 10 === 0) setBubble(`下载中 ${pct}%…`);
        } else if (event.event === "Error") {
          setBubble("下载失败：" + (event.data?.message || "未知错误"));
        } else if (event.event === "Downloaded") {
          setBubble(`下载完成，正在安装 v${update.version}…`);
        }
      });
    } catch (_) { /* 旧版 API 可能没这个方法 */ }
    await updater.download_and_install();
    // 上面会自动重启到新版本，除非失败才走到下面
    setBubble("请手动退出并重新打开 App 完成更新");
  } catch (e) {
    console.warn("[updater] failed", e);
    if (manual) setBubble("更新失败：" + ((e as Error).message || "网络问题"));
  }
}
// 托盘菜单的"检查更新…"
if (window.__TAURI__?.event) {
  window.__TAURI__!.event!.listen!("wm:check-update", () => runUpdateCheck(true));
}
// 启动后后台偷偷 check 一次（等 UI 初始化完 10 秒，给网络点时间）
if (window.__TAURI__) setTimeout(() => runUpdateCheck(false), 10000);

if (!S.onboarded) showOb();
// 字体/布局稳定后再校一次窗口高度
setTimeout(autoFit, 600);
