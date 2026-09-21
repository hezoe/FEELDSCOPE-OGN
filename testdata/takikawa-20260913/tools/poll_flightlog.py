# -*- coding: utf-8 -*-
"""受信機の /api/flight-log を GET だけで定期取得し、変化を1行ずつ出力する（受信機には書き込まない）。
使い方: FEELDSCOPE_URL=http://<受信機> python tools/poll_flightlog.py [間隔秒]
出力: 変化があった行だけ stdout と ../flightlog-changes.log に追記。最新の全体は ../flight-log-latest.json。
"""
import json, os, sys, time, urllib.request

URL = os.environ.get("FEELDSCOPE_URL", "http://feeldscope.local") + "/api/flight-log"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..")
INTERVAL = int(sys.argv[1]) if len(sys.argv) > 1 else 60


def now():
    return time.strftime("%H:%M:%S")


def emit(msg):
    line = f"{now()} {msg}"
    print(line, flush=True)
    with open(os.path.join(OUT, "flightlog-changes.log"), "a", encoding="utf-8") as f:
        f.write(line + "\n")


def fmt(e):
    ra = e.get("releaseAlt")
    rd = e.get("releaseDist")
    return (f"{e.get('registration') or e.get('deviceId')}({e.get('deviceId')}) "
            f"TO={e.get('takeoffTime')} LD={e.get('landingTime') or '-'} "
            f"RA={ra if ra is not None else '-'} RD={round(rd) if rd is not None else '-'}")


prev_entries = {}
prev_phases = {}
fails = 0
while True:
    try:
        with urllib.request.urlopen(URL, timeout=20) as r:
            d = json.load(r)
        if fails:
            emit(f"RECOVERED after {fails} failures")
        fails = 0
        with open(os.path.join(OUT, "flight-log-latest.json"), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)
        entries = {e["id"]: e for e in d.get("entries", [])}
        for i, e in entries.items():
            if i not in prev_entries:
                emit("NEW  " + fmt(e))
            elif fmt(e) != fmt(prev_entries[i]):
                emit("UPD  " + fmt(prev_entries[i]) + "  ->  " + fmt(e))
        for i, e in prev_entries.items():
            if i not in entries:
                emit("GONE " + fmt(e))
        phases = d.get("phases", {})
        for dev, ph in phases.items():
            if prev_phases.get(dev) != ph:
                emit(f"PHASE {dev} {prev_phases.get(dev)} -> {ph}")
        prev_entries, prev_phases = entries, phases
    except Exception as ex:
        fails += 1
        if fails in (1, 3, 10) or fails % 30 == 0:
            emit(f"FETCH_FAIL#{fails} {ex}")
    time.sleep(INTERVAL)
