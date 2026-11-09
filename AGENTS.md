# AGENTS.md — Watermelon 仓库 Agent 规则

## Git 规则（必须遵守）
- 提交前先运行 `git config user.name "ShawnNggg"` 和 `git config user.email "wuqungd@gmail.com"`。
- 只改仓库级 git 配置，**绝对不要**用 `git config --global`。
- **禁止** Co-authored-by 或任何署名 trailer。
- **禁止** `git push --force`，除非用户明确要求并已备份。
- 提交前 `git status` + `git diff` 确认内容正确。

## 仓库信息
- 仓库：`git@github.com:ShawnNggg/Watermelon.git`
- 所有者：ShawnNggg
- 正确邮箱：`wuqungd@gmail.com`

## 项目结构
```
Watermelon/
├── widget/ui/index.html              # 单文件前端（内嵌 CSS + JS）
├── widget/src-tauri/src/main.rs      # Rust 后端（Tauri commands）
├── widget/src-tauri/tauri.conf.json # Tauri 配置
├── widget/src-tauri/Cargo.toml
├── .github/workflows/release.yml     # GitHub Actions 发布流程
└── scripts/gen-latest.py             # latest.json 生成脚本
```

## 常用命令
```bash
# 开发
cd widget && npx tauri dev
# 打包 DMG
cd widget && npx tauri build --bundles dmg
# 打包 App（本地测试）
cd widget && npx tauri build --bundles app
```

## 约束
- macOS aarch64 平台优先。
- 不要改动 updater 公钥配置（`tauri.conf.json` 中的 `pubkey` 字段）。
- 编译命令加代理清理：`env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY`。
