import Foundation
@testable import WatermelonCore

/// 测试统一使用固定 GMT 日历，避免本机时区影响。
/// 基准周：2024-01-01 是周一，2024-01-05 周五，2024-01-06/07 周末，下一周周五为 2024-01-12。
enum TestSupport {
    static let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        return cal
    }()

    static func date(_ year: Int, _ month: Int, _ day: Int,
                     _ hour: Int = 0, _ minute: Int = 0, _ second: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day,
                                           hour: hour, minute: minute, second: second))!
    }

    /// 周一至周五 9:00–18:00
    static let standardSchedule = WorkSchedule()

    static func schedule(workdays: Set<Int>) -> WorkSchedule {
        WorkSchedule(workdays: workdays)
    }
}
