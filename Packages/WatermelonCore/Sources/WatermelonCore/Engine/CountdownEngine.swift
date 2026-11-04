import Foundation

public enum WorkStatus: Equatable, Sendable {
    /// 还没上班（今天是工作日，now < start）
    case beforeWork(start: Date, end: Date)
    /// 搬砖中
    case working(remaining: TimeInterval, progress: Double, end: Date)
    /// 已下班（今天是工作日，now >= effectiveEnd）
    case offWork
    /// 休息日
    case restDay(RestReason)
}

public struct WeekendCountdown: Equatable, Sendable {
    public var target: Date
    public var remaining: TimeInterval
}

public struct MoyuSummary: Equatable, Sendable {
    public var minutes: Int
    public var isActive: Bool
}

public struct CountdownState: Equatable, Sendable {
    public var status: WorkStatus
    public var moyu: MoyuSummary
    public var weekend: WeekendCountdown?
}

/// 倒计时引擎：纯函数，零 SwiftUI 依赖，全部输入显式传入。
public struct CountdownEngine: Sendable {
    public var calendar: Calendar

    public init(calendar: Calendar = .current) {
        self.calendar = calendar
    }

    public func state(at now: Date,
                      schedule: WorkSchedule,
                      overrides: [DayKey: OverrideType] = [:],
                      moyuSessions: [MoyuSession] = []) -> CountdownState {
        let resolver = WorkdayResolver(calendar: calendar, schedule: schedule, overrides: overrides)
        let today = resolver.resolve(now)
        let moyu = moyuSummary(on: now, sessions: moyuSessions, at: now)

        let status: WorkStatus
        if !today.isWorkday {
            status = .restDay(today.restReason ?? .weekend)
        } else if let start = today.start, let end = today.effectiveEnd {
            if now < start {
                status = .beforeWork(start: start, end: end)
            } else if now < end {
                let total = end.timeIntervalSince(start)
                let elapsed = now.timeIntervalSince(start)
                let progress = total > 0 ? min(max(elapsed / total, 0), 1) : 0
                status = .working(remaining: end.timeIntervalSince(now), progress: progress, end: end)
            } else {
                status = .offWork
            }
        } else {
            status = .offWork
        }

        return CountdownState(status: status,
                              moyu: moyu,
                              weekend: weekendCountdown(at: now, resolver: resolver))
    }

    /// 周末倒计时：本周（按 calendar 周）最后一个工作日的 effectiveEnd；该时刻已过则顺延到下周。
    /// 连续 4 周都找不到工作日（极端排班或连续放假）返回 nil。
    public func weekendCountdown(at now: Date, resolver: WorkdayResolver) -> WeekendCountdown? {
        for weekOffset in 0..<4 {
            guard let probe = calendar.date(byAdding: .weekOfYear, value: weekOffset, to: now),
                  let week = calendar.dateInterval(of: .weekOfYear, for: probe) else { continue }
            var lastEnd: Date? = nil
            var day = week.start
            while day < week.end {
                let resolved = resolver.resolve(day)
                if resolved.isWorkday, let end = resolved.effectiveEnd {
                    lastEnd = end
                }
                guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
            if let lastEnd, lastEnd > now {
                return WeekendCountdown(target: lastEnd, remaining: lastEnd.timeIntervalSince(now))
            }
        }
        return nil
    }

    /// 摸鱼统计：只累计落在「当天」内的时长；进行中的会话统计到 now。
    public func moyuSummary(on day: Date, sessions: [MoyuSession], at now: Date) -> MoyuSummary {
        let dayStart = calendar.startOfDay(for: day)
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart)
            ?? dayStart.addingTimeInterval(86400)
        var total: TimeInterval = 0
        var active = false
        for session in sessions {
            let end = session.end ?? now
            let overlapStart = max(session.start, dayStart)
            let overlapEnd = min(end, dayEnd)
            if overlapEnd > overlapStart {
                total += overlapEnd.timeIntervalSince(overlapStart)
            }
            if session.end == nil {
                active = true
            }
        }
        return MoyuSummary(minutes: Int(total / 60), isActive: active)
    }
}
