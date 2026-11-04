import Foundation

/// 日粒度键，格式 "yyyy-MM-dd"，按注入的日历时区解释。
public struct DayKey: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let raw: String

    public init(_ raw: String) {
        self.raw = raw
    }

    public init(date: Date, calendar: Calendar) {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        self.raw = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    public static func < (lhs: DayKey, rhs: DayKey) -> Bool { lhs.raw < rhs.raw }

    public var description: String { raw }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        raw = try container.decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(raw)
    }
}
