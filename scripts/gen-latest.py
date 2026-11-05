#!/usr/bin/env python3
"""生成 Tauri v2 updater 的 latest.json manifest.

用法: python3 scripts/gen-latest.py <version> <github_tag> [repo]
"""
import json, sys, os, glob, datetime

VERSION = sys.argv[1]
TAG = sys.argv[2]
REPO = sys.argv[3] if len(sys.argv) > 3 else "ShawnNggg/-"
BUNDLE = os.environ.get("BUNDLE_DIR", "widget/src-tauri/target/release/bundle")
OUT_DIR = os.environ.get("OUT_DIR", "release")

os.makedirs(OUT_DIR, exist_ok=True)

# 找 .tar.gz 和 .sig
targz_list = glob.glob(os.path.join(BUNDLE, "**", "*.app.tar.gz"), recursive=True)
sig_list   = glob.glob(os.path.join(BUNDLE, "**", "*.app.tar.gz.sig"), recursive=True)

if not targz_list:
    print(f"❌ ERROR: no .app.tar.gz found under {BUNDLE}", file=sys.stderr)
    sys.exit(1)
if not sig_list:
    print(f"❌ ERROR: no .sig file found under {BUNDLE}", file=sys.stderr)
    sys.exit(1)

targz = targz_list[0]
sig   = sig_list[0]

targz_basename = os.path.basename(targz)
targz_url = f"https://github.com/{REPO}/releases/download/{TAG}/{targz_basename}"

with open(sig, 'r') as f:
    sig_content = f.read().strip()

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

manifest = {
    "version": VERSION,
    "notes": f"Watermelon v{VERSION} auto build",
    "pub_date": now,
    "platforms": {
        "darwin-aarch64": {
            "signature": sig_content,
            "url": targz_url
        }
    }
}

out_path = os.path.join(OUT_DIR, "latest.json")
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2)

print(f"✅ {out_path} written")
print(json.dumps(manifest, indent=2))
