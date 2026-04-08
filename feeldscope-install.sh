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

log_info "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients python3-pip git

# Install paho-mqtt for Python
pip3 install --break-system-packages paho-mqtt 2>/dev/null || pip3 install paho-mqtt

# =============================================================================
# Step 2: Node.js
# =============================================================================

log_info "[2/7] Installing Node.js ${NODE_MAJOR}.x..."
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

log_info "[3/7] Configuring Mosquitto with WebSocket support..."
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

log_info "[4/7] Deploying FEELDSCOPE files to $FEELDSCOPE_DIR..."
mkdir -p "$FEELDSCOPE_DIR"

# Copy Python scripts
cp "$SCRIPT_DIR/ogn-mqtt.py"       "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/adsb-poller.py"    "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/igc-simulator.py"  "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/aircraft-db.json"  "$FEELDSCOPE_DIR/"
cp "$SCRIPT_DIR/adsb-config.json"  "$FEELDSCOPE_DIR/"

# Copy testdata
cp -r "$SCRIPT_DIR/testdata" "$FEELDSCOPE_DIR/"

# Copy webapp source
cp -r "$SCRIPT_DIR/webapp" "$FEELDSCOPE_DIR/"

# Set ownership
chown -R pi:pi "$FEELDSCOPE_DIR"

log_info "Files deployed to $FEELDSCOPE_DIR"

# =============================================================================
# Step 5: Build webapp
# =============================================================================

log_info "[5/7] Building FEELDSCOPE webapp (this may take a few minutes)..."
cd "$FEELDSCOPE_DIR/webapp"
# Remove stale node_modules to ensure clean install with correct deps
rm -rf node_modules package-lock.json .next
sudo -u pi npm install 2>&1 | tail -5
# Use --webpack flag to avoid Turbopack/SWC native binding issues on armhf
sudo -u pi npx next build --webpack 2>&1 | tail -10
if [ ! -d .next ]; then
    log_error "Webapp build failed. Check errors above."
    exit 1
fi
log_info "Webapp built successfully"

# =============================================================================
# Step 6: Install systemd services
# =============================================================================

log_info "[6/7] Installing systemd services..."
cp "$SCRIPT_DIR/config/ogn-mqtt.service"          /etc/systemd/system/
cp "$SCRIPT_DIR/config/adsb-poller.service"        /etc/systemd/system/
cp "$SCRIPT_DIR/config/igc-simulator.service"      /etc/systemd/system/
cp "$SCRIPT_DIR/config/feeldscope-webapp.service"  /etc/systemd/system/

systemctl daemon-reload

# =============================================================================
# Step 7: Enable and start services
# =============================================================================

log_info "[7/7] Starting FEELDSCOPE services..."

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

echo "Web UI:     http://${IP_ADDR}:3000"
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
