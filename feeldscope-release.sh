#!/bin/bash
# =============================================================================
# FEELDSCOPE リリース署名の検証(R-076)
#
# 受信機は GitHub の master をそのまま追わず、「署名を確かめられたリリースタグ」だけを
# 取り込む。GitHub のアカウントやリポジトリが乗っ取られて細工したコミットを push されても、
# 署名鍵(VPS の ~/.ssh/feeldscope_release_ed25519・GitHub には置かない)が無ければ
# 受信機は新しい版として受け付けない。
#
#   署名  : git tag -s vX.Y.Z(SSH 署名・ed25519)。/commit の手順で版ごとに打つ。
#   検証鍵: /etc/feeldscope/allowed_signers(ssh の allowed_signers 形式・複数行可)。
#           SD イメージに同梱。リポジトリの config/allowed_signers と違うときは、
#           「署名が通った版の中身」である場合だけ写す(=鍵の交換は署名付きの版を通してしか
#           できない)。無いときだけ初回限定でリポジトリから写す(trust on first use・ログに残す)。
#   選択  : v* タグを版の順に並べ、署名が通った最新を選ぶ。今の版より古い版は選ばない
#           (巻き戻し攻撃の防止)。/boot/feeldscope/release-pin にタグ名を書くとその版に固定
#           (署名は必要)。
#   検証  : 受信機の git(2.30)は SSH 署名を自分では確かめられないので、タグの中身から署名を
#           切り出して ssh-keygen -Y verify(OpenSSH 8.2 以降)で確かめる。git の SSH 署名は
#           「署名ブロックより前の全バイト」に namespace "git" で付く。
#
# 使い方(単体):
#   feeldscope-release.sh latest [--fetch]   署名が通った最新の版を "タグ 版 コミット" で出す(無ければ 1)
#   feeldscope-release.sh verify <タグ>      そのタグの署名を確かめる(署名者を出す)
#   feeldscope-release.sh current            今の checkout の版とタグ
#   feeldscope-release.sh sync-signers       検証鍵の初回配置/署名付きの版からの更新
# 使い方(source): 上の各動作が fs_release_* 関数として使える。
#
# 環境変数: FS_REPO_DIR(既定=このファイルの場所) FS_ALLOWED_SIGNERS FS_PIN_FILE
#           FS_GIT_USER(root で動くときに git を実行するユーザー・既定 pi)
# =============================================================================

FS_REPO_DIR="${FS_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
FS_ALLOWED_SIGNERS="${FS_ALLOWED_SIGNERS:-/etc/feeldscope/allowed_signers}"
FS_PIN_FILE="${FS_PIN_FILE:-/boot/feeldscope/release-pin}"
FS_GIT_USER="${FS_GIT_USER:-pi}"
FS_MAX_CANDIDATES="${FS_MAX_CANDIDATES:-20}"

fs_log() { echo "[release] $*" >&2; }

# リポジトリの所有者で git を動かす(root から呼ばれたときの dubious ownership 対策)
fs_git() {
    if [ "$(id -u)" -eq 0 ] && id -u "$FS_GIT_USER" >/dev/null 2>&1 && [ "$(stat -c %U "$FS_REPO_DIR" 2>/dev/null)" = "$FS_GIT_USER" ]; then
        sudo -n -u "$FS_GIT_USER" git -C "$FS_REPO_DIR" "$@"
    else
        git -C "$FS_REPO_DIR" "$@"
    fi
}

# タグの中身の webapp/package.json から版を読む
fs_tag_version() {
    fs_git show "$1:webapp/package.json" 2>/dev/null | grep -m1 '"version"' | sed -E 's/.*"version" *: *"([^"]+)".*/\1/'
}

# 今の checkout の版
fs_current_version() {
    grep -m1 '"version"' "$FS_REPO_DIR/webapp/package.json" 2>/dev/null | sed -E 's/.*"version" *: *"([^"]+)".*/\1/'
}

# a >= b (版の順)
fs_version_ge() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }

# タグの署名を確かめる。成功なら署名者(principal)を標準出力に出して 0。
fs_release_verify() {
    local tag="$1" raw sig payload principal tmpd
    [ -r "$FS_ALLOWED_SIGNERS" ] || { fs_log "検証鍵がありません: $FS_ALLOWED_SIGNERS"; return 1; }
    [ "$(fs_git cat-file -t "$tag" 2>/dev/null)" = "tag" ] || { fs_log "$tag は注釈付きタグではありません"; return 1; }
    tmpd=$(mktemp -d) || return 1
    # 署名ブロックより前が署名対象、ブロック自体が署名。ブロックが無ければ未署名。
    fs_git cat-file tag "$tag" > "$tmpd/raw" || { rm -rf "$tmpd"; return 1; }
    if ! grep -q '^-----BEGIN SSH SIGNATURE-----$' "$tmpd/raw"; then
        fs_log "$tag は署名されていません"; rm -rf "$tmpd"; return 1
    fi
    sed -n '/^-----BEGIN SSH SIGNATURE-----$/,/^-----END SSH SIGNATURE-----$/p' "$tmpd/raw" > "$tmpd/sig"
    sed '/^-----BEGIN SSH SIGNATURE-----$/,$d' "$tmpd/raw" > "$tmpd/payload"
    # 署名に合う鍵の持ち主を allowed_signers から探し、その名前で検証する
    principal=$(ssh-keygen -Y find-principals -s "$tmpd/sig" -f "$FS_ALLOWED_SIGNERS" 2>/dev/null | head -1)
    if [ -z "$principal" ]; then
        fs_log "$tag の署名鍵は検証鍵に載っていません"; rm -rf "$tmpd"; return 1
    fi
    if ssh-keygen -Y verify -f "$FS_ALLOWED_SIGNERS" -I "$principal" -n git -s "$tmpd/sig" < "$tmpd/payload" >/dev/null 2>&1; then
        rm -rf "$tmpd"; echo "$principal"; return 0
    fi
    fs_log "$tag の署名が合いません"; rm -rf "$tmpd"; return 1
}

# 署名が通った最新の版を選ぶ。出力: "タグ 版 コミット"。--fetch で先に origin のタグを取る。
# 今の版より古い版は選ばない。release-pin があればその版(署名必須)。
fs_release_latest() {
    local do_fetch=0 tag ver cur pin commit n=0
    [ "${1:-}" = "--fetch" ] && do_fetch=1
    if [ $do_fetch = 1 ]; then
        # --force は付けない: 既にあるタグを別の中身に差し替えられても受け付けない
        fs_git fetch --quiet --tags origin 2>/dev/null || fs_log "origin からタグを全部は取れませんでした(ネットワーク、または既にあるタグの差し替え=受け付けない)。手元にあるタグで続けます"
    fi
    cur=$(fs_current_version)
    if [ -r "$FS_PIN_FILE" ]; then
        pin=$(tr -d ' \r\n' < "$FS_PIN_FILE")
        if [ -n "$pin" ]; then
            fs_log "release-pin により $pin に固定"
            if fs_release_verify "$pin" >/dev/null; then
                commit=$(fs_git rev-parse "$pin^{commit}" 2>/dev/null) || return 1
                echo "$pin $(fs_tag_version "$pin") $commit"; return 0
            fi
            fs_log "固定先 $pin の署名を確かめられないので更新しません"; return 1
        fi
    fi
    for tag in $(fs_git tag -l 'v[0-9]*' | sort -V -r); do
        n=$((n+1)); [ $n -gt "$FS_MAX_CANDIDATES" ] && break
        ver=$(fs_tag_version "$tag")
        [ -n "$ver" ] || continue
        if [ -n "$cur" ] && ! fs_version_ge "$ver" "$cur"; then
            fs_log "$tag($ver) は今の版($cur)より古いので選びません"; break
        fi
        if fs_release_verify "$tag" >/dev/null; then
            commit=$(fs_git rev-parse "$tag^{commit}" 2>/dev/null) || continue
            echo "$tag $ver $commit"; return 0
        fi
    done
    fs_log "署名を確かめられる版がありません"
    return 1
}

# 検証鍵の配置。無ければリポジトリから初回限定で写す(trust on first use)。
# あるときは、今の checkout が署名の通ったタグそのものである場合だけリポジトリの鍵で更新する。
fs_release_sync_signers() {
    local src="$FS_REPO_DIR/config/allowed_signers" head tag
    [ -s "$src" ] || { fs_log "リポジトリに config/allowed_signers がありません"; return 1; }
    if [ ! -s "$FS_ALLOWED_SIGNERS" ]; then
        install -d -m 755 "$(dirname "$FS_ALLOWED_SIGNERS")" && install -m 644 "$src" "$FS_ALLOWED_SIGNERS" || return 1
        fs_log "検証鍵を初回配置しました(trust on first use): $FS_ALLOWED_SIGNERS ← $src"
        return 0
    fi
    cmp -s "$src" "$FS_ALLOWED_SIGNERS" && return 0
    head=$(fs_git rev-parse HEAD 2>/dev/null) || return 1
    for tag in $(fs_git tag --points-at "$head" -l 'v[0-9]*' 2>/dev/null); do
        if fs_release_verify "$tag" >/dev/null; then
            install -m 644 "$src" "$FS_ALLOWED_SIGNERS" && fs_log "検証鍵を署名付きの版 $tag の内容に更新しました"
            return $?
        fi
    done
    fs_log "検証鍵がリポジトリと違いますが、今の checkout は署名付きの版ではないので更新しません"
    return 1
}

# 今の checkout の版とタグ
fs_release_current() {
    local head
    head=$(fs_git rev-parse HEAD 2>/dev/null) || return 1
    echo "$(fs_current_version) $(fs_git tag --points-at "$head" -l 'v[0-9]*' 2>/dev/null | sort -V | tail -1) $head"
}

# 単体実行
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1:-}" in
        latest)       fs_release_latest "${2:-}" ;;
        verify)       [ -n "${2:-}" ] || { echo "usage: $0 verify <tag>" >&2; exit 2; }; fs_release_verify "$2" ;;
        current)      fs_release_current ;;
        sync-signers) fs_release_sync_signers ;;
        *) sed -n '2,30p' "$0" >&2; exit 2 ;;
    esac
fi
