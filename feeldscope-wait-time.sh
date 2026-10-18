#!/bin/bash
# FEELDSCOPE 時刻合わせ待ち(OGN の受信を時計が合ってから始める)
#
#   feeldscope-wait-time.sh [待つ秒数]     既定 180秒。0 なら今合っているかを見るだけ
#   終了コード 0 = 時計が合っている / 1 = 合わなかった
#
# なぜ要るか:
# Raspberry Pi には時計の電池が無く、起動直後は前に保存した時刻から動き出す。固定化
# (OverlayFS)中は保存した時刻も再起動で消えるので、何日も前の時刻から始まる。
# FLARM の電波は時刻を使って暗号化されているため、時計が狂ったまま受信を始めると
# 位置がでたらめに解読され、それが OGN 全体へ配信される。2026-10-18 関宿(Sekiyado1)
# では電源断のあと10/16の時刻で起動し、高度 8,800m・経度142度などの壊れた位置を
# 約60件送った。時計が合うまで受信を始めなければ起きない。
#
# 合ったかどうか: chrony の同期(Leap status: Normal)かカーネルの同期フラグ。
# ネットがつながっていれば ntpdate で強制的に合わせる(OGN の起動スクリプトと同じ方法)。
# 時計の合わない端末(ネットの無い場所)で受信を止めたくなければ
# /boot/feeldscope-no-time-wait を置く。
set -u

MAX="${1:-180}"
case "$MAX" in ''|*[!0-9]*) MAX=180 ;; esac
[ -e /boot/feeldscope-no-time-wait ] && exit 0

synced() {
  if command -v chronyc >/dev/null 2>&1 &&
     chronyc -n tracking 2>/dev/null | grep -qE '^Leap status *: Normal'; then
    return 0
  fi
  [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]
}

force_sync() {
  # ntpdate が合わせられたら、その時刻は正しい(chrony の同期判定を待たない)
  if [ -x /usr/sbin/ntpdate ] && /usr/sbin/ntpdate -u -b -t 3 pool.ntp.org >/dev/null 2>&1; then
    return 0
  fi
  command -v chronyc >/dev/null 2>&1 && chronyc -a makestep >/dev/null 2>&1
  return 1
}

synced && exit 0
[ "$MAX" -eq 0 ] && exit 1

waited=0
while [ "$waited" -lt "$MAX" ]; do
  if force_sync || synced; then
    echo "時計が合いました（${waited}秒待ち）: $(date -Is)"
    exit 0
  fi
  sleep 10
  waited=$(( waited + 10 ))
done
echo "時計が合わないまま ${MAX}秒たちました。受信機はまだ始めません（ネットがつながれば受信機の見張りが始めます）: $(date -Is)" >&2
exit 1
