#!/bin/bash
# FEELDSCOPE リモートサポート ウォッチドッグ
# ON/OFF の正本は systemd の wg-quick@wg0 の enable 状態。
# - enabled かつ inactive → start（再起動直後の取りこぼしや異常停止からの自動復帰）
# - disabled            → 何もしない（OFF は webapp の disable --now で即時反映済み）
# systemd timer(毎分, OnBootSec) と手動から呼ばれる。root で実行。
#
# 旧仕様(3時間で自動OFF)の名残として remote-support.json が残っていても参照しない。
set -u

enabled=$(systemctl is-enabled wg-quick@wg0 2>/dev/null || true)
active=$(systemctl is-active wg-quick@wg0 2>/dev/null || true)

if [ "$enabled" = "enabled" ] && [ "$active" != "active" ]; then
  systemctl start wg-quick@wg0 \
    && logger -t feeldscope-remote-support "restarted (was $active while enabled)"
fi
