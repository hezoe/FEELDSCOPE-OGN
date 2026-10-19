#!/bin/bash
# =============================================================================
# FEELDSCOPE Updater
#
# Updates FEELDSCOPE from git repository, rebuilds webapp, restarts services.
# Preserves site-specific settings (adsb-config.json, etc.)
#
# Usage:
#   cd /home/pi/FEELDSCOPE-OGN
#   sudo bash feeldscope-update.sh
#
# =============================================================================

set -e

FEELDSCOPE_DIR="/home/pi/FEELDSCOPE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root (use sudo)"
    exit 1
fi

# 固定化(OverlayFS)が働いている（今の起動で有効）と、ここで書いた更新は RAM にしか残らず再起動で消える。
# そのときは「固定化を外して再起動 → 起動後に自動で更新(feeldscope-update-resume) → 固定化を戻して
# 再起動」を自動で行う（再起動 2回）。以前はエラーで止まり、手で外して再起動する必要があった。
# 「次の起動から有効」なだけ（まだ働いていない）なら、SD に直接書けるので普通に更新する。
OVERLAY_BASE=/overlay/robase
if command -v overlayctl &>/dev/null && [ -e "$OVERLAY_BASE/overlay" ]; then
    reenable=0
    overlayctl status 2>/dev/null | grep -q "overlay enabled for next boot" && reenable=1
    log_warn "固定化(OverlayFS)が有効です。固定化を外して再起動し、起動後に自動で更新してから、"
    log_warn "固定化を戻してもう一度再起動します（再起動 2回・10〜20分。経過は /boot/feeldscope/update.log）"
    mkdir -p /boot/feeldscope
    printf 'requested=%s\nreenable_overlay=%s\nrepo=%s\n' "$(date -Is)" "$reenable" "$SCRIPT_DIR" > /boot/feeldscope/update-pending
    # 再起動のあとを受け持つ仕組みを、固定化の下の SD に置く（ここで普通に入れても RAM にしか残らない）。
    # 画面の設定の書き写し(feeldscope-persist)と同じロックで、SD の読み書き切り替えが重ならないようにする
    exec 9>/run/feeldscope-persist.lock
    flock -w 60 9 || true
    # 下の SD がもう書き込み可能なこともある(画面の設定の書き写しが読み取り専用に戻せなかったときなど)。
    # そのときに remount すると「busy」で失敗し、set -e で途中終了して予約の印だけが残った(2026-10-19 関宿)。
    # 書き写し(feeldscope-persist)と同じく、読み取り専用のときだけ切り替え、自分で切り替えたときだけ戻す
    was_ro=1
    grep -q " $OVERLAY_BASE ext4 rw," /proc/mounts && was_ro=0
    if [ "$was_ro" -eq 1 ] && ! mount -o remount,rw "$OVERLAY_BASE"; then
        rm -f /boot/feeldscope/update-pending
        log_error "SD を書き込み可能にできませんでした。手で sudo overlayctl disable && sudo reboot してから更新してください"
        exit 1
    fi
    if ! { install -m 755 "$SCRIPT_DIR/feeldscope-update-resume.sh" "$OVERLAY_BASE/usr/local/sbin/feeldscope-update-resume" \
        && install -m 644 "$SCRIPT_DIR/config/feeldscope-update-resume.service" "$OVERLAY_BASE/etc/systemd/system/feeldscope-update-resume.service" \
        && mkdir -p "$OVERLAY_BASE/etc/systemd/system/multi-user.target.wants" \
        && ln -sf /etc/systemd/system/feeldscope-update-resume.service \
            "$OVERLAY_BASE/etc/systemd/system/multi-user.target.wants/feeldscope-update-resume.service"; }; then
        rm -f /boot/feeldscope/update-pending
        [ "$was_ro" -eq 1 ] && mount -o remount,ro "$OVERLAY_BASE" 2>/dev/null || true
        log_error "再起動のあとを受け持つ仕組みを SD に置けませんでした。手で sudo overlayctl disable && sudo reboot してから更新してください"
        exit 1
    fi
    sync
    # 戻せなくても続ける(このあと固定化を外して再起動するので、読み取り専用かどうかは問題にならない)
    if [ "$was_ro" -eq 1 ] && ! mount -o remount,ro "$OVERLAY_BASE" 2>/dev/null; then
        log_warn "SD を読み取り専用に戻せませんでした(このあとの再起動で戻ります)"
    fi
    flock -u 9 || true
    overlayctl disable
    echo "=== $(date -Is) 固定化中に更新を頼まれました。固定化を外して再起動します ===" >> /boot/feeldscope/update.log
    sync
    log_info "再起動します..."
    systemctl reboot
    exit 0
fi

echo ""
echo "========================================"
echo "  FEELDSCOPE Updater"
echo "========================================"
echo ""

# =============================================================================
# Step 1: Pull latest code
# =============================================================================

log_info "[1/6] Pulling latest code..."
cd "$SCRIPT_DIR"
SELF_HASH_BEFORE=$(sha256sum "$0" | awk '{print $1}')
if ! sudo -u pi git pull --ff-only; then
    # 上流の履歴が書き換えられた（force push）場合だけ、origin/master に合わせ直す。
    # 端末はコミットを持たないので失うものは無い。設定・記録は追跡外なので残る。
    # ネットワーク不通や、早送りできるのに失敗した場合（手元の変更と衝突など）は従来どおり止める。
    sudo -u pi git fetch origin
    if sudo -u pi git merge-base --is-ancestor HEAD origin/master; then
        log_error "git pull failed"
        exit 1
    fi
    log_warn "Upstream history was rewritten; resetting to origin/master"
    sudo -u pi git reset --hard origin/master
fi
SELF_HASH_AFTER=$(sha256sum "$0" | awk '{print $1}')
# 自己更新検知: スクリプト本体が git pull で書き換わった場合は新版で再exec する。
# bash は実行中ファイルを位置オフセットで読み続けるため、書き換わった後の新ステップ
# (例: v1.1.30で追加された Step 4g CATVPN-enroll deploy) が古い実行プロセスからは
# 走らない。env で再exec を1回に制限し無限ループを防止。
if [ "$SELF_HASH_BEFORE" != "$SELF_HASH_AFTER" ] && [ -z "${FEELDSCOPE_UPDATE_RELOADED:-}" ]; then
    log_info "Updater script itself changed; re-executing new version..."
    export FEELDSCOPE_UPDATE_RELOADED=1
    exec bash "$0" "$@"
fi
log_info "Code updated"

# =============================================================================
# Step 2: Stop services
# =============================================================================

log_info "[2/6] Stopping FEELDSCOPE services..."
systemctl stop ogn-mqtt.service 2>/dev/null || true
# feeldscope-webapp is intentionally kept running so the browser progress bar
# remains visible throughout the build. It is restarted in step 5.
systemctl stop adsb-poller.service 2>/dev/null || true
systemctl stop igc-simulator.service 2>/dev/null || true

# =============================================================================
# Step 3: Update files (preserve site-specific config)
# =============================================================================

log_info "[3/6] Updating FEELDSCOPE files..."

# Backup site-specific config
if [ -f "$FEELDSCOPE_DIR/adsb-config.json" ]; then
    cp "$FEELDSCOPE_DIR/adsb-config.json" /tmp/feeldscope-adsb-config.json.bak
fi

# Update Python scripts
cp "$SCRIPT_DIR/ogn-mqtt.py"       "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/adsb-poller.py"    "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/igc-simulator.py"  "$FEELDSCOPE_DIR/"

# Site-specific data (aircraft-db.json, testdata/*.IGC) are NOT overwritten
# — they live only on each device and are excluded from git

# Update webapp source
rm -rf "$FEELDSCOPE_DIR/webapp/.next"

# webapp/src は丸ごとリポジトリの中身で、端末固有のものは何も入っていない。
# そのため「消えたファイルは端末からも消す」でよい。
#
# なぜ要るか:
# 以前は cp -r で重ねていたので、上流で削除したファイルが端末に残り続けた。
# 2026-09-20 に滝川で、v1.2.1「利用状況の記録(UX分析)を削除」で消したはずの
#   webapp/src/app/api/analytics/pointer/route.ts
#   webapp/src/lib/PointerTracker.tsx
# が残っており、ビルドに載って /api/analytics/pointer が実際に応答していた。
# 版番号は上がるので画面からは新しい版に見えており、気づけなかった。
# （v1.2.1 は記録先ディレクトリ $FEELDSCOPE_DIR/analytics の片付けだけ入れていて、
#   ソース側の残骸は想定していなかった。)
#
# set -e で動いているので、途中で失敗して src を失わないよう、
# 別名で作り切ってから入れ替える。mv は同一ファイルシステム内なので瞬時。
src_new="$FEELDSCOPE_DIR/webapp/.src.new"
rm -rf "$src_new"
cp -r "$SCRIPT_DIR/webapp/src" "$src_new"
rm -rf "$FEELDSCOPE_DIR/webapp/src"
mv "$src_new" "$FEELDSCOPE_DIR/webapp/src"
cp "$SCRIPT_DIR/webapp/server.js"      "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/package.json"   "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/package-lock.json" "$FEELDSCOPE_DIR/webapp/" 2>/dev/null || true
cp "$SCRIPT_DIR/webapp/next.config.ts" "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/tsconfig.json"  "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/postcss.config.mjs" "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/tailwind.config.js" "$FEELDSCOPE_DIR/webapp/" 2>/dev/null || true
cp "$SCRIPT_DIR/webapp/eslint.config.mjs"  "$FEELDSCOPE_DIR/webapp/"

# Restore site-specific config
if [ -f /tmp/feeldscope-adsb-config.json.bak ]; then
    cp /tmp/feeldscope-adsb-config.json.bak "$FEELDSCOPE_DIR/adsb-config.json"
    rm /tmp/feeldscope-adsb-config.json.bak
fi

# Update service files
cp "$SCRIPT_DIR/config/ogn-mqtt.service"          /etc/systemd/system/
cp "$SCRIPT_DIR/config/adsb-poller.service"        /etc/systemd/system/
cp "$SCRIPT_DIR/config/igc-simulator.service"      /etc/systemd/system/
cp "$SCRIPT_DIR/config/feeldscope-webapp.service"  /etc/systemd/system/
cp "$SCRIPT_DIR/config/mosquitto-feeldscope.conf"  /etc/mosquitto/conf.d/feeldscope.conf

# リモートサポート監視（enable 状態を正本に、落ちていたら自動復帰）
cp "$SCRIPT_DIR/config/feeldscope-remote-support.service" /etc/systemd/system/
cp "$SCRIPT_DIR/config/feeldscope-remote-support.timer"   /etc/systemd/system/
install -m 755 "$SCRIPT_DIR/feeldscope-remote-support-check.sh" /usr/local/sbin/feeldscope-remote-support-check.sh
install -m 755 "$SCRIPT_DIR/feeldscope-reset-password.sh"       /usr/local/bin/feeldscope-reset-password

# OGN受信機の監視(ウォッチドッグ)は converge に集約(冪等・単体でも流せる)。
# rtlsdr-ogn の enable はしない(受信方式は端末ごとの正本)。
bash "$SCRIPT_DIR/feeldscope-converge.sh" || log_warn "converge reported warnings (continuing)"

chown -R pi:pi "$FEELDSCOPE_DIR"

systemctl daemon-reload
# リモートサポートの ON/OFF は wg-quick@wg0 の enable 状態が正本。
# 更新で切り替えない（ON のまま更新しても接続は維持される）。
systemctl enable --now feeldscope-remote-support.timer >/dev/null 2>&1 || true
# （OGN受信機ウォッチドッグの導入/enable は上の feeldscope-converge.sh が実施済み）
log_info "Files updated"

# =============================================================================
# Step 4: Network/clock fixup (idempotent - safe on every update)
#   - Strip DNS=10.66.0.1 from wg0.conf so .wg names use /etc/hosts only
#   - Add static /etc/hosts entries for CATVPN names (vps.wg + self)
#   - Switch ntp -> chrony with NICT IP-only servers (no DNS dependency)
#   - Enable fake-hwclock so clock survives power-off (RTC-less RPi)
# =============================================================================

log_info "[4/6] Applying network/clock fixups (idempotent)..."

NEED_WG_RESTART=false

# 4a. Strip DNS= from wg0.conf (avoids cascade DNS failure when WG drops)
if [ -f /etc/wireguard/wg0.conf ] && grep -q '^DNS\s*=' /etc/wireguard/wg0.conf; then
    log_info "  Removing DNS= line from /etc/wireguard/wg0.conf"
    sed -i.bak-$(date +%Y%m%d-%H%M%S) '/^DNS\s*=/d' /etc/wireguard/wg0.conf
    NEED_WG_RESTART=true
fi

# 4b. Add static /etc/hosts entries for *.wg names
if [ -f /etc/wireguard/wg0.conf ] && ! grep -q 'CATVPN static names' /etc/hosts; then
    log_info "  Adding *.wg static entries to /etc/hosts"
    SELF_IP=$(grep '^Address' /etc/wireguard/wg0.conf | head -1 | awk -F'[ =/]+' '{print $3}')
    SELF_NAME=$(hostname)
    {
        echo ""
        echo "# CATVPN static names (no DNS dependency)"
        echo "10.66.0.1   vps.wg vps"
        [ -n "$SELF_IP" ] && [ -n "$SELF_NAME" ] && echo "${SELF_IP}   ${SELF_NAME}.feeldscope.wg ${SELF_NAME}"
    } >> /etc/hosts
fi

# 4c. Install chrony + fake-hwclock (idempotent)
if ! command -v chronyc &>/dev/null; then
    log_info "  Installing chrony + fake-hwclock"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chrony fake-hwclock || \
        log_warn "  package install failed (will retry on next update)"
fi

# 4d. Replace chrony.conf with NICT IP-only (only if not already our config)
if [ -f /etc/chrony/chrony.conf ] && ! grep -q '133.243.238.163' /etc/chrony/chrony.conf; then
    log_info "  Writing NICT IP-only chrony config"
    cp /etc/chrony/chrony.conf /etc/chrony/chrony.conf.bak-$(date +%Y%m%d-%H%M%S)
    cat > /etc/chrony/chrony.conf <<'CHRONY_EOF'
# FEELDSCOPE-OGN: IP-only NTP (no DNS dependency)
# NICT public NTP servers (Japan)
server 133.243.238.163 iburst
server 133.243.238.243 iburst
server 133.243.238.244 iburst
server 61.205.120.130 iburst

driftfile /var/lib/chrony/chrony.drift
makestep 1.0 3
rtcsync
logdir /var/log/chrony
CHRONY_EOF
    mkdir -p /var/log/chrony
    systemctl restart chrony 2>/dev/null || true
fi

# 4e. Disable legacy ntp, enable chrony + fake-hwclock
systemctl disable --now ntp 2>/dev/null || true
systemctl enable --now chrony 2>/dev/null || true
systemctl enable fake-hwclock 2>/dev/null || true
[ -x /sbin/fake-hwclock ] && /sbin/fake-hwclock save 2>/dev/null || true

# 4g. Deploy CATVPN enroll script to /usr/local/bin/catvpn-enroll
#     (Web UIから sudo -n /usr/local/bin/catvpn-enroll <TOKEN> で呼び出せる)
if [ -f "$SCRIPT_DIR/installer/catvpn-enroll.sh" ]; then
    install -m 755 "$SCRIPT_DIR/installer/catvpn-enroll.sh" /usr/local/bin/catvpn-enroll
    log_info "  Deployed /usr/local/bin/catvpn-enroll"
fi

# 4g2. Backfill /etc/catvpn/identity for existing CATVPN-enrolled devices
#      (v1.1.31以前に加入したデバイスは identity ファイルが無く GUIに hostname が表示されない)
if [ -f /etc/wireguard/wg0.conf ] && [ ! -f /etc/catvpn/identity ] \
   && [ -f /etc/ssh/ssh_host_ed25519_key-cert.pub ]; then
    FQDN=$(ssh-keygen -L -f /etc/ssh/ssh_host_ed25519_key-cert.pub 2>/dev/null \
            | grep -oE '[a-z0-9-]+\.feeldscope\.wg' | head -1)
    SELF_IP=$(grep '^Address' /etc/wireguard/wg0.conf | head -1 | awk -F'[ =/]+' '{print $2}')
    if [ -n "$FQDN" ] && [ -n "$SELF_IP" ]; then
        log_info "  Backfilling /etc/catvpn/identity for existing enrollment ($FQDN)"
        install -d -m 755 /etc/catvpn
        cat > /etc/catvpn/identity <<EOF
hostname=$FQDN
fleet=feeldscope
assigned_ip=$SELF_IP
ssh_user=pi
enrolled_at=(backfilled $(date -Iseconds))
EOF
        chmod 644 /etc/catvpn/identity
    fi
fi

# 4h. Zero-touch auto-claim: VPS側にこの hostname 用の保留トークンがあれば自動加入
#     - 既に登録済 (wg0.conf 存在) なら catvpn-enroll 内部で即exit
#     - 保留トークンが無ければ 404 で正常終了
#     - ネットワーク不通でもエラーは飲み込む (アップデート全体は成功扱い)
if [ -x /usr/local/bin/catvpn-enroll ] && [ ! -f /etc/wireguard/wg0.conf ]; then
    log_info "  Attempting CATVPN auto-claim for hostname '$(hostname)'..."
    /usr/local/bin/catvpn-enroll --auto 2>&1 | sed 's/^/    /' || \
        log_warn "  auto-claim skipped (no pending token or error; continuing)"
fi

# 4f. Restart wg-quick@wg0 if conf was modified
if [ "$NEED_WG_RESTART" = "true" ] && systemctl is-active wg-quick@wg0 >/dev/null 2>&1; then
    log_info "  Restarting wg-quick@wg0 to apply DNS removal"
    systemctl restart wg-quick@wg0 2>/dev/null || log_warn "  wg-quick restart failed"
fi

log_info "Network/clock fixups complete"

# ---- Security hardening (ufw + sshd) — idempotent ----
log_info "  Applying security hardening (ufw + sshd)..."
if [ -f "$SCRIPT_DIR/feeldscope-harden.sh" ]; then
    bash "$SCRIPT_DIR/feeldscope-harden.sh" || log_warn "  Hardening reported warnings (continuing)"
else
    log_warn "  feeldscope-harden.sh not found; skipping hardening"
fi

# ---- wpa_supplicant.conf の重複 network ブロック除去 — idempotent ----
# OGN 公式イメージの設定マネージャが rtlsdr-ogn 起動のたびに追記するため、
# 既存機は放置すると再起動回数ぶん増殖する。デプロイ＋即時実行で自己修復させる。
log_info "  Deduplicating wpa_supplicant.conf..."
if [ -f "$SCRIPT_DIR/feeldscope-wpa-dedupe.sh" ]; then
    install -m 755 "$SCRIPT_DIR/feeldscope-wpa-dedupe.sh" /usr/local/sbin/feeldscope-wpa-dedupe
    if [ -f "$SCRIPT_DIR/config/feeldscope-wpa-dedupe.service" ]; then
        cp "$SCRIPT_DIR/config/feeldscope-wpa-dedupe.service" /etc/systemd/system/
        systemctl daemon-reload
        systemctl enable feeldscope-wpa-dedupe.service >/dev/null 2>&1 || true
    fi
    bash /usr/local/sbin/feeldscope-wpa-dedupe || log_warn "  wpa dedupe reported warnings (continuing)"
else
    log_warn "  feeldscope-wpa-dedupe.sh not found; skipping"
fi

# ---- 廃止した機能の後片付け — idempotent ----
# v1.2.1 で「利用状況の記録(UX分析)」を削除した。記録先のディレクトリは
# コードを消しても残るため、更新のたびに残骸が無いか見て、あれば片付ける。
# 対象は下の1ディレクトリだけに限定し、中身も pointer-*.jsonl しか消さない。
ANALYTICS_DIR="$FEELDSCOPE_DIR/analytics"
if [ -d "$ANALYTICS_DIR" ]; then
    log_info "  Removing retired analytics data ($ANALYTICS_DIR)..."
    find "$ANALYTICS_DIR" -maxdepth 1 -type f -name 'pointer-*.jsonl' -delete 2>/dev/null || true
    # 他に何も入っていなければディレクトリごと消す（空でなければ残して知らせる）
    if rmdir "$ANALYTICS_DIR" 2>/dev/null; then
        log_info "  Analytics data removed"
    else
        log_warn "  $ANALYTICS_DIR is not empty; left as is"
    fi
fi

# =============================================================================
# Step 5: Rebuild webapp
# =============================================================================

log_info "[5/6] Rebuilding webapp..."
cd "$FEELDSCOPE_DIR/webapp"
sudo -u pi npm install --production=false 2>&1 | tail -5
sudo -u pi npm run build 2>&1 | tail -5
log_info "Webapp rebuilt"

# =============================================================================
# Step 6: Restart services
# =============================================================================

log_info "[6/6] Restarting services..."
systemctl restart mosquitto
systemctl start ogn-mqtt.service
systemctl restart feeldscope-webapp.service

# Restart optional services if they were enabled
if systemctl is-enabled adsb-poller.service &>/dev/null; then
    systemctl start adsb-poller.service
fi

echo ""
echo "========================================"
echo "  FEELDSCOPE Update Complete!"
echo "========================================"
echo ""
echo "Service Status:"
echo "  ogn-mqtt:     $(systemctl is-active ogn-mqtt 2>/dev/null || echo 'unknown')"
echo "  webapp:       $(systemctl is-active feeldscope-webapp 2>/dev/null || echo 'unknown')"
echo "  mosquitto:    $(systemctl is-active mosquitto 2>/dev/null || echo 'unknown')"
echo ""
if command -v overlayctl &>/dev/null && ! overlayctl status 2>/dev/null | grep -q "overlay enabled for next boot"; then
    echo "固定化(OverlayFS)を使う場合: sudo overlayctl enable && sudo reboot"
fi
echo ""
