import Foundation

/// 持久化聚合根：整个 App 的可持久化状态都在这里。
public struct AppState: Codable, Equatable, Sendable {
    public var hasOnboarded: Bool
    public var schedule: WorkSchedule
    public var overrides: [DayOverride]
    public var todos: [TodoItem]
    public var moyuSessions: [MoyuSession]

    public init(hasOnboarded: Bool = false,
                schedule: WorkSchedule = WorkSchedule(),
                overrides: [DayOverride] = [],
                todos: [TodoItem] = [],
                moyuSessions: [MoyuSession] = []) {
        self.hasOnboarded = hasOnboarded
        self.schedule = schedule
        self.overrides = overrides
        self.todos = todos
        self.moyuSessions = moyuSessions
    }

    public static var empty: AppState { AppState() }

    /// 引擎输入用的索引表；同一天多条时后者覆盖前者。
    public var overridesByDay: [DayKey: OverrideType] {
        Dictionary(overrides.map { ($0.day, $0.type) }, uniquingKeysWith: { _, new in new })
    }
}
