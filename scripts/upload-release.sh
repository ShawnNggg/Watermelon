#!/usr/bin/env bash
# 一键上传 Tauri Release 产物到 GitHub Releases
# 用法：
#   bash scripts/upload-release.sh                # 自动探测 v0.1.4、自动找最新产物
#   bash scripts/upload-release.sh v0.1.4         # 指定 tag
#   bash scripts/upload-release.sh v0.1.5 /path/to/dir  # 指定 tag + 指定产物目录
#
# 前提：
#   1. 已 export GITHUB_TOKEN=ghp_xxx
#   2. 已 git push 并 push --tags 到 origin
#   3. 已跑过 npm run tauri build

set -euo pipefail

# 绕过用户 shell 里的 HTTP_PROXY（.zshrc 可能配了 v2ray 但未启动）
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="localhost,127.0.0.1,github.com,api.github.com,uploads.github.com"

# —— 0. 基本信息 ——
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO="ShawnNggg/Watermelon"
API="https://api.github.com"
UPLOAD="https://uploads.github.com"

# —— 1. 参数 & 前置检查 ——
TAG="${1:-$(git -C "$PROJ_DIR" tag --sort=-creatordate | head -1)}"
ARTIFACT_DIR="${2:-$PROJ_DIR/widget/src-tauri/target/release/bundle}"

if [ -z "$TAG" ]; then
  echo "❌ 找不到任何 git tag，请先打 tag 或手动传入"
  exit 1
fi

# 解析 GITHUB_TOKEN：env 或命令行覆盖
if [ -z "${GITHUB_TOKEN:-}" ]; then
  # 尝试从 osxkeychain 找（git credential helper 存的 GitHub token）
  FOUND=$(printf "protocol=https\nhost=github.com\n\n" | git -C "$PROJ_DIR" credential fill 2>/dev/null \
    | awk '/^password=/ {print substr($0,index($0,"=")+1); exit}')
  if [ -n "$FOUND" ]; then
    GITHUB_TOKEN="$FOUND"
    echo "🔑 从 git credential helper 读到 token"
  fi
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "❌ GITHUB_TOKEN 未设置，有两种解法："
  echo ""
  echo "  方案 1 — 新生成一个 PAT（推荐）："
  echo "    1. 打开 https://github.com/settings/tokens/new"
  echo "    2. Note 随便写 · Expiration 90d · Scopes 选 repo (full control)"
  echo "       或者用 Fine-grained token：选 ShawnNggg/Watermelon repo，"
  echo "       Permissions → Repository permissions → Contents: Read and write"
  echo "    3. 复制生成的 token，然后："
  echo "       export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx"
  echo "       bash scripts/upload-release.sh"
  echo ""
  echo "  方案 2 — 存进 osxkeychain（git credential helper 自动读）："
  echo "    git credential-osxkeychain store  # 交互输入 username / password(=PAT)"
  echo "    bash scripts/upload-release.sh     # 会自动找到"
  exit 1
fi

# token 冒烟检查
TOKEN_CHK=$(curl -sS -o /dev/null -w "%{http_code}" \
  --noproxy '*' \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/user")
if [ "$TOKEN_CHK" != "200" ]; then
  echo "❌ Token 无效（HTTP $TOKEN_CHK），请重新生成：https://github.com/settings/tokens/new"
  exit 1
fi
echo "🔑 Token OK"

echo "🎯 Repo : $REPO"
echo "🏷️  Tag  : $TAG"
echo "📁 Artifacts : $ARTIFACT_DIR"
echo ""

# —— 2. 收集产物（排除 bundle_dmg.sh 临时残留 rw.*.dmg）——
mapfile -t ASSETS < <(find "$ARTIFACT_DIR" -maxdepth 4 \
  \( -name "*.dmg" -o -name "*.tar.gz" -o -name "*.tar.gz.sig" \
     -o -name "latest*.json" -o -name "*.apk" -o -name "*.msi" \) \
  -type f \
  ! -name "rw.*.dmg" \
  | sort)

if [ ${#ASSETS[@]} -eq 0 ]; then
  echo "❌ 在 $ARTIFACT_DIR 下没找到任何产物"
  echo "   先跑 cd widget && npm run tauri build"
  exit 1
fi

echo "📦 待上传产物（${#ASSETS[@]} 个）："
ls -lh "${ASSETS[@]}" | sed 's/^/  /'
echo ""

# —— 3. 查 / 创建 Release ——
# 优先用 tag 名匹配 Release，没匹配到就用 commit tag
RELEASE_JSON=$(curl -sS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/repos/$REPO/releases/tags/$TAG" \
  -o /tmp/wm_release.json -w "%{http_code}" \
  || echo 0)

if [ "$RELEASE_JSON" = "404" ]; then
  echo "🆕 Release 不存在，新建（tag=$TAG）..."
  RELEASE_BODY=$(cat <<'BODY'
v0.1.4 · 重构 + 25 动作库 + 圆角修复

feat: typecheck main.ts, 25-action pet pool, 2-min rotation, settings bottom corner fix

- main.ts 去掉 @ts-nocheck，231 个 TS 错误清零；resolveDay 桥接到 domain 纯函数；PET_ACTS 全部换成 BehaviorEngine.tick()；overrides type→kind 数据迁移
- 小狗动作池扩展到 25 个（搬砖 13 / 摸鱼 5 / 加班 3 / 下班 3 / 休息 1），每 2 分钟自动轮换（原 7.5s）
- 点小狗 → 立刻换动作（不再触发摸鱼）；新增 BehaviorEngine.next() 跳过冷却
- 设置面板：新增内部滚动容器，窗口触顶时滚动发生在内层、外层仍保留 20px 圆角；autoFit 先解除约束再测量真实内容高度
- 新增 15 个 SVG 道具 + CSS 动画（咖啡杯、书本、记事本、音符、会议气泡、问号/叹气、饼干、手机、乌云小雨、爱心等）
- tauri.conf.json：窗口宽度 300→340；CSP 收紧放行 wasm-unsafe-eval + asset://localhost（Rive 预留）
- Tauri v2 schemas 重新生成
- 测试 97/97 全绿，tsc 0 错，vite build 通过
BODY
)
  curl -sS \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"tag_name":sys.argv[1],"name":sys.argv[1],"body":open(sys.argv[2]).read(),"draft":False,"prerelease":False}))' \
        "$TAG" <(echo "$RELEASE_BODY"))" \
    "$API/repos/$REPO/releases" \
    -o /tmp/wm_release.json
else
  echo "♻️  Release 已存在，复用并更新资产"
fi

RELEASE_ID=$(python3 -c 'import json; print(json.load(open("/tmp/wm_release.json"))["id"])')
echo "🔗 Release ID = $RELEASE_ID"

# —— 4. 清理同名旧资产 ——
export GITHUB_TOKEN
python3 - "$RELEASE_ID" <<'PY'
import json, os, subprocess, sys
rid = sys.argv[1]
d = json.load(open("/tmp/wm_release.json"))
remote = {a["name"]: a["id"] for a in d.get("assets", [])}
token = os.environ["GITHUB_TOKEN"]
# 清理所有 Watermelon 相关旧资产（避免 version mismatch）
to_delete = [aid for name, aid in remote.items() if "Watermelon" in name or name.startswith("latest")]
for aid in to_delete:
    subprocess.run([
        "curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
        "-H", f"Authorization: Bearer {token}",
        "-X", "DELETE",
        f"https://api.github.com/repos/ShawnNggg/Watermelon/releases/assets/{aid}",
    ], check=False)
PY
echo "🧹 旧资产清理完成"

# —— 5. 逐个上传 ——
upload_one() {
  local file="$1"
  local name
  name=$(basename "$file")
  local mime
  case "$name" in
    *.dmg)  mime="application/x-apple-diskimage" ;;
    *.tar.gz) mime="application/gzip" ;;
    *.sig)  mime="application/pgp-signature" ;;
    *.json) mime="application/json" ;;
    *)      mime="application/octet-stream" ;;
  esac
  local size
  size=$(stat -f%z "$file")
  printf "⬆  上传 %-40s %6s bytes" "$name" "$size"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Content-Type: $mime" \
    --data-binary "@$file" \
    "$UPLOAD/repos/$REPO/releases/$RELEASE_ID/assets?name=$name")
  if [ "$code" = "201" ]; then
    echo " ✅ ($code)"
  else
    echo " ❌ HTTP $code"
    return 1
  fi
}

for f in "${ASSETS[@]}"; do
  upload_one "$f" || exit 1
done

echo ""
echo "🎉 全部上传完成！"
echo "🔗 访问 https://github.com/$REPO/releases/tag/$TAG 查看"
