#!/bin/bash
# =============================================================================
# FEELDSCOPE 初回起動の自動インストール（FEELDSCOPE 専用イメージに同梱）
#
# OGN 公式イメージ（seb-ogn-rpi-image）に FEELDSCOPE を自動で入れる。利用者は SD カードの
# /boot/OGN-receiver.conf に受信機名・座標・パスワード・Wi-Fi を書いて電源を入れるだけ。
#   1. ルート領域を SD カードいっぱいまで広げる（1回だけ・再起動あり）
#   2. インターネット接続を待つ
#   3. OGN 受信ソフト（公式イメージの設定マネージャが初回に自動ダウンロード）の準備を待つ
#   4. FEELDSCOPE を GitHub から取得（git clone）
#   5. feeldscope-install.sh を実行（失敗したら時間をおいて再試行、だめなら次回起動で再開）
#   6. 完了したら自分自身を無効化
# 進み具合は /run/feeldscope-firstboot/status.json に書き、feeldscope-firstboot-status.py が
# ポート80で表示する（インストーラーがアプリを起動する直前に止める）。
# ログ: /var/log/feeldscope-firstboot.log（要所で /boot/feeldscope-firstboot.log にも写す。
#       SD カードをパソコンに挿せば読める）
# =============================================================================
set -u

# 検証用に環境変数で差し替えられる（実機では既定値のまま）
STATE_DIR="${FB_STATE_DIR:-/var/lib/feeldscope-firstboot}"
RUN_DIR="${FB_RUN_DIR:-/run/feeldscope-firstboot}"
LOG="${FB_LOG:-/var/log/feeldscope-firstboot.log}"
BOOT_DIR="${FB_BOOT_DIR:-/boot}"
BOOT_LOG="$BOOT_DIR/feeldscope-firstboot.log"
OGN_HOME="${FB_OGN_HOME:-/home/pi}"
REPO_URL="${FB_REPO_URL:-https://github.com/hezoe/FEELDSCOPE-OGN}"
REPO_DIR="${FB_REPO_DIR:-/home/pi/FEELDSCOPE-OGN}"
INSTALL_TRIES="${FB_INSTALL_TRIES:-3}"
RETRY_WAIT="${FB_RETRY_WAIT:-300}"
AS_PI="${FB_AS_PI-sudo -u pi}"   # 検証時は空にして自分のユーザーで動かす

mkdir -p "$STATE_DIR" "$RUN_DIR"
exec >>"$LOG" 2>&1
export DEBIAN_FRONTEND=noninteractive   # apt の対話用の警告(debconf)を出さない

log() { echo "$(date '+%F %T') $*"; }

# 進み具合(段階番号・見出し・説明)。状態ページが読む
status() {
    local step="$1" title="$2" msg="$3" state="${4:-running}"
    python3 - "$RUN_DIR/status.json" "$step" "$title" "$msg" "$state" <<'PY'
import json, sys, time, os
path, step, title, msg, state = sys.argv[1:6]
try:
    old = json.load(open(path))
except Exception:
    old = {}
now = time.time()
started = old.get("started")
# Raspberry Pi は時計の電池が無く、起動直後は古い時刻(イメージ作成時)で動き、時刻合わせで一気に進む。
# 経過時間が数年分にならないよう、2025年より前の開始時刻・未来の開始時刻は捨てて数え直す。
if not started or started < 1735689600 or started > now:
    started = now
d = {"step": int(step), "title": title, "message": msg, "state": state, "started": started, "updated": now}
tmp = path + ".tmp"
json.dump(d, open(tmp, "w"), ensure_ascii=False)
os.replace(tmp, path)
PY
    log "[$step] $title — $msg ($state)"
}

# ログを /boot へ写す（/boot は普段 読み取り専用のことがある）
copy_log_to_boot() {
    local was_ro=0
    if grep -q " $BOOT_DIR .*\bro\b" /proc/mounts; then was_ro=1; mount -o remount,rw "$BOOT_DIR" || return 0; fi
    tail -n 2000 "$LOG" > "$BOOT_LOG" 2>/dev/null || true
    sync
    [ "$was_ro" = 1 ] && mount -o remount,ro "$BOOT_DIR" || true
}

finish_ok() {
    touch "$STATE_DIR/done"
    status 6 "完了" "FEELDSCOPE のインストールが完了しました。この画面を再読み込みすると FEELDSCOPE が開きます。" done
    systemctl disable feeldscope-firstboot.service >/dev/null 2>&1 || true
    systemctl disable feeldscope-firstboot-status.service >/dev/null 2>&1 || true
    systemctl stop feeldscope-firstboot-status.service >/dev/null 2>&1 || true
    # 本体はインストーラーが起動済みだが、そのときまだ状態ページがポート80を使っていると待ち受けに失敗する。
    # 状態ページを止めたあとで起動し直して、確実に画面が開く状態にする。
    systemctl restart feeldscope-webapp.service >/dev/null 2>&1 || true
    copy_log_to_boot
    log "=== 完了 ==="
    exit 0
}

fail_and_wait() {
    status "$1" "$2" "$3" error
    copy_log_to_boot
    log "=== 失敗のため停止（次回起動で続きから再開） ==="
    exit 1
}

log "=== FEELDSCOPE 初回起動の自動インストール 開始 ==="
[ -f "$STATE_DIR/done" ] && { log "完了済み。何もしない"; exit 0; }

# 日本語キーボード配列を、今のコンソールにもすぐ反映する（イメージ側で /etc/default/keyboard は jp106 に設定済み）
setupcon -k --force >/dev/null 2>&1 || true

# ── 1. OverlayFS と領域拡張 ──────────────────────────────────────────────
status 1 "準備" "読み書きの設定とSDカードの領域を確認しています。"
# OGN 公式イメージの OverlayFS は /overlay/disable の印で切り替える（overlayctl disable が作る）。
# 専用イメージでは最初から無効にしてあるが、念のため確かめる（有効のままだと再起動で変更が消える）。
ov="$(overlayctl status 2>/dev/null || true)"
log "overlayctl status: $(echo "$ov" | tr '\n' ' ')"
if echo "$ov" | grep -q 'overlay is active'; then
    log "OverlayFS が動作中 → 無効にして再起動"
    overlayctl disable || fail_and_wait 1 "準備" "OverlayFS を無効にできませんでした。"
    copy_log_to_boot
    reboot; exit 0
fi
if echo "$ov" | grep -q 'enabled for next boot'; then
    # 今は動いていないが、次の起動で有効になる設定 → 印を作るだけ（再起動は不要）
    log "OverlayFS が次回起動で有効の設定 → overlayctl disable"
    overlayctl disable || fail_and_wait 1 "準備" "OverlayFS を無効にできませんでした。"
fi
if [ ! -f "$STATE_DIR/expanded" ]; then
    status 1 "準備" "SDカードの領域をいっぱいまで広げています。このあと自動で再起動します（1〜2分）。"
    if command -v raspi-config >/dev/null 2>&1; then
        raspi-config nonint do_expand_rootfs || log "領域拡張に失敗（続行。容量が足りない場合はインストールで失敗します）"
    else
        log "raspi-config が無い → 領域拡張をスキップ"
    fi
    touch "$STATE_DIR/expanded"
    copy_log_to_boot
    sync; reboot; exit 0
fi
log "ルート領域: $(df -h / | awk 'NR==2{print $2" 中 "$4" 空き"}')"

# ── 2. インターネット接続と時刻合わせ ────────────────────────────────────
# 接続の確認は HTTP で行う。起動直後は時計が古く(電池が無いため)、HTTPS は証明書が「有効期間前」で失敗するため。
status 2 "インターネット接続の確認" "インターネットにつながるのを待っています。"
waited=0
until curl -fsS --max-time 10 -o /dev/null http://connectivitycheck.gstatic.com/generate_204 \
      || curl -fsS --max-time 10 -o /dev/null http://download.glidernet.org/; do
    sleep 10; waited=$((waited + 10))
    if [ $((waited % 60)) = 0 ]; then
        status 2 "インターネット接続の確認" "まだつながりません（$((waited / 60))分経過）。LANケーブル、または OGN-receiver.conf の Wi-Fi 名・パスワード・wifiCountry=\"JP\" を確認してください。"
    fi
    if [ "$waited" -ge 3600 ]; then
        fail_and_wait 2 "インターネット接続の確認" "1時間待ってもインターネットにつながりませんでした。ネットワークを確認して電源を入れ直してください（続きから再開します）。"
    fi
done
log "インターネット接続OK"
# 時刻合わせ（済まないと GitHub への HTTPS 接続ができない）
if [ "$(date +%Y)" -lt 2025 ]; then
    status 2 "インターネット接続の確認" "時刻合わせを待っています。"
    waited=0
    until [ "$(date +%Y)" -ge 2025 ]; do
        if [ $((waited % 60)) = 0 ]; then
            ntpdate -u pool.ntp.org >/dev/null 2>&1 || timedatectl set-ntp true >/dev/null 2>&1 || true
        fi
        sleep 5; waited=$((waited + 5))
        [ "$waited" -ge 900 ] && fail_and_wait 2 "インターネット接続の確認" "時刻を合わせられませんでした（NTP が使えないネットワーク?）。電源を入れ直してください。"
    done
    log "時刻合わせOK: $(date '+%F %T')"
fi
waited=0
until curl -fsS --max-time 10 -o /dev/null https://github.com; do
    sleep 10; waited=$((waited + 10))
    [ "$waited" -ge 1800 ] && fail_and_wait 2 "インターネット接続の確認" "GitHub に接続できませんでした。電源を入れ直すと再試行します。"
done

# ── 3. OGN 受信ソフトの準備 ────────────────────────────────────────────
status 3 "OGN 受信ソフトの準備" "OGN の受信ソフトが自動ダウンロードされるのを待っています（数分）。"
waited=0
until [ -x "$OGN_HOME/rtlsdr-ogn/ogn-rf" ] || [ -n "$(ls "$OGN_HOME"/rtlsdr-ogn*/ogn-rf 2>/dev/null)" ]; do
    sleep 10; waited=$((waited + 10))
    if [ "$waited" -ge 1800 ]; then
        log "30分待っても OGN 受信ソフトが見つからない → 続行（インストーラーが警告を出す）"
        break
    fi
done

# ── 4. FEELDSCOPE の取得 ──────────────────────────────────────────────
status 4 "FEELDSCOPE の取得" "FEELDSCOPE を GitHub から取得しています。"
if ! command -v git >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq git || fail_and_wait 4 "FEELDSCOPE の取得" "git を入れられませんでした。電源を入れ直すと再試行します。"
fi
if [ -d "$REPO_DIR/.git" ]; then
    $AS_PI git -C "$REPO_DIR" fetch --quiet origin && $AS_PI git -C "$REPO_DIR" reset --hard --quiet origin/master \
        || fail_and_wait 4 "FEELDSCOPE の取得" "GitHub から更新できませんでした。電源を入れ直すと再試行します。"
else
    rm -rf "$REPO_DIR"
    $AS_PI git clone --quiet "$REPO_URL" "$REPO_DIR" \
        || fail_and_wait 4 "FEELDSCOPE の取得" "GitHub から取得できませんでした。電源を入れ直すと再試行します。"
fi
log "取得した版: $($AS_PI git -C "$REPO_DIR" log -1 --format='%h %s')"

# ── 5. インストール ──────────────────────────────────────────────────
for try in $(seq 1 "$INSTALL_TRIES"); do
    status 5 "FEELDSCOPE のインストール" "インストールしています（20〜40分）。電源を切らずにお待ちください。（${try}回目）"
    log "--- feeldscope-install.sh 開始（${try}回目） ---"
    if (cd "$REPO_DIR" && bash feeldscope-install.sh); then
        log "--- feeldscope-install.sh 成功 ---"
        finish_ok
    fi
    log "--- feeldscope-install.sh 失敗（${try}回目） ---"
    # インストーラーがアプリ起動前に状態ページを止めている場合があるので戻す
    systemctl start feeldscope-firstboot-status.service >/dev/null 2>&1 || true
    copy_log_to_boot
    [ "$try" -lt "$INSTALL_TRIES" ] && sleep "$RETRY_WAIT"
done
fail_and_wait 5 "FEELDSCOPE のインストール" "インストールに失敗しました。電源を入れ直すと続きから再試行します。直らない場合は SD カードの feeldscope-firstboot.log を添えてご連絡ください。"
