#!/bin/bash
# FEELDSCOPE 起動の記録（再起動の回数と、前回は正常に止まったか）
#
#   feeldscope-bootlog boot       起動時（feeldscope-bootlog.service の ExecStart）
#   feeldscope-bootlog shutdown   正常な停止・再起動のとき（同 ExecStop）
#   feeldscope-bootlog alive      5分ごと（feeldscope-alive.timer）
#
# なぜ要るか:
# 固定化(OverlayFS)が有効だとログは RAM にしか残らず、再起動すると前の起動の記録が消える。
# 2026-10-18 関宿(Sekiyado1)では1日に5回再起動したが、回数も「電源が切れたのか、画面から
# 再起動したのか、固まったのか」も確定できなかった。そこで固定化の外にある /boot(FAT)に、
#   - 起動時刻（時計が合ってから「今 − 起動からの時間」で求める）
#   - 前回が正常な停止だったか（正常に止めたときだけ印を書く。印が無ければ電源断・固まり）
#   - 前回最後に動いていた時刻（5分ごとに書く。電源が切れたおおよその時刻が分かる）
# を残し、状態の画面に出す。
set -u

DIR="${FEELDSCOPE_BOOTLOG_DIR:-/boot/feeldscope}"   # 試験用に差し替え可
LOG="$DIR/boots.log"            # 1行1起動（JSON）。新しい200行だけ残す
CLEAN="$DIR/clean-shutdown"     # 正常に止めたときの印（起動時に読んで消す）
ALIVE="$DIR/alive"              # 最後に動いていた時刻（5分ごと）
STATE="${FEELDSCOPE_BOOTLOG_STATE:-/run/feeldscope-boot.json}" # この起動の情報（起動時に作り、時計が合ったら LOG へ書く）
KEEP=200

mkdir -p "$DIR" 2>/dev/null || exit 0
synced() { "${FEELDSCOPE_WAIT_TIME:-/usr/local/sbin/feeldscope-wait-time.sh}" 0 >/dev/null 2>&1; }
uptime_s() { cut -d' ' -f1 /proc/uptime | cut -d. -f1; }
iso() { date -d "@$1" +%Y-%m-%dT%H:%M:%S%z | sed 's/\(..\)$/:\1/'; }

case "${1:-}" in
  boot)
    if [ -e "$CLEAN" ]; then prev=clean; rm -f "$CLEAN"
    elif [ -s "$LOG" ] || [ -e "$ALIVE" ]; then prev=unclean    # 前の起動の記録があるのに印が無い = 電源断か固まり
    else prev=unknown; fi                                         # 初めての起動
    prev_alive=$(cat "$ALIVE" 2>/dev/null | head -1)
    bid=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)
    printf '{"boot_id":"%s","prev":"%s","prev_alive":"%s"}\n' "$bid" "$prev" "$prev_alive" > "$STATE"
    sync
    # 時計がもう合っていれば、すぐ記録する（多くは数十秒後の alive で記録される）
    synced && exec "$0" alive
    ;;
  shutdown)
    date +%Y-%m-%dT%H:%M:%S%z > "$CLEAN"
    sync
    ;;
  alive)
    synced || exit 0                       # 狂った時計の時刻は書かない
    now=$(date +%s)
    iso "$now" > "$ALIVE.tmp" && mv -f "$ALIVE.tmp" "$ALIVE"
    if [ -s "$STATE" ] && ! grep -q '"logged"' "$STATE"; then
      boot=$(iso $(( now - $(uptime_s) )))
      line=$(sed "s/^{/{\"boot\":\"$boot\",/" "$STATE")
      { [ -f "$LOG" ] && tail -n $(( KEEP - 1 )) "$LOG"; echo "$line"; } > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"
      sed -i 's/}$/,"logged":true}/' "$STATE"
    fi
    sync
    ;;
  *)
    echo "使い方: feeldscope-bootlog {boot|shutdown|alive}" >&2; exit 2 ;;
esac
exit 0
