#!/bin/bash
# =============================================================================
# FEELDSCOPE Converge — OS状態の冪等な収束（構成ドリフトの自己修復）
#
# git（webappコード）では配れない「OS側のサービス設定」を、既知の正しい状態へ
# 冪等に揃える。full update（git pull + build）なしで、どの端末にも安全に流せる。
#
#   - OGN受信機ウォッチドッグ（feeldscope-ogn-watchdog）を導入/更新。
#     受信機が落ちても自力復帰する（watchdog 自身が「rtlsdr-ogn が enabled の
#     端末でのみ作動／SDRが無ければ何もしない」ので、SkyLens機・ADS-B専用機に
#     入れても無害）。
#
#   - OGN の受信を時計が合ってから始める（feeldscope-wait-time.sh + rtlsdr-ogn の
#     drop-in）。時計が狂ったまま始めると FLARM の位置がでたらめに解読され OGN 全体へ
#     配信される（2026-10-18 関宿）。
#
#   - 固定化(OverlayFS)中も画面で変えた設定を SD に書き写す（feeldscope-persist）。
#
#   - 起動の記録（feeldscope-bootlog・feeldscope-alive.timer）。再起動の回数・前回は正常に
#     止まったか・最後に動いていた時刻を /boot に残す（固定化中も消えない）。
#
#   - ※ rtlsdr-ogn の enable はしない。受信方式（rtlsdr-ogn / SkyLens / ADS-B専用）
#     は端末ごとの意図的な正本なので、ここでは触らない。一律 enable すると
#     SkyLens/ADS-B 機で ogn-rf が SDR を奪い合い受信停止する（既知事故）。
#     rtlsdr-ogn 機であることが確定している端末だけ、別途 `systemctl enable
#     rtlsdr-ogn` を個別に実施すること。
#
# 使い方:  sudo bash feeldscope-converge.sh    （単体でも、update.sh からでも可）
# 何度実行しても安全（冪等）。ビルドや受信機の再起動はしない。
# =============================================================================
set -u
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info(){ echo -e "${GREEN}[converge]${NC} $1"; }
warn(){ echo -e "${YELLOW}[converge]${NC} $1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "root で実行してください（sudo）" >&2; exit 1; }

# OverlayFS（固定化）が有効だと書込みが永続しない。警告のみ（致命ではない）。
if command -v overlayctl >/dev/null 2>&1 && overlayctl status 2>/dev/null | grep -qi enabled; then
  warn "OverlayFS が有効です。変更は再起動で失われます（先に 'overlayctl disable && reboot' を推奨）。"
fi

changed=0
inst(){ # inst <src> <dst> <mode> … 差分がある時だけ入れる（冪等）
  local src="$1" dst="$2" mode="$3"
  if [ ! -f "$src" ]; then warn "欠品: $src（skip）"; return; fi
  if ! cmp -s "$src" "$dst" 2>/dev/null; then
    install -m "$mode" "$src" "$dst"; info "更新: $dst"; changed=1
  fi
}

# --- OGN受信機ウォッチドッグ（受信が落ちたら停止→起動で自動復帰） ---
inst "$SCRIPT_DIR/feeldscope-ogn-watchdog.sh"             /usr/local/sbin/feeldscope-ogn-watchdog.sh          755
inst "$SCRIPT_DIR/config/feeldscope-ogn-watchdog.service" /etc/systemd/system/feeldscope-ogn-watchdog.service 644
inst "$SCRIPT_DIR/config/feeldscope-ogn-watchdog.timer"   /etc/systemd/system/feeldscope-ogn-watchdog.timer   644

# --- OGN の受信を時計が合ってから始める（狂った時計で壊れた位置を配信しない） ---
inst "$SCRIPT_DIR/feeldscope-wait-time.sh"                /usr/local/sbin/feeldscope-wait-time.sh             755
mkdir -p /etc/systemd/system/rtlsdr-ogn.service.d
inst "$SCRIPT_DIR/config/rtlsdr-ogn-wait-time.conf"       /etc/systemd/system/rtlsdr-ogn.service.d/feeldscope-wait-time.conf 644

# --- 固定化(OverlayFS)中も画面で変えた設定を SD に書き写す ---
inst "$SCRIPT_DIR/feeldscope-persist.sh"                  /usr/local/sbin/feeldscope-persist                  755

# --- 起動の記録（再起動の回数・前回は正常に止まったか・最後に動いていた時刻を /boot に残す） ---
inst "$SCRIPT_DIR/feeldscope-bootlog.sh"                  /usr/local/sbin/feeldscope-bootlog                  755
inst "$SCRIPT_DIR/config/feeldscope-bootlog.service"      /etc/systemd/system/feeldscope-bootlog.service      644
inst "$SCRIPT_DIR/config/feeldscope-alive.service"        /etc/systemd/system/feeldscope-alive.service        644
inst "$SCRIPT_DIR/config/feeldscope-alive.timer"          /etc/systemd/system/feeldscope-alive.timer          644

# --- 固定化中に頼まれた更新を、固定化を外した起動のあとで行う（/boot/feeldscope/update-pending があるときだけ動く） ---
inst "$SCRIPT_DIR/feeldscope-update-resume.sh"            /usr/local/sbin/feeldscope-update-resume            755
inst "$SCRIPT_DIR/config/feeldscope-update-resume.service" /etc/systemd/system/feeldscope-update-resume.service 644

[ "$changed" -eq 1 ] && systemctl daemon-reload
# 受信機の監視は常に ON。止めたいときは /boot/feeldscope-ogn-watchdog.disabled を置く。
systemctl enable --now feeldscope-ogn-watchdog.timer >/dev/null 2>&1 || true
# 起動の記録。bootlog は「正常に止めたときだけ印を書く」ため、起動中(active)にしておく必要がある
systemctl enable --now feeldscope-bootlog.service >/dev/null 2>&1 || true
systemctl enable --now feeldscope-alive.timer     >/dev/null 2>&1 || true
systemctl enable feeldscope-update-resume.service >/dev/null 2>&1 || true   # 起動時だけ(印があるときだけ)動く

wd="$(systemctl is-active feeldscope-ogn-watchdog.timer 2>/dev/null)/$(systemctl is-enabled feeldscope-ogn-watchdog.timer 2>/dev/null)"
ro="$(systemctl is-enabled rtlsdr-ogn 2>/dev/null | tail -1)"
info "収束完了: watchdog timer=${wd}  rtlsdr-ogn=${ro}（enable は不変）"
