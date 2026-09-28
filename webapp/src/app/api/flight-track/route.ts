import { NextRequest, NextResponse } from "next/server";
import { getFlightTrack } from "@/lib/flight-tracker";

// 機体クリックで「このフライト」の航跡を返す(表示専用・READ ONLY)。
// 航跡は flight-tracker がメモリ上に保持している。離陸(滑走の始まり)から着陸までで、
// 着陸後も次のフライトが始まるまで残る(webapp の再起動で消える)。
// active = まだ飛行中で航跡が伸びている。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const device = (req.nextUrl.searchParams.get("device") || "").trim();
  if (!device) return NextResponse.json({ error: "device required" }, { status: 400 });
  const { points, active } = getFlightTrack(device);
  return NextResponse.json({ device, count: points.length, active, points });
}
