#!/bin/bash
# FEELDSCOPE 固定化(OverlayFS)中の設定の書き写し
#
#   sudo /usr/local/sbin/feeldscope-persist <ファイル>...
#
# なぜ要るか:
# 固定化(OverlayFS)が有効だと、ルートは「読み取り専用の SD(/overlay/robase)の上に
# RAM を重ねたもの」になり、書き込みは RAM にしか残らない。電源断や再起動のたびに
# 機体の登録・滑空場・表示の設定などが消える。2026-10-18 関宿(Sekiyado1)では
# 電源断で4回再起動し、登録した登録番号が消えて右の一覧が ID のままになった。
# 固定化は SD を守るための設定なので、それは保ったまま、画面で変えた設定ファイル
# だけを下の SD にも書き写す(overlayctl も disable の印を同じ方法で書いている)。
#
# 書き写せるのは下の決まったファイルだけ(任意のファイルを SD に書けないように)。
# 固定化が無効なら何もしない(普通に書いた時点で SD に残っているため)。
set -u

ROBASE="${FEELDSCOPE_PERSIST_ROBASE:-/overlay/robase}"   # 試験用に差し替え可(sudo は環境変数を渡さないので本番は常に既定)
ALLOWED=(
  /home/pi/FEELDSCOPE/aircraft-db.json
  /home/pi/FEELDSCOPE/airfield-config.json
  /home/pi/FEELDSCOPE/view-config.json
  /home/pi/FEELDSCOPE/adsb-config.json
  /home/pi/FEELDSCOPE/auth.json
  /home/pi/FEELDSCOPE/ogn-receiver-sync.json
  /etc/wpa_supplicant/wpa_supplicant.conf
  /etc/dhcpcd.conf
  /var/spool/cron/crontabs/root
)
LOCK=/run/feeldscope-persist.lock

[ "$(id -u)" -eq 0 ] || { echo "root で実行してください" >&2; exit 1; }
[ $# -ge 1 ] || { echo "使い方: feeldscope-persist <ファイル>..." >&2; exit 2; }

# 固定化が無効(=普通に SD へ書けている)なら何もしない。overlayctl と同じ判定
[ -e "$ROBASE/overlay" ] || exit 0

allowed() { local f; for f in "${ALLOWED[@]}"; do [ "$1" = "$f" ] && return 0; done; return 1; }

targets=()
for f in "$@"; do
  if ! allowed "$f"; then echo "書き写せないファイル: $f" >&2; continue; fi
  targets+=("$f")
done
[ ${#targets[@]} -gt 0 ] || exit 2

exec 9>"$LOCK"
flock -w 30 9 || { echo "ほかの書き写しが終わらない" >&2; exit 1; }

# 下の SD を一時的に書き込み可能にする。終わったら(失敗しても)読み取り専用に戻す
was_ro=1
grep -q " $ROBASE ext4 rw," /proc/mounts && was_ro=0
if [ "$was_ro" -eq 1 ]; then
  mount -o remount,rw "$ROBASE" || { echo "SD を書き込み可能にできない" >&2; exit 1; }
  trap 'sync; mount -o remount,ro "$ROBASE" 2>/dev/null' EXIT
fi

rc=0
for f in "${targets[@]}"; do
  dst="$ROBASE$f"
  if [ -e "$f" ]; then
    mkdir -p "$(dirname "$dst")"
    # 同じ所に一時ファイルを作ってから置き換える(書いている途中で電源が切れても元のファイルは残る)
    tmp="$dst.feeldscope-tmp"
    if cp -p "$f" "$tmp" && sync "$tmp" && mv -f "$tmp" "$dst"; then
      echo "書き写し: $f"
    else
      echo "書き写しに失敗: $f" >&2; rm -f "$tmp"; rc=1
    fi
  else
    # 画面で消したファイル(例: 機体DBを空にした)は下の SD からも消す
    rm -f "$dst" && echo "削除を書き写し: $f"
  fi
done
sync
exit "$rc"
