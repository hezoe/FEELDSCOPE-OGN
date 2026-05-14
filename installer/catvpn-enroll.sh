#!/bin/bash
#
# CATVPN enrollment script for RPi / Linux client.
# 1コマンドで WireGuard + SSH CA セットアップを完了する。
#
# Usage:
#   sudo ./catvpn-enroll.sh <TOKEN>           # トークンモード (admin手渡し)
#   sudo ./catvpn-enroll.sh --auto            # 自動モード (hostname経由でVPSの保留トークンを使用)
#   sudo ./catvpn-enroll.sh <TOKEN> <API_URL> # API URLを上書き
#
# Defaults:
#   API_URL = https://cathub.ezoe.net
#
# 冪等: 既に /etc/wireguard/wg0.conf がある場合は何もせず終了 (0で正常終了)。

set -euo pipefail

MODE=""
TOKEN=""
API="https://cathub.ezoe.net"

if [ "${1:-}" = "--auto" ]; then
    MODE="auto"
    API="${2:-$API}"
elif [ -n "${1:-}" ]; then
    MODE="token"
    TOKEN="$1"
    API="${2:-$API}"
else
    echo "Usage: $0 <TOKEN> [API_URL]" >&2
    echo "       $0 --auto [API_URL]" >&2
    exit 1
fi

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must be run as root (use sudo)" >&2
    exit 1
fi

log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "ERROR: $*" >&2; }

# ---------- 0. Idempotency: skip if already enrolled ----------
if [ -f /etc/wireguard/wg0.conf ] && grep -q "^Address" /etc/wireguard/wg0.conf; then
    log "Already enrolled (/etc/wireguard/wg0.conf exists). Nothing to do."
    exit 0
fi

# ---------- 1. prerequisites ----------
log "[1/8] Checking prerequisites..."

if ! command -v wg >/dev/null 2>&1; then
    log "Installing wireguard-tools..."
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard wireguard-tools
fi

for cmd in python3 curl ssh-keygen systemctl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        err "$cmd is required"
        exit 1
    fi
done

# ---------- 2. WG キーペア生成 ----------
log "[2/8] Generating WireGuard keypair..."

install -d -m 700 /etc/wireguard
if [ -s /etc/wireguard/private.key ]; then
    log "  Existing WG private key found, reusing it"
    WG_PRIV=$(cat /etc/wireguard/private.key)
    WG_PUB=$(echo "$WG_PRIV" | wg pubkey)
else
    umask 077
    WG_PRIV=$(wg genkey)
    WG_PUB=$(echo "$WG_PRIV" | wg pubkey)
    echo "$WG_PRIV" > /etc/wireguard/private.key
    echo "$WG_PUB" > /etc/wireguard/public.key
    chmod 600 /etc/wireguard/private.key
fi

# ---------- 3. SSH ホスト鍵確認 ----------
log "[3/8] Reading SSH host public key..."

if [ ! -f /etc/ssh/ssh_host_ed25519_key.pub ]; then
    log "  Generating missing ed25519 host key..."
    ssh-keygen -A
fi
HOST_PUB=$(cat /etc/ssh/ssh_host_ed25519_key.pub)

# ---------- 4. API へ登録要求 ----------
log "[4/8] Calling enrollment API at $API ..."

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE" "$RESP_FILE" 2>/dev/null || true' EXIT
RESP_FILE=$(mktemp)

SELF_HOSTNAME=$(hostname)

# CATVPN固有ホスト名: MAC 末尾6 hexから生成 (例: feeldscope-1a2b3c)
# OSのhostname (feeldscope, takikawa-01 等) とは独立した CATVPN内アイデンティティ。
derive_catvpn_hostname() {
    local mac
    for ifname in eth0 wlan0; do
        if [ -f "/sys/class/net/$ifname/address" ]; then
            mac=$(cat "/sys/class/net/$ifname/address" 2>/dev/null | tr -d ':' | tr 'A-Z' 'a-z')
            if [ -n "$mac" ] && [ "$mac" != "000000000000" ]; then
                echo "feeldscope-${mac: -6}"
                return 0
            fi
        fi
    done
    echo "feeldscope-$(date +%s | sha256sum | cut -c1-6)"
}

if [ "$MODE" = "auto" ]; then
    # Step 1: 現在の hostname で /claim を試す (admin が事前にトークン発行している場合に一致)
    log "  Step 1/2: trying /claim with current hostname '$SELF_HOSTNAME'..."
    python3 -c "
import json
print(json.dumps({
    'hostname': '$SELF_HOSTNAME',
    'wg_pubkey': '$WG_PUB',
    'host_pubkey': open('/etc/ssh/ssh_host_ed25519_key.pub').read().strip(),
}))
" > "$BODY_FILE"

    HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w "%{http_code}" -X POST "$API/claim" \
        -H "Content-Type: application/json" \
        --data-binary "@$BODY_FILE")

    if [ "$HTTP_CODE" = "200" ]; then
        log "  /claim succeeded with current hostname"
    else
        # Step 2: 自動生成 hostname で /self-enroll に fallback
        CATVPN_HOSTNAME=$(derive_catvpn_hostname)
        log "  /claim returned $HTTP_CODE. Falling back to /self-enroll as '$CATVPN_HOSTNAME'..."
        python3 -c "
import json
print(json.dumps({
    'fleet': 'feeldscope',
    'hostname': '$CATVPN_HOSTNAME',
    'wg_pubkey': '$WG_PUB',
    'host_pubkey': open('/etc/ssh/ssh_host_ed25519_key.pub').read().strip(),
}))
" > "$BODY_FILE"

        HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w "%{http_code}" -X POST "$API/self-enroll" \
            -H "Content-Type: application/json" \
            --data-binary "@$BODY_FILE")

        if [ "$HTTP_CODE" != "200" ]; then
            log "  /self-enroll also failed (HTTP $HTTP_CODE). Skipping auto-enrollment."
            cat "$RESP_FILE" >&2
            echo >&2
            exit 0
        fi
        log "  /self-enroll succeeded"
    fi
else
    # token モード: 既存の /enroll を使用
    python3 -c "
import json
print(json.dumps({
    'wg_pubkey': '$WG_PUB',
    'host_pubkey': open('/etc/ssh/ssh_host_ed25519_key.pub').read().strip(),
}))
" > "$BODY_FILE"

    HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w "%{http_code}" -X POST "$API/enroll" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary "@$BODY_FILE")

    if [ "$HTTP_CODE" != "200" ]; then
        err "API returned HTTP $HTTP_CODE"
        cat "$RESP_FILE" >&2
        echo >&2
        exit 1
    fi
fi

# ---------- 5. レスポンス解析 ----------
log "[5/8] Parsing API response..."

eval "$(python3 -c "
import json, shlex
with open('$RESP_FILE') as f:
    d = json.load(f)
fields = ['assigned_ip', 'subnet_mask', 'hostname', 'fleet',
         'vps_wg_pubkey', 'vps_endpoint', 'dns_server',
         'user_ca_pub', 'host_cert', 'ssh_user', 'principal_name']
for k in fields:
    print(f'CATVPN_{k.upper()}={shlex.quote(str(d[k]))}')
")"

log "  Assigned IP:  $CATVPN_ASSIGNED_IP"
log "  Hostname:     $CATVPN_HOSTNAME"
log "  SSH user:     $CATVPN_SSH_USER (principal: $CATVPN_PRINCIPAL_NAME)"

# ---------- 6. WG 設定書き込み ----------
log "[6/8] Writing WireGuard config..."

cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
PrivateKey = $WG_PRIV
Address    = $CATVPN_ASSIGNED_IP/$CATVPN_SUBNET_MASK
# DNS= は意図的に未指定。/etc/hosts で *.wg を解決し、その他のDNSは
# LAN/公開DNSをそのまま使う (WG切断時に地図/NTPが連鎖死しないように)

[Peer]
# CATVPN hub
PublicKey           = $CATVPN_VPS_WG_PUBKEY
Endpoint            = $CATVPN_VPS_ENDPOINT
AllowedIPs          = 10.66.0.0/16
PersistentKeepalive = 25
EOF
chmod 600 /etc/wireguard/wg0.conf

# Static /etc/hosts entries for *.wg (DNS不要で .wg ホスト名を解決)
if ! grep -q 'CATVPN static names' /etc/hosts; then
    {
        echo ""
        echo "# CATVPN static names (no DNS dependency)"
        echo "10.66.0.1   vps.wg vps"
        echo "${CATVPN_ASSIGNED_IP}   ${CATVPN_HOSTNAME} $(hostname)"
    } >> /etc/hosts
fi

# chrony + fake-hwclock セットアップ (RTC無しPi用; WG切断時もNTP/時計が独立して動く)
if ! command -v chronyc &>/dev/null; then
    log "  Installing chrony + fake-hwclock..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chrony fake-hwclock || \
        log "  WARN: chrony/fake-hwclock install failed (continuing)"
fi
if [ -f /etc/chrony/chrony.conf ] && ! grep -q '133.243.238.163' /etc/chrony/chrony.conf; then
    cp /etc/chrony/chrony.conf /etc/chrony/chrony.conf.bak-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
    cat > /etc/chrony/chrony.conf <<'CHRONY_EOF'
# CATVPN-managed: IP-only NTP (no DNS dependency)
# NICT public NTP (Japan)
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
fi
systemctl disable --now ntp 2>/dev/null || true
systemctl enable --now chrony 2>/dev/null || true
systemctl enable fake-hwclock 2>/dev/null || true
[ -x /sbin/fake-hwclock ] && /sbin/fake-hwclock save 2>/dev/null || true

# ---------- 7. SSH CA 信頼設定 ----------
log "[7/8] Configuring sshd for CA authentication..."

echo "$CATVPN_USER_CA_PUB" > /etc/ssh/user_ca.pub
echo "$CATVPN_HOST_CERT" > /etc/ssh/ssh_host_ed25519_key-cert.pub
chmod 644 /etc/ssh/user_ca.pub /etc/ssh/ssh_host_ed25519_key-cert.pub
chown root:root /etc/ssh/user_ca.pub /etc/ssh/ssh_host_ed25519_key-cert.pub

install -d -m 755 /etc/ssh/auth_principals
echo "$CATVPN_PRINCIPAL_NAME" > "/etc/ssh/auth_principals/$CATVPN_SSH_USER"
chmod 644 "/etc/ssh/auth_principals/$CATVPN_SSH_USER"

# CATVPN identity を記録 (GUIで表示するため)
install -d -m 755 /etc/catvpn
cat > /etc/catvpn/identity <<EOF
hostname=$CATVPN_HOSTNAME
fleet=$CATVPN_FLEET
assigned_ip=$CATVPN_ASSIGNED_IP
ssh_user=$CATVPN_SSH_USER
enrolled_at=$(date -Iseconds)
EOF
chmod 644 /etc/catvpn/identity

# sshd_config 冪等追記
if grep -qE "^[[:space:]]*(TrustedUserCAKeys|HostCertificate|AuthorizedPrincipalsFile)[[:space:]]" /etc/ssh/sshd_config; then
    log "  sshd_config already has CA directives, skipping"
else
    cat >> /etc/ssh/sshd_config <<EOF

# CATVPN
TrustedUserCAKeys /etc/ssh/user_ca.pub
AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u
HostCertificate /etc/ssh/ssh_host_ed25519_key-cert.pub
EOF
fi

if ! sshd -t; then
    err "sshd config syntax check failed!"
    exit 1
fi

# ---------- 8. サービス起動 ----------
log "[8/8] Starting WireGuard and reloading sshd..."

systemctl enable --now wg-quick@wg0
systemctl reload ssh || systemctl reload sshd || true

# ---------- 完了 ----------
log ""
log "=== Enrollment complete ==="
log "Hostname:      $CATVPN_HOSTNAME"
log "Assigned IP:   $CATVPN_ASSIGNED_IP"
log "SSH user:      $CATVPN_SSH_USER"
log ""
log "Verify from operator PC:"
log "  ssh $CATVPN_SSH_USER@$CATVPN_HOSTNAME"
log ""

# WG ハンドシェイクの確認（タイムアウト10秒）
log "Waiting for WG handshake (up to 15s)..."
for i in $(seq 1 15); do
    if wg show wg0 latest-handshakes 2>/dev/null | awk '{print $2}' | grep -qE '^[1-9]'; then
        log "  Handshake OK."
        break
    fi
    sleep 1
done

# ping hub
if ping -c 2 -W 2 "$CATVPN_DNS_SERVER" >/dev/null 2>&1; then
    log "  Ping to hub ($CATVPN_DNS_SERVER) OK."
else
    log "  WARNING: ping to hub failed (may take a moment to converge)"
fi

log "Done."
