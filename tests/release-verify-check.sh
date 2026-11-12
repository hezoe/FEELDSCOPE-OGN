#!/bin/bash
# feeldscope-release.sh の検証ロジックの試験(R-076)。仮のリポジトリと仮の鍵だけで動き、
# 実リポジトリ・/etc には触れない。署名には git の SSH 署名を使う(git 2.34 以降が必要)。
#   bash tests/release-verify-check.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail(){ echo "NG: $*" >&2; exit 1; }
ok(){ echo "ok: $*"; }

# 鍵: 正規(k1)と攻撃者(k2)
ssh-keygen -q -t ed25519 -N '' -f "$T/k1"; ssh-keygen -q -t ed25519 -N '' -f "$T/k2"
printf 'release@test namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$T/k1.pub")" > "$T/signers"
G=(git -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c tag.gpgsign=false -c gpg.format=ssh)
SIGN1=(-c gpg.format=ssh -c user.signingkey="$T/k1.pub")
SIGN2=(-c gpg.format=ssh -c user.signingkey="$T/k2.pub")

# 上流(GitHub 役)
mkdir -p "$T/up/webapp" "$T/up/config"; cd "$T/up"; "${G[@]}" init -q -b master
cp "$HERE/feeldscope-release.sh" .; cp "$T/signers" config/allowed_signers
echo '{"version": "1.4.45"}' > webapp/package.json; "${G[@]}" add -A; "${G[@]}" commit -qm v1.4.45
"${G[@]}" "${SIGN1[@]}" tag -s v1.4.45 -m v1.4.45
echo '{"version": "1.4.46"}' > webapp/package.json; "${G[@]}" commit -qam v1.4.46
"${G[@]}" "${SIGN1[@]}" tag -s v1.4.46 -m v1.4.46
echo '{"version": "1.4.47"}' > webapp/package.json; "${G[@]}" commit -qam "evil 1.4.47"
"${G[@]}" tag -a -m unsigned v1.4.47                          # 未署名
echo '{"version": "1.4.48"}' > webapp/package.json; "${G[@]}" commit -qam "evil 1.4.48"
"${G[@]}" "${SIGN2[@]}" tag -s v1.4.48 -m v1.4.48               # 攻撃者の鍵

# 受信機役
"${G[@]}" clone -q "$T/up" "$T/unit"; cd "$T/unit"; "${G[@]}" checkout -q --detach v1.4.45
export FS_REPO_DIR="$T/unit" FS_GIT_USER="$(id -un)" FS_ALLOWED_SIGNERS="$T/etc/allowed_signers" FS_PIN_FILE="$T/pin"
L="$T/unit/feeldscope-release.sh"

bash "$L" sync-signers >/dev/null 2>&1 && cmp -s "$T/etc/allowed_signers" "$T/signers" && ok "初回の鍵配置(TOFU)" || fail "TOFU"
[ "$(bash "$L" verify v1.4.46 2>/dev/null)" = "release@test" ] && ok "正規の署名を受理" || fail "verify v1.4.46"
bash "$L" verify v1.4.47 >/dev/null 2>&1 && fail "未署名を受理した" || ok "未署名を拒否"
bash "$L" verify v1.4.48 >/dev/null 2>&1 && fail "鍵違いを受理した" || ok "鍵違いを拒否"
r=$(bash "$L" latest --fetch 2>/dev/null); [ "${r%% *}" = "v1.4.46" ] && ok "最新=署名の通った v1.4.46(1.4.47/1.4.48 は飛ばす)" || fail "latest=$r"

# 巻き戻し: 受信機が 1.4.46 のとき、1.4.45 しか署名が無ければ何も選ばない
"${G[@]}" checkout -q --detach v1.4.46; "${G[@]}" tag -d v1.4.46 >/dev/null
bash "$L" latest >/dev/null 2>&1 && fail "古い版へ巻き戻した" || ok "古い版への巻き戻しを拒否"
"${G[@]}" fetch -q --tags origin

# 固定: release-pin
echo v1.4.45 > "$T/pin"; r=$(bash "$L" latest 2>/dev/null); [ "${r%% *}" = "v1.4.45" ] && ok "release-pin で固定" || fail "pin=$r"
echo v1.4.48 > "$T/pin"; bash "$L" latest >/dev/null 2>&1 && fail "鍵違いの固定先を受理した" || ok "固定先も署名が必要"
rm -f "$T/pin"

# 改ざん: 上流で既存タグを差し替えても、受信機は手元の署名付きタグを保つ
cd "$T/up"; "${G[@]}" tag -d v1.4.46 >/dev/null; "${G[@]}" tag -a -m forged v1.4.46 HEAD
cd "$T/unit"; r=$(bash "$L" latest --fetch 2>/dev/null); [ "${r%% *}" = "v1.4.46" ] && bash "$L" verify v1.4.46 >/dev/null 2>&1 && ok "既存タグの差し替えを受け付けない" || fail "forge r=$r"

# 鍵の交換: 署名付きの版に新しい鍵を入れると受信機の鍵が更新される。master のままでは更新されない
cd "$T/up"; "${G[@]}" tag -d v1.4.46 >/dev/null; "${G[@]}" "${SIGN1[@]}" tag -s v1.4.46 -m v1.4.46 "v1.4.45^{}" >/dev/null 2>&1 || true
"${G[@]}" checkout -q master; printf 'new@test namespaces="git" %s\n' "$(cut -d' ' -f1,2 "$T/k2.pub")" >> config/allowed_signers
echo '{"version": "1.4.49"}' > webapp/package.json; "${G[@]}" commit -qam "rotate 1.4.49"
cd "$T/unit"; "${G[@]}" fetch -q origin master; "${G[@]}" checkout -q --detach origin/master
bash "$L" sync-signers >/dev/null 2>&1 || true; [ "$(wc -l < "$T/etc/allowed_signers")" = 1 ] && ok "master のままでは鍵を差し替えない" || fail "rotate via master"
cd "$T/up"; "${G[@]}" "${SIGN1[@]}" tag -s v1.4.49 -m v1.4.49
cd "$T/unit"; r=$(bash "$L" latest --fetch 2>/dev/null); "${G[@]}" checkout -q --detach "${r%% *}"
bash "$L" sync-signers >/dev/null 2>&1 || true; [ "$(wc -l < "$T/etc/allowed_signers")" = 2 ] && ok "署名付きの版 ${r%% *} を通して鍵を追加" || fail "rotate via signed"
[ "$(bash "$L" verify v1.4.48 2>/dev/null)" = "new@test" ] && ok "追加した鍵で署名された版を受理" || fail "new key verify"
echo "全て合格"
