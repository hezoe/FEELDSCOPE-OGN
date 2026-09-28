import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/version - 動いているサーバのビルド版数(ビルド時に焼き込んだ値)。
// package.json をその場で読むと、更新中(git pull 後・再起動前)に新しい版数を返して
// 古いサーバのページへ再読み込みさせてしまうので、ビルド時の値を返す。
export async function GET() {
  return NextResponse.json(
    { version: process.env.FEELDSCOPE_BUILD_VERSION || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
