#!/usr/bin/env bash
# 生成 latest.json（Tauri v2 updater manifest）
# 用法: bash scripts/gen-latest.sh <version> <github_tag> [repo]
set -euo pipefail

VERSION="${1:?usage: gen-latest.sh <version> <github_tag> [repo]}"
TAG="${2:?missing tag}"
REPO="${3:-ShawnNggg/-}"
BUNDLE_DIR="${BUNDLE_DIR:-widget/src-tauri/target/release/bundle}"
OUT_DIR="${OUT_DIR:-release}"

mkdir -p "$OUT_DIR"

# 找 .tar.gz 和 .sig
TARGZ_FILE=$(find "$BUNDLE_DIR" -name "*.app.tar.gz" -type f | head -1)
SIG_FILE=$(find "$BUNDLE_DIR" -name "*.app.tar.gz.sig" -type f | head -1)

echo "tar.gz: $TARGZ_FILE"
echo "sig: $SIG_FILE"

if [ -z "$TARGZ_FILE" ] || [ ! -f "$TARGZ_FILE" ]; then
    echo "❌ ERROR: no .app.tar.gz found under $BUNDLE_DIR" >&2
    exit 1
fi

if [ -z "$SIG_FILE" ] || [ ! -f "$SIG_FILE" ]; then
    echo "❌ ERROR: no .sig file found under $BUNDLE_DIR" >&2
    exit 1
fi

TARGZ_BASENAME=$(basename "$TARGZ_FILE")
SIG_CONTENT=$(cat "$SIG_FILE" | tr -d '\r')
TARGZ_URL="https://github.com/${REPO}/releases/download/${TAG}/${TARGZ_BASENAME}"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 -c "
import json
sig = '''${SIG_CONTENT}'''
manifest = {
    'version': '${VERSION}',
    'notes': f'Watermelon v${VERSION} auto build',
    'pub_date': '${NOW}',
    'platforms': {
        'darwin-aarch64': {
            'signature': sig.strip(),
            'url': '${TARGZ_URL}'
        }
    }
}
with open('${OUT_DIR}/latest.json', 'w') as f:
    json.dump(manifest, f, indent=2)
print('✅ ${OUT_DIR}/latest.json written')
print(json.dumps(manifest, indent=2))
"
