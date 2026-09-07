# 旧世代の資料（アーカイブ）

FEELDSCOPE を FEELDSCOPE-OGN と FEELDSCOPE-SKYLENS の2本に整理した際、
旧世代のフォルダにしか無かった資料をここへ移しました。**現行コードとは対応しません**。
当時の設計判断や調査結果を追うための記録として残しています。

## 出どころ

| 元 | 内容 |
|---|---|
| 旧 FEELDSCOPE（GitHub: hezoe/FEELDSCOPE、現在はアーカイブ） | 仕様書、OGN受信機の調査記録、オフライン地図の手順 |
| FLARM FS Monitor モックアップ | `mockup/` の HTML 3案 |

## 中身

- `FEELDSCOPE_Specification.md` … 初期の全体仕様
- `OGN_MQTT_API_Specification.md` … OGN から MQTT へ流すデータの取り決め
- `OGN_Receiver_Setup_Japan.md` … 日本での OGN 受信機セットアップ手順（初期版）
- `OGN_BinaryPatch_Success.md` … 922.4MHz 受信を通すためのバイナリパッチの記録
- `受信デコードMQTT.md` … 受信からデコードまでの流れのメモ
- `Changelog` … 旧世代の変更履歴
- `DISTRIBUTION_PLAN.md` … 配布方法の検討メモ
- `offline-tiles-setup.md` と `tools/download_tiles.py` … オフライン地図タイルの用意
- `mockup/` … 画面デザインの初期案（index-rev1〜3）

現行の手順は [setup-guide.html](../../setup-guide.html) と Web UI のマニュアルを参照してください。
