#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ogn-mqtt.py のパーサ回帰テスト。

v1.1.43 で修正したバグを再発させないための最小限のテスト。依存は標準ライブラリ
のみ（paho はスタブする）。

    python3 test-ogn-mqtt-parse.py

背景: ogn-decode の集計行は平均SNRを %4.1f で出力するため、10dB 未満の機体は
"< 8.6dB>" と先頭に空白が入る。この空白を許さない正規表現だったため、受信の
弱い機体の集計行がパースできず、その位置行が「リスト上ひとつ前の機体」に
取り込まれていた。2機の座標が1本の航跡に交互に入り、航跡がジグザグになる／
機体どうしで航跡が入れ替わる原因になっていた。
"""
import importlib.util
import math
import sys
import types


def load_ogn_mqtt():
    """paho をスタブして ogn-mqtt.py を読み込む。"""
    paho = types.ModuleType("paho")
    mqtt_pkg = types.ModuleType("paho.mqtt")
    client_mod = types.ModuleType("paho.mqtt.client")

    class _Client:
        pass

    client_mod.Client = _Client
    client_mod.CallbackAPIVersion = types.SimpleNamespace(VERSION2=2)
    sys.modules.update({
        "paho": paho,
        "paho.mqtt": mqtt_pkg,
        "paho.mqtt.client": client_mod,
    })
    spec = importlib.util.spec_from_file_location("ogn_mqtt", "ogn-mqtt.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ogn_mqtt"] = mod
    spec.loader.exec_module(mod)
    return mod


# ── テスト用の aircraft-list.txt 生成 ──────────────────────────────────────

def hhmmss(sec_of_day):
    return "%02d%02d%02d" % (
        sec_of_day // 3600, (sec_of_day % 3600) // 60, sec_of_day % 60)


def make_block(device_id, avg_snr_db, lat0, lon0, t_start, count,
               track_deg, speed_ms):
    """1機ぶんの集計行＋位置行（1Hz・直線飛行）を ogn-decode の書式で作る。"""
    head = (
        "%s [   %2d/   %2dsec] 1:2:%s F*  < 0.1m/s> <%4.1fdB>, "
        "<0.0bit/packet>, < +9.12(0.00)kHz>  +1.0dB@10km(26751)"
        % (device_id, count, count, device_id[3:], avg_snr_db)
    )
    lines = [head]
    for i in range(count):
        dist = speed_ms * i
        lat = lat0 + (dist * math.cos(math.radians(track_deg))) / 111320.0
        lon = lon0 + (dist * math.sin(math.radians(track_deg))) / (
            111320.0 * math.cos(math.radians(lat0)))
        lines.append(
            "%s: [ %+010.5f,%+011.5f]deg  %4dm  +0.0m/s  %4.1fm/s %05.1fdeg "
            " +0.0deg/s __1 02x03m Fn:00fop+13.31kHz  7.8/20.5dB/0  0e "
            "    0.4km 006.9deg  +0.7deg"
            % (hhmmss(t_start + i), lat, lon, 800, speed_ms, track_deg)
        )
    return "\n".join(lines)


# ── テスト本体 ────────────────────────────────────────────────────────────

def test_weak_signal_header_parses(m):
    """SNR が 10dB 未満でも集計行を読めること（先頭の空白に耐える）。"""
    line = ("FLRDB0253 [   20/  141sec] 1:2:DB0253 F*  < 0.1m/s> < 8.6dB>, "
            "<1.8bit/packet>, <+13.47(0.32)kHz>  -2.4dB@10km(13501)")
    got = m.parse_aircraft_header(line)
    assert got is not None, "弱信号の集計行がパースできない"
    assert got["device_id"] == "FLRDB0253"
    assert abs(got["avg_snr_db"] - 8.6) < 1e-9


def test_no_cross_contamination(m):
    """弱信号機が前の機体の航跡に混ざらないこと。"""
    strong = make_block("FLRAAA111", 25.8, 43.5530, 141.8947, 36000, 30, 45.0, 30.0)
    weak = make_block("FLRBBB222", 8.6, 43.6100, 141.9500, 36000, 30, 225.0, 28.0)
    parsed = m.parse_aircraft_list(strong + "\n" + weak + "\n")

    assert set(parsed) == {"FLRAAA111", "FLRBBB222"}, \
        "機体が欠落している: %s" % sorted(parsed)
    for device_id, expected_lat in (("FLRAAA111", 43.55), ("FLRBBB222", 43.61)):
        for pos in parsed[device_id]["positions"]:
            assert abs(pos["latitude"] - expected_lat) < 0.05, \
                "%s の航跡に別機体の座標が混入している" % device_id


def test_positions_sorted_and_deduped(m):
    """位置が時刻順に並び、重複が落ちていること。"""
    block = make_block("FLRAAA111", 25.8, 43.5530, 141.8947, 36000, 10, 45.0, 30.0)
    lines = block.split("\n")
    # リングバッファの折り返しと再送を模して、順序を崩し重複を足す
    shuffled = [lines[0]] + lines[6:] + lines[1:6] + [lines[3]]
    parsed = m.parse_aircraft_list("\n".join(shuffled) + "\n")
    positions = parsed["FLRAAA111"]["positions"]

    stamps = [p["timestamp_epoch"] for p in positions]
    assert stamps == sorted(stamps), "位置が時刻順に並んでいない"
    assert len(stamps) == len(set(stamps)) == 10, \
        "重複が落ちていない: %d件" % len(stamps)
    assert parsed["FLRAAA111"]["latest_position"]["timestamp_epoch"] == max(stamps), \
        "latest_position が最新でない"


def test_hhmmss_timestamp(m):
    """位置の時刻 HHMMSS が秒数として誤解釈されないこと。"""
    line = ("073015: [ +43.55299,+141.89478]deg    28m  +0.0m/s   0.1m/s "
            "180.0deg  +0.0deg/s __1 03x03m Fn:13___ +0.50kHz 44.5/58.0dB/0 "
            " 0e     0.4km 090.0deg +28.3deg")
    pos = m.parse_position_line(line)
    assert pos is not None, "位置行がパースできない"
    assert pos["timestamp_sod"] == 7 * 3600 + 30 * 60 + 15, \
        "HHMMSS を秒数として扱っている: %d" % pos["timestamp_sod"]
    assert pos["timestamp_utc"][11:19] == "07:30:15", pos["timestamp_utc"]


def test_negative_altitude(m):
    """高度が負でも位置行を取りこぼさないこと。"""
    line = ("073015: [ +43.55299,+141.89478]deg    -5m  +0.0m/s   0.1m/s "
            "180.0deg  +0.0deg/s __1 03x03m Fn:13___ +0.50kHz 44.5/58.0dB/0 "
            " 0e     0.4km 090.0deg +28.3deg")
    pos = m.parse_position_line(line)
    assert pos is not None, "高度が負の位置行を落としている"
    assert pos["altitude_m"] == -5


def test_absurd_position_rejected(m):
    """復号エラーで壊れた座標・高度・距離の位置行を落とすこと。"""
    base = ("073015: [ {lat},{lon}]deg {alt}m  +0.0m/s   0.1m/s "
            "180.0deg  +0.0deg/s __1 03x03m Fn:13___ +0.50kHz 44.5/58.0dB/0 "
            " 0e  {dist}km 090.0deg +28.3deg")
    ok = base.format(lat="+43.55299", lon="+141.89478", alt="   28", dist="   0.4")
    assert m.parse_position_line(ok) is not None, "正常な位置行まで落としている"
    for tag, bad in (
        ("緯度が範囲外", base.format(lat="+93.55299", lon="+141.89478", alt="   28", dist="   0.4")),
        ("経度が範囲外", base.format(lat="+43.55299", lon="+191.89478", alt="   28", dist="   0.4")),
        ("高度がありえない", base.format(lat="+43.55299", lon="+141.89478", alt="31000", dist="   0.4")),
        ("距離がありえない", base.format(lat="+43.55299", lon="+141.89478", alt="   28", dist="9999.0")),
    ):
        assert m.parse_position_line(bad) is None, "%s を通している" % tag


def test_continuity_filter(m):
    """直前の位置からありえない速度で飛んだ位置を落とすこと。"""
    def pos(t, lat, lon, alt):
        return {"timestamp_epoch": float(t), "latitude": lat, "longitude": lon,
                "altitude_m": alt}

    prev = pos(1000, 43.5530, 141.8947, 800)
    # 1秒で 30m 進む（108 km/h）＝ 正常
    assert m.is_continuous(prev, pos(1001, 43.55327, 141.8947, 802)),         "正常な動きを落としている"
    # 1秒で 0.1度（約11km）飛ぶ ＝ 復号エラー
    assert not m.is_continuous(prev, pos(1001, 43.6530, 141.8947, 800)),         "座標の飛躍を通している"
    # 1秒で 200m 上昇 ＝ 復号エラー
    assert not m.is_continuous(prev, pos(1001, 43.5530, 141.8947, 1000)),         "高度の飛躍を通している"
    # 10分あいたら判断できないので通す
    assert m.is_continuous(prev, pos(1000 + 600, 43.6530, 141.8947, 800)),         "間隔が空いた場合まで落としている"


def test_single_packet_is_a_ghost(m):
    """復号エラーで機体IDが壊れてできた幽霊を見分けられること。

    本物の機体は 1Hz で送り続けるのでパケット数が増えるが、壊れたIDは 1 の
    まま増えない。直前の位置と比べる方法では「初めて見る機体」なので弾けず、
    パケット数で見るしかない。
    """
    ghost = ("FLRFB0727 [    1/    1sec] 1:2:FB0727 F*  < 0.1m/s> <12.3dB>, "
             "<0.0bit/packet>, < +9.12(0.00)kHz>")
    real = ("FLRDB0727 [   60/   60sec] 1:2:DB0727 F*  < 0.1m/s> <12.3dB>, "
            "<0.0bit/packet>, < +9.12(0.00)kHz>")
    g = m.parse_aircraft_header(ghost)
    r = m.parse_aircraft_header(real)
    assert g is not None and r is not None, "集計行がパースできない"
    assert g["packets_received"] < m.MIN_PACKETS_TO_PUBLISH,         "1パケットの機体を確認済みとみなしている"
    assert r["packets_received"] >= m.MIN_PACKETS_TO_PUBLISH,         "本物の機体を幽霊とみなしている"


def main():
    m = load_ogn_mqtt()
    tests = [
        test_weak_signal_header_parses,
        test_no_cross_contamination,
        test_positions_sorted_and_deduped,
        test_hhmmss_timestamp,
        test_negative_altitude,
        test_absurd_position_rejected,
        test_continuity_filter,
        test_single_packet_is_a_ghost,
    ]
    failed = 0
    for test in tests:
        try:
            test(m)
        except AssertionError as err:
            failed += 1
            print("FAIL %s: %s" % (test.__name__, err))
        else:
            print("ok   %s" % test.__name__)
    if failed:
        print("\n%d 件失敗" % failed)
        return 1
    print("\n%d 件すべて成功" % len(tests))
    return 0


if __name__ == "__main__":
    sys.exit(main())
