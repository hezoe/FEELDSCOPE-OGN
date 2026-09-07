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
ZOOM_MIN = 0
ZOOM_MAX = 17
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
