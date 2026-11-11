// FEELDSCOPE-OGN custom server
// Next.js を素で起動しつつ、実接続の送信元IP(socket.remoteAddress)を x-client-ip に載せる。
// これにより API 側で「10.66.10.0/24(CATVPN オペレーター) からのアクセス＝リモートサポート中の管理者」
// を判定できる。クライアント詐称防止のため、外部由来の x-client-ip/x-real-ip は破棄して上書きする。
const { createServer } = require("http");
const os = require("os");
const next = require("next");

// ── R-033/R-077 (2026-11-11): CSRF・DNS リバインディング対策 ──────────────────
// 「LAN の中からしか届かない」前提を、場内 PC のブラウザを踏み台にして外部の Web ページが
// 破る攻撃(クロスサイト POST / DNS リバインディング)を入口で遮断する。
// ・Host: IPリテラル / localhost / 自機ホスト名(+.local) / *.feeldscope.wg のみ許可
//   (攻撃者のドメイン名で届く要求 = DNS リバインディングを拒否)
// ・GET/HEAD/OPTIONS 以外で Origin ヘッダがある場合、Origin のホストが Host と一致する時だけ許可
//   (ブラウザのクロスサイト送信 = CSRF を拒否。curl 等 Origin の無いクライアントは従来どおり)
function stripPort(h) {
  if (!h) return "";
  const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h);      // [IPv6]:port
  if (m) return m[1].toLowerCase();
  return h.replace(/:\d+$/, "").toLowerCase();
}
function hostHeaderOk(hostHeader) {
  const h = stripPort(hostHeader);
  if (!h) return true;                               // ヘルスチェック等 Host 無しは許可
  if (h === "localhost") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;   // IPv4 リテラル
  if (h.includes(":")) return true;                  // IPv6 リテラル
  const self = os.hostname().toLowerCase();
  if (h === self || h === `${self}.local` || h.endsWith(".feeldscope.wg")) return true;
  // デモ等、固有のドメイン名で公開する場合は FEELDSCOPE_EXTRA_HOSTS=カンマ区切り で許可
  const extra = (process.env.FEELDSCOPE_EXTRA_HOSTS || "").toLowerCase().split(",").map((s) => s.trim());
  return extra.includes(h);
}
function originOk(req) {
  const m = (req.method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const origin = req.headers.origin;
  if (!origin) return true;                          // ブラウザ以外(スクリプト・機器内部)
  if (origin === "null") return false;               // サンドボックス iframe 等からの送信は拒否
  let oh;
  try { oh = new URL(origin).hostname.toLowerCase(); } catch { return false; }
  return oh === stripPort(req.headers.host);
}

const port = parseInt(process.env.PORT || "80", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    // R-033/R-077: Host / Origin 検査(上の関数参照)
    if (!hostHeaderOk(req.headers.host) || !originOk(req)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "forbidden (bad host or origin)" }));
      return;
    }
    const ip = (req.socket && req.socket.remoteAddress) || "";
    // 詐称防止: クライアント供給ヘッダを消してから実IPを設定
    delete req.headers["x-client-ip"];
    delete req.headers["x-real-ip"];
    req.headers["x-client-ip"] = ip;
    handle(req, res);
  });
  // 待ち受けに失敗したら(ポート80が使用中など)終了し、systemd(Restart=on-failure)に起動し直させる。
  // Next.js は uncaughtException を記録するだけで終了しないため、ここで終了しないと
  // 待ち受けていないまま「動作中」に見え続け、画面が開かない（2026-10-01 専用イメージの初回インストールで発生）。
  server.on("error", (err) => {
    console.error(`feeldscope-webapp: listen failed on ${hostname}:${port}: ${err && err.message}`);
    process.exit(1);
  });
  server.listen(port, hostname, () => {
    console.log(`feeldscope-webapp (custom server) listening on ${hostname}:${port}`);
  });
});
