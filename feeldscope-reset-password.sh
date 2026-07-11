#!/bin/bash
# 管理者パスワードのリセット（オペレーター/失念時の復旧用）
# 使い方: feeldscope-reset-password [新パスワード]   引数なしで既定 "admin" に戻す
# webapp(src/lib/auth.ts)と同じ scrypt(32B, salt16B) 形式で auth.json を書き換える。
set -eu
AUTH="${FEELDSCOPE_AUTH_CONFIG:-/home/pi/FEELDSCOPE/auth.json}"
NEW="${1:-admin}"

FEELDSCOPE_AUTH_PATH="$AUTH" FEELDSCOPE_NEWPASS="$NEW" node -e '
const { randomBytes, scryptSync } = require("crypto");
const fs = require("fs");
const p = process.env.FEELDSCOPE_NEWPASS;
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(p, salt, 32).toString("hex");
const sessionSecret = randomBytes(32).toString("hex");
fs.writeFileSync(process.env.FEELDSCOPE_AUTH_PATH,
  JSON.stringify({ salt, hash, sessionSecret, mustChange: true }, null, 2),
  { mode: 0o600 });
'
chown pi:pi "$AUTH" 2>/dev/null || true
echo "管理者パスワードをリセットしました（新パスワード: '$NEW' / 次回変更を推奨）。"
