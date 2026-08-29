#!/bin/bash
# =============================================================================
# FEELDSCOPE: wpa_supplicant.conf の重複 network ブロック除去 (idempotent)
#
# 【背景】
# OGN 公式イメージの設定マネージャ /root/OGN-receiver-config-manager は、
# /boot/OGN-receiver.conf に wifiPassword が設定されていると、
# rtlsdr-ogn の起動のたびに wpa_supplicant.conf へ *追記* する:
#
#     cat >> /etc/wpa_supplicant/wpa_supplicant.conf <<EOWIFI
#     country=${wifiCountry}
#     network={ ssid="${wifiName}" psk="${wifiPassword}" }
#     EOWIFI
#
# rtlsdr-ogn は起動毎に GitHub からこのスクリプトを自己更新するため、
# スクリプト自体にパッチを当てても次回起動で元に戻る。よって
# 「追記されたものを後から畳む」方式で対処する。
# （実機では再起動 164 回で network ブロックが 166 個まで増殖していた）
#
# 【この処理】
#  - 同一 SSID の network={} ブロックは最後の 1 個だけ残す（psk 更新を優先）
#  - 重複した country= 行を先頭の 1 個に正規化
#  - ヘッダ (ctrl_interface / update_config) が無ければ補う
#  - 変更が無ければ書き込まない（無用な wpa_cli reconfigure を避ける）
#
# Called by: feeldscope-install.sh / feeldscope-update.sh / feeldscope-wpa-dedupe.service
# Best-effort: 常に exit 0（呼び出し元を止めない）
# =============================================================================
CONF=/etc/wpa_supplicant/wpa_supplicant.conf

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
wlog()  { echo -e "${GREEN}[WPA-DEDUPE]${NC} $1"; }
wwarn() { echo -e "${YELLOW}[WPA-DEDUPE]${NC} $1"; }

[ -f "$CONF" ] || { wlog "$CONF が無いのでスキップ"; exit 0; }

BEFORE=$(grep -c '^[[:space:]]*network={' "$CONF" 2>/dev/null || echo 0)
if [ "$BEFORE" -le 1 ]; then
    wlog "network ブロックは ${BEFORE} 個。重複なし"
    exit 0
fi

TMP=$(mktemp /tmp/wpa-dedupe.XXXXXX) || exit 0
trap 'rm -f "$TMP" "$TMP.py"' EXIT

cat > "$TMP.py" <<'PYEOF'
import re, sys

path = sys.argv[1]
with open(path, encoding="utf-8", errors="replace") as f:
    src = f.read()

# network={ ... } ブロックを抽出（ネストしない前提。wpa_supplicant の書式に合致）
block_re = re.compile(r'^[ \t]*network=\{.*?^[ \t]*\}[ \t]*$', re.M | re.S)
blocks = block_re.findall(src)
rest = block_re.sub('', src)

# SSID をキーに最後の 1 個だけ残す（後勝ち = 新しい認証情報を優先）
uniq = {}
for i, b in enumerate(blocks):
    m = re.search(r'ssid\s*=\s*"([^"]*)"', b)
    key = m.group(1) if m else f'__nossid_{i}__'
    uniq[key] = b.strip()

# country= は最初に見つかったものを 1 行だけ採用
country = None
for line in rest.splitlines():
    m = re.match(r'\s*country\s*=\s*(\S+)', line)
    if m:
        country = m.group(1)
        break

# ヘッダの既存値を尊重しつつ、無ければ既定値を補う
ctrl = 'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev'
m = re.search(r'^\s*(ctrl_interface=.*)$', rest, re.M)
if m:
    ctrl = m.group(1).strip()
update_config = '1'
m = re.search(r'^\s*update_config\s*=\s*(\S+)', rest, re.M)
if m:
    update_config = m.group(1)

out = [ctrl, f'update_config={update_config}', '']
if country:
    out.append(f'country={country}')
    out.append('')
for b in uniq.values():
    out.append(b)
    out.append('')

result = '\n'.join(out).rstrip('\n') + '\n'
sys.stdout.write(result)
PYEOF

if ! python3 "$TMP.py" "$CONF" > "$TMP" 2>/dev/null; then
    wwarn "整形に失敗したため変更しません"
    exit 0
fi

# 安全弁: 結果が空、あるいは network ブロックが 1 個も無いなら書き込まない
AFTER=$(grep -c '^[[:space:]]*network={' "$TMP" 2>/dev/null || echo 0)
if [ ! -s "$TMP" ] || [ "$AFTER" -lt 1 ]; then
    wwarn "整形結果が不正（network ${AFTER} 個）。変更しません"
    exit 0
fi

if cmp -s "$TMP" "$CONF"; then
    wlog "既に正規化済み（network ${BEFORE} 個）"
    exit 0
fi

# 初回のみ元ファイルを保全
if [ ! -f "${CONF}.orig" ]; then
    cp -p "$CONF" "${CONF}.orig" 2>/dev/null || true
fi

install -m 600 -o root -g root "$TMP" "$CONF" 2>/dev/null || {
    wwarn "書き込みに失敗しました"
    exit 0
}
wlog "重複を除去: network ブロック ${BEFORE} → ${AFTER} 個"

# 反映（失敗しても無視。次回起動で効く）
wpa_cli -i wlan0 reconfigure >/dev/null 2>&1 || true

exit 0
