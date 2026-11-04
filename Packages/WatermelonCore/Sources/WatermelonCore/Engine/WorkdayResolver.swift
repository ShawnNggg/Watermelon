import Foundation

public enum RestReason: String, Codable, Equatable, Sendable {
    case weekend
    case holiday
    case leave
}

/// 某天的「实际作息」：全局作息 + 当日覆盖合成后的结果。
public struct ResolvedDay: Equatable, Sendable {
    public var day: DayKey
    public var isWorkday: Bool
    public var restReason: RestReason?
    /// 休息日为 nil
    public var start: Date?
    public var effectiveEnd: Date?
}

/// 把全局作息 + 当日覆盖合成为某天的实际作息。
/// 优先级：override(holiday/leave) > workdays 集合；overtime 只顺延 effectiveEnd。
public struct WorkdayResolver: Sendable {
    public var calendar: Calendar
    public var schedule: WorkSchedule
    public var overrides: [DayKey: OverrideType]

    public init(calendar: Calendar = .current,
                schedule: WorkSchedule,
                overrides: [DayKey: OverrideType] = [:]) {
        self.calendar = calendar
        self.schedule = schedule
        self.overrides = overrides
    }

    public func resolve(_ day: Date) -> ResolvedDay {
        let key = DayKey(date: day, calendar: calendar)
        let dayStart = calendar.startOfDay(for: day)

        switch overrides[key] {
        case .holiday:
            return ResolvedDay(day: key, isWorkday: false, restReason: .holiday, start: nil, effectiveEnd: nil)
        case .leave:
            return ResolvedDay(day: key, isWorkday: false, restReason: .leave, start: nil, effectiveEnd: nil)
        default:
            break
        }

        let weekday = calendar.component(.weekday, from: day)
        guard schedule.workdays.contains(weekday) else {
            return ResolvedDay(day: key, isWorkday: false, restReason: .weekend, start: nil, effectiveEnd: nil)
        }

        let start = timeOnDay(dayStart, schedule.workStart)
        var end = timeOnDay(dayStart, schedule.workEnd)
        if case .overtime(let minutes) = overrides[key] {
            end = calendar.date(byAdding: .minute, value: minutes, to: end) ?? end
        }
        // 加班不跨天：截断到当天 23:59:59
        let dayLimit = (calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart)
            .addingTimeInterval(-1)
        end = min(end, dayLimit)
        // 防御异常输入（如下班时间早于上班时间）：按休息日处理，避免除零与负值
        guard end > start else {
            return ResolvedDay(day: key, isWorkday: false, restReason: .weekend, start: nil, effectiveEnd: nil)
        }

        return ResolvedDay(day: key, isWorkday: true, restReason: nil, start: start, effectiveEnd: end)
    }

    private func timeOnDay(_ dayStart: Date, _ time: TimeOfDay) -> Date {
        calendar.date(byAdding: .minute, value: time.minutesSinceMidnight, to: dayStart) ?? dayStart
    }
}
