// Behavior 层类型 — 角色行为状态机的输入/输出

/** 桌宠 action，与 SVG .widget[data-act="xxx"] 的 CSS 选择器一致 */
export type PetAction =
  // —— 搬砖 ——
  | "typing"        // 敲键盘
  | "present"       // 站着做汇报
  | "scolded"       // 挨骂发抖
  | "dozing"        // 打瞌睡
  | "phone"         // 打电话
  | "coffee"        // 喝茶续命
  | "stretch"       // 伸懒腰
  | "think"         // 卡需求发呆
  | "read"          // 看文档
  | "write"         // 记笔记
  | "music"         // 戴耳机听歌
  | "meeting"       // 开无效会议
  | "sigh"          // 无声叹气
  // —— 摸鱼 ——
  | "melon"         // 吃西瓜
  | "toilet"        // 带薪蹲坑
  | "scroll"        // 刷手机
  | "snack"         // 偷吃零食
  | "nap"           // 趴桌小睡
  // —— 加班 ——
  | "overtime"      // 加班崩溃
  | "crunch"        // 疯狂赶工
  | "despair"       // 绝望发呆
  // —— 下班 / 休息 ——
  | "happy"         // 下班蹦跶
  | "dance"         // 开心跳舞
  | "wag"           // 摇尾巴庆祝
  | "sleep";        // 呼呼大睡

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
}

/** BehaviorEngine 能接收的事件 —— 可能立刻触发 action 切换或 one-shot */
export type BehaviorEvent =
  | { kind: "phaseChange"; prev: BehaviorSnapshot; next: BehaviorSnapshot }
  | { kind: "moyuStart" }
  | { kind: "moyuEnd" }
  | { kind: "tap" }                 // 用户点小狗 → one-shot
  | { kind: "nearOffWork" }         // 距离下班 <5min → 可能提前进入 happy
  | { kind: "offWorkReached" }      // 刚到下班时刻 → 强制 happy
  | { kind: "todoClear" }           // 最后一个待办清掉 → 得意 one-shot
  | { kind: "beforeWorkArrive" };   // 早上到公司

/** 引擎输出 —— Renderer 接口消费 */
export interface BehaviorOutput {
  /** 当前应播放的 action */
  action: PetAction;
  /** 一次性触发器（tap/surprise/celebrate/...），Renderer 自行解释 */
  oneshots: string[];
  /** 是否应该重起内部轮换计时器（action 确实变了才 true） */
  actionChanged: boolean;
}
