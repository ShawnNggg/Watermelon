import Foundation
import Testing
@testable import WatermelonCore

struct WorkdayResolverTests {
    func resolver(_ overrides: [DayKey: OverrideType] = [:],
                  schedule: WorkSchedule = TestSupport.standardSchedule) -> WorkdayResolver {
        WorkdayResolver(calendar: TestSupport.calendar, schedule: schedule, overrides: overrides)
    }

    @Test func 普通周一是工作日() {
        let day = resolver().resolve(TestSupport.date(2024, 1, 1, 12, 0))
        #expect(day.isWorkday)
        #expect(day.restReason == nil)
        #expect(day.start == TestSupport.date(2024, 1, 1, 9, 0))
        #expect(day.effectiveEnd == TestSupport.date(2024, 1, 1, 18, 0))
    }

    @Test func 周六是周末休息日() {
        let day = resolver().resolve(TestSupport.date(2024, 1, 6, 10, 0))
        #expect(!day.isWorkday)
        #expect(day.restReason == .weekend)
        #expect(day.start == nil)
        #expect(day.effectiveEnd == nil)
    }

    @Test func 周日是周末() {
        let day = resolver().resolve(TestSupport.date(2024, 1, 7, 10, 0))
        #expect(!day.isWorkday)
        #expect(day.restReason == .weekend)
    }

    @Test func 放假覆盖工作日() {
        let day = resolver([DayKey("2024-01-02"): .holiday])
            .resolve(TestSupport.date(2024, 1, 2, 10, 0))
        #expect(!day.isWorkday)
        #expect(day.restReason == .holiday)
    }

    @Test func 请假覆盖工作日() {
        let day = resolver([DayKey("2024-01-03"): .leave])
            .resolve(TestSupport.date(2024, 1, 3, 10, 0))
        #expect(!day.isWorkday)
        #expect(day.restReason == .leave)
    }

    @Test func 加班顺延下班时间() {
        let day = resolver([DayKey("2024-01-01"): .overtime(minutes: 120)])
            .resolve(TestSupport.date(2024, 1, 1, 10, 0))
        #expect(day.isWorkday)
        #expect(day.effectiveEnd == TestSupport.date(2024, 1, 1, 20, 0))
    }

    @Test func 加班不跨天截断到235959() {
        // 18:00 + 600 分钟 = 次日 04:00，应截断到当天 23:59:59
        let day = resolver([DayKey("2024-01-01"): .overtime(minutes: 600)])
            .resolve(TestSupport.date(2024, 1, 1, 10, 0))
        #expect(day.effectiveEnd == TestSupport.date(2024, 1, 1, 23, 59, 59))
    }

    @Test func 加班不影响上班时间() {
        let day = resolver([DayKey("2024-01-01"): .overtime(minutes: 120)])
            .resolve(TestSupport.date(2024, 1, 1, 10, 0))
        #expect(day.start == TestSupport.date(2024, 1, 1, 9, 0))
    }

    @Test func 单休排班周六是工作日() {
        let schedule = TestSupport.schedule(workdays: [2, 3, 4, 5, 6, 7])
        let day = resolver(schedule: schedule).resolve(TestSupport.date(2024, 1, 6, 10, 0))
        #expect(day.isWorkday)
    }

    @Test func 空工作日集合全部休息() {
        let schedule = TestSupport.schedule(workdays: [])
        let day = resolver(schedule: schedule).resolve(TestSupport.date(2024, 1, 1, 10, 0))
        #expect(!day.isWorkday)
        #expect(day.restReason == .weekend)
    }
}
