import Foundation

/// 一段摸鱼计时。end == nil 表示「摸鱼中」（未结束会话会持久化，App 重启不丢状态）。
public struct MoyuSession: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var start: Date
    public var end: Date?

    public init(id: UUID = UUID(), start: Date, end: Date? = nil) {
        self.id = id
        self.start = start
        self.end = end
    }
}
