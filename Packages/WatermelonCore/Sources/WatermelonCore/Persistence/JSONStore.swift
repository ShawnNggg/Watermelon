import Foundation

/// AppState 的 JSON 文件持久化：原子写 + 损坏兜底。
public final class JSONStore: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    /// 默认存储位置：~/Library/Application Support/Watermelon/state.json
    public static func defaultURL(fileManager: FileManager = .default) -> URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appending(path: "Library/Application Support")
        return base.appending(path: "Watermelon/state.json")
    }

    /// 读取状态。文件不存在或损坏时回退默认值；损坏文件会改名备份，避免启动崩溃。
    public func load() -> AppState {
        guard let data = try? Data(contentsOf: url) else { return .empty }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(AppState.self, from: data)
        } catch {
            let backupURL = url.deletingLastPathComponent()
                .appending(path: "state.corrupted-\(Int(Date().timeIntervalSince1970)).json")
            try? FileManager.default.moveItem(at: url, to: backupURL)
            return .empty
        }
    }

    /// 原子写：先写同目录临时文件再落位，写入中途崩溃不会留下半个文件。
    public func save(_ state: AppState) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(state)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}
