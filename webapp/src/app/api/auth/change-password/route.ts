import { NextResponse } from "next/server";
import { getAuthContext, changePassword } from "@/lib/auth";

export async function POST(request: Request) {
  const ctx = await getAuthContext(request);
  // ログイン済み or オペレーター(リモートサポート)でなければ不可
  if (!ctx.loggedIn && !ctx.isOperator) {
    return NextResponse.json({ ok: false, error: "認証が必要です", needsAuth: true }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const newPassword = String(body.newPassword || "");
  const current = body.current != null ? String(body.current) : null;
  // オペレーターは現在パスワード不要（失念時の解除・リセット用）
  const result = await changePassword(newPassword, current, ctx.isOperator);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, message: "パスワードを変更しました" });
}
