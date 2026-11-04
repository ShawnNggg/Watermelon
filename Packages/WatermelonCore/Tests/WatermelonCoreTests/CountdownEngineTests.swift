import Foundation
import Testing
@testable import WatermelonCore

struct CountdownEngineTests {
    let engine = CountdownEngine(calendar: TestSupport.calendar)

    // MARK: - 当日状态

    @Test func 上班前状态() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 8, 30),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.status == .beforeWork(start: TestSupport.date(2024, 1, 1, 9, 0),
                                            end: TestSupport.date(2024, 1, 1, 18, 0)))
    }

    @Test func 上班瞬间进度为零() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 9, 0),
                                 schedule: TestSupport.standardSchedule)
        guard case .working(let remaining, let progress, _) = state.status else {
            Issue.record("期望 working，实际 \(state.status)")
            return
        }
        #expect(abs(remaining - 9 * 3600) < 0.5)
        #expect(abs(progress - 0) < 1e-9)
    }

    @Test func 中午的进度与剩余() {
        // 9:00–18:00 共 9 小时，12:00 已过 3 小时
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 12, 0),
                                 schedule: TestSupport.standardSchedule)
        guard case .working(let remaining, let progress, _) = state.status else {
            Issue.record("期望 working，实际 \(state.status)")
            return
        }
        #expect(abs(remaining - 6 * 3600) < 0.5)
        #expect(abs(progress - 1.0 / 3.0) < 1e-9)
    }

    @Test func 下午一点半进度恰好一半() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 13, 30),
                                 schedule: TestSupport.standardSchedule)
        guard case .working(let remaining, let progress, _) = state.status else {
            Issue.record("期望 working，实际 \(state.status)")
            return
        }
        #expect(abs(remaining - 4.5 * 3600) < 0.5)
        #expect(abs(progress - 0.5) < 1e-9)
    }

    @Test func 下班瞬间即为已下班() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 18, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.status == .offWork)
    }

    @Test func 深夜是已下班() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 23, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.status == .offWork)
    }

    @Test func 周六是周末休息日() {
        let state = engine.state(at: TestSupport.date(2024, 1, 6, 10, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.status == .restDay(.weekend))
    }

    @Test func 放假覆盖为休息日() {
        let state = engine.state(at: TestSupport.date(2024, 1, 3, 10, 0),
                                 schedule: TestSupport.standardSchedule,
                                 overrides: [DayKey("2024-01-03"): .holiday])
        #expect(state.status == .restDay(.holiday))
    }

    @Test func 请假覆盖为休息日() {
        let state = engine.state(at: TestSupport.date(2024, 1, 3, 10, 0),
                                 schedule: TestSupport.standardSchedule,
                                 overrides: [DayKey("2024-01-03"): .leave])
        #expect(state.status == .restDay(.leave))
    }

    @Test func 加班一小时十八点半仍在工作() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 18, 30),
                                 schedule: TestSupport.standardSchedule,
                                 overrides: [DayKey("2024-01-01"): .overtime(minutes: 60)])
        guard case .working(let remaining, _, let end) = state.status else {
            Issue.record("期望 working，实际 \(state.status)")
            return
        }
        #expect(abs(remaining - 30 * 60) < 0.5)
        #expect(end == TestSupport.date(2024, 1, 1, 19, 0))
    }

    // MARK: - 周末倒计时

    @Test func 周三的周末目标是本周五下班() {
        let state = engine.state(at: TestSupport.date(2024, 1, 3, 10, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 5, 18, 0))
    }

    @Test func 周五下班前一小时() {
        let state = engine.state(at: TestSupport.date(2024, 1, 5, 17, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 5, 18, 0))
        #expect(abs((state.weekend?.remaining ?? 0) - 3600) < 0.5)
    }

    @Test func 周五下班瞬间滚动到下周() {
        let state = engine.state(at: TestSupport.date(2024, 1, 5, 18, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 12, 18, 0))
    }

    @Test func 周五晚上滚动到下周() {
        let state = engine.state(at: TestSupport.date(2024, 1, 5, 19, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 12, 18, 0))
    }

    @Test func 周六目标是下周五() {
        let state = engine.state(at: TestSupport.date(2024, 1, 6, 10, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 12, 18, 0))
    }

    @Test func 本周五放假则周四下班即周末() {
        let state = engine.state(at: TestSupport.date(2024, 1, 3, 10, 0),
                                 schedule: TestSupport.standardSchedule,
                                 overrides: [DayKey("2024-01-05"): .holiday])
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 4, 18, 0))
    }

    @Test func 周四请假不影响周五目标() {
        let state = engine.state(at: TestSupport.date(2024, 1, 3, 10, 0),
                                 schedule: TestSupport.standardSchedule,
                                 overrides: [DayKey("2024-01-04"): .leave])
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 5, 18, 0))
    }

    @Test func 整周放假滚到下周五() {
        var overrides: [DayKey: OverrideType] = [:]
        for day in 1...5 {
            overrides[DayKey("2024-01-0\(day)")] = .holiday
        }
        let state = engine.state(at: TestSupport.date(2024, 1, 3, 10, 0),
                                 schedule: TestSupport.standardSchedule,
                                 overrides: overrides)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 12, 18, 0))
    }

    @Test func 休息日也返回周末倒计时() {
        let state = engine.state(at: TestSupport.date(2024, 1, 6, 10, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.weekend != nil)
        #expect(state.weekend?.target == TestSupport.date(2024, 1, 12, 18, 0))
    }

    // MARK: - 摸鱼统计

    @Test func 无会话时摸鱼为零() {
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 12, 0),
                                 schedule: TestSupport.standardSchedule)
        #expect(state.moyu.minutes == 0)
        #expect(!state.moyu.isActive)
    }

    @Test func 已结束会话累计时长() {
        let session = MoyuSession(start: TestSupport.date(2024, 1, 1, 10, 0),
                                  end: TestSupport.date(2024, 1, 1, 10, 30))
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 12, 0),
                                 schedule: TestSupport.standardSchedule,
                                 moyuSessions: [session])
        #expect(state.moyu.minutes == 30)
        #expect(!state.moyu.isActive)
    }

    @Test func 进行中会话统计到当前时间() {
        let session = MoyuSession(start: TestSupport.date(2024, 1, 1, 11, 15))
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 12, 0),
                                 schedule: TestSupport.standardSchedule,
                                 moyuSessions: [session])
        #expect(state.moyu.minutes == 45)
        #expect(state.moyu.isActive)
    }

    @Test func 跨天会话只算当天部分() {
        // 周日 23:30 摸到周一 00:30，周一当天只算 30 分钟
        let session = MoyuSession(start: TestSupport.date(2024, 1, 7, 23, 30),
                                  end: TestSupport.date(2024, 1, 8, 0, 30))
        let state = engine.state(at: TestSupport.date(2024, 1, 8, 12, 0),
                                 schedule: TestSupport.standardSchedule,
                                 moyuSessions: [session])
        #expect(state.moyu.minutes == 30)
    }

    @Test func 多段会话累加() {
        let s1 = MoyuSession(start: TestSupport.date(2024, 1, 1, 10, 0),
                             end: TestSupport.date(2024, 1, 1, 10, 15))
        let s2 = MoyuSession(start: TestSupport.date(2024, 1, 1, 15, 0),
                             end: TestSupport.date(2024, 1, 1, 15, 20))
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 17, 0),
                                 schedule: TestSupport.standardSchedule,
                                 moyuSessions: [s1, s2])
        #expect(state.moyu.minutes == 35)
    }

    @Test func 搬砖中叠加摸鱼汇总() {
        let session = MoyuSession(start: TestSupport.date(2024, 1, 1, 11, 50))
        let state = engine.state(at: TestSupport.date(2024, 1, 1, 12, 0),
                                 schedule: TestSupport.standardSchedule,
                                 moyuSessions: [session])
        guard case .working = state.status else {
            Issue.record("期望 working，实际 \(state.status)")
            return
        }
        #expect(state.moyu.minutes == 10)
        #expect(state.moyu.isActive)
    }
}
