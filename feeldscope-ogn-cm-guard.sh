#!/bin/bash
# FEELDSCOPE OGN 設定マネージャの見張り（受信機ウォッチドッグから呼ばれる。root）
#
# なぜ要るか:
# OGN 受信機は起動のたびに、OGN 公式イメージの設定マネージャ /root/OGN-receiver-config-manager を
# 実行してから受信ソフト(ogn-rf/ogn-decode)を起動する(init.d の launch)。設定マネージャは最新の受信ソフトを
# download.glidernet.org から取りに行く前に「つながるまで永久に待つ」(checkInternet: wget --spider と
# sleep 1 の無限ループ)。2026-10-22、glidernet のダウンロードサーバーが止まっている間に毎朝の自動再起動が
# 走り、手元に動く受信ソフトがあるのに滝川の受信が約6時間止まった。ウォッチドッグの停止→起動も同じ所で
# 止まり、止まった起動処理が15分ごとに積み重なった。設定マネージャは起動のたびに GitHub から自分を
# 書き換えるので、本体には手を入れず、外から見張って解放する。
#
# やること(受信機が応答しないときだけ呼ばれる前提):
#   1. 起動処理が重複していたら、いちばん古いものだけ残し、後から積み重なった分は受信ソフトを起動させずに止める。
#   2. 残った設定マネージャが「接続確認の待ち」(直下の子が wget --spider / sleep 1)に入っていて、起動から
#      CM_STUCK_SEC 秒以上たっていれば、設定マネージャを止める。起動処理はそのまま続き、手元の受信ソフトと
#      設定で受信を始める。受信ソフトのダウンロード・展開の途中(wget -O - / tar)は壊さないよう絶対に止めない。
#   手元に受信ソフトがまだ無い(初回の導入前)ときは止めない(ダウンロードできるまで待つしかない)。
#
# 終了コード: 10=設定マネージャは動いていない(従来の停止→起動へ) / 11=起動処理が進行中なので待つ /
#             12=止まっていた設定マネージャを解放した(受信の開始を待つ) / 13=止まっているが受信ソフトが無いので待つ
CM="${FEELDSCOPE_OGN_CM:-/root/OGN-receiver-config-manager}"
INIT_PAT="${FEELDSCOPE_OGN_INIT_PAT:-init.d/rtlsdr-ogn}"
OGN_DIR="${FEELDSCOPE_OGN_DIR:-/home/pi/rtlsdr-ogn}"
OGN_CONF="${FEELDSCOPE_OGN_CONF:-/home/pi/rtlsdr-ogn.conf}"
# 通常の設定マネージャは全体で 40〜60秒、接続確認はふつう数秒で抜ける。余裕をみて4分
CM_STUCK_SEC="${FEELDSCOPE_OGN_CM_STUCK_SEC:-240}"

# 起動処理(init.d の launch)から呼ばれた設定マネージャを「pid ppid 経過秒」で古い順に。
# 設定マネージャが内部で作る背景の subshell(Wi-Fi 設定)は親が設定マネージャなので除外される。
cm_mains() {
  ps -eo pid=,ppid=,etimes=,args= | while read -r pid ppid et a1 a2 _; do
    [ "$a1" = "/bin/bash" ] && [ "$a2" = "$CM" ] || continue
    case "$(ps -o args= -p "$ppid" 2>/dev/null)" in *"$INIT_PAT"*) echo "$pid $ppid $et" ;; esac
  done | sort -k3,3nr
}
# 直下の子が接続確認(wget --spider)かその合間の sleep 1 なら「つながるまで待っている」
in_check_loop() {
  ps -o args= --ppid "$1" 2>/dev/null | grep -qE '^(/usr/bin/)?wget --spider|^sleep 1$'
}
kill_tree() { # kill_tree <pid> <signal>: 子(wget/sleep)を先に、次に本体
  pkill "-$2" -P "$1" 2>/dev/null; kill "-$2" "$1" 2>/dev/null
}

mapfile -t cms < <(cm_mains)
[ "${#cms[@]}" -eq 0 ] && exit 10

for line in "${cms[@]:1}"; do
  read -r pid ppid et <<<"$line"
  kill -9 "$ppid" 2>/dev/null          # 先に起動処理を止める(設定マネージャが終わっても受信ソフトを起動させない)
  kill_tree "$pid" 9
  echo "重複していた受信機の起動処理を片付けました（起動処理 ${ppid}・${et}秒）"
done

read -r pid ppid et <<<"${cms[0]}"
if ! in_check_loop "$pid" || [ "$et" -lt "$CM_STUCK_SEC" ]; then
  echo "受信機の起動処理が進行中（設定マネージャ ${et}秒）。今回は待つ"
  exit 11
fi
if [ ! -x "$OGN_DIR/ogn-rf" ] || [ ! -x "$OGN_DIR/ogn-decode" ] || [ ! -s "$OGN_CONF" ]; then
  echo "設定マネージャが ${et}秒、接続確認で止まっていますが、手元に受信ソフトが無いのでダウンロードできるまで待ちます"
  exit 13
fi
echo "OGN 設定マネージャが ${et}秒、接続確認（download.glidernet.org / GitHub）で止まっています。止めて、手元の受信ソフトと設定で受信を始めます"
kill_tree "$pid" TERM
sleep 2
kill -0 "$pid" 2>/dev/null && kill_tree "$pid" 9
exit 12
