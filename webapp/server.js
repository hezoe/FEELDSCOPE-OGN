// FEELDSCOPE-OGN custom server
// Next.js を素で起動しつつ、実接続の送信元IP(socket.remoteAddress)を x-client-ip に載せる。
// これにより API 側で「10.66.10.0/24(CATVPN オペレーター) からのアクセス＝リモートサポート中の管理者」
// を判定できる。クライアント詐称防止のため、外部由来の x-client-ip/x-real-ip は破棄して上書きする。
const { createServer } = require("http");
const next = require("next");

const port = parseInt(process.env.PORT || "80", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
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
