// Behavior 层类型 — 角色行为状态机的输入/输出

/** 桌宠 action，与 SVG .widget[data-act="xxx"] 的 CSS 选择器一致（严格对齐 german-shepherd 素材包） */
export type PetAction =
  // —— 搬砖 ——
  | "typing"        // 敲键盘
  | "scolded"       // 挨骂发抖
  | "dozing"        // 打瞌睡
  | "phone"         // 打电话
  | "coffee"        // 喝茶续命
  | "stretch"       // 伸懒腰
  | "think"         // 卡需求发呆
  // —— 摸鱼 ——
  | "scroll"        // 刷手机
  | "snack"         // 偷吃零食
  // —— 加班 ——
  | "overtime"      // 加班崩溃
  | "crunch"        // 疯狂赶工
  | "despair"       // 绝望发呆
  // —— 下班 / 休息 ——
  | "happy"         // 下班蹦跶
  | "dance"         // 开心跳舞
  | "wag";          // 摇尾巴庆祝

/** Behavior 层看到的"心情" —— 从 Domain CountdownState 映射过来 */
export type Mood =
  | "beforeWork"
  | "working"       // 普通搬砖
  | "moyu"          // 摸鱼中
  | "overtime"
  | "happy"         // 下班了
  | "rest";         // 周末/放假/请假

/** 从 Domain 传入 Behavior 的快照（比 CountdownState 更窄，只拿行为层关心的字段） */
export interface BehaviorSnapshot {
  phase: "beforeWork" | "working" | "offWork" | "rest";
  moyuActive: boolean;
  /** 今日加班分钟数（0 = 无加班） */
  overtimeMin: number;
  /** 距下班还有多少分钟（null = 非工作日 / 未知）—— 驱动 "看表" 类动作 */
  minutesToOffwork?: number | null;
  /** 今日摸鱼累计分钟 —— 驱动 "摸鱼一小时勋章" */
  slackMinutesToday?: number;
  /** 日期标记：payday / festivals … —— 驱动彩蛋动作 */
  dateFlags?: string[];
}

/** BehaviorEngine 能接收的事件 —— 可能立刻触发 action 切换或 one-shot */
export type BehaviorEvent =
  | { kind: "phaseChange"; prev: BehaviorSnapshot; next: BehaviorSnapshot }
  | { kind: "moyuStart" }
  | { kind: "moyuEnd" }
  | { kind: "tap" }                 // 用户点小狗 → one-shot
  | { kind: "doubleTap" }           // 双击
  | { kind: "longPress" }           // 长按
  | { kind: "dragStart" }           // 开始拖拽
  | { kind: "dragEnd" }             // 拖拽落地
  | { kind: "todoDone" }            // 完成单个待办
  | { kind: "nearOffWork" }         // 距离下班 <5min → 可能提前进入 happy
  | { kind: "offWorkReached" }      // 刚到下班时刻 → 强制 happy
  | { kind: "todoClear" }           // 最后一个待办清掉 → 得意 one-shot
  | { kind: "beforeWorkArrive" };   // 早上到公司

/** 引擎输出 —— Renderer 接口消费 */
export interface BehaviorOutput {
  /** 当前应播放的 action（Legacy SVG 用） */
  action: PetAction;
  /** 当前动作在 50 动作库里的定义（Rive 用；兜底合成的动作 defId=0） */
  defId: number;
  /** Rive 状态机完整意图（B2 契约） */
  intent: import("@/avatar").Intent;
  /** 一次性触发器（tap/surprise/celebrate/...），Renderer 自行解释 */
  oneshots: string[];
  /** 是否应该重起内部轮换计时器（action 确实变了才 true） */
  actionChanged: boolean;
}
