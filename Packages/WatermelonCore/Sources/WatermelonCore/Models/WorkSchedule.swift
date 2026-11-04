import Foundation

/// 一天中的时刻（墙上时间）。
public struct TimeOfDay: Codable, Hashable, Comparable, Sendable {
    public var hour: Int
    public var minute: Int

    public init(_ hour: Int, _ minute: Int) {
        self.hour = hour
        self.minute = minute
    }

    public var minutesSinceMidnight: Int { hour * 60 + minute }

    public static func < (lhs: TimeOfDay, rhs: TimeOfDay) -> Bool {
        lhs.minutesSinceMidnight < rhs.minutesSinceMidnight
    }
}

/// 午休设置。V1 预留字段，默认 nil 不参与计算。
public struct LunchBreak: Codable, Equatable, Sendable {
    public var start: TimeOfDay
    public var end: TimeOfDay

    public init(start: TimeOfDay, end: TimeOfDay) {
        self.start = start
        self.end = end
    }
}

/// 全局作息设置，只有一份。
public struct WorkSchedule: Codable, Equatable, Sendable {
    /// 工作日集合，元素为 Calendar.weekday（1=周日 … 7=周六）。默认周一至周五。
    public var workdays: Set<Int>
    public var workStart: TimeOfDay
    public var workEnd: TimeOfDay
    public var lunchBreak: LunchBreak?

    public init(workdays: Set<Int> = [2, 3, 4, 5, 6],
                workStart: TimeOfDay = TimeOfDay(9, 0),
                workEnd: TimeOfDay = TimeOfDay(18, 0),
                lunchBreak: LunchBreak? = nil) {
        self.workdays = workdays
        self.workStart = workStart
        self.workEnd = workEnd
        self.lunchBreak = lunchBreak
    }
}
