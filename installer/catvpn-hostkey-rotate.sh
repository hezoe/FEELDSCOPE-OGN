#!/bin/bash
# =============================================================================
# CATVPN host key individualization — 既加入端末のホスト鍵個体化（2026-11-09）
#
# 出荷イメージ由来の「全端末共通 SSH ホスト鍵」を端末固有の鍵に作り直し、
# ハブの登録(TOFU 照合用 host_pubkey)を VPN トンネル越しの /rekey-host で更新する。
# トンネル越しの申請 = 現在の WG 秘密鍵の所持証明(WireGuard の暗号鍵ルーティングに
# より送信元 IP は偽装できない)なので、管理者の承認なしで「本人の鍵だけ」を安全に
# 差し替えられる。以後、この鍵がこの端末の本人確認になる。
#
# - 一度成功したら印(/etc/catvpn/hostkey-individualized)を置いて二度と動かない
# - 未加入(wg0.conf 無し)なら何もしない(新規加入は catvpn-enroll が個体化する)
# - OverlayFS(固定化)が働いている間は何もしない(鍵が再起動で消えてハブ記録とずれる)
# - 失敗したら何も変えない(次回の feeldscope-update/converge で再試行)
#
# feeldscope-converge.sh から実行される。単体実行も可: sudo catvpn-hostkey-rotate
# =============================================================================
set -u

MARKER=/etc/catvpn/hostkey-individualized
HUB=http://10.66.0.1:18080
log() { echo "[catvpn-hostkey-rotate] $*"; }

[ "$(id -u)" -eq 0 ] || { echo "root で実行してください（sudo）" >&2; exit 1; }
[ -f "$MARKER" ] && exit 0
[ -f /etc/wireguard/wg0.conf ] || exit 0
if command -v overlayctl &>/dev/null && [ -e /overlay/robase/overlay ]; then
    log "固定化(OverlayFS)が有効のため見送ります(固定化を外した更新のときに行われます)"
    exit 0
fi

# 1) 新しい鍵を作る(まだ本番の場所には置かない)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "$tmp/key" || { log "鍵の生成に失敗しました"; exit 1; }

# 2) ハブへ VPN 経由で届け出て、新しい鍵の証明書をもらう
python3 -c "import json,sys; print(json.dumps({'new_host_pubkey': open(sys.argv[1]).read().strip()}))" \
    "$tmp/key.pub" > "$tmp/req.json"
HTTP_CODE=$(curl -sS -m 20 -o "$tmp/resp.json" -w "%{http_code}" -X POST "$HUB/rekey-host" \
    -H "Content-Type: application/json" --data-binary "@$tmp/req.json") || HTTP_CODE=000
if [ "$HTTP_CODE" != "200" ]; then
    log "ハブへの届け出に失敗しました(HTTP $HTTP_CODE)。何も変更しません(次回の更新で再試行)"
    cat "$tmp/resp.json" >&2 2>/dev/null || true
    exit 1
fi
CERT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['host_cert'])" "$tmp/resp.json") \
    || { log "応答の解析に失敗しました"; exit 1; }

# 3) 鍵と証明書を入れ替える(sshd -t で検証し、失敗したら元に戻す)
bdir=$(mktemp -d /etc/ssh/hostkey-backup.XXXXXX) || { log "バックアップ作成に失敗"; exit 1; }
cp -a /etc/ssh/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key.pub "$bdir"/ 2>/dev/null || true
cp -a /etc/ssh/ssh_host_ed25519_key-cert.pub "$bdir"/ 2>/dev/null || true
install -m 600 "$tmp/key"     /etc/ssh/ssh_host_ed25519_key
install -m 644 "$tmp/key.pub" /etc/ssh/ssh_host_ed25519_key.pub
printf '%s\n' "$CERT" > /etc/ssh/ssh_host_ed25519_key-cert.pub
chmod 644 /etc/ssh/ssh_host_ed25519_key-cert.pub
if ! sshd -t; then
    cp -a "$bdir"/. /etc/ssh/ 2>/dev/null || true
    rm -rf "$bdir"
    log "sshd の検証に失敗したため元に戻しました(ハブ記録は新しい鍵です。次回の更新で再試行)"
    exit 1
fi
rm -rf "$bdir"
install -d -m 755 /etc/catvpn
date -Iseconds > "$MARKER"
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
log "SSH ホスト鍵を端末固有の鍵に個体化し、ハブの登録を更新しました"
exit 0
