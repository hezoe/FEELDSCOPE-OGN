import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";

export async function GET(request: Request) {
  const ctx = await getAuthContext(request);
  return NextResponse.json({
    loggedIn: ctx.loggedIn,
    isOperator: ctx.isOperator,
    mustChange: ctx.mustChange,
    // 変更操作が可能か（ログイン or オペレーター）
    canMutate: ctx.loggedIn || ctx.isOperator,
  });
}
