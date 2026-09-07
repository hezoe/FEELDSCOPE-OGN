#!/bin/bash
# FEELDSCOPE リモートサポート ウォッチドッグ
# ON/OFF の正本は systemd の wg-quick@wg0 の enable 状態。
#   - enabled かつ inactive        → start（再起動直後の取りこぼしや異常停止からの復帰）
#   - enabled かつ active だが無通信 → restart（ハンドシェイク途絶からの復帰）
#   - disabled                     → 何もしない（OFF は webapp の disable --now で反映済み）
# systemd timer(毎分, OnBootSec) と手動から呼ばれる。root で実行。
#
# ハンドシェイク途絶の検知が要る理由:
# ハブ側が一定時間落ちると、端末の WireGuard は再試行(REKEY_ATTEMPT_TIME=90秒)を
# 使い切って沈黙する。端末から VPN 宛に自発的な通信が無いため、ハブが復旧しても
# 自力では戻らず、リモートサポートON のまま到達不能になる。実際に発生した。
#
# 旧仕様(3時間で自動OFF)の名残として remote-support.json が残っていても参照しない。
set -u

# 無通信とみなすまでの秒数。正常時のハンドシェイク間隔は約2分(keepalive 25秒)。
STALL_SEC="${FEELDSCOPE_WG_STALL_SEC:-300}"
# 復旧を試みる最短間隔。ハブ側が長時間落ちている間の再起動連打を防ぐ。
RETRY_INTERVAL_SEC="${FEELDSCOPE_WG_RETRY_INTERVAL_SEC:-600}"
# 最後に復旧を試みた時刻の記録。tmpfs 上に置き、再起動でリセットされてよい。
STAMP="${FEELDSCOPE_WG_STAMP:-/run/feeldscope-remote-support.stamp}"

enabled=$(systemctl is-enabled wg-quick@wg0 2>/dev/null || true)
[ "$enabled" = "enabled" ] || exit 0

now=$(date +%s)

mark_attempt() { : > "$STAMP" 2>/dev/null || true; }
attempt_age() {
  # 前回の復旧試行からの経過秒。記録が無ければ十分大きい値を返す。
  if [ -f "$STAMP" ]; then
    echo $(( now - $(stat -c %Y "$STAMP" 2>/dev/null || echo 0) ))
  else
    echo "$RETRY_INTERVAL_SEC"
  fi
}

active=$(systemctl is-active wg-quick@wg0 2>/dev/null || true)
if [ "$active" != "active" ]; then
  mark_attempt
  systemctl start wg-quick@wg0 \
    && logger -t feeldscope-remote-support "started (was $active while enabled)"
  exit 0
fi

# ここから先は「起動しているのに通信が無い」状態の検知。
latest=$(wg show wg0 latest-handshakes 2>/dev/null | awk '{ if ($2 > max) max = $2 } END { print max + 0 }')

if [ "$latest" -gt 0 ]; then
  age=$(( now - latest ))
else
  # 一度もハンドシェイクしていない場合はインターフェース起動からの経過で判断する。
  started=$(systemctl show wg-quick@wg0 -p ActiveEnterTimestamp --value 2>/dev/null)
  started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
  [ "$started_epoch" -gt 0 ] || exit 0
  age=$(( now - started_epoch ))
fi

[ "$age" -gt "$STALL_SEC" ] || exit 0
[ "$(attempt_age)" -ge "$RETRY_INTERVAL_SEC" ] || exit 0

mark_attempt
systemctl restart wg-quick@wg0 \
  && logger -t feeldscope-remote-support "restarted (no handshake for ${age}s)"
