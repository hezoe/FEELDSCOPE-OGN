import { NextResponse } from "next/server";
import { verifyPassword, issueSession, sessionCookieHeader } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: "" }));
  if (!(await verifyPassword(String(password || "")))) {
    return NextResponse.json({ ok: false, error: "パスワードが違います" }, { status: 401 });
  }
  const token = await issueSession();
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
