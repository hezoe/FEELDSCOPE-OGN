import { NextResponse } from "next/server";
import { getAuthContext, isAuthorizedToMutate } from "@/lib/auth";
import {
  GAIN_STEPS,
  SHARED_FIELDS,
  type SkylensConfig,
  applySharedPositionToOgn,
  getSkylensStatus,
  isActive,
  readSkylensConfig,
  restartSkylens,
  validateSkylensConfig,
  writeSkylensConfigFile,
} from "@/lib/skylens-config";

// GET /api/skylens — 設定と実測ステータス
export async function GET() {
  const [config, status] = await Promise.all([readSkylensConfig(), getSkylensStatus()]);
  return NextResponse.json({
    config,
    status,
    shared_fields: SHARED_FIELDS,
    gain_steps: GAIN_STEPS,
  });
}

// POST /api/skylens — 保存 / 再起動（いずれも管理者ログインが必要）
export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;

  const ctx = await getAuthContext(request);
  if (!isAuthorizedToMutate(ctx)) {
    return NextResponse.json(
      { error: "設定変更には管理者ログインが必要です。", needsAuth: true },
      { status: 401 }
    );
  }

  try {
    switch (action) {
      case "save": {
        const c = body.config as SkylensConfig;
        if (!c) throw new Error("設定がありません");
        validateSkylensConfig(c);

        await writeSkylensConfigFile(c);
        // 局位置は OGN 側にも反映する（受信機は 1 台なので座標は共有）
        await applySharedPositionToOgn(c.latitude, c.longitude, c.elevationM);

        // 稼働中なら反映のため再起動する。ブリッジも局位置を読み直す必要がある
        const restarted = await restartSkylens();
        return NextResponse.json({
          ok: true,
          message: restarted
            ? "SkyLens設定を保存し、受信機を再起動しました。復調プランが JAPAN であることを確認してください。"
            : "SkyLens設定を保存しました。次回の SkyLens 受信開始時に反映されます。",
        });
      }

      case "restart": {
        if (!(await isActive("skylens"))) {
          return NextResponse.json(
            { error: "SkyLens は稼働していません。設定画面で SkyLens 受信に切り替えてください。" },
            { status: 400 }
          );
        }
        await restartSkylens();
        return NextResponse.json({ ok: true, message: "SkyLens を再起動しました。" });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
