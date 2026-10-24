import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 版数は package.json をファイルとして読む。`import pkg from "./package.json"` だと、
// Raspberry Pi(armhf)が使う WebAssembly 版の変換器では設定ファイルが ESM のまま読み込まれ、
// Node 20 が JSON の import に属性(with { type: "json" })を求めて build も start も失敗する
// (v1.4.36 = Next.js 16.4.2 で発生。x64/arm64 のネイティブ版の変換器では起きない)。
const configDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
const pkg = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  // ビルドした版数をクライアントとサーバの両方に焼き込む。
  // 開きっぱなしの画面が更新後も古いJSで動き続けないよう、VersionWatcher が
  // 自分の版数と /api/version(動いているサーバの版数)を比べて再読み込みする。
  env: { FEELDSCOPE_BUILD_VERSION: pkg.version },
};

export default nextConfig;
