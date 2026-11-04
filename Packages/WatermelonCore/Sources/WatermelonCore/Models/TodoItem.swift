import Foundation

public struct TodoItem: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var title: String
    public var isDone: Bool
    /// 是否计入「下班前还有 N 件事」
    public var dueToday: Bool
    public var createdAt: Date
    public var completedAt: Date?

    public init(id: UUID = UUID(),
                title: String,
                isDone: Bool = false,
                dueToday: Bool = true,
                createdAt: Date = Date(),
                completedAt: Date? = nil) {
        self.id = id
        self.title = title
        self.isDone = isDone
        self.dueToday = dueToday
        self.createdAt = createdAt
        self.completedAt = completedAt
    }
}
