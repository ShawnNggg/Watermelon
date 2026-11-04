import Foundation

public enum OverrideType: Codable, Equatable, Sendable {
    /// 加班：当天下班时间顺延 N 分钟（不跨天，截断到当天 23:59:59）
    case overtime(minutes: Int)
    /// 放假：当天视为休息日
    case holiday
    /// 请假：当天跳过（计算语义同放假，UI 文案不同）
    case leave
}

/// 某一天的特殊安排，一天最多一条。
public struct DayOverride: Codable, Equatable, Sendable, Identifiable {
    public var day: DayKey
    public var type: OverrideType

    public var id: DayKey { day }

    public init(day: DayKey, type: OverrideType) {
        self.day = day
        self.type = type
    }
}
