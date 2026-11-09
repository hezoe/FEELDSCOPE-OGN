#!/bin/bash
# =============================================================================
# CATVPN identity self-check — SD クローン事故の自己修復（2026-11-09 ITAKURA1 事件対策）
#
# 登録時に /etc/catvpn/identity へ記録した CATVPN 名(feeldscope-<eth0 MAC 末尾6桁>)と、
# いま動いているハードウェアの MAC 由来の名前を照合する。不一致 = この SD は別の
# ハードウェアで作られたもの(クローン)。そのまま接続すると元の端末の鍵・IP を名乗って
# 元の端末を締め出すため、WG 設定と鍵を破棄し、この端末自身の名前で登録し直す。
#
# - 判定は MAC(変更不能の識別子)だけ。端末名(OS の hostname・OGN 受信機名)を
#   変えても発動しない。
# - MAC 由来でない名前(takikawa-01 等のトークン加入)は判定できないので何もしない。
# - MAC が読めない異常時も何もしない(壊さない方に倒す)。
# - OverlayFS(固定化)が働いている間は、修復しても再起動で消えて毎回鍵が変わり
#   申請が暴走するため、修復せず設定画面に警告だけ出す。
#
# 起動時(wg-quick@wg0 の前)に systemd から、また feeldscope-converge からも実行される。
# 何度実行しても安全(冪等)。正常な端末では何もしない。
# =============================================================================
set -u

IDENTITY=/etc/catvpn/identity
STATUS_DIR=/var/lib/catvpn-client
HOSTKEY_MARKER=/etc/catvpn/hostkey-individualized
log() { echo "[catvpn-identity-check] $*"; }

[ "$(id -u)" -eq 0 ] || { echo "root で実行してください（sudo）" >&2; exit 1; }

# 登録が無ければ何もしない(未加入の端末は catvpn-enroll が自分の名前で申請する)
[ -f /etc/wireguard/wg0.conf ] || exit 0
[ -f "$IDENTITY" ] || exit 0

recorded=$(sed -n 's/^hostname=//p' "$IDENTITY" | head -1)
short=${recorded%%.*}
case "$short" in
    feeldscope-*) suffix=${short#feeldscope-} ;;
    *) exit 0 ;;   # MAC 由来でない名前は判定対象外
esac
[[ "$suffix" =~ ^[0-9a-f]{6,12}$ ]] || exit 0

# いまのハードウェアの MAC と照合(登録時と同じく eth0 優先・wlan0 も許容)
match=0; found_mac=0
for ifname in eth0 wlan0; do
    f="/sys/class/net/$ifname/address"
    [ -f "$f" ] || continue
    mac=$(tr -d ':' < "$f" | tr 'A-Z' 'a-z')
    { [ -n "$mac" ] && [ "$mac" != "000000000000" ]; } || continue
    found_mac=1
    [ "${mac: -6}" = "$suffix" ] && match=1
done
[ "$found_mac" -eq 1 ] || exit 0   # MAC が読めない異常時は何もしない
[ "$match" -eq 1 ] && exit 0       # 一致 = 本来のハードウェア(正常)

log "MISMATCH: 登録名は $short ですが、この端末の MAC と一致しません。"
log "この SD カードは別の端末からのクローンとみられます。"

# 固定化(OverlayFS)が働いている間は修復しない(書いても再起動で消えるため)
if command -v overlayctl &>/dev/null && [ -e /overlay/robase/overlay ]; then
    log "固定化(OverlayFS)が有効のため自動修復は見送り、警告だけ記録します。"
    install -d -m 755 "$STATUS_DIR"
    {
        echo "state=error"
        echo "hostname=$recorded"
        echo "message=SDクローンを検出しました(このSDは別の端末で登録されたものです)。固定化(OverlayFS)を外して再起動すると、この端末として自動で登録し直します。"
        echo "requested_at="
        echo "first_pending_at="
        echo "checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$STATUS_DIR/enroll-status"
    exit 0
fi

log "自己修復: クローン元の VPN 設定・鍵を破棄し、この端末として登録し直します..."

# 1) クローン元の WG 接続・鍵・identity を破棄(元の端末を名乗らない)
systemctl disable --now wg-quick@wg0 2>/dev/null || true
rm -f /etc/wireguard/wg0.conf /etc/wireguard/private.key /etc/wireguard/public.key
rm -f "$IDENTITY"
rm -f "$STATUS_DIR/enroll-status"

# 2) クローン元の SSH ホスト鍵も引き継がない(鍵=本人確認。同じ鍵のままだと見分けられない)。
#    sshd -t で検証し、失敗したら元に戻す(登録自体は続ける)。
bdir=$(mktemp -d /etc/ssh/hostkey-backup.XXXXXX) || bdir=""
if [ -n "$bdir" ]; then
    cp -a /etc/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key.pub "$bdir"/ 2>/dev/null || true
    cp -a /etc/ssh/ssh_host_ed25519_key-cert.pub "$bdir"/ 2>/dev/null || true
    rm -f /etc/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key.pub \
          /etc/ssh/ssh_host_ed25519_key-cert.pub
    if ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key && sshd -t; then
        rm -rf "$bdir"
        install -d -m 755 /etc/catvpn
        date -Iseconds > "$HOSTKEY_MARKER"
        systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
        log "SSH ホスト鍵をこの端末固有の鍵に作り直しました。"
    else
        cp -a "$bdir"/. /etc/ssh/ 2>/dev/null || true
        rm -rf "$bdir"
        log "WARN: ホスト鍵の作り直しに失敗したため、元の鍵のまま続けます。"
    fi
fi

# 3) /etc/hosts のクローン元の静的エントリを消す(再登録時に正しい値で追記される)
sed -i '/# CATVPN static names/,+2d' /etc/hosts 2>/dev/null || true

# 4) この端末自身として登録を申請(承認制)。ネット不通でも enroll 側が再試行タイマーを仕込む
if [ -x /usr/local/bin/catvpn-enroll ]; then
    /usr/local/bin/catvpn-enroll --auto || true
    log "この端末としての登録申請を出しました(管理者の承認が必要です)。"
else
    log "WARN: /usr/local/bin/catvpn-enroll が見つかりません。登録申請は出せませんでした。"
fi
exit 0
