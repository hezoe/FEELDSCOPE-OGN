import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // ビルドした版数をクライアントとサーバの両方に焼き込む。
  // 開きっぱなしの画面が更新後も古いJSで動き続けないよう、VersionWatcher が
  // 自分の版数と /api/version(動いているサーバの版数)を比べて再読み込みする。
  env: { FEELDSCOPE_BUILD_VERSION: pkg.version },
};

export default nextConfig;
