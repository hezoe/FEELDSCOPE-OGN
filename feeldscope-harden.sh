#!/bin/bash
# =============================================================================
# FEELDSCOPE device hardening (idempotent)
# Called by feeldscope-install.sh (fresh install) and feeldscope-update.sh (GitHub upgrade).
# Best-effort: never aborts the caller (always exits 0).
#
#  - ufw : default deny incoming / allow outgoing, allow 22(SSH) / 80(webapp) / 9001(MQTT WS)
#          -> LAN からの MQTT native(1883) と OGN 内部ポート(50010/50013/8082/8083) を遮断。
#          9001 はブラウザ地図が ws://<device>:9001 に直結するため必ず開ける。
#  - sshd: PermitRootLogin no / X11Forwarding no を常に適用。
#          PasswordAuthentication no は「pi に SSH 公開鍵が既にある時だけ」適用する
#          （鍵未設定の新規機で無効化するとロックアウトするため、その場合は据え置き）。
# =============================================================================
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
hlog()  { echo -e "${GREEN}[HARDEN]${NC} $1"; }
hwarn() { echo -e "${YELLOW}[HARDEN]${NC} $1"; }

# ---- ufw (host firewall) ----
if ! command -v ufw >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y ufw >/dev/null 2>&1 || hwarn "ufw install failed (skipped)"
fi
if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp    >/dev/null 2>&1   # SSH
    ufw allow 80/tcp    >/dev/null 2>&1   # webapp
    ufw allow 9001/tcp  >/dev/null 2>&1   # MQTT over WebSocket (browser map connects directly)
    ufw default deny incoming  >/dev/null 2>&1
    ufw default allow outgoing >/dev/null 2>&1
    if ufw status 2>/dev/null | grep -q "Status: active"; then
        hlog "ufw already active (rules ensured: 22/80/9001)"
    elif ufw --force enable >/dev/null 2>&1; then
        hlog "ufw enabled (allow 22/80/9001, deny other incoming)"
    else
        hwarn "ufw enable failed (skipped)"
    fi

    # ---- CVE-2026-98432 緩和: IP オプション付き IPv4 パケットを入口で落とす ----
    # カーネル TCP スタックの use-after-free(kernel 4.4+。機体の bullseye には修正
    # カーネルの配布が無いため apt では直せない)。この攻撃は「IP オプション付きの
    # IPv4 パケット」が引き金の必須条件なので、それを落とせば経路を断てる。正規の
    # 通信は IP オプションを使わないため影響しない(IHL>5 = ヘッダにオプションあり)。
    # 根本対策は OS 世代更新(R-078)で、本ルールはそれまでの緩和。
    BR=/etc/ufw/before.rules
    CVE_TAG="FEELDSCOPE CVE-2026-98432"
    CVE_RULE='-A ufw-before-input -m u32 --u32 "0>>24&0x0F=6:15" -j DROP'
    if [ -f "$BR" ] && ! grep -qF "$CVE_TAG" "$BR"; then
        # before.rules は外部チェーンを参照するためファイル全体は --test できない。
        # 追加する u32 ルール単体を検証し、通った時だけ差し替える(壊れた規則で
        # ufw reload が全遮断/全開放になるのを防ぐ。xt_u32 が無い環境では skip)。
        if printf '*filter\n:ufw-before-input - [0:0]\n%s\nCOMMIT\n' "$CVE_RULE" \
             | iptables-restore --test >/dev/null 2>&1; then
            cp -a "$BR" "${BR}.feeldscope-bak"
            awk '
                { print }
                (!done && /^-A ufw-before-input -i lo -j ACCEPT/) {
                    print "";
                    print "# FEELDSCOPE CVE-2026-98432: drop IPv4 packets carrying IP options (IHL>5)";
                    print "-A ufw-before-input -m u32 --u32 \"0>>24&0x0F=6:15\" -j DROP";
                    done=1
                }
            ' "${BR}.feeldscope-bak" > "$BR"
            ufw reload >/dev/null 2>&1 || true
            hlog "before.rules: IP-options drop added (CVE-2026-98432 mitigation)"
        else
            hwarn "before.rules: u32 rule unsupported here (xt_u32 missing?); skipped"
        fi
    fi
fi

# ---- sshd hardening via drop-in (wins because Include is near the top) ----
DROPIN=/etc/ssh/sshd_config.d/60-feeldscope-hardening.conf
SSH_KEYS=/home/pi/.ssh/authorized_keys
if [ -d /etc/ssh/sshd_config.d ] && grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config 2>/dev/null; then
    # R-086 (2026-11-11): CATVPN 加入機は SSH CA(TrustedUserCAKeys)でログインするため
    # authorized_keys が無くても鍵ログイン手段がある。CA 信頼が設定済みなら
    # パスワード認証を切る(以前は authorized_keys がある時だけで、加入機に残っていた)。
    HAS_CA=0
    grep -rqsE '^\s*TrustedUserCAKeys\s+\S' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null && HAS_CA=1
    if [ -s "$SSH_KEYS" ] || [ "$HAS_CA" = 1 ]; then
        PW_LINE="PasswordAuthentication no"
        PW_NOTE="password auth OFF (pi has an SSH key or CA trust)"
    else
        PW_LINE="# PasswordAuthentication kept enabled: pi has no SSH key yet (avoid lockout)"
        PW_NOTE="password auth KEPT (no SSH key for pi yet)"
    fi
    cat > "$DROPIN" <<EOF
# FEELDSCOPE hardening - managed by feeldscope-harden.sh (do not edit by hand)
PermitRootLogin no
X11Forwarding no
$PW_LINE
EOF
    chmod 644 "$DROPIN"
    if sshd -t 2>/dev/null; then
        systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
        hlog "sshd hardened (root login no, X11 no; $PW_NOTE)"
    else
        hwarn "sshd config test failed; reverting drop-in"
        rm -f "$DROPIN"
    fi
else
    hwarn "sshd_config has no drop-in Include; sshd hardening skipped (manual review)"
fi

exit 0
