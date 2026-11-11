import { NextResponse } from "next/server";
import { verifyPassword, issueSession, sessionCookieHeader, loginRateOk, clientIpFromRequest } from "@/lib/auth";

export async function POST(request: Request) {
  // R-032: 総当たり対策(IPごと10分で8回まで)
  if (!loginRateOk(clientIpFromRequest(request))) {
    return NextResponse.json({ ok: false, error: "試行回数が多すぎます。しばらく待ってからやり直してください" }, { status: 429 });
  }
  const { password } = await request.json().catch(() => ({ password: "" }));
  if (!(await verifyPassword(String(password || "")))) {
    return NextResponse.json({ ok: false, error: "パスワードが違います" }, { status: 401 });
  }
  const token = await issueSession();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
