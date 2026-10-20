#!/bin/bash
# FEELDSCOPE 時刻合わせ待ち(OGN の受信を時計が合ってから始める)
#
#   feeldscope-wait-time.sh [待つ秒数]     既定 180秒。0 なら今合っているかを見るだけ
#   feeldscope-wait-time.sh sync           1回だけ合わせる(10分ごとの cron 用。chrony が同期中なら何もしない)
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
# ネットがつながっていれば強制的に合わせる。ただし1台の時刻サーバーの答えだけは信じない:
# 複数の出どころ(NICT・Google・Cloudflare)に問い合わせ、2つ以上が1秒以内で一致したときだけ合わせる。
# 以前は ntpdate pool.ntp.org の1台の答えで合わせていて、2026-10-20 関宿では時刻合わせのあとに
# 時計が 2026-10-21・10-22 になった回があった(VPN が断られ続け、FLARM の解読も狂う)。
# 時計の合わない端末(ネットの無い場所)で受信を止めたくなければ
# /boot/feeldscope-no-time-wait を置く。
set -u

MAX="${1:-180}"
case "$MAX" in ''|*[!0-9]*) MAX=180 ;; esac
# 待たない設定でも、sync(10分ごとの時刻合わせ)は行う
[ "${1:-}" != sync ] && [ -e /boot/feeldscope-no-time-wait ] && exit 0

synced() {
  if command -v chronyc >/dev/null 2>&1 &&
     chronyc -n tracking 2>/dev/null | grep -qE '^Leap status *: Normal'; then
    return 0
  fi
  [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]
}

TIME_SERVERS="${FEELDSCOPE_TIME_SERVERS:-ntp.nict.jp time.google.com time.cloudflare.com}"
NTPDATE="${FEELDSCOPE_NTPDATE:-/usr/sbin/ntpdate}"   # 試験用に差し替え可

# 時計を動かす。試験では FEELDSCOPE_SET_CLOCK_LOG に書くだけ(コンテナで date -s するとホストの時計が動く)
set_clock() {
  if [ -n "${FEELDSCOPE_SET_CLOCK_LOG:-}" ]; then echo "$1" >> "$FEELDSCOPE_SET_CLOCK_LOG"; else date -s "$1" >/dev/null; fi
}

# 時刻サーバーごとのずれ(秒)を1行ずつ。問い合わせだけで時計は動かさない(ntpdate -q)
offsets() {
  for s in $TIME_SERVERS; do
    "$NTPDATE" -q -u -t 2 "$s" 2>/dev/null |
      awk '/^server / { for (i = 1; i <= NF; i++) if ($i == "offset") { v = $(i + 1); gsub(",", "", v); print v; exit } }'
  done
}

force_sync() {
  if [ -x "$NTPDATE" ]; then
    # 2つ以上が1秒以内で一致したら、その平均のずれだけ時計を動かす(0.5秒未満なら動かさない)
    off=$(offsets | awk 'NF { a[n++] = $1 } END { for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { d = a[i] - a[j]; if (d < 0) d = -d; if (d <= 1) { printf "%.6f\n", (a[i] + a[j]) / 2; exit } } }')
    if [ -n "$off" ]; then
      if awk -v o="$off" 'BEGIN { exit !(o > 0.5 || o < -0.5) }'; then
        set_clock "@$(date +%s.%N | awk -v o="$off" '{ printf "%.3f", $1 + o }')" || return 1
      fi
      return 0
    fi
  fi
  command -v chronyc >/dev/null 2>&1 && chronyc -a makestep >/dev/null 2>&1
  return 1
}

if [ "${1:-}" = sync ]; then
  synced && exit 0
  force_sync && { echo "時計を合わせました: $(date -Is)"; exit 0; }
  echo "時刻サーバーの答えがそろわず、合わせませんでした: $(date -Is)" >&2
  exit 1
fi

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
