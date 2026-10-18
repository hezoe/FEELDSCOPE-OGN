#!/bin/bash
# FEELDSCOPE 固定化(OverlayFS)中に頼まれた更新を、固定化を外した起動のあとで行う
#
#   feeldscope-update-resume.service（/boot/feeldscope/update-pending があるときだけ起動時に動く）から呼ばれる
#
# 流れ（feeldscope-update.sh が固定化中に呼ばれたとき）:
#   1. update.sh が /boot/feeldscope/update-pending を置き、固定化を外して再起動する
#   2. この起動（固定化なし＝SD に直接書ける）で、ここが update.sh を流す
#   3. 頼まれたときに固定化が有効だったなら、固定化を戻してもう一度再起動する
# 印は最初に消す（更新が失敗しても再起動を繰り返さない）。経過は /boot/feeldscope/update.log
# （固定化の外・再起動しても残る）に追記し、設定画面の更新ログでも読める。
#
# update.sh そのものではなく、このスクリプトが再起動のあとを受け持つのは、SD に入っている
# update.sh が古い版でも（固定化の扱いを知らなくても）ここから普通に流せるようにするため。
set -u

PENDING=/boot/feeldscope/update-pending
LOG=/boot/feeldscope/update.log
[ -e "$PENDING" ] || exit 0

reenable=0
grep -q '^reenable_overlay=1' "$PENDING" && reenable=1
repo=$(sed -n 's/^repo=//p' "$PENDING" | head -1)
[ -n "$repo" ] && [ -f "$repo/feeldscope-update.sh" ] || repo=/home/pi/FEELDSCOPE-OGN
rm -f "$PENDING"; sync

# ログが育ちすぎないように(古い分を落とす)
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 300000 ]; then
  tail -c 150000 "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"
fi

{
  echo "=== $(date -Is) 固定化を外した起動で、更新を始めます ==="
  # ネットと時計を待つ（git pull と npm に要る）
  [ -x /usr/local/sbin/feeldscope-wait-time.sh ] && /usr/local/sbin/feeldscope-wait-time.sh 300 || true
  bash "$repo/feeldscope-update.sh"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "=== $(date -Is) 更新が終わりました ==="
  else
    echo "=== $(date -Is) 更新に失敗しました（終了コード $rc）。上のログを確認してください ==="
  fi
  if [ "$reenable" -eq 1 ]; then
    echo "=== $(date -Is) 固定化(OverlayFS)を戻して再起動します ==="
    overlayctl enable || echo "固定化を戻せませんでした。設定画面から固定化を ON にしてください"
  fi
} >> "$LOG" 2>&1
sync
[ "$reenable" -eq 1 ] && systemctl reboot
exit 0
