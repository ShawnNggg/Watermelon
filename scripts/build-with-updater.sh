#!/usr/bin/env bash
# 一键脚本：build Watermelon 带 updater 签名
# 运行前提：已经在本地生成过签名密钥（~/.tauri/watermelon.key）
#
#   npx tauri signer generate -w ~/.tauri/watermelon.key
#
# 预期产出（在 widget/src-tauri/target/release/bundle/macos/）：
#   Watermelon.app
#   Watermelon.app.tar.gz      ← updater 安装包
#   Watermelon.app.tar.gz.sig  ← 签名
#   latest-macos.json          ← updater manifest

set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ_DIR/widget"

export TAURI_SIGNING_PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/watermelon.key}"

if [ ! -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then
  echo "❌ 签名密钥不存在：$TAURI_SIGNING_PRIVATE_KEY_PATH"
  echo "   先运行：npx tauri signer generate -w ~/.tauri/watermelon.key"
  exit 1
fi

echo "🔐 使用密钥：$TAURI_SIGNING_PRIVATE_KEY_PATH"

# 清旧 bundle（避免拿到过期的 latest.json）
rm -rf src-tauri/target/release/bundle

echo "🚀 开始 build（带 updater 签名）..."
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  PATH="$HOME/.cargo/bin:$PATH" \
  TAURI_SIGNING_PRIVATE_KEY_PATH="$TAURI_SIGNING_PRIVATE_KEY_PATH" \
  npx tauri build --bundles dmg

echo ""
echo "✅ Build 完成，产物在 src-tauri/target/release/bundle/"
echo ""

# 展示关键产物
echo "📦 关键产物："
echo "--- macos bundle ---"
ls -lh src-tauri/target/release/bundle/macos/ 2>/dev/null | sed 's/^/  /'
echo "--- dmg bundle ---"
ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | sed 's/^/  /' || echo "  (bundle_dmg.sh 可能被系统沙箱拦了，不影响 updater)"
echo ""

echo "🔐 Updater 签名验证（如果有 tar.gz）："
for f in src-tauri/target/release/bundle/macos/*.tar.gz; do
  [ -f "$f" ] || continue
  sig="${f}.sig"
  if [ -f "$sig" ]; then
    echo "  ✅ 找到 $f"
    echo "  ✅ 找到签名 $sig"
    # 验证签名
    npx tauri signer verify \
      --file "$f" \
      --signature "$sig" \
      --pubkey "$TAURI_SIGNING_PRIVATE_KEY_PATH.pub" 2>&1 | sed 's/^/  /'
  else
    echo "  ❌ 没有找到签名文件 $sig"
  fi
done

# 显示 latest.json 路径和内容
latest=$(find src-tauri/target/release/bundle -name "latest*.json" -maxdepth 4 | head -1)
if [ -n "$latest" ]; then
  echo ""
  echo "📝 Updater manifest（$latest）："
  cat "$latest" | python3 -m json.tool 2>/dev/null | sed 's/^/  /' || cat "$latest"
  echo ""
  echo "💡 下一步：把这个 latest.json 和 .tar.gz / .sig 一起上传到 GitHub Release"
  echo "   tauri.conf.json 里 plugins.updater.endpoints 应该指向 GitHub Release 里的 latest.json"
fi
