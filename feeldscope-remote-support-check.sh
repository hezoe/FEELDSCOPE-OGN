#!/bin/bash
# FEELDSCOPE リモートサポート時限強制
# state ファイルの expiresAt(epoch秒) に基づき wg-quick@wg0 を start/stop する。
# - now < expiresAt : 窓内 → 起動(未起動なら start)。※再起動後もこれでON復帰
# - now >= expiresAt: 期限切れ/無効 → 停止(起動中なら stop)＋ disable
# systemd timer(毎分, OnBootSec) と手動から呼ばれる。root で実行。
set -u
STATE="${FEELDSCOPE_REMOTE_SUPPORT_STATE:-/home/pi/FEELDSCOPE/remote-support.json}"

now=$(date +%s)
expires=0
if [ -f "$STATE" ]; then
  expires=$(grep -oE '"expiresAt"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE" | grep -oE '[0-9]+' | tail -1)
  expires=${expires:-0}
fi

active=$(systemctl is-active wg-quick@wg0 2>/dev/null || true)

if [ "$expires" -gt "$now" ]; then
  # 窓内: ON を維持
  if [ "$active" != "active" ]; then
    systemctl start wg-quick@wg0 \
      && logger -t feeldscope-remote-support "started (remaining $((expires-now))s)"
  fi
else
  # 期限切れ or 無効: OFF
  if [ "$active" = "active" ]; then
    systemctl stop wg-quick@wg0 \
      && logger -t feeldscope-remote-support "auto-off (expired)"
  fi
  # systemd enable による恒久ONが残っていたら解除(時限管理は自前で行う)
  systemctl disable wg-quick@wg0 >/dev/null 2>&1 || true
fi
