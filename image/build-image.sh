#!/bin/bash
# =============================================================================
# FEELDSCOPE 専用イメージの作成（OGN 公式イメージ seb-ogn-rpi-image を加工する）
#
#   sudo bash image/build-image.sh [作業ディレクトリ]      既定の作業ディレクトリ: /home/debian/feeldscope-image-build
#
# 作業ディレクトリの base/ に OGN 公式イメージの zip が無ければダウンロードする（Google ドライブ）。
# 出力: <作業ディレクトリ>/out/feeldscope-ogn-<日付>.img.xz と .sha256
#
# 加工の内容（ファイルの書き換えだけ。ARM のエミュレーションは使わない）:
#   - OverlayFS を無効化（/overlay/disable を作る。overlayctl disable と同じ。起動設定 cmdline.txt は変えない）
#   - キーボードを日本語配列（jp106）に。コンソールの作成済みキーマップも日本語配列で作り直す
#   - タイムゾーンを Asia/Tokyo に
#   - /boot/OGN-receiver.conf を日本語のひな形に、/boot/FEELDSCOPE-README.txt を追加
#   - 初回起動の自動インストール（feeldscope-firstboot）を組み込んで有効化
# FEELDSCOPE 本体は入れない。初回起動時に受信機が GitHub から最新版を取得してインストールする。
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WORK="${1:-/home/debian/feeldscope-image-build}"
BASE_ZIP_NAME="2022-04-29-rpi-lite-ognro-v0.3-stretch.img.zip"
BASE_ZIP_URL="https://drive.usercontent.google.com/download?id=1pncyWeEAkNTGjUBEetyMWp8FSkfy--Oe&export=download&confirm=t"
BASE_ZIP_SHA256="c962b250b2acce5d3779717d8a4f30a518254419d45f1d9f2980100964316c23"
STAMP="${IMAGE_TAG:-$(date +%Y%m%d)}"   # 同じ日に作り直すときは IMAGE_TAG=20261001b など
OUT_NAME="feeldscope-ogn-${STAMP}.img"

[ "$(id -u)" = 0 ] || { echo "root で実行してください（sudo bash $0）" >&2; exit 1; }
mkdir -p "$WORK/base" "$WORK/out" "$WORK/mnt/boot" "$WORK/mnt/root"

# ── ベースイメージ ─────────────────────────────────────────────
ZIP="$WORK/base/$BASE_ZIP_NAME"
if [ ! -f "$ZIP" ]; then
    echo "OGN 公式イメージをダウンロード: $BASE_ZIP_NAME"
    curl -fL --retry 3 -o "$ZIP.part" "$BASE_ZIP_URL"
    mv "$ZIP.part" "$ZIP"
fi
echo "$BASE_ZIP_SHA256  $ZIP" | sha256sum -c - || { echo "ベースイメージのハッシュが違う（版が変わった?）" >&2; exit 1; }
IMG="$WORK/out/$OUT_NAME"
rm -f "$IMG" "$IMG.xz"
python3 - "$ZIP" "$IMG" <<'PY'
import shutil, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
name = [n for n in z.namelist() if n.endswith(".img")][0]
with z.open(name) as src, open(sys.argv[2], "wb") as dst:
    shutil.copyfileobj(src, dst, 16 << 20)
PY

# ── マウント ───────────────────────────────────────────────────
LOOP="$(losetup -fP --show "$IMG")"
B="$WORK/mnt/boot"; R="$WORK/mnt/root"
cleanup() {
    sync
    mountpoint -q "$B" && umount "$B" || true
    mountpoint -q "$R" && umount "$R" || true
    losetup -d "$LOOP" 2>/dev/null || true
}
trap cleanup EXIT
mount "${LOOP}p1" "$B"
mount "${LOOP}p2" "$R"
grep -q 'ID=raspbian' "$R/etc/os-release" || { echo "Raspbian ではない?" >&2; exit 1; }
[ -f "$R/etc/init.d/rtlsdr-ogn" ] || { echo "OGN 公式イメージではない?" >&2; exit 1; }

# ── OverlayFS 無効化 ──────────────────────────────────────────
# OGN 公式イメージの overlayctl disable は /overlay/disable という印を作るだけ(起動時の /sbin/init-overlay が
# これを見て通常起動に切り替え、overlayctl status も「disabled for next boot」と表示する)。
# 2026-10-01 初版は cmdline.txt から init-overlay を外したため status が「enabled」のままになり、
# インストーラーの事前チェックで止まった。
grep -q 'init=/sbin/init-overlay' "$B/cmdline.txt" || { echo "cmdline.txt に init-overlay が無い(版が違う?)" >&2; exit 1; }
[ -d "$R/overlay" ] || { echo "/overlay が無い(版が違う?)" >&2; exit 1; }
echo 1 > "$R/overlay/disable"

# ── 日本語キーボード ───────────────────────────────────────────
sed -i -e 's/^XKBMODEL=.*/XKBMODEL="jp106"/' -e 's/^XKBLAYOUT=.*/XKBLAYOUT="jp"/' -e 's/^XKBVARIANT=.*/XKBVARIANT=""/' "$R/etc/default/keyboard"
# 起動時は作成済みキーマップ(cached_UTF-8_del.kmap.gz)が読まれるので、イメージ内の ckbcomp で日本語配列を作って置き換える
perl "$R/usr/bin/ckbcomp" -I"$R/usr/share/X11/xkb" -backspace del -model jp106 jp > "$WORK/jp.kmap"
grep -q '^keycode 26 = U+0040' "$WORK/jp.kmap" || { echo "日本語キーマップの生成に失敗" >&2; exit 1; }
gzip -9n < "$WORK/jp.kmap" > "$R/etc/console-setup/cached_UTF-8_del.kmap.gz"

# ── タイムゾーン ───────────────────────────────────────────────
echo "Asia/Tokyo" > "$R/etc/timezone"
ln -sf /usr/share/zoneinfo/Asia/Tokyo "$R/etc/localtime"

# ── /boot の設定ファイル ───────────────────────────────────────
cp "$HERE/boot/OGN-receiver.conf" "$B/OGN-receiver.conf"
cp "$HERE/boot/FEELDSCOPE-README.txt" "$B/FEELDSCOPE-README.txt"

# ── 初回起動の自動インストール ─────────────────────────────────
install -m 755 "$HERE/firstboot/feeldscope-firstboot.sh"        "$R/usr/local/sbin/feeldscope-firstboot.sh"
install -m 755 "$HERE/firstboot/feeldscope-firstboot-status.py" "$R/usr/local/sbin/feeldscope-firstboot-status.py"
install -m 644 "$HERE/firstboot/feeldscope-firstboot.service"        "$R/etc/systemd/system/feeldscope-firstboot.service"
install -m 644 "$HERE/firstboot/feeldscope-firstboot-status.service" "$R/etc/systemd/system/feeldscope-firstboot-status.service"
ln -sf /etc/systemd/system/feeldscope-firstboot.service        "$R/etc/systemd/system/multi-user.target.wants/feeldscope-firstboot.service"
ln -sf /etc/systemd/system/feeldscope-firstboot-status.service "$R/etc/systemd/system/multi-user.target.wants/feeldscope-firstboot-status.service"

# ── 版の記録 ───────────────────────────────────────────────────
cat > "$R/etc/feeldscope-image-release" <<EOF
FEELDSCOPE image ${STAMP}
base: ${BASE_ZIP_NAME} (sha256 ${BASE_ZIP_SHA256})
builder: $(git -C "$REPO" log -1 --format='%h %ad' --date=short 2>/dev/null || echo unknown)
EOF

echo "--- 確認 ---"
echo "cmdline: $(cat "$B/cmdline.txt")"
echo "overlay/disable: $(cat "$R/overlay/disable")"
grep XKB "$R/etc/default/keyboard" | head -2
echo "timezone: $(cat "$R/etc/timezone")"
ls -la "$R/etc/systemd/system/multi-user.target.wants/" | grep feeldscope
df -h "$R" | tail -1

cleanup
trap - EXIT

# ── 圧縮 ──────────────────────────────────────────────────────
echo "圧縮中（数分）..."
xz -T0 -6 "$IMG"
(cd "$WORK/out" && sha256sum "$OUT_NAME.xz" > "$OUT_NAME.xz.sha256")
ls -la "$WORK/out/$OUT_NAME.xz"
cat "$WORK/out/$OUT_NAME.xz.sha256"
