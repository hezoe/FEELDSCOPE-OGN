#!/usr/bin/env python3
"""FEELDSCOPE 初回起動の自動インストール中に、進み具合をブラウザで見せる小さな Web サーバ（ポート80）。

feeldscope-firstboot.sh が /run/feeldscope-firstboot/status.json に書く状態と、ログの末尾を表示する。
インストーラーが FEELDSCOPE 本体（同じポート80）を起動する直前にこのサービスを止める。
"""
import html
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATUS = os.environ.get("FB_STATUS", "/run/feeldscope-firstboot/status.json")
LOG = os.environ.get("FB_LOG", "/var/log/feeldscope-firstboot.log")
PORT = int(os.environ.get("FB_PORT", "80"))
STEPS = ["準備（領域の拡張・再起動）", "インターネット接続の確認", "OGN 受信ソフトの準備",
         "FEELDSCOPE の取得", "FEELDSCOPE のインストール（20〜40分）", "完了"]


def read_status():
    try:
        with open(STATUS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"step": 1, "title": "準備", "message": "起動しています。", "state": "running", "started": time.time()}


def tail(path, n=30):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.readlines()[-n:]
    except Exception:
        return []


def page():
    s = read_status()
    step, state = int(s.get("step", 1)), s.get("state", "running")
    elapsed = int((time.time() - float(s.get("started", time.time()))) / 60)
    items = []
    for i, name in enumerate(STEPS, 1):
        if i < step or (i == step and state == "done"):
            mark, cls = "✓", "done"
        elif i == step:
            mark, cls = ("!" if state == "error" else "…"), ("error" if state == "error" else "now")
        else:
            mark, cls = "", "todo"
        items.append(f'<li class="{cls}"><span class="mk">{mark}</span>{html.escape(name)}</li>')
    log_html = html.escape("".join(tail(LOG)))
    refresh = "" if state == "done" else '<meta http-equiv="refresh" content="15">'
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">{refresh}
<title>FEELDSCOPE セットアップ中</title>
<style>
body{{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#f4f7f9;color:#1d2a33;margin:0;padding:24px 16px}}
main{{max-width:640px;margin:0 auto}}
h1{{font-size:1.4rem;margin:0 0 4px}} .sub{{color:#5a6a74;margin:0 0 20px;font-size:.9rem}}
.msg{{background:#fff;border:1px solid #d5dde2;border-radius:8px;padding:14px 16px;margin-bottom:16px}}
.msg.error{{border-color:#d33;background:#fff3f3}}
ol{{list-style:none;padding:0;margin:0 0 16px}} li{{padding:6px 0;display:flex;gap:10px;align-items:center}}
.mk{{width:1.6em;height:1.6em;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;background:#e3e8ec;color:#5a6a74;flex:none}}
.done .mk{{background:#2f7d4f;color:#fff}} .now .mk{{background:#1d5a85;color:#fff}} .error .mk{{background:#d33;color:#fff}}
.todo{{color:#8a99a3}}
details{{font-size:.8rem}} pre{{white-space:pre-wrap;background:#1d2a33;color:#dfe7ec;padding:10px;border-radius:6px;max-height:320px;overflow:auto}}
</style></head><body><main>
<h1>FEELDSCOPE をセットアップしています</h1>
<p class="sub">経過 {elapsed} 分 ・ この画面は15秒ごとに更新されます。電源を切らずにお待ちください。</p>
<div class="msg {'error' if state == 'error' else ''}"><b>{html.escape(s.get('title', ''))}</b><br>{html.escape(s.get('message', ''))}</div>
<ol>{''.join(items)}</ol>
<details><summary>詳しいログ（最新30行）</summary><pre>{log_html}</pre></details>
</main></body></html>"""


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = page().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
