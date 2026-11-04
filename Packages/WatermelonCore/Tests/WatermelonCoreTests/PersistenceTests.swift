import Foundation
import Testing
@testable import WatermelonCore

struct PersistenceTests {
    func makeStore() throws -> (JSONStore, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appending(path: "watermelon-tests-\(UUID().uuidString)")
        let url = dir.appending(path: "state.json")
        return (JSONStore(url: url), dir)
    }

    @Test func 保存后读取完整还原() throws {
        let (store, dir) = try makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }

        // 注意：ISO8601 编码不带小数秒，测试日期必须整秒
        var state = AppState(hasOnboarded: true)
        state.schedule = WorkSchedule(workdays: [2, 3, 4, 5, 6, 7],
                                      workStart: TimeOfDay(10, 30),
                                      workEnd: TimeOfDay(19, 30))
        state.overrides = [
            DayOverride(day: DayKey("2024-01-02"), type: .holiday),
            DayOverride(day: DayKey("2024-01-03"), type: .overtime(minutes: 90)),
            DayOverride(day: DayKey("2024-01-04"), type: .leave)
        ]
        state.todos = [
            TodoItem(id: UUID(), title: "写周报", isDone: false, dueToday: true,
                     createdAt: TestSupport.date(2024, 1, 1, 9, 0)),
            TodoItem(id: UUID(), title: "交报销", isDone: true, dueToday: false,
                     createdAt: TestSupport.date(2024, 1, 1, 9, 5),
                     completedAt: TestSupport.date(2024, 1, 1, 11, 0))
        ]
        state.moyuSessions = [
            MoyuSession(id: UUID(),
                        start: TestSupport.date(2024, 1, 1, 10, 0),
                        end: TestSupport.date(2024, 1, 1, 10, 30)),
            MoyuSession(id: UUID(), start: TestSupport.date(2024, 1, 1, 15, 0))
        ]

        try store.save(state)
        #expect(store.load() == state)
    }

    @Test func 文件不存在返回默认状态() throws {
        let (store, dir) = try makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(store.load() == .empty)
    }

    @Test func 损坏文件备份并回退默认() throws {
        let (store, dir) = try makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("not a json {{{".utf8).write(to: store.url)

        #expect(store.load() == .empty)

        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path())
        #expect(files.contains { $0.hasPrefix("state.corrupted-") && $0.hasSuffix(".json") })
    }

    @Test func 保存产出合法JSON() throws {
        let (store, dir) = try makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.save(.empty)

        let data = try Data(contentsOf: store.url)
        let object = try JSONSerialization.jsonObject(with: data)
        let dict = object as? [String: Any]
        #expect(dict?["schedule"] != nil)
        #expect(dict?["hasOnboarded"] != nil)
    }

    @Test func 同天多条覆盖后者生效() {
        let state = AppState(overrides: [
            DayOverride(day: DayKey("2024-01-01"), type: .holiday),
            DayOverride(day: DayKey("2024-01-01"), type: .leave)
        ])
        #expect(state.overridesByDay[DayKey("2024-01-01")] == .leave)
    }
}
