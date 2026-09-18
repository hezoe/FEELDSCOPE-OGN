#!/bin/bash
# FEELDSCOPE OGN受信機 ウォッチドッグ
#
# rtlsdr-ogn が応答しなければ停止→起動で戻す。systemd timer から root で呼ばれる。
#
# なぜ要るか:
# 2026-09-13、滝川で Web UI の「設定を保存して受信機を再起動」が起動処理の途中で
# 死に、rtlsdr-ogn が上がらないまま 4日半 誰も気づかなかった。受信も OGN への
# アップロードも止まっていた。各地の滑空場にボランティアが自分で置く運用なので、
# 「人が画面を見ていれば気づく」は前提にできない。自力で戻れるようにする。
#
# 起動処理を待ち切ってから終了する理由:
# init.d の start は launch を `( … ) &` で背景に投げて 2秒で戻る。ここで
# スクリプトを終えると Type=oneshot の cgroup ごと systemd に片付けられ、
# 起動途中の launch が道連れになる（webapp 側で実際に起きた事故と同じ形）。
set -u

STAMP=/run/feeldscope-ogn-watchdog.stamp
RESTART_LOG=/tmp/feeldscope-ogn-restart.log
DISABLE_FLAG=/boot/feeldscope-ogn-watchdog.disabled
RTLSDR_CONF=/home/pi/rtlsdr-ogn.conf

# 復旧を試みる最短間隔。アンテナやドングルが物理的に外れている間の連打を防ぐ。
RETRY_INTERVAL_SEC="${FEELDSCOPE_OGN_RETRY_INTERVAL_SEC:-900}"
# 起動完了を待つ上限。ntpdate + OGN-receiver-config-manager で 60秒前後かかる。
START_WAIT_SEC="${FEELDSCOPE_OGN_START_WAIT_SEC:-150}"

[ -e "$DISABLE_FLAG" ] && exit 0
[ -x /etc/init.d/rtlsdr-ogn ] || exit 0

# SDR が刺さっていない端末（VPSのデモ機、ADS-B専用機）では何もしない
if command -v lsusb >/dev/null 2>&1; then
  lsusb 2>/dev/null | grep -qE 'RTL283[28]' || exit 0
fi

# 状態ページのポート。rtlsdr-ogn.conf の HTTP.Port が正本（既定 8082）
port=$(sed -n 's/^[[:space:]]*Port[[:space:]]*=[[:space:]]*\([0-9]\{1,5\}\).*/\1/p' \
       "$RTLSDR_CONF" 2>/dev/null | tail -1)
case "$port" in ''|*[!0-9]*) port=8082 ;; esac

alive() { curl -sf --max-time 3 "http://localhost:$port/" >/dev/null 2>&1; }

# 1回の取りこぼし（起動直後・一瞬の高負荷）で再起動しないよう二度見る
alive && exit 0
sleep 5
alive && exit 0

now=$(date +%s)
if [ -f "$STAMP" ]; then
  age=$(( now - $(stat -c %Y "$STAMP" 2>/dev/null || echo 0) ))
  if [ "$age" -lt "$RETRY_INTERVAL_SEC" ]; then
    echo "受信機が停止中。前回の復旧試行から ${age}秒しか経っていないので今回は待つ"
    exit 0
  fi
fi
: > "$STAMP" 2>/dev/null || true

echo "受信機(rtlsdr-ogn)が ${port}番に応答しません。停止→起動で復旧を試みます"
{
  echo "=== $(date -Is) watchdog restart ==="
  # stop は $shells が無いと「No shells started.」で exit 0 する。restart だと
  # そこでスクリプトごと終わって start に届かないので、必ず別々に叩く。
  /etc/init.d/rtlsdr-ogn stop
  sleep 2
  /etc/init.d/rtlsdr-ogn start
} >> "$RESTART_LOG" 2>&1

waited=0
while [ "$waited" -lt "$START_WAIT_SEC" ]; do
  sleep 5
  waited=$(( waited + 5 ))
  if alive; then
    echo "受信機が復旧しました（${waited}秒）"
    # OGN設定マネージャは起動のたびに wpa_supplicant.conf へ network を足すので畳む
    [ -x /usr/local/sbin/feeldscope-wpa-dedupe ] &&
      /usr/local/sbin/feeldscope-wpa-dedupe >/dev/null 2>&1
    exit 0
  fi
done

echo "受信機を復旧できませんでした。$RESTART_LOG を確認してください"
exit 1
