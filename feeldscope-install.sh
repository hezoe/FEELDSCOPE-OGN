#!/bin/bash
# =============================================================================
# FEELDSCOPE Installer for OGN Receiver Image
#
# Prerequisites:
#   - OGN official image (seb-ogn-rpi-image) booted and running
#   - OGN receiver operational (ogn-rf + ogn-decode running)
#   - Internet connection available
#   - OverlayFS disabled (run: sudo overlayctl disable && sudo reboot)
#
# Usage:
#   git clone https://github.com/hiroshi/FEELDSCOPE-OGN
#   cd FEELDSCOPE-OGN
#   sudo bash feeldscope-install.sh
#
# =============================================================================

set -e

FEELDSCOPE_DIR="/home/pi/FEELDSCOPE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_MAJOR=20

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# Pre-flight checks
# =============================================================================

if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root (use sudo)"
    exit 1
fi

# Check if running on Raspberry Pi
if [ ! -f /proc/cpuinfo ] || ! grep -q "Raspberry Pi\|BCM" /proc/cpuinfo 2>/dev/null; then
    log_warn "This does not appear to be a Raspberry Pi. Continuing anyway..."
fi

# Check if OGN receiver is installed
if [ ! -f /etc/init.d/rtlsdr-ogn ]; then
    log_error "OGN receiver service not found. This script requires the OGN official image."
    log_error "Download from: http://download.glidernet.org/seb-ogn-rpi-image"
    exit 1
fi

# Check OverlayFS
if command -v overlayctl &>/dev/null; then
    overlay_status=$(overlayctl status 2>/dev/null || echo "unknown")
    if echo "$overlay_status" | grep -qi "enabled"; then
        log_error "OverlayFS is enabled. Changes will be lost on reboot."
        log_error "Please run:"
        log_error "  sudo overlayctl disable"
        log_error "  sudo reboot"
        log_error "Then run this installer again."
        exit 1
    fi
fi

# Check OGN processes
if pgrep -x ogn-rf >/dev/null 2>&1 && pgrep -x ogn-decode >/dev/null 2>&1; then
    log_info "OGN receiver is running (ogn-rf + ogn-decode)"
else
    log_warn "OGN receiver processes not detected. FEELDSCOPE will be installed but ogn-mqtt won't work until OGN receiver is running."
fi

echo ""
echo "========================================"
echo "  FEELDSCOPE Installer"
echo "  OGN Receiver Add-on"
echo "========================================"
echo ""
echo "Install directory: $FEELDSCOPE_DIR"
echo "Source directory:  $SCRIPT_DIR"
echo ""

# =============================================================================
# Step 1: System packages
# =============================================================================

log_info "[1/8] Installing system packages..."
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients python3-pip git

# Install paho-mqtt for Python
pip3 install --break-system-packages paho-mqtt 2>/dev/null || pip3 install paho-mqtt

# =============================================================================
# Step 2: Node.js
# =============================================================================

log_info "[2/8] Installing Node.js ${NODE_MAJOR}.x..."
NODE_INSTALLED=false
if command -v node &>/dev/null; then
    current_node=$(node -v | cut -d. -f1 | tr -d v)
    if [ "$current_node" -ge "$NODE_MAJOR" ] 2>/dev/null; then
        log_info "Node.js $(node -v) already installed, skipping"
        NODE_INSTALLED=true
    fi
fi

if [ "$NODE_INSTALLED" = false ]; then
    ARCH=$(uname -m)
    case "$ARCH" in
        armv7l|armv6l)
            # NodeSource doesn't support armhf; use official Node.js binary
            NODE_VERSION="v${NODE_MAJOR}.20.2"
            NODE_DIST="node-${NODE_VERSION}-linux-armv7l"
            NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.tar.xz"
            log_info "Downloading Node.js ${NODE_VERSION} for ${ARCH}..."
            cd /tmp
            curl -fsSL "$NODE_URL" -o node.tar.xz
            tar -xf node.tar.xz
            cp -r ${NODE_DIST}/bin/* /usr/local/bin/
            cp -r ${NODE_DIST}/lib/* /usr/local/lib/
            cp -r ${NODE_DIST}/include/* /usr/local/include/ 2>/dev/null || true
            cp -r ${NODE_DIST}/share/* /usr/local/share/ 2>/dev/null || true
            rm -rf node.tar.xz ${NODE_DIST}
            ;;
        aarch64|x86_64)
            curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
            apt-get install -y -qq nodejs
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac
fi
log_info "Node.js $(node -v), npm $(npm -v)"

# =============================================================================
# Step 3: Configure Mosquitto
# =============================================================================

log_info "[3/8] Configuring Mosquitto with WebSocket support..."
cp "$SCRIPT_DIR/config/mosquitto-feeldscope.conf" /etc/mosquitto/conf.d/feeldscope.conf

# Disable the default listener if it conflicts
if [ -f /etc/mosquitto/mosquitto.conf ]; then
    if ! grep -q "^listener" /etc/mosquitto/mosquitto.conf; then
        # Default config doesn't have explicit listener, our config will add them
        :
    fi
fi

systemctl enable mosquitto
systemctl restart mosquitto
log_info "Mosquitto configured (MQTT :1883, WebSocket :9001)"

# =============================================================================
# Step 4: Deploy FEELDSCOPE files
# =============================================================================

log_info "[4/8] Deploying FEELDSCOPE files to $FEELDSCOPE_DIR..."
mkdir -p "$FEELDSCOPE_DIR"

# Copy Python scripts
cp "$SCRIPT_DIR/ogn-mqtt.py"       "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/adsb-poller.py"    "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/igc-simulator.py"  "$FEELDSCOPE_DIR/"

# Site-specific data files (gitignored). Use source if present, otherwise create defaults.
if [ -f "$SCRIPT_DIR/aircraft-db.json" ]; then
    cp "$SCRIPT_DIR/aircraft-db.json" "$FEELDSCOPE_DIR/"
elif [ ! -f "$FEELDSCOPE_DIR/aircraft-db.json" ]; then
    echo '{}' > "$FEELDSCOPE_DIR/aircraft-db.json"
fi
if [ -f "$SCRIPT_DIR/adsb-config.json" ]; then
    cp "$SCRIPT_DIR/adsb-config.json" "$FEELDSCOPE_DIR/"
elif [ ! -f "$FEELDSCOPE_DIR/adsb-config.json" ]; then
    cat > "$FEELDSCOPE_DIR/adsb-config.json" <<'ADSBEOF'
{
  "enabled": false,
  "url": "",
  "interval": 3
}
ADSBEOF
fi

# Copy testdata (optional, may only contain .gitkeep after fresh clone)
mkdir -p "$FEELDSCOPE_DIR/testdata"
if [ -d "$SCRIPT_DIR/testdata" ]; then
    cp -r "$SCRIPT_DIR/testdata/." "$FEELDSCOPE_DIR/testdata/" 2>/dev/null || true
fi

# Copy webapp source
cp -r "$SCRIPT_DIR/webapp" "$FEELDSCOPE_DIR/"

# Set ownership
chown -R pi:pi "$FEELDSCOPE_DIR"

log_info "Files deployed to $FEELDSCOPE_DIR"

# =============================================================================
# Step 5: Ensure rtlsdr-ogn.conf has HTTP section
# =============================================================================

log_info "[5/8] Configuring OGN HTTP interface..."

OGN_CONF="/home/pi/rtlsdr-ogn.conf"
OGN_CONF_BOOT="/boot/rtlsdr-ogn.conf"

if [ -f "$OGN_CONF_BOOT" ]; then
    # /boot/rtlsdr-ogn.conf already exists (config-manager is bypassed)
    OGN_CONF_SRC="$OGN_CONF_BOOT"
elif [ -f "$OGN_CONF" ]; then
    OGN_CONF_SRC="$OGN_CONF"
else
    log_warn "rtlsdr-ogn.conf not found. OGN config-manager may not have run yet."
    log_warn "Skipping HTTP config. You may need to rerun this installer after first OGN boot."
    OGN_CONF_SRC=""
fi

if [ -n "$OGN_CONF_SRC" ]; then
    if grep -q "HTTP:" "$OGN_CONF_SRC"; then
        log_info "HTTP section already present in $OGN_CONF_SRC"
    else
        log_info "Adding HTTP section to OGN config..."
        # Append HTTP section (Port 8082 for ogn-rf; ogn-decode auto-uses 8083)
        cat >> "$OGN_CONF_SRC" <<'OGNEOF'

HTTP:
{ Port = 8082;
} ;
OGNEOF
        log_info "HTTP section added"
    fi
    # Ensure /boot copy exists so config-manager is bypassed on future boots
    if [ "$OGN_CONF_SRC" != "$OGN_CONF_BOOT" ]; then
        cp "$OGN_CONF_SRC" "$OGN_CONF_BOOT"
        log_info "Copied to $OGN_CONF_BOOT (bypasses config-manager)"
    fi
    # Also sync to /home/pi for immediate use
    cp "$OGN_CONF_BOOT" "$OGN_CONF"

    # Restart OGN to apply HTTP config
    log_info "Restarting OGN receiver..."
    service rtlsdr-ogn restart || log_warn "Failed to restart OGN. You may need to reboot."
    sleep 5
fi

# =============================================================================
# Step 6: Build webapp
# =============================================================================

log_info "[6/8] Building FEELDSCOPE webapp (this may take a few minutes)..."
cd "$FEELDSCOPE_DIR/webapp"
# Remove stale node_modules to ensure clean install with correct deps
rm -rf node_modules package-lock.json .next
sudo -u pi npm install 2>&1 | tail -5
# package.json build script includes --webpack to avoid Turbopack/SWC issues on armhf
sudo -u pi npm run build 2>&1 | tail -10
if [ ! -d .next ]; then
    log_error "Webapp build failed. Check errors above."
    exit 1
fi
log_info "Webapp built successfully"

# =============================================================================
# Step 6: Install systemd services
# =============================================================================

log_info "[7/8] Installing systemd services..."
cp "$SCRIPT_DIR/config/ogn-mqtt.service"          /etc/systemd/system/
cp "$SCRIPT_DIR/config/adsb-poller.service"        /etc/systemd/system/
cp "$SCRIPT_DIR/config/igc-simulator.service"      /etc/systemd/system/
cp "$SCRIPT_DIR/config/feeldscope-webapp.service"  /etc/systemd/system/

systemctl daemon-reload

# =============================================================================
# Step 7: Enable and start services
# =============================================================================

log_info "[8/8] Starting FEELDSCOPE services..."

# Core services: ogn-mqtt + webapp (always enabled)
systemctl enable ogn-mqtt.service
systemctl enable feeldscope-webapp.service

systemctl start ogn-mqtt.service
systemctl start feeldscope-webapp.service

log_info "Services started"

# =============================================================================
# Installation complete
# =============================================================================

echo ""
echo "========================================"
echo "  FEELDSCOPE Installation Complete!"
echo "========================================"
echo ""

# Get IP address
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$IP_ADDR" ]; then
    IP_ADDR="<raspberry-pi-ip>"
fi

echo "Web UI:     http://${IP_ADDR}/"
echo ""
echo "Service Status:"
echo "  ogn-mqtt:     $(systemctl is-active ogn-mqtt 2>/dev/null || echo 'unknown')"
echo "  webapp:       $(systemctl is-active feeldscope-webapp 2>/dev/null || echo 'unknown')"
echo "  mosquitto:    $(systemctl is-active mosquitto 2>/dev/null || echo 'unknown')"
echo ""
echo "Optional services (not auto-started):"
echo "  ADS-B poller: sudo systemctl enable --now adsb-poller"
echo "  IGC simulator: sudo systemctl start igc-simulator"
echo ""
echo "Re-enable OverlayFS (recommended for production):"
echo "  sudo overlayctl enable"
echo "  sudo reboot"
echo ""
