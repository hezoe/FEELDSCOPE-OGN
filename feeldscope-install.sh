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

log_info "[1/9] Installing system packages..."
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients python3-pip git cmake libusb-1.0-0-dev

# Install paho-mqtt for Python
pip3 install --break-system-packages paho-mqtt 2>/dev/null || pip3 install paho-mqtt

# =============================================================================
# Step 2: Node.js
# =============================================================================

log_info "[2/9] Installing Node.js ${NODE_MAJOR}.x..."
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

log_info "[3/9] Configuring Mosquitto with WebSocket support..."
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

log_info "[4/9] Deploying FEELDSCOPE files to $FEELDSCOPE_DIR..."
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
# Step 5: Install RTL-SDR Blog V4 driver (replaces stock librtlsdr 0.6.0)
# =============================================================================
#
# The OGN official image ships with librtlsdr 0.6.0 which does NOT support
# RTL-SDR Blog V4 properly (PLL fails to lock at 922 MHz Japan FLARM band,
# Live Time stays at 0%, no aircraft are decoded).
#
# The rtl-sdr-blog driver fork is a drop-in replacement that fully supports
# V4 and remains compatible with V3. We always install it.
#
# Reference: https://github.com/rtlsdrblog/rtl-sdr-blog
# =============================================================================

log_info "[5/9] Installing RTL-SDR Blog V4 driver..."

# Detect SDR variant for logging only
SDR_VARIANT="unknown"
if command -v rtl_test &>/dev/null; then
    if rtl_test 2>&1 | grep -q "Blog V4"; then
        SDR_VARIANT="V4"
    elif rtl_test 2>&1 | grep -q "RTL2832"; then
        SDR_VARIANT="V3 or other"
    fi
fi
log_info "Detected SDR: ${SDR_VARIANT}"

# Skip rebuild if newer driver already installed
if [ -f /usr/local/lib/arm-linux-gnueabihf/librtlsdr.so.0 ] \
   && /usr/local/bin/rtl_test 2>&1 | grep -q "RTL-SDR Blog V4 Detected"; then
    log_info "RTL-SDR Blog driver already installed at /usr/local/lib"
else
    # Stop OGN to release the SDR before linking against the new lib
    if [ -f /etc/init.d/rtlsdr-ogn ]; then
        service rtlsdr-ogn stop 2>/dev/null || true
        sleep 2
    fi

    cd /tmp
    rm -rf rtl-sdr-blog
    if ! git clone --depth 1 https://github.com/rtlsdrblog/rtl-sdr-blog.git 2>&1 | tail -2; then
        log_error "Failed to clone rtl-sdr-blog. Check network."
        exit 1
    fi
    cd rtl-sdr-blog
    mkdir -p build && cd build
    cmake ../ -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON >/dev/null 2>&1
    make -j2 >/dev/null 2>&1
    make install >/dev/null 2>&1
    cp ../rtl-sdr.rules /etc/udev/rules.d/
    ldconfig
    udevadm control --reload-rules
    udevadm trigger
    log_info "RTL-SDR Blog driver installed (supports V3 and V4)"
fi

# Verify ogn-rf will pick up the new lib
if ldd /home/pi/rtlsdr-ogn/ogn-rf 2>/dev/null | grep -q "/usr/local/lib.*librtlsdr"; then
    log_info "ogn-rf is now linked against the new driver"
else
    log_warn "ogn-rf may still link the old librtlsdr (will take effect after restart)"
fi

# =============================================================================
# Step 6: Generate / verify OGN config (Japan FLARM-optimized)
# =============================================================================
#
# The stock config-manager generates a config with:
#   - GSM section (922.4 MHz) but no RF.OGN section
#     → ogn-rf falls back to European default 868.8 MHz (wrong for Japan)
#   - GainMode that may cause AGC oscillation with V4
#
# We replace it with a Japan-optimized config that:
#   - Sets FreqPlan = 7 (Japan, 922.4 MHz center, 50 kHz × 3 ch FLARM)
#   - Sets a low initial Gain (7.7 dB) — AGC walks up based on MinNoise/MaxNoise.
#     A high initial Gain (49.6) caused decode failures in field tests with V4.
#   - MinNoise = 5.0 / MaxNoise = 10.0 — pushes AGC to gain index ~20 (37 dB)
#     for weak signal environments. Defaults (2.0/6.0) settled too low (~29 dB)
#     and missed FLARM packets at the Takikawa field test (2026-05-04).
#   - DetectSNR = 3.0 — catches weak signals; default 6.0 missed marginal packets.
#   - Wider ScanMargin (80 kHz) to cover all 3 Japan FLARM channels
#   - Adds HTTP section so ogn-rf/ogn-decode expose status pages on :8082/:8083
# =============================================================================

log_info "[6/9] Configuring OGN for Japan FLARM..."

OGN_CONF="/home/pi/rtlsdr-ogn.conf"
OGN_CONF_BOOT="/boot/rtlsdr-ogn.conf"

# Pull receiver name and position from /boot/OGN-receiver.conf if user already set them
EXISTING_NAME=""
EXISTING_LAT=""
EXISTING_LON=""
if [ -f /boot/OGN-receiver.conf ]; then
    EXISTING_NAME=$(grep -i '^ReceiverName=' /boot/OGN-receiver.conf 2>/dev/null | head -1 | cut -d'"' -f2)
    EXISTING_LAT=$(grep -i '^Latitude=' /boot/OGN-receiver.conf 2>/dev/null | head -1 | cut -d'"' -f2)
    EXISTING_LON=$(grep -i '^Longitude=' /boot/OGN-receiver.conf 2>/dev/null | head -1 | cut -d'"' -f2)
fi
RECV_NAME="${EXISTING_NAME:-NEWRECV01}"
LAT_VAL="${EXISTING_LAT:-35.6977}"
LON_VAL="${EXISTING_LON:-139.7548}"

# Check whether existing /boot/rtlsdr-ogn.conf already has the Japan-tuned settings
# (including the 2026-05-04 weak-signal AGC tuning: MinNoise=5.0 / DetectSNR=3.0).
NEED_REGEN=true
if [ -f "$OGN_CONF_BOOT" ] \
   && grep -q "FreqPlan = 7" "$OGN_CONF_BOOT" \
   && grep -q "RF.OGN\|RF:OGN\|OGN:" "$OGN_CONF_BOOT" \
   && grep -q "HTTP:" "$OGN_CONF_BOOT" \
   && grep -q "MinNoise = 5.0" "$OGN_CONF_BOOT" \
   && grep -q "DetectSNR  = 3.0\|DetectSNR = 3.0" "$OGN_CONF_BOOT"; then
    NEED_REGEN=false
    log_info "Existing $OGN_CONF_BOOT already has Japan FLARM config — preserved"
fi

if [ "$NEED_REGEN" = true ]; then
    if [ -f "$OGN_CONF_BOOT" ]; then
        cp "$OGN_CONF_BOOT" "${OGN_CONF_BOOT}.bak.$(date +%Y%m%d-%H%M%S)"
        log_info "Backed up old config to ${OGN_CONF_BOOT}.bak.*"
    fi
    cat > "$OGN_CONF_BOOT" <<OGNEOF
RF:
{ FreqPlan   = 7;        # 7 = Japan (922.4 MHz FLARM band, 50 kHz x 3 ch)
  FreqCorr   = 0;
  SampleRate = 2.0;

  OGN:
  { GainMode = 0;
    Gain     = 7.7;      # Initial gain — OGN steps it up via internal noise-window AGC.
                         # Low starting value avoids ADC saturation when test FLARMs are nearby (<5m).
    MinNoise = 5.0;      # Force AGC to push gain until measured noise reaches 5 dB.
                         # Default 2.0 settled at ~29 dB and missed weak FLARM packets.
    MaxNoise = 10.0;     # Cap above which AGC backs off (default 6.0 was too tight).
  };
};

Demodulator:
{ DetectSNR  = 3.0;      # Lower SNR threshold to catch weak signals.
                         # Default 6.0 missed marginal FLARM packets at Takikawa (2026-05-04).
  ScanMargin = 80.0;     # Wider margin to cover 3 Japan FLARM channels (922.351/.402/.449 MHz)
};

Position:
{ Latitude  = ${LAT_VAL};
  Longitude = ${LON_VAL};
  Altitude  = 23;
};

APRS:
{ Call = "${RECV_NAME}";
};

HTTP:
{ Port = 8082;
};
OGNEOF
    log_info "Wrote new $OGN_CONF_BOOT (FreqPlan=Japan, Gain auto-AGC, Recv=${RECV_NAME})"
fi

# Mirror to /home/pi (init.d copies /boot to /home/pi on every start anyway)
cp "$OGN_CONF_BOOT" "$OGN_CONF"

log_info "Restarting OGN receiver..."
service rtlsdr-ogn restart || log_warn "Failed to restart OGN. You may need to reboot."
sleep 5

# =============================================================================
# Step 7: Build webapp
# =============================================================================

log_info "[7/9] Building FEELDSCOPE webapp (this may take a few minutes)..."
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
# Step 8: Install systemd services
# =============================================================================

log_info "[8/9] Installing systemd services..."
cp "$SCRIPT_DIR/config/ogn-mqtt.service"          /etc/systemd/system/
cp "$SCRIPT_DIR/config/adsb-poller.service"        /etc/systemd/system/
cp "$SCRIPT_DIR/config/igc-simulator.service"      /etc/systemd/system/
cp "$SCRIPT_DIR/config/feeldscope-webapp.service"  /etc/systemd/system/

systemctl daemon-reload

# =============================================================================
# Step 9: Enable and start services
# =============================================================================

log_info "[9/9] Starting FEELDSCOPE services..."

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
