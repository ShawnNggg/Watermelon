import Foundation

/// 时钟协议：引擎不直接触碰 Date()，测试注入固定时间。
public protocol Clock: Sendable {
    func now() -> Date
}

public struct SystemClock: Clock {
    public init() {}
    public func now() -> Date { Date() }
}
