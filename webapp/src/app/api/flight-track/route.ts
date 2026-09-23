import { NextRequest, NextResponse } from "next/server";
import { getFlightTrack } from "@/lib/flight-tracker";

// 機体クリックで「今のフライト」の航跡を返す(表示専用・READ ONLY)。
// 航跡は flight-tracker がメモリ上に保持している(地上に戻ると90秒で消える)。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const device = (req.nextUrl.searchParams.get("device") || "").trim();
  if (!device) return NextResponse.json({ error: "device required" }, { status: 400 });
  const points = getFlightTrack(device);
  return NextResponse.json({ device, count: points.length, points });
}
