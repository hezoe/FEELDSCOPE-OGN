# オフライン地図タイルのダウンロードと配置手順

## 概要

FEELDSCOPEをインターネット接続のない環境で使用するために、国土地理院の地図タイルを事前にダウンロードし、サーバー（Raspberry Pi 5）上に配置する。

## 対象範囲

| 項目 | 値 |
|---|---|
| 中心座標 | 北緯 36.014168° / 東経 139.816818° |
| 範囲 | 50km × 50km（中心から各方向25km） |
| 緯度範囲 | 35.789° 〜 36.239° |
| 経度範囲 | 139.538° 〜 140.095° |
| ズームレベル | 11 〜 15 |

## 対象レイヤー

| レイヤーID | 名称 | 形式 | 用途 |
|---|---|---|---|
| `ort` | 航空写真 | JPEG | ベースマップ |
| `hillshademap` | 陰影起伏図 | PNG | 地形把握（航空写真に重ねて使用） |

## 推定データ量

| ズームレベル | タイル枚数（1レイヤー） | 2レイヤー合計 |
|---|---|---|
| 11 | 約16〜25枚 | 約30〜50枚 |
| 12 | 約49〜64枚 | 約100〜130枚 |
| 13 | 約170〜200枚 | 約340〜400枚 |
| 14 | 約680〜780枚 | 約1,360〜1,560枚 |
| 15 | 約2,600〜3,000枚 | 約5,200〜6,000枚 |
| **合計** | **約3,500〜4,000枚** | **約7,000〜8,000枚** |

合計データ量: **約100〜135MB**

## ディレクトリ構造

```
webapp/public/tiles/
├── ort/
│   ├── 11/
│   │   ├── {x}/
│   │   │   └── {y}.jpg
│   │   └── ...
│   ├── 12/
│   ├── 13/
│   ├── 14/
│   └── 15/
└── hillshademap/
    ├── 11/
    │   ├── {x}/
    │   │   └── {y}.png
    │   └── ...
    ├── 12/
    ├── 13/
    ├── 14/
    └── 15/
```

## 手順

### 1. ダウンロードスクリプトの実行

以下のPythonスクリプトを `tools/download_tiles.py` として保存し、実行する。

```bash
cd /path/to/FEELDSCOPE
python tools/download_tiles.py
```

スクリプトの内容:

```python
#!/usr/bin/env python3
"""国土地理院タイルダウンローダー"""

import os
import math
import time
import urllib.request

# === 設定 ===
CENTER_LAT = 36.014168
CENTER_LON = 139.816818
RANGE_KM = 25  # 中心から各方向の距離(km) → 50km四方
ZOOM_MIN = 11
ZOOM_MAX = 15
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "webapp", "public", "tiles")

LAYERS = [
    {"id": "ort",           "ext": "jpg"},
    {"id": "hillshademap",  "ext": "png"},
]

BASE_URL = "https://cyberjapandata.gsi.go.jp/xyz"
REQUEST_INTERVAL = 0.1  # サーバー負荷軽減のため100msの間隔を空ける


def deg2tile(lat_deg, lon_deg, zoom):
    """緯度経度からタイル座標を算出"""
    lat_rad = math.radians(lat_deg)
    n = 2 ** zoom
    x = int((lon_deg + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def get_tile_range(zoom):
    """指定ズームレベルでの対象タイル範囲を算出"""
    # 中心から25kmの緯度経度オフセット
    lat_offset = RANGE_KM / 111.0
    lon_offset = RANGE_KM / (111.0 * math.cos(math.radians(CENTER_LAT)))

    north = CENTER_LAT + lat_offset
    south = CENTER_LAT - lat_offset
    west = CENTER_LON - lon_offset
    east = CENTER_LON + lon_offset

    x_min, y_min = deg2tile(north, west, zoom)
    x_max, y_max = deg2tile(south, east, zoom)

    return x_min, x_max, y_min, y_max


def download_tiles():
    total = 0
    downloaded = 0
    skipped = 0
    errors = 0

    # タイル総数を事前計算
    for zoom in range(ZOOM_MIN, ZOOM_MAX + 1):
        x_min, x_max, y_min, y_max = get_tile_range(zoom)
        count = (x_max - x_min + 1) * (y_max - y_min + 1) * len(LAYERS)
        total += count

    print(f"ダウンロード対象: {total} タイル")
    print(f"出力先: {os.path.abspath(OUTPUT_DIR)}")
    print()

    done = 0
    for layer in LAYERS:
        layer_id = layer["id"]
        ext = layer["ext"]

        for zoom in range(ZOOM_MIN, ZOOM_MAX + 1):
            x_min, x_max, y_min, y_max = get_tile_range(zoom)

            for x in range(x_min, x_max + 1):
                dir_path = os.path.join(OUTPUT_DIR, layer_id, str(zoom), str(x))
                os.makedirs(dir_path, exist_ok=True)

                for y in range(y_min, y_max + 1):
                    done += 1
                    file_path = os.path.join(dir_path, f"{y}.{ext}")

                    # 既にダウンロード済みならスキップ
                    if os.path.exists(file_path):
                        skipped += 1
                        continue

                    url = f"{BASE_URL}/{layer_id}/{zoom}/{x}/{y}.{ext}"
                    try:
                        urllib.request.urlretrieve(url, file_path)
                        downloaded += 1
                        print(f"[{done}/{total}] {layer_id}/{zoom}/{x}/{y}.{ext}")
                    except Exception as e:
                        errors += 1
                        print(f"[{done}/{total}] エラー: {url} - {e}")

                    time.sleep(REQUEST_INTERVAL)

    print()
    print(f"完了: ダウンロード {downloaded}, スキップ {skipped}, エラー {errors}")


if __name__ == "__main__":
    download_tiles()
```

### 2. Webアプリの地図タイル参照先を変更

`webapp/src/components/FlightMap.tsx` のタイルレイヤー設定を以下のように変更する。

**変更前:**
```javascript
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
  maxZoom: 18,
}).addTo(map);
```

**変更後:**
```javascript
// 航空写真（ベース）
L.tileLayer("/tiles/ort/{z}/{x}/{y}.jpg", {
  attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>",
  maxZoom: 15,
}).addTo(map);

// 陰影起伏図（オーバーレイ）
L.tileLayer("/tiles/hillshademap/{z}/{x}/{y}.png", {
  attribution: "",
  maxZoom: 15,
  opacity: 0.3,
}).addTo(map);
```

### 3. Leaflet CSSのローカル配置

`webapp/src/app/layout.tsx` で読み込んでいるLeaflet CSSもオフライン用にローカルに配置する。

```bash
# node_modulesからコピー
cp webapp/node_modules/leaflet/dist/leaflet.css webapp/public/leaflet.css
```

**layout.tsxの変更前:**
```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" ... />
```

**layout.tsxの変更後:**
```html
<link rel="stylesheet" href="/leaflet.css" />
```

## 出典表示（必須）

国土地理院タイルの利用にあたり、地図上に以下の出典を表示すること。

> 出典: 国土地理院 (https://maps.gsi.go.jp/development/ichiran.html)

上記手順のattribution設定で対応済み。

## 注意事項

- ダウンロードスクリプトは中断しても再実行すれば未取得分のみダウンロードする（リジューム対応）
- サーバー負荷軽減のため、リクエスト間隔を100ms空けている。全量取得に約15〜20分程度かかる
- ズームレベル16以降が必要な場合は `ZOOM_MAX` を変更する。ただしタイル数はレベルごとに約4倍に増加する
- タイル範囲外にスクロールすると灰色（タイルなし）になる。運用範囲に応じて `RANGE_KM` を調整すること
