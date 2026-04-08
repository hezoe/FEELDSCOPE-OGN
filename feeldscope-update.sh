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

log_info "[1/5] Pulling latest code..."
cd "$SCRIPT_DIR"
sudo -u pi git pull --ff-only
log_info "Code updated"

# =============================================================================
# Step 2: Stop services
# =============================================================================

log_info "[2/5] Stopping FEELDSCOPE services..."
systemctl stop ogn-mqtt.service 2>/dev/null || true
systemctl stop feeldscope-webapp.service 2>/dev/null || true
systemctl stop adsb-poller.service 2>/dev/null || true
systemctl stop igc-simulator.service 2>/dev/null || true

# =============================================================================
# Step 3: Update files (preserve site-specific config)
# =============================================================================

log_info "[3/5] Updating FEELDSCOPE files..."

# Backup site-specific config
if [ -f "$FEELDSCOPE_DIR/adsb-config.json" ]; then
    cp "$FEELDSCOPE_DIR/adsb-config.json" /tmp/feeldscope-adsb-config.json.bak
fi

# Update Python scripts
cp "$SCRIPT_DIR/ogn-mqtt.py"       "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/adsb-poller.py"    "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/igc-simulator.py"  "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/aircraft-db.json"  "$FEELDSCOPE_DIR/"

# Update testdata
cp -r "$SCRIPT_DIR/testdata" "$FEELDSCOPE_DIR/"

# Update webapp source
rm -rf "$FEELDSCOPE_DIR/webapp/.next"
cp -r "$SCRIPT_DIR/webapp/src"         "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/package.json"   "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/package-lock.json" "$FEELDSCOPE_DIR/webapp/" 2>/dev/null || true
cp "$SCRIPT_DIR/webapp/next.config.ts" "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/tsconfig.json"  "$FEELDSCOPE_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/postcss.config.mjs" "$FEELDSCOPE_DIR/webapp/"
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

chown -R pi:pi "$FEELDSCOPE_DIR"

systemctl daemon-reload
log_info "Files updated"

# =============================================================================
# Step 4: Rebuild webapp
# =============================================================================

log_info "[4/5] Rebuilding webapp..."
cd "$FEELDSCOPE_DIR/webapp"
sudo -u pi npm install --production=false 2>&1 | tail -5
sudo -u pi npm run build 2>&1 | tail -5
log_info "Webapp rebuilt"

# =============================================================================
# Step 5: Restart services
# =============================================================================

log_info "[5/5] Restarting services..."
systemctl restart mosquitto
systemctl start ogn-mqtt.service
systemctl start feeldscope-webapp.service

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
