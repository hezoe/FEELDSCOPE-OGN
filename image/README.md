# FEELDSCOPE 専用イメージ

OGN 公式イメージ（[seb-ogn-rpi-image](http://download.glidernet.org/seb-ogn-rpi-image/)、2022-04-29 版・Raspbian 11）を加工した、
「書き込んで設定ファイルを1つ書けば FEELDSCOPE が入る」SD カードイメージ。

## 利用者の手順

1. イメージ（`feeldscope-ogn-YYYYMMDD.img.xz`）を Raspberry Pi Imager などで SD カードに書き込む
   （Imager の「OS をカスタマイズ」は使わない。設定は次の `OGN-receiver.conf` で行う）
2. パソコンで SD カードの `OGN-receiver.conf` を開き、受信機名・緯度・経度・SSH パスワード（英字と数字だけ）・
   Wi-Fi（使う場合）を書いて保存
3. Raspberry Pi に SD カード・SDR ドングル（アンテナ付き）・LAN を挿して電源を入れる
4. 30〜40分待つ（途中で自動的に再起動する）。ブラウザで `http://ogn-receiver.local/` を開くと進み具合が見え、
   完了すると同じアドレスで FEELDSCOPE が開く（管理者の初期パスワード `admin`）

## イメージに加えている変更（`build-image.sh`）

| 変更 | 理由 |
|---|---|
| OverlayFS を無効化（`/overlay/disable` を作る。起動設定 `cmdline.txt` は変えない） | 有効のままだと再起動でインストールが消える。OGN 公式イメージの `overlayctl disable` もこの印を作るだけで、起動時の `/sbin/init-overlay` と `overlayctl status` がこれを見る（初版は cmdline から init-overlay を外したため status が「enabled」のままになり、インストーラーの事前チェックで止まった） |
| キーボードを日本語配列（jp106）に。コンソールの作成済みキーマップも日本語配列で作り直す | 公式イメージは英国配列（gb）で、日本語キーボードの記号が別の文字になりパスワードを打ち間違える |
| タイムゾーンを Asia/Tokyo に | ログ・自動再起動の時刻を日本時間に |
| `/boot/OGN-receiver.conf` を日本語のひな形に、`/boot/FEELDSCOPE-README.txt` を追加 | パソコンで開いて書くだけにする |
| 初回起動の自動インストール（`firstboot/`）を組み込んで有効化 | SSH 作業をなくす |

FEELDSCOPE 本体はイメージに入れない。初回起動時に受信機が GitHub から**最新版**を取得してインストールするので、
アプリを更新するたびにイメージを作り直す必要はない（作り直すのは OGN 公式イメージが新しくなったとき）。

## 初回起動の流れ（`firstboot/feeldscope-firstboot.sh`）

1. `overlayctl status` を確かめ、OverlayFS が動作中なら無効にして再起動・次回起動で有効の設定なら `overlayctl disable`（印を作るだけ）
2. ルート領域を SD カードいっぱいまで広げて再起動（1回だけ）
3. インターネット接続を待つ（1時間で打ち切り）
4. OGN 受信ソフト（公式イメージの設定マネージャが毎起動ダウンロード）が置かれるのを待つ
5. `git clone https://github.com/hezoe/FEELDSCOPE-OGN /home/pi/FEELDSCOPE-OGN`（以後の更新は設定画面のアップデートで git pull）
6. `feeldscope-install.sh` を実行（失敗したら5分おいて最大3回。だめなら次回起動で続きから再開）
7. 完了したら自動インストールと状態ページを無効化

- 進み具合は `feeldscope-firstboot-status.py` がポート80で表示し、インストーラーが FEELDSCOPE 本体を起動する直前に止める。
- ログ: `/var/log/feeldscope-firstboot.log`。要所で SD カードの `/boot/feeldscope-firstboot.log` にも写す（パソコンで読める）。
- `pi` ユーザーのパスワードは、公式イメージの設定マネージャが**起動のたびに** `OGN-receiver.conf` の `piUserPassword` に設定し直す
  （空欄ならパスワードでのログインは無効）。

## イメージの作り方

```bash
sudo env PATH=/usr/sbin:/usr/bin:/sbin:/bin bash image/build-image.sh /home/debian/feeldscope-image-build
# 同じ日に作り直すときは IMAGE_TAG=20261001b のように名前を変える
```

- ベースの zip が作業ディレクトリに無ければ Google ドライブから取得し、SHA-256 を照合する（版が変わったら止まる）。
- ファイルの書き換えだけで作るので ARM のエミュレーションは使わない（数分）。
- 出力: `<作業ディレクトリ>/out/feeldscope-ogn-YYYYMMDD.img.xz` と `.sha256`

## 初回起動の検証（実機なし）

`feeldscope-firstboot.sh` はパス・コマンドを環境変数（`FB_*`）で差し替えられる。`reboot` `raspi-config` `systemctl` などを
記録だけするダミーに置き換え、偽のインストーラー（成功版・失敗版）のリポジトリを `FB_REPO_URL` に指定して、
領域拡張→再起動 / インストール成功→完了 / 失敗→エラー表示 / OverlayFS 動作中→無効化して再起動 / 次回起動で有効→印を作って続行 の各経路を確かめられる（`overlayctl` のダミーは `/overlay/disable` 相当の印で status を返す）。

## 実機での試験項目

- [ ] 書き込み直後の SD カードをパソコンに挿すと `OGN-receiver.conf` と `FEELDSCOPE-README.txt` が見える
- [ ] 電源投入後、`http://ogn-receiver.local/`（または IP）で進み具合が表示される
- [ ] 1回目の自動再起動のあと、ルート領域が SD カードいっぱいに広がっている（`df -h /`）
- [ ] 30〜40分で完了し、同じアドレスで FEELDSCOPE が開く・受信機名と座標が反映されている
- [ ] 受信機に直接つないだ日本語キーボードで記号（@ : * ( ) _ など）が正しく打てる
- [ ] `OGN-receiver.conf` のパスワードで SSH ログインできる
- [ ] 再起動しても FEELDSCOPE が残っている（OverlayFS 無効）
- [ ] 設定画面のアップデートが動く
