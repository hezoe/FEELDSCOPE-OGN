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

# Check OverlayFS
if command -v overlayctl &>/dev/null; then
    overlay_status=$(overlayctl status 2>/dev/null || echo "unknown")
    if echo "$overlay_status" | grep -qi "enabled"; then
        log_error "OverlayFS is enabled. Please run:"
        log_error "  sudo overlayctl disable && sudo reboot"
        exit 1
    fi
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
sudo -u pi git pull --ff-only
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
cp -r "$SCRIPT_DIR/webapp/src"         "$FEELDSCOPE_DIR/webapp/"
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

# リモートサポート時限管理（3時間で自動OFF・再起動で窓内復帰）
cp "$SCRIPT_DIR/config/feeldscope-remote-support.service" /etc/systemd/system/
cp "$SCRIPT_DIR/config/feeldscope-remote-support.timer"   /etc/systemd/system/
install -m 755 "$SCRIPT_DIR/feeldscope-remote-support-check.sh" /usr/local/sbin/feeldscope-remote-support-check.sh
install -m 755 "$SCRIPT_DIR/feeldscope-reset-password.sh"       /usr/local/bin/feeldscope-reset-password

chown -R pi:pi "$FEELDSCOPE_DIR"

systemctl daemon-reload
# 旧来 enable された恒久ONを解除し、時限タイマーを起動
systemctl disable wg-quick@wg0 >/dev/null 2>&1 || true
systemctl enable --now feeldscope-remote-support.timer >/dev/null 2>&1 || true
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
echo "Re-enable OverlayFS: sudo overlayctl enable && sudo reboot"
echo ""
