// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "WatermelonCore",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "WatermelonCore", targets: ["WatermelonCore"])
    ],
    targets: [
        .target(name: "WatermelonCore"),
        .testTarget(name: "WatermelonCoreTests", dependencies: ["WatermelonCore"])
    ]
)
